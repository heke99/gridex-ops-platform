import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { ApiInputError } from '@/lib/api/strictRequest'
import { StaffApiError } from '@/lib/staff-api/errors'
import { getSupabaseServiceEnv } from '@/lib/env/supabaseServer'
import { supabaseService, createSupabaseServiceRequestClient } from '@/lib/supabase/service'

export type ResourceContext = {
  companyId: string; userId: string; client: { id: string }; sessionId: string
  sessionRevision: number; nativeSessionId: string; requestId: string; correlationId: string
}
export type Row = Record<string, unknown>
export type ResourcePage = { limit: number; returned: number; has_more: boolean; next_cursor: string | null }
export const CASE_STATUSES = ['open', 'action_required', 'awaiting_external_response', 'billing_blocked', 'manual_follow_up', 'resolved', 'cancelled', 'closed'] as const
export const WRITE_STATUSES = ['open', 'action_required', 'awaiting_external_response', 'manual_follow_up', 'resolved', 'closed'] as const
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
const CUSTOMER_STATUSES = ['draft', 'pending_verification', 'active', 'inactive', 'moved', 'terminated', 'blocked', 'archived']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function invalid(field: string, message = 'Fältet är ogiltigt.', status = 422, code = 'invalid_request'): never {
  throw new ApiInputError(message, code, status, field)
}
export function fields(body: Row, allowed: readonly string[]) {
  for (const key of Object.keys(body)) if (!allowed.includes(key)) invalid(key, 'Fältet stöds inte.')
}
export function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > max) invalid(field)
  return value.trim()
}
export function optionalText(value: unknown, field: string, max: number): string | null {
  return value === undefined || value === null ? null : requiredText(value, field, max)
}
export function reference(value: unknown, kind: string, field = 'reference'): string {
  if (typeof value !== 'string' || !new RegExp(`^${kind}_[A-Za-z0-9_-]{20,64}$`).test(value)) invalid(field)
  return value
}
export function enumValue<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) invalid(field)
  return value as T
}
export function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) invalid(field)
  const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-T:]/).map(Number)
  const calendar = new Date(Date.UTC(year, month - 1, day))
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) invalid(field)
  return value
}
export function resourceQuery(params: URLSearchParams, operation: string) {
  const allowed = ['limit', 'cursor', ...(operation === 'customers' ? ['q', 'status', 'customer_type'] : operation === 'cases' ? ['q', 'status', 'priority', 'customer_reference', 'assignee_reference'] : operation === 'assignees' ? ['q'] : [])]
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) invalid(key, 'Query-parametern är ogiltig.', 400)
  }
  const rawLimit = params.get('limit')
  const limit = rawLimit === null ? 50 : Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (rawLimit !== null && !/^\d+$/.test(rawLimit))) invalid('limit', 'Limit måste vara 1–100.', 400)
  const filters: Record<string, string> = {}
  for (const key of allowed.filter(key => !['limit', 'cursor'].includes(key))) {
    const raw = params.get(key)
    if (raw === null) continue
    const value = raw.trim()
    if (key === 'q') { if (value.length < 2 || value.length > 120 || value.includes('\0')) invalid(key, 'Söktext måste vara 2–120 tecken.', 400) }
    else if (key === 'status') enumValue(value, operation === 'customers' ? CUSTOMER_STATUSES : CASE_STATUSES, key)
    else if (key === 'customer_type') enumValue(value, ['private', 'business', 'association'], key)
    else if (key === 'priority') enumValue(value, PRIORITIES, key)
    else reference(value, key === 'customer_reference' ? 'customer' : 'staff', key)
    filters[key] = value
  }
  const cursor = params.get('cursor')
  if (cursor !== null && (!cursor || cursor.length > 4096)) invalid('cursor', 'Cursor är ogiltig.', 400, 'invalid_cursor')
  return { limit, cursor, filters }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Row).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
