import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { SourceObjectScope } from '@/lib/ediel/sources/sourceOwnerWire'

type Rpc = (name: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
export type SupplyCommitScope = { switchRequestId: string; supplyPeriodId: string; customerId: string; meteringPointId: string; siteId: string }
export type SupplyObjectPartition = { object: SourceObjectScope } & (
  | { disposition: 'applied'; effectReceiptId: string; effectFactsHash: string }
  | { disposition: 'held'; reason: string }
)
export type SupplyMarketResult = { applied: boolean; reason: string | null; idempotent: boolean; periods: Array<{ id: string; status: string }>; commits: SupplyCommitScope[];
  /** Null identifies an established legacy result with no prospective own receipts. */
  partition: SupplyObjectPartition[] | null; effectReceiptIds: string[]; fullyApplied: boolean; reviewRequired: boolean }
const rpc = () => supabaseService.rpc.bind(supabaseService) as unknown as Rpc
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const nullableText = (value: unknown): value is string | null => value === null || typeof value === 'string'
const index = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

function readPartition(value: unknown): SupplyObjectPartition[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8192) throw Error('supply_object_partition_invalid')
  const seen = new Set<number>()
  return value.map(entry => {
    if (!record(entry) || !record(entry.object)) throw Error('supply_object_partition_invalid')
    const object = entry.object
    if (object.messageIndex !== 0 || !nullableText(object.messageReference) || !nullableText(object.objectId)
      || !nullableText(object.identityAgency) || !Array.isArray(object.registers) || object.registers.length < 1 || object.registers.length > 8192)
      throw Error('supply_object_partition_invalid')
    const registers: SourceObjectScope['registers'] = object.registers.map(register => {
      if (!record(register) || !index(register.lineIndex) || !index(register.segmentIndex) || !nullableText(register.lineNumber)
        || !nullableText(register.registerIndex) || !index(register.registerPosition) || register.registerPosition < 1 || seen.has(register.segmentIndex))
        throw Error('supply_object_partition_invalid')
      seen.add(register.segmentIndex)
      return { lineIndex: register.lineIndex, segmentIndex: register.segmentIndex, lineNumber: register.lineNumber,
        registerIndex: register.registerIndex, registerPosition: register.registerPosition }
    })
    const scope: SourceObjectScope = { messageIndex: 0, messageReference: object.messageReference, objectId: object.objectId,
      identityAgency: object.identityAgency, registers }
    if (entry.disposition === 'held' && typeof entry.reason === 'string' && entry.reason.length > 0)
      return { object: scope, disposition: 'held', reason: entry.reason }
    if (entry.disposition === 'applied' && typeof scope.objectId === 'string' && scope.objectId.length > 0
      && typeof scope.identityAgency === 'string' && scope.identityAgency.length > 0 && uuid(entry.effectReceiptId) && typeof entry.effectFactsHash === 'string' && /^[a-f\d]{64}$/i.test(entry.effectFactsHash))
      return { object: scope, disposition: 'applied', effectReceiptId: entry.effectReceiptId, effectFactsHash: entry.effectFactsHash }
    throw Error('supply_object_partition_invalid')
  })
}

/** Execution derives every legal/object/date fact again from the accepted own
 * immutable source. Mutable parsed payload and caller correlation are not inputs. */
export async function applySupplyMarketSource(input: { actorUserId: string; message: Pick<EdielMessageRow, 'id' | 'company_id' | 'direction' | 'message_family' | 'message_code'> }): Promise<SupplyMarketResult> {
  if (!input.message.company_id || input.message.direction !== 'inbound' || input.message.message_family !== 'PRODAT' || !['Z04', 'Z05'].includes(String(input.message.message_code ?? '').toUpperCase().slice(0, 3))) {
    return { applied: false, reason: 'not_inbound_supply_source', idempotent: false, periods: [],commits: [],partition: null,effectReceiptIds: [],fullyApplied: false,reviewRequired: false }
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
  const partition = result.partition === undefined ? null : readPartition(result.partition)
  const applied = result.applied === true
  const effectReceiptIds = partition?.flatMap(entry => entry.disposition === 'applied' ? [entry.effectReceiptId] : []) ?? []
  if (partition && (applied !== (effectReceiptIds.length > 0) || new Set(effectReceiptIds).size !== effectReceiptIds.length
    || (applied && (!Array.isArray(result.effectReceiptIds) || result.effectReceiptIds.length !== effectReceiptIds.length || new Set(result.effectReceiptIds).size !== result.effectReceiptIds.length
      || result.effectReceiptIds.some(id => !uuid(id) || !effectReceiptIds.includes(id)))))) throw Error('supply_object_partition_effect_mismatch')
  if (partition && !applied && commits.length) throw Error('supply_object_partition_effect_mismatch')
  const fullyApplied = applied && (partition === null || partition.every(entry => entry.disposition === 'applied'))
  return { applied, reason: typeof result.reason === 'string' ? result.reason : null, idempotent: result.idempotent === true,
    periods,commits,partition,effectReceiptIds,fullyApplied,reviewRequired: partition !== null && !fullyApplied }
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
