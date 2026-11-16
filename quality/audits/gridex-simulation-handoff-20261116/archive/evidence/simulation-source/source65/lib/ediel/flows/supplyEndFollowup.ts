import { supabaseService } from '@/lib/supabase/service'

type Rpc = (name: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
export type SupplyEndFollowup = { status: 'created' | 'existing' | 'not_applicable'; effectReceiptId: string; sourceMessageId: string; caseId?: string }
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)

/** The genuine committed receipt owns scope and period; this command projects
 * an operational task, never supply approval or whole-message completion. */
export async function projectSupplyEndFollowup(input: { companyId: string; actorUserId: string; effectReceiptId: string }): Promise<SupplyEndFollowup> {
  if (!uuid(input.companyId) || !uuid(input.actorUserId) || !uuid(input.effectReceiptId)) throw Error('supply_followup_identity_required')
  const { data, error } = await (supabaseService.rpc.bind(supabaseService) as unknown as Rpc)('ediel_project_supply_end_followup_v1', {
    p_company_id: input.companyId, p_effect_receipt_id: input.effectReceiptId, p_actor_user_id: input.actorUserId,
  })
  if (error) throw error
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('supply_followup_result_invalid')
  const result = data as Record<string, unknown>
  if (!['created', 'existing', 'not_applicable'].includes(String(result.status)) || result.effectReceiptId !== input.effectReceiptId
    || !uuid(result.sourceMessageId) || (result.status !== 'not_applicable' && !uuid(result.caseId))) throw Error('supply_followup_result_invalid')
  return { status: result.status as SupplyEndFollowup['status'], effectReceiptId: input.effectReceiptId, sourceMessageId: result.sourceMessageId,
    ...(result.status !== 'not_applicable' ? { caseId: result.caseId as string } : {}) }
}
