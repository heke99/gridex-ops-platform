import { supabaseService } from '@/lib/supabase/service'

type RpcResult = { data: unknown; error: unknown }
type RpcRequest = PromiseLike<RpcResult> & { abortSignal?: (signal: AbortSignal) => PromiseLike<RpcResult> }
type Rpc = (name: string, params: Record<string, unknown>) => RpcRequest

function requestSupplyFollowup(name: string, params: Record<string, unknown>, signal?: AbortSignal): PromiseLike<RpcResult> {
  const request = (supabaseService.rpc.bind(supabaseService) as unknown as Rpc)(name, params)
  return signal && request.abortSignal ? request.abortSignal(signal) : request
}
export type SupplyEndFollowup = { status: 'created' | 'existing' | 'not_applicable'; effectReceiptId: string; sourceMessageId: string; caseId?: string }
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)

/** The genuine committed receipt owns scope and period; this command projects
 * an operational task, never supply approval or whole-message completion. */
export async function projectSupplyEndFollowup(input: { companyId: string; actorUserId: string; effectReceiptId: string; signal?: AbortSignal }): Promise<SupplyEndFollowup> {
  if (!uuid(input.companyId) || !uuid(input.actorUserId) || !uuid(input.effectReceiptId)) throw Error('supply_followup_identity_required')
  const { data, error } = await requestSupplyFollowup('ediel_project_supply_end_followup_v1', {
    p_company_id: input.companyId, p_effect_receipt_id: input.effectReceiptId, p_actor_user_id: input.actorUserId,
  }, input.signal)
  if (error) throw error
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('supply_followup_result_invalid')
  const result = data as Record<string, unknown>
  if (!['created', 'existing', 'not_applicable'].includes(String(result.status)) || result.effectReceiptId !== input.effectReceiptId
    || !uuid(result.sourceMessageId) || (result.status !== 'not_applicable' && !uuid(result.caseId))) throw Error('supply_followup_result_invalid')
  return { status: result.status as SupplyEndFollowup['status'], effectReceiptId: input.effectReceiptId, sourceMessageId: result.sourceMessageId,
    ...(result.status !== 'not_applicable' ? { caseId: result.caseId as string } : {}) }
}

const SUPPLY_END_FOLLOWUP_BUDGET_MS = 5_000

/** Claim one durable source receipt at a time after the deadline commits. */
export async function projectDueSupplyEndFollowups(input: { companyId?: string | null; actorUserId: string; limit: number }): Promise<void> {
  const signal = AbortSignal.timeout(SUPPLY_END_FOLLOWUP_BUDGET_MS)
  const seen = new Set<string>()
  let failed = 0
  let firstError: unknown

  for (let attempted = 0; attempted < input.limit && !signal.aborted; attempted++) {
    const { data, error } = await requestSupplyFollowup('gridex_list_due_supply_end_followups_v1', {
      p_company_id: input.companyId ?? null,
      p_actor_user_id: input.actorUserId,
    }, signal)
    if (error) throw error
    if (!Array.isArray(data) || data.length > 1) throw Error('supply_followup_due_result_invalid')
    if (data.length === 0) break
    const row: unknown = data[0]
    if (!row || typeof row !== 'object' || !('company_id' in row) || !uuid(row.company_id) ||
      !('effect_receipt_id' in row) || !uuid(row.effect_receipt_id) ||
      (input.companyId && row.company_id !== input.companyId)) throw Error('supply_followup_due_result_invalid')
    if (seen.has(row.effect_receipt_id) || signal.aborted) break

    seen.add(row.effect_receipt_id)
    try {
      await projectSupplyEndFollowup({ companyId: row.company_id, effectReceiptId: row.effect_receipt_id, actorUserId: input.actorUserId, signal })
    } catch (cause) {
      failed += 1
      firstError ??= cause
    }
  }
  if (failed > 0) {
    throw new Error(`Kunde inte skapa uppföljning för ${failed} leveransslut. Kvittona finns kvar för omtag i schemakörningen.`, { cause: firstError })
  }
}


type LegacySupplyEndFollowup = { status: 'scheduled' | 'created' | 'existing' | 'not_applicable' }

export async function projectLegacySupplyEndFollowup(input: {
  companyId: string; actorUserId: string; sourceMessageId: string; supplyPeriodId: string; signal?: AbortSignal
}): Promise<LegacySupplyEndFollowup> {
  if (![input.companyId, input.actorUserId, input.sourceMessageId, input.supplyPeriodId].every(uuid)) {
    throw Error('legacy_end_followup_identity_required')
  }
  const { data, error } = await requestSupplyFollowup('gridex_project_legacy_supply_end_followup_v1', {
    p_company_id: input.companyId, p_source_message_id: input.sourceMessageId,
    p_supply_period_id: input.supplyPeriodId, p_actor_user_id: input.actorUserId,
  }, input.signal)
  if (error) throw error
  const result = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
  if (result.sourceMessageId !== input.sourceMessageId || result.supplyPeriodId !== input.supplyPeriodId
    || !['scheduled', 'created', 'existing', 'not_applicable'].includes(String(result.status))
    || (['created', 'existing'].includes(String(result.status)) && !uuid(result.caseId))) {
    throw Error('legacy_end_followup_result_invalid')
  }
  return { status: result.status as LegacySupplyEndFollowup['status'] }
}

export async function projectDueLegacySupplyEndFollowups(input: {
  companyId?: string | null; actorUserId: string; limit: number
}): Promise<void> {
  const signal = AbortSignal.timeout(SUPPLY_END_FOLLOWUP_BUDGET_MS)
  const seen = new Set<string>()
  const failures: unknown[] = []
  for (let attempted = 0; attempted < input.limit && !signal.aborted; attempted++) {
    const { data, error } = await requestSupplyFollowup('gridex_list_due_legacy_supply_end_followups_v1', {
      p_company_id: input.companyId ?? null, p_actor_user_id: input.actorUserId,
    }, signal)
    if (error) throw error
    if (!Array.isArray(data) || data.length > 1) throw Error('legacy_end_followup_due_result_invalid')
    if (data.length === 0) break
    const row = data[0] as Record<string, unknown>
    if (!row || !uuid(row.company_id) || !uuid(row.source_message_id) || !uuid(row.supply_period_id)
      || (input.companyId && row.company_id !== input.companyId)) throw Error('legacy_end_followup_due_result_invalid')
    const key = row.company_id + ':' + row.source_message_id + ':' + row.supply_period_id
    if (seen.has(key) || signal.aborted) break
    seen.add(key)
    try {
      await projectLegacySupplyEndFollowup({
        companyId: row.company_id, sourceMessageId: row.source_message_id, supplyPeriodId: row.supply_period_id,
        actorUserId: input.actorUserId, signal,
      })
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Uppföljning av äldre leveransslut inväntar nästa schemakörning.')
}
