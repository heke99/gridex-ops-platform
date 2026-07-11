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
  const sourceType = stringValue(row.source_type) ?? stringValue(row.sourceType)
  if (sourceType !== 'spot' && sourceType !== 'fixed' && sourceType !== 'portfolio' && sourceType !== 'manual') return null
  const weight = numberValue(row.weight_percent) ?? numberValue(row.weightPercent)
  return {
    sourceType,
    weightPercent: weight ?? 100,
    fixedPriceSekPerKwh: numberValue(row.fixed_price_sek_per_kwh) ?? numberValue(row.fixedPriceSekPerKwh),
    label: stringValue(row.label),
    validFrom: stringValue(row.valid_from) ?? stringValue(row.validFrom),
    validTo: stringValue(row.valid_to) ?? stringValue(row.validTo),
    metadata: isObject(row.metadata) ? row.metadata : {},
  }
}

function legacyComponentShape(row: Record<string, unknown>): {
  componentType: string | null
  calculationType: string | null
  unit: string | null
} {
  const code = (stringValue(row.code) ?? '').toLowerCase()
  const rawUnit = (stringValue(row.unit) ?? '').toLowerCase()
  if (code === 'fixed_price') return { componentType: null, calculationType: null, unit: null }
  if (code === 'monthly_fee') return { componentType: 'fixed_monthly_fee', calculationType: 'fixed_monthly', unit: 'sek_month' }
  if (code === 'invoice_fee') return { componentType: 'invoice_fee', calculationType: 'fixed_once', unit: 'sek_invoice' }
  if (code === 'spot_markup') return { componentType: 'spot_markup', calculationType: 'ore_per_kwh', unit: 'ore_per_kwh' }
  if (code === 'variable_fee') return { componentType: 'variable_fee', calculationType: 'ore_per_kwh', unit: 'ore_per_kwh' }
  if (code === 'green_fee') {
    if (rawUnit === 'sek_month') return { componentType: 'green_energy_fee', calculationType: 'fixed_monthly', unit: 'sek_month' }
    if (rawUnit === 'ore_per_kwh' || rawUnit === 'ore/kwh') return { componentType: 'green_energy_fee', calculationType: 'ore_per_kwh', unit: 'ore_per_kwh' }
    return { componentType: 'green_energy_fee', calculationType: 'per_kwh', unit: rawUnit || 'sek_per_kwh' }
  }
  return { componentType: null, calculationType: null, unit: null }
}

function normalizePriceComponent(row: Record<string, unknown>): PriceComponent | null {
  const legacy = legacyComponentShape(row)
  const name = stringValue(row.name) ?? stringValue(row.component_label) ?? stringValue(row.label)
  const amount = numberValue(row.amount) ?? numberValue(row.value_amount)
  const calculationType = stringValue(row.calculation_type) ?? stringValue(row.calculation_unit) ?? legacy.calculationType
  const componentType = stringValue(row.component_type) ?? legacy.componentType
  if (!name || amount === null || !calculationType || !componentType) return null
  return {
    componentType,
    name,
    description: stringValue(row.description),
    calculationType,
    amount,
    unit: stringValue(row.unit) ?? legacy.unit ?? calculationType,
    vatApplicable: typeof row.vat_applicable === 'boolean' ? row.vat_applicable : true,
    invoiceLineVisible: typeof row.invoice_line_visible === 'boolean' ? row.invoice_line_visible : true,
    periodizationMode: stringValue(row.periodization_mode),
    priority: numberValue(row.priority),
    validFrom: stringValue(row.valid_from),
    validTo: stringValue(row.valid_to),
    metadata: isObject(row.metadata) ? row.metadata : {},
  }
}

