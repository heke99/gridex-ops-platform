import { isUuid } from '@/lib/validation/uuid'

type RecordValue = Record<string, unknown>
export type UnderlayGenerationRow = {
  underlayId: string | null
  status: 'ready_for_pricing' | 'needs_review'
  sourceTable: 'normalized_metering_values'
  sourceRows: number
  warnings: string[]
  historyNeed?: unknown
}
export type UnderlayGenerationScope = { customerId: string | null; meteringPointId: string | null }

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

// Older receipts may omit this field. A history hold is an operator review
// outcome, with no stored underlay ID or market request claimed by the receipt.
export function hasPendingUnderlayHistoryQualification(row: UnderlayGenerationRow): boolean {
  return row.status === 'needs_review' && row.underlayId === null &&
    object(row.historyNeed) && row.historyNeed.state === 'awaiting_qualification'
}

export function parseUnderlayGenerationResult(
  value: unknown,
  { billingMonth, scope }: { billingMonth: string; scope: UnderlayGenerationScope },
): UnderlayGenerationResult {
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
