import { supabaseService } from '@/lib/supabase/service'

/**
 * FINDINGS H3d owner decision 2026-10-24 B6 "I god tid före slutet": the operator task to send an end of supply (Z08)
 * is created this many calendar days before the planned contract end. The Ediel registers set no other lead time for a
 * supplier's end of supply (the only Z08 deadline is Z08H "senast den dag hävningen träder i kraft",
 * lib/ediel/rulebook/deadlinePolicy.ts and timers.json TM-Z08-H), so the owner's 14 days apply. The database command
 * gridex_termination_notice_expiry_tasks_v1 holds the same constant (20261024100000) and returns it as lead_days.
 */
export const TERMINATION_Z08_TASK_LEAD_DAYS = 14

/**
 * FINDINGS H3d B3/B6 (owner decisions 2026-10-23 "Vänta på nytt byte, sedan ev. Z08" and 2026-10-24 "I god tid före
 * slutet"): a termination without a move keeps the supply until a new supplier takes over (Z05 from the grid owner).
 * From TERMINATION_Z08_TASK_LEAD_DAYS days before the planned end, while the contract is still signed/active with supply
 * beyond that end, the database creates ONE operator task per contract and planned end
 * ('termination_end_of_supply_pending': send an end of supply, Z08, to the grid owner; due on the planned end). An open
 * task is closed automatically, with its reason, once the supply no longer runs beyond the planned end (a new
 * supplier's Z05 came first). Nothing is sent automatically. Idempotent; the as-of day is the Swedish calendar day.
 * Runs on the customer-operations cron.
 */
export async function createTerminationNoticeExpiryTasks(input: { companyId?: string | null; asOf?: string | null } = {}) {
  const { data, error } = await supabaseService.rpc('gridex_termination_notice_expiry_tasks_v1', {
    p_company_id: input.companyId ?? null,
    p_as_of: input.asOf ?? null,
  })
  if (error) throw error
  const result = (data ?? {}) as { as_of?: string; tasks_created?: number; contract_ids?: string[]; tasks_closed?: number; lead_days?: number }
  return {
    asOf: result.as_of ?? null,
    tasksCreated: Number(result.tasks_created ?? 0),
    contractIds: Array.isArray(result.contract_ids) ? result.contract_ids : [],
    tasksClosed: Number(result.tasks_closed ?? 0),
    leadDays: typeof result.lead_days === 'number' ? result.lead_days : null,
  }
}