function baseComponentsFromLegacySnapshot(snapshot: Record<string, unknown>): BasePriceComponent[] {
  const hasSnapshotEvidence = [
    snapshot.pricing_model,
    snapshot.billing_model,
    snapshot.contract_type,
    snapshot.public_offer,
    snapshot.mix,
    snapshot.snapshot_schema,
  ].some((value) => value !== null && value !== undefined)
  if (!hasSnapshotEvidence) return []
  const contractType = `${stringValue(snapshot.pricing_model) ?? ''} ${stringValue(snapshot.billing_model) ?? ''} ${stringValue(snapshot.contract_type) ?? ''}`.toLowerCase()
  const mix = isObject(snapshot.mix) ? snapshot.mix : {}
  const spotWeight = numberValue(mix.spot_weight_percent) ?? numberValue(snapshot.spot_weight_percent) ?? 0
  const portfolioWeight = numberValue(mix.portfolio_weight_percent) ?? numberValue(snapshot.portfolio_weight_percent) ?? 0
  const fixedWeight = numberValue(mix.fixed_weight_percent) ?? numberValue(snapshot.fixed_weight_percent) ?? 0
  const publicOffer = isObject(snapshot.public_offer) ? snapshot.public_offer : {}
  const fixedOre = numberValue(snapshot.fixed_price_ore_per_kwh)
    ?? numberValue(publicOffer.fixed_price_ore_per_kwh)

  if (/mixed|mix|hybrid/.test(contractType)) {
    const rows: BasePriceComponent[] = []
    if (spotWeight > 0) rows.push({ sourceType: 'spot', weightPercent: spotWeight, label: 'Rörlig spotandel' })
    if (portfolioWeight > 0) rows.push({ sourceType: 'portfolio', weightPercent: portfolioWeight, label: 'Portföljandel' })
    if (fixedWeight > 0) rows.push({ sourceType: 'fixed', weightPercent: fixedWeight, fixedPriceSekPerKwh: fixedOre !== null ? fixedOre / 100 : null, label: 'Fastprisandel' })
    return rows
  }
  if (/portfolio|portfölj/.test(contractType)) return [{ sourceType: 'portfolio', weightPercent: 100, label: 'Portföljpris' }]
  if (/fixed|fast/.test(contractType)) return [{ sourceType: 'fixed', weightPercent: 100, fixedPriceSekPerKwh: fixedOre !== null ? fixedOre / 100 : null, label: 'Fastpris' }]
  return [{ sourceType: 'spot', weightPercent: 100, label: 'Spotpris' }]
}

function databaseShapeError(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string } | null
  return Boolean(
    candidate &&
      (['42703', '42P01', 'PGRST204', 'PGRST205'].includes(String(candidate.code ?? '')) ||
        /does not exist|schema cache|column .* not found/i.test(candidate.message ?? '')),
  )
}