export function requestFingerprint(value: unknown) { return createHash('sha256').update(canonical(value)).digest('hex') }
function binding(context: Pick<ResourceContext, 'companyId' | 'userId' | 'client'>, resource: string, parent: string, filters: Row) {
  return canonical([context.companyId, context.userId, context.client.id, resource, parent, filters])
}
function cursorKey() { return createHash('sha256').update(`gridex-staff-cursor:v1:${getSupabaseServiceEnv().serviceRoleKey}`).digest() }
export function encodeStaffCursor(context: Pick<ResourceContext, 'companyId' | 'userId' | 'client'>, resource: string, parent: string, filters: Row, tuple: { id: string; created_at: string }) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', cursorKey(), iv)
  const bytes = Buffer.concat([cipher.update(JSON.stringify({ version: 1, binding: binding(context, resource, parent, filters), tuple }), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64url')
}
export function decodeStaffCursor(cursor: string | null, context: Pick<ResourceContext, 'companyId' | 'userId' | 'client'>, resource: string, parent: string, filters: Row): { id: string; created_at: string } | null {
  if (cursor === null) return null
  try {
    const bytes = Buffer.from(cursor, 'base64url')
    if (bytes.length < 29 || bytes.toString('base64url') !== cursor) throw new Error('invalid')
    const decipher = createDecipheriv('aes-256-gcm', cursorKey(), bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28))
    const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'))
    if (value.version !== 1 || value.binding !== binding(context, resource, parent, filters) || !UUID.test(value.tuple?.id ?? '')) throw new Error('invalid')
    timestamp(value.tuple?.created_at, 'cursor')
    return value.tuple
  } catch { return invalid('cursor', 'Cursor är ogiltig för denna resurs.', 400, 'invalid_cursor') }
}
export function databaseError(error: unknown): never {
  const value = error as { code?: string; message?: string }
  const code = value?.message ?? ''
  if (value?.code === '55P03' && code === 'staff_session_busy') throw new StaffApiError(409, code, 'En annan sessionåtgärd pågår. Försök igen.', true, [], 1)
  if (code === 'staff_rate_limited') throw new StaffApiError(429, code, 'För många staffåtgärder. Försök igen senare.', true, [], 60)
  if (code === 'attachment_quota_exceeded') throw new StaffApiError(429, code, 'För många bilagor för kunden det senaste dygnet. Försök igen senare.', true, [], 86_400)
  const statuses: Record<string, number> = { customer_not_found: 404, support_case_not_found: 404, attachment_not_found: 404, support_case_closed: 409, support_case_version_conflict: 409, support_assignee_ineligible: 409, idempotency_conflict: 409, idempotency_in_progress: 409, attachment_unavailable: 409, attachment_quota_exceeded: 429, invalid_request: 422 }
  if (statuses[code]) throw new ApiInputError('Åtgärden kunde inte utföras.', code, statuses[code])
  if (value?.code === '42501') throw new ApiInputError('Behörighet saknas för åtgärden.', 'staff_permission_denied', 403)
  throw error
}
export async function readRows(context: ResourceContext, operation: string, parent: string, query: ReturnType<typeof resourceQuery>) {
  const after = decodeStaffCursor(query.cursor, context, operation, parent, query.filters)
  const { data, error } = await supabaseService.rpc('staff_api_read_resources', { p_company_id: context.companyId, p_operation: operation, p_reference: parent || null, p_filters: query.filters, p_after: after, p_limit: query.limit + 1 })
  if (error) databaseError(error)
  if (!data || typeof data !== 'object' || !Array.isArray(data.rows)) throw new Error('Invalid staff resource read result')
  return data.rows as Row[]
}
export function pageRows<T>(context: ResourceContext, operation: string, parent: string, query: ReturnType<typeof resourceQuery>, rows: Row[], mapper: (row: Row) => T) {
  const selected = rows.slice(0, query.limit); const last = selected.at(-1)
  const hasMore = rows.length > query.limit
  return { data: selected.map(mapper), page: { limit: query.limit, returned: selected.length, has_more: hasMore, next_cursor: hasMore && last ? encodeStaffCursor(context, operation, parent, query.filters, { id: String(last.id), created_at: String(last.created_at) }) : null } }
}
export function commandArgs(context: ResourceContext) {
  return { p_session_id: context.sessionId, p_revision: context.sessionRevision, p_user_id: context.userId, p_native_session_id: context.nativeSessionId, p_client_id: context.client.id, p_company_id: context.companyId }
}
export function commandDatabase(context: ResourceContext) { return createSupabaseServiceRequestClient({ requestId: context.requestId, correlationId: context.correlationId }) }
