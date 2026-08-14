import { createHash } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import { isValidIdempotencyKey } from '@/lib/api/idempotencyKey'

export class ApiInputError extends Error {
  readonly status: number
  readonly code: string
  readonly field: string | null

  constructor(message: string, code = 'invalid_request', status = 422, field: string | null = null) {
    super(message)
    this.name = 'ApiInputError'
    this.status = status
    this.code = code
    this.field = field
  }
}

export async function readJsonObject(request: NextRequest, maxBytes = 256_000): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ApiInputError('Request body är för stor.', 'payload_too_large', 413)
  }
  const raw = await request.text()
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) throw new ApiInputError('Request body är för stor.', 'payload_too_large', 413)
  if (!raw.trim()) throw new ApiInputError('JSON body saknas.', 'json_body_missing', 400)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ApiInputError('JSON body är ogiltig.', 'invalid_json', 400)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiInputError('JSON body måste vara ett objekt.', 'invalid_json_object', 400)
  }
  return parsed as Record<string, unknown>
}

export function requireIsoDate(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) throw new ApiInputError(`${field} måste anges som YYYY-MM-DD.`, 'invalid_date', 422, field)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new ApiInputError(`${field} är inte ett giltigt kalenderdatum.`, 'invalid_date', 422, field)
  }
  return text
}

export function requireIdempotencyKey(request: NextRequest): string {
  const key = request.headers.get('idempotency-key') ?? ''
  if (!key) throw new ApiInputError('Idempotency-Key krävs.', 'idempotency_key_required', 400)
  if (!isValidIdempotencyKey(key)) throw new ApiInputError('Idempotency-Key har ogiltigt format.', 'idempotency_key_invalid', 400)
  return key
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

function payloadHash(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex')
}

export async function claimPortalWriteIdempotency(input: {
  companyId: string
  clientId: string
  customerId: string | null
  operation: string
  idempotencyKey: string
  payload: unknown
}): Promise<{ replay: boolean; recordId: string; statusCode?: number; responseBody?: unknown }> {
  const requestHash = payloadHash(input.payload)
  const now = new Date().toISOString()
  const inserted = await supabaseService
    .from('customer_portal_write_idempotency')
    .insert({
      company_id: input.companyId,
      api_client_id: input.clientId,
      customer_id: input.customerId,
      route: input.operation,
      idempotency_key: input.idempotencyKey,
      request_hash: requestHash,
      status: 'processing',
      started_at: now,
      updated_at: now,
    })
    .select('id,status,response_status,response_body,request_hash')
    .maybeSingle()

  if (!inserted.error && inserted.data) {
    return { replay: false, recordId: String(inserted.data.id) }
  }

  if (String(inserted.error?.code ?? '') !== '23505') throw inserted.error

  let existingQuery = supabaseService
    .from('customer_portal_write_idempotency')
    .select('id,status,response_status,response_body,request_hash,started_at')
    .eq('company_id', input.companyId)
    .eq('api_client_id', input.clientId)
    .eq('route', input.operation)
    .eq('idempotency_key', input.idempotencyKey)
  existingQuery = input.customerId === null
    ? existingQuery.is('customer_id', null)
    : existingQuery.eq('customer_id', input.customerId)
  const existing = await existingQuery.maybeSingle()
  if (existing.error) throw existing.error
  if (!existing.data) throw new Error('Idempotency-raden kunde inte läsas efter konflikt.')
  if (String(existing.data.request_hash) !== requestHash) {
    throw new ApiInputError('Idempotency-Key har redan använts med annan payload.', 'idempotency_conflict', 409)
  }
  if (String(existing.data.status) === 'completed') {
    return {
      replay: true,
      recordId: String(existing.data.id),
      statusCode: Number(existing.data.response_status ?? 200),
      responseBody: existing.data.response_body,
    }
  }
  if (
    String(existing.data.status) === 'failed' &&
    input.operation === '/api/v1/customer/move-out'
  ) {
    const retried = await supabaseService
      .from('customer_portal_write_idempotency')
      .update({
        status: 'processing',
        error_code: null,
        response_status: null,
        response_body: null,
        started_at: now,
        completed_at: null,
        updated_at: now,
      })
      .eq('id', existing.data.id)
      .eq('company_id', input.companyId)
      .eq('status', 'failed')
      .select('id')
      .maybeSingle()
    if (retried.error) throw retried.error
    if (retried.data) {
      return { replay: false, recordId: String(retried.data.id) }
    }
  }
  if (String(existing.data.status) === 'failed') {
    throw new ApiInputError(
      'Ett tidigare anrop med samma Idempotency-Key misslyckades. Kontrollera resursens status innan en ny nyckel används.',
      'idempotency_previous_attempt_failed',
      409,
    )
  }
  throw new ApiInputError('Ett identiskt anrop behandlas redan.', 'idempotency_in_progress', 409)
}

export async function completePortalWriteIdempotency(input: {
  recordId: string
  companyId: string
  statusCode: number
  responseBody: unknown
}): Promise<void> {
  const { data, error } = await supabaseService
    .from('customer_portal_write_idempotency')
    .update({
      status: 'completed',
      response_status: input.statusCode,
      response_body: input.responseBody,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.recordId)
    .eq('company_id', input.companyId)
    .eq('status', 'processing')
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Idempotency-raden kunde inte slutföras säkert.')
}

export async function failPortalWriteIdempotency(input: {
  recordId: string
  companyId: string
  errorCode: string
}): Promise<void> {
  const { error } = await supabaseService
    .from('customer_portal_write_idempotency')
    .update({
      status: 'failed',
      error_code: input.errorCode,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.recordId)
    .eq('company_id', input.companyId)
  if (error) throw error
}

export type IdempotentWriteResult<T> = {
  statusCode: number
  body: T
}

/**
 * Executes an external customer write once for a tenant/client/customer tuple.
 * The callback must contain the complete business mutation. Replays return the
 * stored response and conflicting payloads are rejected before any write runs.
 */
export async function executeIdempotentPortalWrite<T>(input: {
  request: NextRequest
  companyId: string
  clientId: string
  customerId: string | null
  operation: string
  payload: unknown
  execute: () => Promise<IdempotentWriteResult<T>>
}): Promise<IdempotentWriteResult<T> & { replayed: boolean }> {
  const idempotencyKey = requireIdempotencyKey(input.request)
  const claim = await claimPortalWriteIdempotency({
    companyId: input.companyId,
    clientId: input.clientId,
    customerId: input.customerId,
    operation: input.operation,
    idempotencyKey,
    payload: input.payload,
  })

  if (claim.replay) {
    return {
      statusCode: claim.statusCode ?? 200,
      body: claim.responseBody as T,
      replayed: true,
    }
  }

  try {
    const result = await input.execute()
    await completePortalWriteIdempotency({
      recordId: claim.recordId,
      companyId: input.companyId,
      statusCode: result.statusCode,
      responseBody: result.body,
    })
    return { ...result, replayed: false }
  } catch (error) {
    const errorCode = error instanceof ApiInputError ? error.code : 'write_failed'
    await failPortalWriteIdempotency({
      recordId: claim.recordId,
      companyId: input.companyId,
      errorCode,
    }).catch(() => undefined)
    throw error
  }
}
