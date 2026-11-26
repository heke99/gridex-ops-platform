import { supabaseService } from '@/lib/supabase/service'
import { parseUnderlayGenerationResult, type UnderlayGenerationRow, type UnderlayGenerationScope } from './underlayGenerationResult'

export type { UnderlayGenerationRow, UnderlayGenerationScope } from './underlayGenerationResult'

type RecordValue = Record<string, unknown>
export type UnderlayGenerationIntent = { key: string; companyId: string; actorUserId: string; billingMonth: string; scope: UnderlayGenerationScope }

function request(intent: UnderlayGenerationIntent) {
  return { p_company_id: intent.companyId, p_actor_user_id: intent.actorUserId, p_intent_key: intent.key,
    p_scope: { billingMonth: intent.billingMonth, ...intent.scope } }
}

export async function readUnderlayGenerationReceipt(intent: UnderlayGenerationIntent) {
  const { data, error } = await supabaseService.rpc('gridex_read_underlay_generation_receipt_v1', request(intent))
  if (error) throw error
  return data === null ? null : parseUnderlayGenerationResult(data, intent)
}

export async function storeUnderlayGenerationReceipt(intent: UnderlayGenerationIntent, plan: {
  sourceRows: number;
  before: UnderlayGenerationRow[];
  commands: Array<{ underlay: RecordValue; items: RecordValue[] }>;
  commandResults: Array<Omit<UnderlayGenerationRow, 'underlayId'>>;
  after: UnderlayGenerationRow[];
}, e66SourceMode?: 'single' | 'mixed') {
  const rpc = e66SourceMode === 'mixed'
    ? 'gridex_store_mixed_e66_underlay_generation_receipt_v1'
    : e66SourceMode === 'single'
      ? 'gridex_store_e66_underlay_generation_receipt_v1'
      : 'gridex_store_underlay_generation_receipt_v1'
  const { data, error } = await supabaseService.rpc(rpc, {
    ...request(intent), p_source_rows: plan.sourceRows, p_before: plan.before, p_commands: plan.commands,
    p_command_results: plan.commandResults, p_after: plan.after,
  })
  if (error) throw error
  return parseUnderlayGenerationResult(data, intent)
}
