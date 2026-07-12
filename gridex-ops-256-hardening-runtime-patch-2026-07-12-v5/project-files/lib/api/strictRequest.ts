import { createHash } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'

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
  const key = request.headers.get('idempotency-key')?.trim() ?? ''
  if (key.length < 8 || key.length > 200) {
    throw new ApiInputError('Idempotency-Key krävs och måste vara 8–200 tecken.', 'idempotency_key_required', 400)
  }
  return key
}

function payloadHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export async function claimPortalWriteIdempotency(input: {
  companyId: string
  clientId: string
  customerId: string
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

  const existing = await supabaseService
    .from('customer_portal_write_idempotency')
    .select('id,status,response_status,response_body,request_hash,started_at')
    .eq('company_id', input.companyId)
    .eq('api_client_id', input.clientId)
    .eq('customer_id', input.customerId)
    .eq('route', input.operation)
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle()
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
