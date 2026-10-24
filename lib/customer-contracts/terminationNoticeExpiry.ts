import { supabaseService } from '@/lib/supabase/service'

/**
 * FINDINGS H3d B3 (owner decision 2026-10-23 "Vänta på nytt byte, sedan ev. Z08"): a termination without a move keeps
 * the supply until a new supplier takes over (Z05 from the grid owner). When the notice period has expired and the
 * contract is still signed/active with an open supply period, the database creates ONE operator task per contract and
 * planned end ('termination_end_of_supply_pending': send an end of supply, Z08, to the grid owner). Nothing is sent
 * automatically. Idempotent; the as-of day is the Swedish calendar day. Runs on the customer-operations cron.
 */
export async function createTerminationNoticeExpiryTasks(input: { companyId?: string | null; asOf?: string | null } = {}) {
  const { data, error } = await supabaseService.rpc('gridex_termination_notice_expiry_tasks_v1', {
    p_company_id: input.companyId ?? null,
    p_as_of: input.asOf ?? null,
  })
  if (error) throw error
  const result = (data ?? {}) as { as_of?: string; tasks_created?: number; contract_ids?: string[] }
  return {
    asOf: result.as_of ?? null,
    tasksCreated: Number(result.tasks_created ?? 0),
    contractIds: Array.isArray(result.contract_ids) ? result.contract_ids : [],
  }
}
