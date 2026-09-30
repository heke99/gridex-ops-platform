import { createHash } from 'node:crypto'
import type { EdielProjectionField, EdielProjectionRequest } from './types'

const fields = new Set<EdielProjectionField>(['reading_at', 'quantity', 'unit', 'quality', 'qualifier', 'registration_date', 'resolution', 'product_id'])
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const allowed = new Set(['grantId', 'grantVersion', 'purpose', 'fields', 'start', 'end', 'limit', 'cursor'])
export class EdielProjectionQueryError extends Error {}
function invalid(): never { throw new EdielProjectionQueryError('Ogiltig projekteringsförfrågan.') }
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return invalid()
  return new Date(value).toISOString()
}
function scopeHash(input: EdielProjectionRequest): string {
  return createHash('sha256').update(JSON.stringify([input.beneficiaryCompanyId, input.actorUserId, input.grantId,
    input.expectedGrantVersion, input.purpose, input.seriesId, [...input.fields].sort(), input.startInclusive, input.endExclusive])).digest('hex')
}

/** Every page goes through the current grant RPC. The cursor only selects an
 * ordered position inside that same tenant/user/grant/version/field/time scope. */
export function parseEdielProjectionRequest(input: { query: URLSearchParams; seriesId: string; companyId: string; actorUserId: string }): EdielProjectionRequest {
  for (const key of input.query.keys()) if (!allowed.has(key) || input.query.getAll(key).length !== 1) invalid()
  const grantId = input.query.get('grantId') ?? ''
  const version = input.query.get('grantVersion') ?? ''
  const purpose = input.query.get('purpose')?.trim() ?? ''
  const selected = (input.query.get('fields') ?? '').split(',')
  const limit = input.query.get('limit') ?? '100'
  if (!uuid.test(input.seriesId) || !uuid.test(grantId) || !uuid.test(input.companyId) || !uuid.test(input.actorUserId) ||
      !/^[1-9]\d{0,8}$/.test(version) || !purpose || purpose.length > 128 || /[\r\n\x00]/.test(purpose) ||
      !selected.length || selected.length > fields.size || new Set(selected).size !== selected.length || selected.some(value => !fields.has(value as EdielProjectionField)) ||
      !/^[1-9]\d{0,3}$/.test(limit) || Number(limit) > 1000) invalid()
  const request: EdielProjectionRequest = { beneficiaryCompanyId: input.companyId, actorUserId: input.actorUserId,
    grantId, expectedGrantVersion: Number(version), purpose, seriesId: input.seriesId, fields: selected as EdielProjectionField[],
    startInclusive: timestamp(input.query.get('start')), endExclusive: timestamp(input.query.get('end')), limit: Number(limit) }
  if (request.startInclusive >= request.endExclusive) invalid()
  const cursor = input.query.get('cursor')
  if (cursor != null) {
    if (!cursor || cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor)) invalid()
    try {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { v?: unknown; scope?: unknown; readingAt?: unknown; valueId?: unknown }
      if (decoded.v !== 1 || decoded.scope !== scopeHash(request) || typeof decoded.valueId !== 'string' || !uuid.test(decoded.valueId)) invalid()
      const readingAt = timestamp(decoded.readingAt)
      if (readingAt < request.startInclusive || readingAt >= request.endExclusive) invalid()
      request.after = { readingAt, valueId: decoded.valueId }
    } catch { invalid() }
  }
  return request
}

export function createEdielProjectionCursor(request: EdielProjectionRequest, next: { readingAt: string; valueId: string } | null): string | null {
  if (!next) return null
  const readingAt = timestamp(next.readingAt)
  if (!uuid.test(next.valueId) || readingAt < request.startInclusive || readingAt >= request.endExclusive) throw new Error('ediel_projection_cursor_invalid')
  return Buffer.from(JSON.stringify({ v: 1, scope: scopeHash(request), readingAt, valueId: next.valueId })).toString('base64url')
}
