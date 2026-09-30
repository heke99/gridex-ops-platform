import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'

type Rpc = (name: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
export type SupplyCommitScope = { switchRequestId: string; supplyPeriodId: string; customerId: string; meteringPointId: string; siteId: string }
export type SupplyMarketResult = { applied: boolean; reason: string | null; idempotent: boolean; periods: Array<{ id: string; status: string }>; commits: SupplyCommitScope[] }
const rpc = () => supabaseService.rpc.bind(supabaseService) as unknown as Rpc

/** Execution derives every legal/object/date fact again from the accepted own
 * immutable source. Mutable parsed payload and caller correlation are not inputs. */
export async function applySupplyMarketSource(input: { actorUserId: string; message: Pick<EdielMessageRow, 'id' | 'company_id' | 'direction' | 'message_family' | 'message_code'> }): Promise<SupplyMarketResult> {
  if (!input.message.company_id || input.message.direction !== 'inbound' || input.message.message_family !== 'PRODAT' || !['Z04', 'Z05'].includes(String(input.message.message_code ?? '').toUpperCase().slice(0, 3))) {
    return { applied: false, reason: 'not_inbound_supply_source', idempotent: false, periods: [],commits: [] }
  }
  const { data, error } = await rpc()('ediel_apply_supply_source_v1', { p_company_id: input.message.company_id, p_source_message_id: input.message.id, p_actor_user_id: input.actorUserId })
  if (error) throw error
  const result = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
  const periods = Array.isArray(result.periods) ? result.periods.filter((p): p is { id: string; status: string } => p !== null && typeof p === 'object' && typeof p.id === 'string' && typeof p.status === 'string').map(p => ({ id: p.id, status: p.status })) : []
  const commits: SupplyCommitScope[] = []
  if (result.commits != null) {
    if (!Array.isArray(result.commits)) throw new Error('normal_supply_commit_scope_invalid')
    for (const value of result.commits) {
      if (!value || typeof value !== 'object' || ['switchRequestId','supplyPeriodId','customerId','meteringPointId','siteId'].some(key => typeof value[key] !== 'string' || !value[key])) throw new Error('normal_supply_commit_scope_invalid')
      commits.push(value as SupplyCommitScope)
    }
  }
  return { applied: result.applied === true, reason: typeof result.reason === 'string' ? result.reason : null, idempotent: result.idempotent === true, periods,commits }
}

export async function supplyStartAlreadyCancelled(input: { companyId: string; switchRequestId: string }): Promise<boolean> {
  const { data, error } = await rpc()('ediel_supply_start_is_cancelled_v1', { p_company_id: input.companyId, p_switch_request_id: input.switchRequestId })
  if (error) throw error
  return data === true
}

/** Accepted exact ends and genuinely confirmed due normal starts use their
 * native source owners. A sweep never emits an outgoing wire or retries. */
export async function advanceSupplyMarketDeadlines(input: { actorUserId: string; companyId?: string | null; limit?: number }): Promise<{ updated: number }> {
  const { data, error } = await rpc()('ediel_advance_supply_deadlines_v1', { p_company_id: input.companyId ?? null, p_actor_user_id: input.actorUserId, p_limit: Math.min(Math.max(Math.floor(input.limit ?? 100), 1), 200) })
  if (error) throw error
  const result = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
  return { updated: typeof result.updated === 'number' ? result.updated : 0 }
}
