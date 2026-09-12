import { resolveFrozenBaseComponents } from '@/lib/pricing/priceSourceResolver'
import { isPriceArea } from '@/lib/pricing/types'
import { supabaseService } from '@/lib/supabase/service'
import { stockholmDateForInstant, stockholmLocalToUtc, strictIsoDate } from '@/lib/time/stockholm'

type Row = Record<string, unknown>
const PAGE_SIZE = 1_000

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
function record(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
}
export function evidenceNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.replace(',', '.')) : NaN
  return Number.isFinite(parsed) ? parsed : null
}
export function evidenceQuantityKwh(row: Row): number | null {
  const quantity = evidenceNumber(row.quantity_kwh) ?? evidenceNumber(row.quantity)
  const unit = text(row.unit)?.toLowerCase()
  if (quantity === null) return null
  return unit === 'kwh' ? quantity : unit === 'wh' ? quantity / 1_000 : unit === 'mwh' ? quantity * 1_000 : null
}

// A short API page is not proof of completeness. Require an exact total on
// every page and reject count changes, early short pages and duplicate IDs.
export async function completeEvidenceRows(loader: (from: number, to: number) => PromiseLike<{
  data: Row[] | null; error: unknown; count: number | null
}>): Promise<Row[]> {
  const rows: Row[] = []
  const ids = new Set<string>()
  let expected: number | null = null
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await loader(from, from + PAGE_SIZE - 1)
    if (result.error) throw result.error
    if (result.count === null || !Number.isSafeInteger(result.count) || result.count < 0) throw new Error('billing_evidence_count_missing')
    expected ??= result.count
    if (result.count !== expected) throw new Error('billing_evidence_count_changed')
    const page = result.data ?? []
    if (page.length !== Math.min(PAGE_SIZE, expected - from)) throw new Error('billing_evidence_page_incomplete')
    for (const row of page) {
      const id = text(row.id)
      if (!id || ids.has(id)) throw new Error('billing_evidence_duplicate_or_missing_id')
      ids.add(id)
      rows.push(row)
    }
    if (rows.length === expected) return rows
  }
}

export function underlayValidationErrors(underlay: Row): string[] {
  const errors: string[] = []
  if (underlay.status !== 'validated' || underlay.readiness_status !== 'ready') errors.push('Faktureringsunderlaget är inte validerat och klart.')
  if (evidenceNumber(underlay.missing_values_count) !== 0) errors.push('Faktureringsunderlaget saknar fullständig mätvärdestäckning.')
  if (text(underlay.billing_block_reason)) errors.push(String(underlay.billing_block_reason))
  if (!Array.isArray(underlay.readiness_issues)) errors.push('Underlagets valideringsresultat saknas.')
  else for (const issue of underlay.readiness_issues) errors.push(text(record(issue).message) ?? text(record(issue).code) ?? text(issue) ?? 'Faktureringsunderlaget har ett valideringsfel.')
  // invoice_readiness_status and latest pricing errors describe pricing, not
  // source validation. A validated underlay may still await its first price.
  return [...new Set(errors)]
}

export function billingPeriodInstant(value: unknown): string {
  const raw = text(value)
  if (!raw) throw new Error('billing_evidence_period_missing')
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = strictIsoDate(raw).split('-').map(Number)
    return stockholmLocalToUtc({ year, month, day }).toISOString()
  }
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw) || !Number.isFinite(Date.parse(raw))) throw new Error('billing_evidence_invalid_instant')
  return new Date(raw).toISOString()
}

export function underlayPeriodInstants(underlay: Row): { start: string; end: string } {
  const payload = record(underlay.payload)
  const boundary = (field: 'start' | 'end') => {
    const civil = text(underlay[`billing_period_${field}`])
    const original = text(payload[`billing_period_${field}_instant`])
    if (!original) return billingPeriodInstant(civil)
    const instant = billingPeriodInstant(original)
    if (!civil || (/^\d{4}-\d{2}-\d{2}$/.test(civil)
      ? stockholmDateForInstant(instant) !== civil
      : billingPeriodInstant(civil) !== instant)) throw new Error('billing_evidence_period_identity_mismatch')
    return instant
  }
  const start = boundary('start'), end = boundary('end')
  if (Date.parse(end) <= Date.parse(start)) throw new Error('billing_evidence_invalid_period')
  return { start, end }
}

