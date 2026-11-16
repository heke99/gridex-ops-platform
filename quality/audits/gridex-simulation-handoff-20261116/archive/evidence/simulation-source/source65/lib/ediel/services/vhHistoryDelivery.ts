/** Internal history-job metadata only. This never reads E66 quantities or
 * creates a beneficiary grant. The actual SQL RPC checks current tenant actor
 * permissions; this typed IO port needs the sole generated-types handoff before
 * a protected Supabase caller can be wired. No generated-schema cast/fallback. */
export type VhHistoryRpcClient = {
  rpc(name: 'ediel_vh_history_delivery_audit_v1' | 'ediel_link_vh_history_request_v1',
    args: Record<string, string>): PromiseLike<{ data: unknown; error: unknown }>
}
export type VhHistoryAuditInput = { companyId: string; permissionId: string; actorUserId: string }
export type VhHistoryRequestState = 'awaiting' | 'completed' | 'manual_review'
export type VhHistoryRequest = {
  requestId: string; messageId: string; transactionId: string
  state: VhHistoryRequestState; closedByMessageId: string | null
}
export type VhHistoryObjectAudit = {
  siteId: string; point: string; product: string; approvedStart: string; approvedEnd: string; basisHash: string
  closure: { sourceMessageId: string; status: 'complete' | 'gaps' | 'held'; reviewHash: string; gaps: string[] } | null
  closureHistory: { sourceMessageId: string; reviewHash: string; restoredByMessageId: string | null }[]
  requests: VhHistoryRequest[]
}
export type VhHistoryDeliveryAudit = {
  companyId: string; permissionId: string; environment: 'test' | 'production'
  state: 'approved_or_receiving' | 'historical_delivery_closed'; openingSourceMessageId: string
  objects: VhHistoryObjectAudit[]; dataAccessGranted: false; transportAuthorityGranted: false
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('vh_history_audit_result_invalid')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) throw new Error('vh_history_audit_result_invalid')
  return value
}
function uuid(value: unknown): string {
  const result = text(value)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result)) throw new Error('vh_history_audit_scope_invalid')
  return result.toLowerCase()
}
function hash(value: unknown): string {
  const result = text(value)
  if (!/^[0-9a-f]{64}$/.test(result)) throw new Error('vh_history_audit_result_invalid')
  return result
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('vh_history_audit_result_invalid')
  return value
}
function choice<T extends string>(value: unknown, allowed: readonly T[]): T {
  const result = text(value)
  if (!allowed.includes(result as T)) throw new Error('vh_history_audit_result_invalid')
  return result as T
}
export function vhHistoryAuditArgs(input: VhHistoryAuditInput): Record<string, string> {
  return { p_company_id: uuid(input.companyId), p_permission_id: uuid(input.permissionId), p_actor_user_id: uuid(input.actorUserId) }
}
export async function readVhHistoryDeliveryAudit(client: VhHistoryRpcClient, input: VhHistoryAuditInput): Promise<VhHistoryDeliveryAudit | null> {
  const args = vhHistoryAuditArgs(input)
  const { data, error } = await client.rpc('ediel_vh_history_delivery_audit_v1', args)
  if (error) throw error
  if (data === null) return null
  const row = object(data)
  if (row.companyId !== args.p_company_id || row.permissionId !== args.p_permission_id || row.dataAccessGranted !== false || row.transportAuthorityGranted !== false) throw new Error('vh_history_audit_scope_invalid')
  const objects = list(row.objects).map(value => {
    const item = object(value), start = text(item.approvedStart), end = text(item.approvedEnd)
    if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start)) throw new Error('vh_history_audit_result_invalid')
    const closure = item.closure === null ? null : (() => {
      const c = object(item.closure), review = object(c.review)
      return { sourceMessageId: uuid(c.sourceMessageId), status: choice(c.status, ['complete', 'gaps', 'held'] as const), reviewHash: hash(c.reviewHash), gaps: list(review.gaps).map(g => text(object(g).reason)) }
    })()
    return {
      siteId: uuid(item.siteId), point: text(item.point), product: text(item.product), approvedStart: start, approvedEnd: end, basisHash: hash(item.basisHash), closure,
      closureHistory: list(item.closureHistory).map(value => { const c = object(value); return { sourceMessageId: uuid(c.sourceMessageId), reviewHash: hash(c.reviewHash), restoredByMessageId: c.restoredByMessageId === null ? null : uuid(c.restoredByMessageId) } }),
      requests: list(item.requests).map(value => { const q = object(value); return { requestId: uuid(q.requestId), messageId: uuid(q.messageId), transactionId: text(q.transactionId), state: choice(q.state, ['awaiting', 'completed', 'manual_review'] as const), closedByMessageId: q.closedByMessageId === null ? null : uuid(q.closedByMessageId) } }),
    }
  })
  if (!objects.length || new Set(objects.map(o => o.siteId)).size !== objects.length) throw new Error('vh_history_audit_result_invalid')
  return { companyId: args.p_company_id, permissionId: args.p_permission_id, environment: choice(row.environment, ['test', 'production'] as const), state: choice(row.state, ['approved_or_receiving', 'historical_delivery_closed'] as const), openingSourceMessageId: uuid(row.openingSourceMessageId), objects, dataAccessGranted: false, transportAuthorityGranted: false }
}
