import { supabaseService } from '@/lib/supabase/service'
import { isUuid } from '@/lib/validation/uuid'

type RecordValue = Record<string, unknown>
export type UnderlayGenerationRow = {
  underlayId: string | null
  status: 'ready_for_pricing' | 'needs_review'
  sourceTable: 'normalized_metering_values'
  sourceRows: number
  warnings: string[]
}
export type UnderlayGenerationScope = { customerId: string | null; meteringPointId: string | null }
export type UnderlayGenerationIntent = { key: string; companyId: string; actorUserId: string; billingMonth: string; scope: UnderlayGenerationScope }

type UnderlayGenerationResult = {
  billingMonth: string
  scope: UnderlayGenerationScope
  sourceTable: 'normalized_metering_values'
  sourceRows: number
  underlays: number
  readyForPricing: number
  needsReview: number
  results: UnderlayGenerationRow[]
}

function object(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function count(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function result(value: unknown, { billingMonth, scope }: UnderlayGenerationIntent): UnderlayGenerationResult {
  if (!object(value) || value.billingMonth !== billingMonth || !object(value.scope) ||
      value.scope.customerId !== scope.customerId || value.scope.meteringPointId !== scope.meteringPointId ||
      value.sourceTable !== 'normalized_metering_values' || !count(value.sourceRows) || !Array.isArray(value.results) ||
      value.underlays !== value.results.length || !value.results.every((row) =>
        object(row) && (row.status === 'ready_for_pricing' || row.status === 'needs_review') &&
        (isUuid(row.underlayId) || (row.status === 'needs_review' && row.underlayId === null)) &&
        row.sourceTable === 'normalized_metering_values' && count(row.sourceRows) && Array.isArray(row.warnings) &&
        row.warnings.every((warning) => typeof warning === 'string')) ||
      value.readyForPricing !== value.results.filter((row) => row.status === 'ready_for_pricing').length ||
      value.needsReview !== value.results.filter((row) => row.status === 'needs_review').length) {
    throw new Error('billing_underlay_intent_receipt_invalid')
  }
  return value as UnderlayGenerationResult
}

function request(intent: UnderlayGenerationIntent) {
  return { p_company_id: intent.companyId, p_actor_user_id: intent.actorUserId, p_intent_key: intent.key,
    p_scope: { billingMonth: intent.billingMonth, ...intent.scope } }
}

export async function readUnderlayGenerationReceipt(intent: UnderlayGenerationIntent) {
  const { data, error } = await supabaseService.rpc('gridex_read_underlay_generation_receipt_v1', request(intent))
  if (error) throw error
  return data === null ? null : result(data, intent)
}

export async function storeUnderlayGenerationReceipt(intent: UnderlayGenerationIntent, plan: {
  sourceRows: number;
  before: UnderlayGenerationRow[];
  commands: Array<{ underlay: RecordValue; items: RecordValue[] }>;
  commandResults: Array<Omit<UnderlayGenerationRow, 'underlayId'>>;
  after: UnderlayGenerationRow[];
}) {
  const { data, error } = await supabaseService.rpc('gridex_store_underlay_generation_receipt_v1', {
    ...request(intent), p_source_rows: plan.sourceRows, p_before: plan.before, p_commands: plan.commands,
    p_command_results: plan.commandResults, p_after: plan.after,
  })
  if (error) throw error
  return result(data, intent)
}