export async function loadUnderlayEvidence(input: { companyId: string; billingUnderlayId: string }) {
  const response = await supabaseService.from('billing_underlays').select('*').eq('company_id', input.companyId).eq('id', input.billingUnderlayId).single()
  if (response.error) throw response.error
  const underlay = response.data as Row | null
  if (!underlay || underlay.id !== input.billingUnderlayId || underlay.company_id !== input.companyId) throw new Error('billing_evidence_underlay_identity_mismatch')
  const errors = underlayValidationErrors(underlay)
  if (errors.length) throw new Error(errors.join(' '))
  const period = underlayPeriodInstants(underlay)
  const items = await completeEvidenceRows((from, to) => supabaseService.from('billing_underlay_items').select('*', { count: 'exact' })
    .eq('company_id', input.companyId).eq('billing_underlay_id', input.billingUnderlayId)
    .order('period_start', { ascending: true }).order('id', { ascending: true }).range(from, to))
  const expectedCount = evidenceNumber(underlay.source_meter_value_count)
  if (!expectedCount || !Number.isSafeInteger(expectedCount) || items.length !== expectedCount) throw new Error('billing_evidence_source_count_mismatch')
  const sourceIds = new Set<string>()
  let cursor = Date.parse(period.start), total = 0
  for (const item of items) {
    for (const key of ['company_id', 'customer_id', 'metering_point_id', 'contract_id', 'price_area', 'energy_direction', 'settlement_type']) {
      if (!text(underlay[key]) || item[key] !== underlay[key]) throw new Error(`billing_evidence_item_${key}_mismatch`)
    }
    if (item.billing_underlay_id !== underlay.id || item.status !== 'ready_for_pricing' || !Array.isArray(item.warnings) || item.warnings.length) throw new Error('billing_evidence_item_blocked')
    const sourceId = text(item.source_normalized_metering_value_id)
    if (!sourceId || sourceIds.has(sourceId)) throw new Error('billing_evidence_source_identity_missing_or_duplicate')
    sourceIds.add(sourceId)
    const start = Date.parse(billingPeriodInstant(item.period_start)), end = Date.parse(billingPeriodInstant(item.period_end))
    const quantity = evidenceQuantityKwh(item)
    if (start !== cursor || end <= start || end > Date.parse(period.end)) throw new Error('billing_evidence_gap_overlap_or_period_mismatch')
    if (quantity === null || quantity < 0) throw new Error('billing_evidence_quantity_invalid')
    cursor = end
    total += quantity
  }
  if (cursor !== Date.parse(period.end)) throw new Error('billing_evidence_period_incomplete')
  const expectedKwh = evidenceNumber(underlay.total_kwh)
  if (expectedKwh === null || expectedKwh <= 0 || Math.abs(total - expectedKwh) > 0.001) throw new Error('billing_evidence_quantity_mismatch')
  return { underlay, items, period, totalKwh: total }
}