async function loadPortfolioMonthlyPrice(input: {
  companyId: string
  priceArea: PriceArea
  billingMonth: string
}) {
  const current = await supabaseService
    .from('portfolio_monthly_prices')
    .select('price_ex_vat_sek_per_kwh,status,version_number')
    .eq('company_id', input.companyId)
    .eq('price_area', input.priceArea)
    .eq('billing_month', input.billingMonth)
    .in('status', ['confirmed', 'locked'])
    .is('superseded_at', null)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!current.error || current.error.code === 'PGRST116') return current
  if (!databaseShapeError(current.error)) return current

  // Deployment compatibility while the versioning migration is being applied.
  // The old unique schema already guarantees at most one tenant/area/month row.
  return supabaseService
    .from('portfolio_monthly_prices')
    .select('price_ex_vat_sek_per_kwh,status')
    .eq('company_id', input.companyId)
    .eq('price_area', input.priceArea)
    .eq('billing_month', input.billingMonth)
    .in('status', ['confirmed', 'locked'])
    .maybeSingle()
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
    loadPortfolioMonthlyPrice(input),
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
  const contractSnapshot = isObject(input.contract?.price_snapshot) ? input.contract?.price_snapshot as Record<string, unknown> : {}
  const underlaySnapshot = isObject(input.underlay.pricingSnapshot) ? input.underlay.pricingSnapshot : {}
  const snapshot = Object.keys(underlaySnapshot).length > 0 ? underlaySnapshot : contractSnapshot
  const snapshotBase = Array.isArray(snapshot.base_price_components_snapshot)
    ? snapshot.base_price_components_snapshot
    : Array.isArray(snapshot.base_price_components)
      ? snapshot.base_price_components
      : []
  const snapshotComponents = Array.isArray(snapshot.price_components_snapshot)
    ? snapshot.price_components_snapshot
    : Array.isArray(snapshot.price_components)
      ? snapshot.price_components
      : []

  const normalizedSnapshotBase = snapshotBase
    .map((row) => (isObject(row) ? normalizeBaseComponent(row) : null))
    .filter((row): row is BasePriceComponent => Boolean(row))
  const baseComponents = normalizedSnapshotBase.length > 0
    ? normalizedSnapshotBase
    : baseComponentsFromLegacySnapshot(snapshot)

  const priceComponents = snapshotComponents
    .map((row) => (isObject(row) ? normalizePriceComponent(row) : null))
    .filter((row): row is PriceComponent => Boolean(row))
  const hasFrozenPriceSnapshot = baseComponents.length > 0 || priceComponents.length > 0

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

  if (spotMarkup !== null) contractPriceComponents.push({ componentType: 'markup_ore_per_kwh', name: 'Spotpåslag enligt avtal', calculationType: 'ore_per_kwh', amount: spotMarkup, unit: 'ore_per_kwh', vatApplicable: true, periodizationMode: 'none', priority: 100 })
  if (variableFee !== null) contractPriceComponents.push({ componentType: 'variable_fee', name: 'Rörlig avgift enligt avtal', calculationType: 'ore_per_kwh', amount: variableFee, unit: 'ore_per_kwh', vatApplicable: true, periodizationMode: 'none', priority: 110 })
  if (monthlyFee !== null) contractPriceComponents.push({ componentType: 'fixed_monthly_fee', name: 'Fast månadsavgift enligt avtal', calculationType: 'fixed_monthly', amount: monthlyFee, unit: 'sek_month', vatApplicable: true, periodizationMode: 'none', priority: 200 })
  if (greenFeeValue !== null && greenFeeMode === 'ore_per_kwh') contractPriceComponents.push({ componentType: 'green_energy_fee', name: 'Grön el enligt avtal', calculationType: 'ore_per_kwh', amount: greenFeeValue, unit: 'ore_per_kwh', vatApplicable: true, periodizationMode: 'none', priority: 300 })
  if (greenFeeValue !== null && greenFeeMode === 'sek_per_kwh') contractPriceComponents.push({ componentType: 'green_energy_fee', name: 'Grön el enligt avtal', calculationType: 'per_kwh', amount: greenFeeValue, unit: 'sek_per_kwh', vatApplicable: true, periodizationMode: 'none', priority: 300 })
  if (greenFeeValue !== null && greenFeeMode === 'sek_month') contractPriceComponents.push({ componentType: 'green_energy_fee', name: 'Grön el enligt avtal', calculationType: 'fixed_monthly', amount: greenFeeValue, unit: 'sek_month', vatApplicable: true, periodizationMode: 'none', priority: 300 })

  // Contract-level extras previously only handled by the legacy billing engine:
  // campaign discount, admin fee, start fee (first billing period only) and
  // free-form optional fee lines. These must keep billing output identical when
  // the export/billing paths run through the Pricing Core.
  const discountValue = numberValue(input.contract?.discount_value)
  const discountUnit = stringValue(input.contract?.discount_unit) ?? 'sek_month'
  if (discountValue !== null) {
    if (discountUnit === 'ore_per_kwh') {
      contractPriceComponents.push({ componentType: 'campaign_discount', name: 'Kampanjrabatt', calculationType: 'discount_per_kwh', amount: Math.abs(discountValue), unit: 'ore_per_kwh', vatApplicable: true, periodizationMode: 'none', priority: 400 })
    } else {
      contractPriceComponents.push({ componentType: 'campaign_discount', name: 'Kampanjrabatt', calculationType: 'discount_fixed', amount: Math.abs(discountValue), unit: discountUnit, vatApplicable: true, periodizationMode: 'none', priority: 400 })
    }
  }

  const adminFee = numberValue(input.contract?.admin_fee_sek)
  if (adminFee !== null) {
    contractPriceComponents.push({ componentType: 'admin_fee', name: 'Administrativ avgift', calculationType: 'fixed_monthly', amount: adminFee, unit: 'sek_month', vatApplicable: true, periodizationMode: 'none', priority: 410 })
  }

  const startFee = numberValue(input.contract?.start_fee_sek)
  const contractStart = stringValue(input.contract?.starts_at) ?? stringValue(input.contract?.actual_start_at) ?? stringValue(input.contract?.contract_start_date)
  const isFirstBillingPeriod = Boolean(
    contractStart && contractStart >= input.underlay.periodStart && contractStart < input.underlay.periodEnd
  )
  if (startFee !== null && isFirstBillingPeriod) {
    contractPriceComponents.push({ componentType: 'start_fee', name: 'Startavgift', calculationType: 'fixed_once', amount: startFee, unit: 'sek_once', vatApplicable: true, periodizationMode: 'none', priority: 420 })
  }

  const optionalLines = Array.isArray(input.contract?.optional_fee_lines) ? input.contract?.optional_fee_lines as unknown[] : []
  for (const [index, rawLine] of optionalLines.entries()) {
    if (!isObject(rawLine)) continue
    const label = stringValue(rawLine.label) ?? `Övrig avgift ${index + 1}`
    const amount = numberValue(rawLine.amount)
    if (amount === null) continue
    const unit = stringValue(rawLine.unit) ?? 'sek'
    contractPriceComponents.push({
      componentType: 'custom_addon',
      name: label,
      calculationType: unit === 'ore_per_kwh' ? 'ore_per_kwh' : 'fixed_monthly',
      amount,
      unit,
      vatApplicable: true,
      periodizationMode: 'none',
      priority: 430 + index,
    })
  }

  if (hasFrozenPriceSnapshot) {
    return {
      baseComponents,
      priceComponents: filterComponentsForPeriod(priceComponents, input.underlay.periodStart),
      vatRate: numberValue(snapshot.vat_rate) ?? numberValue(input.contract?.vat_rate) ?? 0.25,
      warnings,
    }
  }

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

  // Legacy tenant-level rules (pricing_component_rules) were previously only
  // applied by lib/billing/pricingEngine.ts. Merge active rules here so the
  // Pricing Core is the single calculation path; dedupe against modern
  // price_components on (componentType, name).
  const legacyRuleComponents = await loadLegacyPricingComponentRules(input.companyId, warnings)
  const seenComponentKeys = new Set(
    [...contractPriceComponents, ...dbComponents, ...priceComponents].map(componentDedupeKey)
  )
  const mergedLegacyComponents = legacyRuleComponents.filter((component) => {
    const key = componentDedupeKey(component)
    if (seenComponentKeys.has(key)) return false
    seenComponentKeys.add(key)
    return true
  })

  const vatRate = numberValue(input.contract?.vat_rate) ?? 0.25

  return {
    baseComponents,
    priceComponents: filterComponentsForPeriod(
      [...contractPriceComponents, ...dbComponents, ...mergedLegacyComponents, ...priceComponents],
      input.underlay.periodStart
    ),
    vatRate,
    warnings,
  }
}

function componentDedupeKey(component: PriceComponent): string {
  return `${component.componentType}:${component.name.trim().toLowerCase()}`
}

function filterComponentsForPeriod(components: PriceComponent[], periodStart: string): PriceComponent[] {
  return components.filter((component) => {
    if (component.validFrom && periodStart < component.validFrom) return false
    if (component.validTo && periodStart > component.validTo) return false
    return true
  })
}

async function loadLegacyPricingComponentRules(companyId: string, warnings: string[]): Promise<PriceComponent[]> {
  try {
    const { data, error } = await supabaseService
      .from('pricing_component_rules')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('priority', { ascending: true })
      .limit(200)

    if (error) {
      if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code ?? '')) return []
      throw error
    }

    return ((data ?? []) as Record<string, unknown>[])
      .filter((row) => {
        // Offer-scoped rules apply only via the offer/contract snapshot path.
        const scope = stringValue(row.contract_offer_id)
        return !scope
      })
      .map(normalizePriceComponent)
      .filter((row): row is PriceComponent => Boolean(row))
  } catch {
    warnings.push('Prisregler (pricing_component_rules) kunde inte läsas och ingick inte i beräkningen.')
    return []
  }
}
