import { supabaseService } from '@/lib/supabase/service'
import { isPriceArea, normalizeBillingMonth, type BillingUnderlayInput, type PriceArea, type PricingPreviewResult } from '@/lib/pricing/types'
import { calculateBasePrice } from '@/lib/pricing/basePriceCalculator'
import { calculatePriceComponents } from '@/lib/pricing/priceComponentCalculator'
import { finalizePricingPreview } from '@/lib/pricing/pricePreviewBuilder'
import { resolveBasePriceSourceValues, resolvePricingConfiguration } from '@/lib/pricing/priceSourceResolver'
import { ensureSpotPricesForBillingMonth } from '@/lib/pricing/spot/spotImportScheduler'

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function dateFromUnderlayMonth(year: unknown, month: unknown): { start: string; end: string; billingMonth: string } | null {
  const y = numberValue(year)
  const m = numberValue(month)
  if (!y || !m || m < 1 || m > 12) return null
  const start = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`
  const endDate = new Date(Date.UTC(y, m, 1))
  const end = endDate.toISOString().slice(0, 10)
  return { start, end, billingMonth: start.slice(0, 7) }
}

async function loadBillingUnderlay(companyId: string, billingUnderlayId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseService
    .from('billing_underlays')
    .select('*')
    .eq('company_id', companyId)
    .eq('id', billingUnderlayId)
    .single()
  if (error) throw error
  return data as Record<string, unknown>
}

async function loadContract(companyId: string, underlay: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const contractId = stringValue(underlay.contract_id)
  if (contractId) {
    const { data, error } = await supabaseService
      .from('customer_contracts')
      .select('*')
      .eq('company_id', companyId)
      .eq('id', contractId)
      .maybeSingle()
    if (error && error.code !== 'PGRST116') throw error
    return (data as Record<string, unknown> | null) ?? null
  }

  const customerId = stringValue(underlay.customer_id)
  const meteringPointId = stringValue(underlay.metering_point_id)
  if (!customerId) return null

  let query = supabaseService
    .from('customer_contracts')
    .select('*')
    .eq('company_id', companyId)
    .eq('customer_id', customerId)
    .in('status', ['active', 'signed'])
    .order('starts_at', { ascending: false })
    .limit(1)

  if (meteringPointId) query = query.or(`metering_point_id.eq.${meteringPointId},metering_point_id.is.null`)

  const { data, error } = await query.maybeSingle()
  if (error && error.code !== 'PGRST116') throw error
  return (data as Record<string, unknown> | null) ?? null
}

function underlayToInput(companyId: string, underlay: Record<string, unknown>, contract: Record<string, unknown> | null): BillingUnderlayInput {
  const period = dateFromUnderlayMonth(underlay.underlay_year, underlay.underlay_month)
  const payload = underlay.payload && typeof underlay.payload === 'object' && !Array.isArray(underlay.payload)
    ? underlay.payload as Record<string, unknown>
    : {}
  const priceAreaRaw = stringValue(underlay.price_area) ?? stringValue(payload.price_area)
  const priceArea = isPriceArea(priceAreaRaw) ? priceAreaRaw : null

  if (!period) throw new Error('Fakturaperiod saknas på underlaget.')

  return {
    companyId,
    billingUnderlayId: stringValue(underlay.id),
    customerId: stringValue(underlay.customer_id),
    customerSiteId: stringValue(underlay.customer_site_id) ?? stringValue(underlay.site_id),
    meteringPointId: stringValue(underlay.metering_point_id),
    contractId: stringValue(contract?.id) ?? stringValue(underlay.contract_id),
    pricePlanId: stringValue(underlay.price_plan_id),
    campaignId: stringValue(underlay.campaign_id),
    priceArea,
    quantityKwh: numberValue(underlay.total_kwh),
    periodStart: period.start,
    periodEnd: period.end,
    activeFrom: stringValue(contract?.starts_at) ?? stringValue(contract?.actual_start_at),
    activeTo: stringValue(contract?.ends_at),
  }
}

async function persistPricingRun(companyId: string, result: PricingPreviewResult, underlay: BillingUnderlayInput) {
  const status = result.status === 'success' ? 'success' : result.status
  const { data: run, error } = await supabaseService
    .from('pricing_runs')
    .insert({
      company_id: companyId,
      billing_underlay_id: underlay.billingUnderlayId ?? null,
      customer_id: underlay.customerId,
      billing_period_start: underlay.periodStart,
      billing_period_end: underlay.periodEnd,
      status,
      total_ex_vat: result.totalExVat,
      vat_amount: result.vatAmount,
      total_inc_vat: result.totalIncVat,
      warnings: result.warnings,
      errors: result.errors,
    })
    .select('id')
    .single()
  if (error) throw error

  const runId = (run as { id: string }).id
  if (result.lines.length > 0) {
    const { error: linesError } = await supabaseService.from('pricing_preview_lines').insert(result.lines.map((line) => ({
      company_id: companyId,
      pricing_run_id: runId,
      billing_underlay_id: underlay.billingUnderlayId ?? null,
      line_type: line.lineType,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unit_price_ex_vat: line.unitPriceExVat,
      amount_ex_vat: line.amountExVat,
      vat_rate: line.vatRate,
      vat_amount: line.vatAmount,
      amount_inc_vat: line.amountIncVat,
      sort_order: line.sortOrder,
      metadata: line.metadata ?? {},
    })))
    if (linesError) throw linesError
  }

  await supabaseService
    .from('billing_underlays')
    .update({
      status: result.status === 'success' ? 'price_preview_ready' : 'pricing_failed',
      readiness_status: result.status === 'success' ? 'ready' : 'blocked',
      readiness_issues: result.errors.map((message) => ({ code: 'pricing_failed', message })),
      calculated_total_sek_ex_vat: result.totalExVat,
      calculated_vat_sek: result.vatAmount,
      calculated_total_sek_inc_vat: result.totalIncVat,
      pricing_snapshot: {
        pricing_run_id: runId,
        warnings: result.warnings,
        errors: result.errors,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', companyId)
    .eq('id', underlay.billingUnderlayId)

  return runId
}

export async function calculatePricingPreviewForUnderlay(input: {
  companyId: string
  billingUnderlayId: string
  persist?: boolean
}): Promise<PricingPreviewResult & { pricingRunId?: string | null }> {
  const underlayRow = await loadBillingUnderlay(input.companyId, input.billingUnderlayId)
  const contract = await loadContract(input.companyId, underlayRow)
  const underlay = underlayToInput(input.companyId, underlayRow, contract)
  const errors: string[] = []
  const warnings: string[] = []

  if (!underlay.customerId) errors.push('Kund saknas på fakturaunderlaget.')
  if (!underlay.meteringPointId) errors.push('Mätpunkt saknas på fakturaunderlaget.')
  if (!underlay.priceArea) errors.push('Elområde saknas på fakturaunderlaget.')
  if (!contract) errors.push('Aktivt kundavtal saknas för fakturaperioden.')
  if (underlay.quantityKwh === null) errors.push('Mätförbrukning saknas på fakturaunderlaget.')

  if (errors.length > 0 || !underlay.priceArea) {
    const failed = finalizePricingPreview({ billingUnderlayId: input.billingUnderlayId, lines: [], warnings, errors })
    if (input.persist) await persistPricingRun(input.companyId, failed, underlay)
    return { ...failed, pricingRunId: null }
  }

  const billingMonth = normalizeBillingMonth(underlay.periodStart)
  const fixedOre = numberValue(contract?.fixed_price_ore_per_kwh)
  const config = await resolvePricingConfiguration({ companyId: input.companyId, underlay, contract })
  warnings.push(...config.warnings)

  const requiresSpotPrice = config.baseComponents.some((component) => component.sourceType === 'spot' && component.weightPercent > 0)
  if (requiresSpotPrice) {
    const spotImport = await ensureSpotPricesForBillingMonth({
      billingMonth,
      priceAreas: [underlay.priceArea as PriceArea],
      reason: 'pricing_preview',
    })
    if (spotImport.imported) warnings.push('Spotpris saknades och importerades automatiskt innan prisberäkningen kördes.')
  }

  const sourceValues = await resolveBasePriceSourceValues({
    companyId: input.companyId,
    priceArea: underlay.priceArea as PriceArea,
    billingMonth,
    fixedSekPerKwh: fixedOre !== null ? fixedOre / 100 : null,
  })

  const base = calculateBasePrice({ underlay, components: config.baseComponents, sourceValues })
  warnings.push(...base.warnings)
  errors.push(...base.errors)

  const component = calculatePriceComponents({
    underlay,
    components: config.priceComponents,
    baseAmountExVat: base.lines.reduce((sum, line) => sum + line.amountExVat, 0),
    vatRate: config.vatRate,
    startSortOrder: 100,
  })
  warnings.push(...component.warnings)
  errors.push(...component.errors)

  const result = finalizePricingPreview({
    billingUnderlayId: input.billingUnderlayId,
    lines: [...base.lines, ...component.lines],
    warnings,
    errors,
    vatRate: config.vatRate,
  })

  const pricingRunId = input.persist ? await persistPricingRun(input.companyId, result, underlay) : null
  return { ...result, pricingRunId }
}

export async function lockPricingPreview(input: { companyId: string; pricingRunId: string; actorUserId?: string | null }) {
  const { data: run, error } = await supabaseService
    .from('pricing_runs')
    .select('id,billing_underlay_id,billing_period_start,billing_period_end')
    .eq('company_id', input.companyId)
    .eq('id', input.pricingRunId)
    .single()
  if (error) throw error

  const row = run as Record<string, unknown>
  const month = stringValue(row.billing_period_start)?.slice(0, 7)
  if (!month) throw new Error('Prisperiod saknas på prisberäkningen.')

  const { error: lockError } = await supabaseService.from('price_period_locks').upsert({
    company_id: input.companyId,
    billing_month: month,
    lock_scope: 'pricing_preview',
    status: 'locked',
    locked_by: input.actorUserId ?? null,
    locked_at: new Date().toISOString(),
  }, { onConflict: 'company_id,billing_month,lock_scope' })
  if (lockError) throw lockError

  await supabaseService
    .from('pricing_runs')
    .update({ status: 'locked', locked_at: new Date().toISOString() })
    .eq('company_id', input.companyId)
    .eq('id', input.pricingRunId)

  if (stringValue(row.billing_underlay_id)) {
    await supabaseService
      .from('billing_underlays')
      .update({ status: 'locked', updated_at: new Date().toISOString() })
      .eq('company_id', input.companyId)
      .eq('id', stringValue(row.billing_underlay_id))
  }
}
