import { supabaseService } from '@/lib/supabase/service'
import type { BasePriceComponent, BasePriceSourceValues, BillingUnderlayInput, PriceComponent, PriceArea } from '@/lib/pricing/types'

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

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

function normalizeBaseComponent(row: Record<string, unknown>): BasePriceComponent | null {
  const sourceType = stringValue(row.source_type)
  if (sourceType !== 'spot' && sourceType !== 'fixed' && sourceType !== 'portfolio' && sourceType !== 'manual') return null
  const weight = numberValue(row.weight_percent)
  return {
    sourceType,
    weightPercent: weight ?? 100,
    fixedPriceSekPerKwh: numberValue(row.fixed_price_sek_per_kwh),
    label: stringValue(row.label),
    validFrom: stringValue(row.valid_from),
    validTo: stringValue(row.valid_to),
    metadata: isObject(row.metadata) ? row.metadata : {},
  }
}

function normalizePriceComponent(row: Record<string, unknown>): PriceComponent | null {
  const name = stringValue(row.name) ?? stringValue(row.component_label)
  const amount = numberValue(row.amount) ?? numberValue(row.value_amount)
  const calculationType = stringValue(row.calculation_type) ?? stringValue(row.calculation_unit)
  const componentType = stringValue(row.component_type)
  if (!name || amount === null || !calculationType || !componentType) return null
  return {
    componentType,
    name,
    description: stringValue(row.description),
    calculationType,
    amount,
    unit: stringValue(row.unit) ?? calculationType,
    vatApplicable: typeof row.vat_applicable === 'boolean' ? row.vat_applicable : true,
    invoiceLineVisible: typeof row.invoice_line_visible === 'boolean' ? row.invoice_line_visible : true,
    periodizationMode: stringValue(row.periodization_mode),
    priority: numberValue(row.priority),
    validFrom: stringValue(row.valid_from),
    validTo: stringValue(row.valid_to),
    metadata: isObject(row.metadata) ? row.metadata : {},
  }
}

export async function resolveBasePriceSourceValues(input: {
  companyId: string
  priceArea: PriceArea
  billingMonth: string
  fixedSekPerKwh?: number | null
  manualSekPerKwh?: number | null
}): Promise<BasePriceSourceValues> {
  const [spot, portfolio] = await Promise.all([
    supabaseService
      .from('spot_price_monthly_summaries')
      .select('average_sek_per_kwh,status')
      .eq('source', 'elprisetjustnu')
      .eq('price_area', input.priceArea)
      .eq('billing_month', input.billingMonth)
      .in('status', ['complete', 'locked'])
      .maybeSingle(),
    supabaseService
      .from('portfolio_monthly_prices')
      .select('price_ex_vat_sek_per_kwh,status')
      .eq('company_id', input.companyId)
      .eq('price_area', input.priceArea)
      .eq('billing_month', input.billingMonth)
      .in('status', ['confirmed', 'locked'])
      .maybeSingle(),
  ])

  if (spot.error && spot.error.code !== 'PGRST116') throw spot.error
  if (portfolio.error && portfolio.error.code !== 'PGRST116') throw portfolio.error

  return {
    spotSekPerKwh: numberValue((spot.data as Record<string, unknown> | null)?.average_sek_per_kwh),
    portfolioSekPerKwh: numberValue((portfolio.data as Record<string, unknown> | null)?.price_ex_vat_sek_per_kwh),
    fixedSekPerKwh: input.fixedSekPerKwh ?? null,
    manualSekPerKwh: input.manualSekPerKwh ?? null,
  }
}

