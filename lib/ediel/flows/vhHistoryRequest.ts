import { vhHistoryAuditArgs, type VhHistoryAuditInput, type VhHistoryRequestState, type VhHistoryRpcClient } from '../services/vhHistoryDelivery'

/** Links an ALREADY genuinely sent, source-qualified VH E73. The SQL rechecks
 * its exact company/customer/original/window/point/target and serializes it
 * with closure. This write operation adds no audit/read prerequisite; the SQL
 * link is authoritative for scope, closed-state and exact replay. This flow
 * creates no request, wire, outbox item, grant or retry.
 * It is not the shared dispatcher guard for previously queued/claimed jobs. */
export async function linkExistingVhHistoryRequest(client: VhHistoryRpcClient, input: VhHistoryAuditInput & {
  siteId: string; requestId: string; messageId: string; transactionId: string
}): Promise<{ requestId: string; state: VhHistoryRequestState; idempotent: boolean; transportAuthorityGranted: false }> {
  if (![input.siteId, input.requestId, input.messageId].every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) || !input.transactionId || input.transactionId.length > 35 || /[\x00-\x1f\x7f-\x9f]/.test(input.transactionId) || / $/.test(input.transactionId)) throw new Error('vh_history_request_scope_unqualified')
  const requestId = input.requestId.toLowerCase()
  const { data, error } = await client.rpc('ediel_link_vh_history_request_v1', { ...vhHistoryAuditArgs(input), p_site_id: input.siteId.toLowerCase(), p_request_id: requestId, p_message_id: input.messageId.toLowerCase(), p_transaction_id: input.transactionId })
  if (error) throw error
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('vh_history_request_result_invalid')
  const row = data as Record<string, unknown>
  if (row.requestId !== requestId || !['awaiting', 'completed', 'manual_review'].includes(String(row.state)) || typeof row.idempotent !== 'boolean' || row.transportAuthorityGranted !== false) throw new Error('vh_history_request_result_invalid')
  return { requestId, state: row.state as VhHistoryRequestState, idempotent: row.idempotent, transportAuthorityGranted: false }
}