export async function loadPricingRunEvidence(input: { companyId: string; pricingRunId: string; billingUnderlayId?: string }) {
  const response = await supabaseService.from('pricing_runs').select('*').eq('company_id', input.companyId).eq('id', input.pricingRunId).single()
  if (response.error) throw response.error
  const run = response.data as Row | null
  const underlayId = text(run?.billing_underlay_id)
  if (!run || run.id !== input.pricingRunId || run.company_id !== input.companyId || !underlayId || (input.billingUnderlayId && input.billingUnderlayId !== underlayId) || !['success', 'locked'].includes(String(run.status))) throw new Error('billing_evidence_pricing_run_invalid')
  const source = await loadUnderlayEvidence({ companyId: input.companyId, billingUnderlayId: underlayId })
  if (run.customer_id !== source.underlay.customer_id) throw new Error('billing_evidence_run_customer_mismatch')
  // pricing_runs historically store civil dates; compare the canonical civil
  // dates, while item coverage is checked against original Stockholm instants.
  for (const boundary of ['start', 'end']) {
    const runPeriod = text(run[`billing_period_${boundary}`])
    const underlayPeriod = text(source.underlay[`billing_period_${boundary}`])
    if (!runPeriod || !underlayPeriod || (runPeriod !== underlayPeriod && stockholmDateForInstant(billingPeriodInstant(runPeriod)) !== stockholmDateForInstant(billingPeriodInstant(underlayPeriod)))) throw new Error('billing_evidence_run_period_mismatch')
  }
  if (Array.isArray(run.errors) && run.errors.length) throw new Error('billing_evidence_run_has_errors')
  const evidence = await completeEvidenceRows((from, to) => supabaseService.from('pricing_interval_evidence').select('*', { count: 'exact' })
    .eq('company_id', input.companyId).eq('pricing_run_id', input.pricingRunId)
    .order('metering_interval_start', { ascending: true }).order('id', { ascending: true }).range(from, to))
  const contractResponse = await supabaseService.from('customer_contracts').select('id,contract_type').eq('company_id', input.companyId).eq('id', String(source.underlay.contract_id)).single()
  if (contractResponse.error) throw contractResponse.error
  const snapshot = record(source.underlay.pricing_snapshot)
  const resolution = text(snapshot.interval_resolution) ?? text(record(snapshot.pricing).interval_resolution) ??
    (contractResponse.data?.contract_type === 'variable_quarterly' ? 'quarterly' : contractResponse.data?.contract_type === 'variable_hourly' ? 'hourly' : 'monthly')
  const priceArea = text(source.underlay.price_area)
  const components = source.underlay.energy_direction === 'production' && !evidence.length
    ? []
    : resolveFrozenBaseComponents(snapshot, {
      companyId: input.companyId,
      billingUnderlayId: underlayId,
      customerId: text(source.underlay.customer_id),
      meteringPointId: text(source.underlay.metering_point_id),
      priceArea: isPriceArea(priceArea) ? priceArea : null,
      quantityKwh: source.totalKwh,
      periodStart: String(source.underlay.billing_period_start),
      periodEnd: String(source.underlay.billing_period_end),
    })
  if (source.underlay.energy_direction !== 'production' && !components.length) throw new Error('billing_evidence_frozen_base_components_missing')
  const spotComponents = components.filter(component => component.sourceType === 'spot')
  const usesSpot = spotComponents.some(component => component.weightPercent > 0)
  const intervalRequired = usesSpot && source.underlay.energy_direction !== 'production' && ['quarterly', 'hourly'].includes(resolution)
  if (intervalRequired || evidence.length) {
    const spotWeight = spotComponents.reduce((sum, component) => sum + component.weightPercent, 0)
    if (!Number.isFinite(spotWeight) || spotWeight <= 0 || spotWeight > 100) throw new Error('billing_evidence_spot_weight_invalid')
    if (evidence.length !== source.items.length) throw new Error('billing_evidence_saved_count_mismatch')
    const byItem = new Map(source.items.map(item => [String(item.id), item]))
    const seen = new Set<string>()
    for (const row of evidence) {
      const id = text(row.billing_underlay_item_id)
      const item = id ? byItem.get(id) : null
      if (!id || !item || seen.has(id)) throw new Error('billing_evidence_saved_item_mismatch')
      seen.add(id)
      if (row.company_id !== input.companyId || row.pricing_run_id !== run.id || row.billing_underlay_id !== underlayId || row.customer_contract_id !== source.underlay.contract_id || row.price_area !== source.underlay.price_area) throw new Error('billing_evidence_saved_identity_mismatch')
      const duration = Date.parse(String(item.period_end)) - Date.parse(String(item.period_start))
      if (billingPeriodInstant(row.metering_interval_start) !== billingPeriodInstant(item.period_start) || billingPeriodInstant(row.metering_interval_end) !== billingPeriodInstant(item.period_end) || row.resolution !== (duration === 900000 ? 'quarter' : duration === 3600000 ? 'hour' : null) || (resolution === 'quarterly' && row.resolution !== 'quarter')) throw new Error('billing_evidence_saved_period_mismatch')
      const quantity = evidenceNumber(row.consumption_kwh)
      if (quantity === null || Math.abs(quantity - evidenceQuantityKwh(item)!) > 0.000001 || evidenceNumber(row.price_sek_per_kwh) === null || evidenceNumber(row.amount_ex_vat) === null || !text(row.price_source_id) || !/^[0-9a-f]{64}$/i.test(String(row.evidence_sha256))) throw new Error('billing_evidence_saved_value_mismatch')
      const expectedAmount = Math.round(quantity * evidenceNumber(row.price_sek_per_kwh)! * (spotWeight / 100) * 100) / 100
      if (Math.abs(evidenceNumber(row.amount_ex_vat)! - expectedAmount) > 0.000001) throw new Error('billing_evidence_saved_amount_mismatch')
    }
  }
  return { ...source, run, evidence }
}
