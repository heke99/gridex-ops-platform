import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { isValidIdempotencyKey } from '@/lib/api/idempotencyKey'

export class IntegrationWriteIdempotencyError extends Error {
  readonly status: number
  readonly code: string
  readonly field: string
  readonly retryable: boolean

  constructor(input: {
    message: string
    code: string
    status: number
    retryable?: boolean
  }) {
    super(input.message)
    this.name = 'IntegrationWriteIdempotencyError'
    this.status = input.status
    this.code = input.code
    this.field = 'Idempotency-Key'
    this.retryable = input.retryable === true
  }
}

export type IntegrationWriteIdempotencyClaim =
  | { outcome: 'disabled' }
  | { outcome: 'claimed'; recordId: string }
  | {
      outcome: 'replay'
      recordId: string
      statusCode: number
      responseBody: unknown
    }

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function integrationWriteRequestHash(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex')
}

function normalizeIdempotencyKey(
  value: string | null | undefined,
  required: boolean,
): string | null {
  const key = value ?? ''
  if (!key) {
    if (required) {
      throw new IntegrationWriteIdempotencyError({
        message: 'Idempotency-Key krävs för denna skrivoperation.',
        code: 'idempotency_key_required',
        status: 400,
      })
    }
    return null
  }
  if (!isValidIdempotencyKey(key)) {
    throw new IntegrationWriteIdempotencyError({
      message: 'Idempotency-Key har ogiltigt format.',
      code: 'idempotency_key_invalid',
      status: 400,
    })
  }
  return key
}

function databaseCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

export async function claimIntegrationWriteIdempotency(input: {
  companyId: string
  apiClientId: string
  route: string
  idempotencyKey?: string | null
  payload: unknown
  required?: boolean
}): Promise<IntegrationWriteIdempotencyClaim> {
  const idempotencyKey = normalizeIdempotencyKey(
    input.idempotencyKey,
    input.required === true,
  )
  if (!idempotencyKey) return { outcome: 'disabled' }

  const requestHash = integrationWriteRequestHash(input.payload)
  const now = new Date().toISOString()
  const inserted = await supabaseService
    .from('integration_api_write_idempotency')
    .insert({
      company_id: input.companyId,
      api_client_id: input.apiClientId,
      route: input.route,
      idempotency_key: idempotencyKey,
      request_hash: requestHash,
      status: 'processing',
      started_at: now,
      updated_at: now,
    })
    .select('id')
    .maybeSingle()

  if (!inserted.error && inserted.data?.id) {
    return { outcome: 'claimed', recordId: String(inserted.data.id) }
  }

  if (databaseCode(inserted.error) !== '23505') {
    throw new IntegrationWriteIdempotencyError({
      message:
        'Idempotensskyddet kunde inte verifieras. Ingen ny skrivoperation startades.',
      code: 'idempotency_store_unavailable',
      status: 503,
      retryable: true,
    })
  }

  const existing = await supabaseService
    .from('integration_api_write_idempotency')
    .select(
      'id,status,response_status,response_body,request_hash,error_code,started_at',
    )
    .eq('company_id', input.companyId)
    .eq('api_client_id', input.apiClientId)
    .eq('route', input.route)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()

  if (existing.error || !existing.data) {
    throw new IntegrationWriteIdempotencyError({
      message:
        'Idempotensposten kunde inte läsas efter en konflikt. Ingen ny skrivoperation startades.',
      code: 'idempotency_store_unavailable',
      status: 503,
      retryable: true,
    })
  }

  if (String(existing.data.request_hash ?? '') !== requestHash) {
    throw new IntegrationWriteIdempotencyError({
      message: 'Idempotency-Key har redan använts med ett annat innehåll.',
      code: 'idempotency_conflict',
      status: 409,
    })
  }

  const status = String(existing.data.status ?? '')
  if (
    status === 'completed' &&
    Number.isInteger(Number(existing.data.response_status)) &&
    existing.data.response_body !== null
  ) {
    return {
      outcome: 'replay',
      recordId: String(existing.data.id),
      statusCode: Number(existing.data.response_status),
      responseBody: existing.data.response_body,
    }
  }

  if (status === 'failed') {
    throw new IntegrationWriteIdempotencyError({
      message:
        'Ett tidigare anrop med samma Idempotency-Key misslyckades. Använd en ny nyckel efter att felet har åtgärdats.',
      code: 'idempotency_previous_attempt_failed',
      status: 409,
    })
  }

  throw new IntegrationWriteIdempotencyError({
    message: 'Ett identiskt anrop behandlas redan.',
    code: 'idempotency_in_progress',
    status: 409,
    retryable: true,
  })
}

export async function completeIntegrationWriteIdempotency(input: {
  recordId: string | null
  companyId: string
  statusCode: number
  responseBody: unknown
}): Promise<boolean> {
  if (!input.recordId) return true

  const completedAt = new Date().toISOString()
  const { data, error } = await supabaseService
    .from('integration_api_write_idempotency')
    .update({
      status: 'completed',
      response_status: input.statusCode,
      response_body: input.responseBody,
      error_code: null,
      completed_at: completedAt,
      updated_at: completedAt,
    })
    .eq('id', input.recordId)
    .eq('company_id', input.companyId)
    .eq('status', 'processing')
    .select('id')
    .maybeSingle()

  if (error || !data) {
    throw new IntegrationWriteIdempotencyError({
      message: 'Affärssvaret kunde inte bindas atomiskt till Idempotency-Key. Svaret hålls tillbaka och anropet får återförsökas.',
      code: 'idempotency_completion_unavailable',
      status: 503,
      retryable: true,
    })
  }
  return true
}

export async function failIntegrationWriteIdempotency(input: {
  recordId: string | null
  companyId: string
  errorCode: string
}): Promise<boolean> {
  if (!input.recordId) return true

  try {
    const completedAt = new Date().toISOString()
    const { error } = await supabaseService
      .from('integration_api_write_idempotency')
      .update({
        status: 'failed',
        response_status: null,
        response_body: null,
        error_code: input.errorCode,
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq('id', input.recordId)
      .eq('company_id', input.companyId)
      .eq('status', 'processing')

    if (error) {
      console.error('[integration-write-idempotency] failure_state_failed', {
        recordId: input.recordId,
        companyId: input.companyId,
        errorCode: databaseCode(error),
      })
      return false
    }
    return true
  } catch (error) {
    console.error('[integration-write-idempotency] failure_state_unavailable', {
      recordId: input.recordId,
      companyId: input.companyId,
      errorCode: databaseCode(error),
    })
    return false
  }
}