export async function resolvePricingConfiguration(input: {
  companyId: string
  underlay: BillingUnderlayInput
  contract?: Record<string, unknown> | null
}): Promise<{ baseComponents: BasePriceComponent[]; priceComponents: PriceComponent[]; vatRate: number; warnings: string[] }> {
  const warnings: string[] = []
  const snapshot = isObject(input.contract?.price_snapshot) ? input.contract?.price_snapshot as Record<string, unknown> : {}
  const snapshotBase = Array.isArray(snapshot.base_price_components) ? snapshot.base_price_components : []
  const snapshotComponents = Array.isArray(snapshot.price_components) ? snapshot.price_components : []

  const baseComponents = snapshotBase
    .map((row) => (isObject(row) ? normalizeBaseComponent(row) : null))
    .filter((row): row is BasePriceComponent => Boolean(row))

  const priceComponents = snapshotComponents
    .map((row) => (isObject(row) ? normalizePriceComponent(row) : null))
    .filter((row): row is PriceComponent => Boolean(row))

  if (baseComponents.length === 0) {
    const contractType = stringValue(input.contract?.contract_type)
    const fixedOre = numberValue(input.contract?.fixed_price_ore_per_kwh)
    if (contractType === 'fixed' && fixedOre !== null) {
      baseComponents.push({ sourceType: 'fixed', weightPercent: 100, fixedPriceSekPerKwh: fixedOre / 100, label: 'Fastpris enligt avtal' })
    } else if (contractType === 'portfolio') {
      baseComponents.push({ sourceType: 'portfolio', weightPercent: 100, label: 'Portföljpris' })
    } else {
      baseComponents.push({ sourceType: 'spot', weightPercent: 100, label: 'Spotpris' })
    }
  }

  const contractPriceComponents: PriceComponent[] = []
  const spotMarkup = numberValue(input.contract?.spot_markup_ore_per_kwh)
  const variableFee = numberValue(input.contract?.variable_fee_ore_per_kwh)
  const monthlyFee = numberValue(input.contract?.monthly_fee_sek)
  const greenFeeMode = stringValue(input.contract?.green_fee_mode)
  const greenFeeValue = numberValue(input.contract?.green_fee_value)

  if (spotMarkup !== null) contractPriceComponents.push({ componentType: 'markup_ore_per_kwh', name: 'Spotpåslag enligt avtal', calculationType: 'ore_per_kwh', amount: spotMarkup, unit: 'öre/kWh', vatApplicable: true, periodizationMode: 'none', priority: 100 })
  if (variableFee !== null) contractPriceComponents.push({ componentType: 'variable_fee', name: 'Rörlig avgift enligt avtal', calculationType: 'ore_per_kwh', amount: variableFee, unit: 'öre/kWh', vatApplicable: true, periodizationMode: 'none', priority: 110 })
  if (monthlyFee !== null) contractPriceComponents.push({ componentType: 'fixed_monthly_fee', name: 'Fast månadsavgift enligt avtal', calculationType: 'fixed_monthly', amount: monthlyFee, unit: 'kr/mån', vatApplicable: true, periodizationMode: 'active_days', priority: 200 })
  if (greenFeeValue !== null && greenFeeMode === 'ore_per_kwh') contractPriceComponents.push({ componentType: 'green_energy_fee', name: 'Grön el enligt avtal', calculationType: 'ore_per_kwh', amount: greenFeeValue, unit: 'öre/kWh', vatApplicable: true, periodizationMode: 'none', priority: 300 })
  if (greenFeeValue !== null && greenFeeMode === 'sek_month') contractPriceComponents.push({ componentType: 'green_energy_fee', name: 'Grön el enligt avtal', calculationType: 'fixed_monthly', amount: greenFeeValue, unit: 'kr/mån', vatApplicable: true, periodizationMode: 'active_days', priority: 300 })

  const { data: componentRows, error } = await supabaseService
    .from('price_components')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('status', 'active')
    .order('priority', { ascending: true })

  if (error && error.code !== '42P01' && error.code !== 'PGRST205') throw error
  if (error) warnings.push('Pris-komponenttabellen saknas i databasen. Kör senaste migrationen.')

  const dbComponents = ((componentRows ?? []) as Record<string, unknown>[])
    .map(normalizePriceComponent)
    .filter((row): row is PriceComponent => Boolean(row))

  const vatRate = numberValue(input.contract?.vat_rate) ?? 0.25

  return {
    baseComponents,
    priceComponents: [...contractPriceComponents, ...dbComponents, ...priceComponents],
    vatRate,
    warnings,
  }
}
