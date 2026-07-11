import type { BasePriceComponent, PriceComponent } from '@/lib/pricing/types'

export type ContractSnapshotOfferInput = {
  contractType?: string | null
  billingModel?: string | null
  productCode?: string | null
  monthlyFeeSek?: number | null
  invoiceFeeSek?: number | null
  markupOrePerKwh?: number | null
  spotMarkupOrePerKwh?: number | null
  variableFeeOrePerKwh?: number | null
  fixedPriceOrePerKwh?: number | null
  greenFeeMode?: string | null
  greenFeeValue?: number | null
  spotWeightPercent?: number | null
  portfolioWeightPercent?: number | null
  fixedWeightPercent?: number | null
  validFrom?: string | null
  validTo?: string | null
}

export type CanonicalContractSnapshot = {
  pricingModel: 'spot' | 'fixed' | 'portfolio' | 'mixed' | 'manual_override'
  basePriceComponents: Array<Record<string, unknown>>
  priceComponents: Array<Record<string, unknown>>
  vatRate: number
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function canonicalPricingModel(contractType?: string | null, billingModel?: string | null): CanonicalContractSnapshot['pricingModel'] {
  const raw = `${billingModel ?? ''} ${contractType ?? ''}`.trim().toLowerCase()
  if (/mixed|mix|hybrid/.test(raw)) return 'mixed'
  if (/portfolio|portfölj/.test(raw)) return 'portfolio'
  if (/fixed|fast/.test(raw)) return 'fixed'
  if (/manual/.test(raw)) return 'manual_override'
  return 'spot'
}

function normalizedWeights(input: ContractSnapshotOfferInput, pricingModel: CanonicalContractSnapshot['pricingModel']) {
  const explicit = {
    spot: numeric(input.spotWeightPercent) ?? 0,
    portfolio: numeric(input.portfolioWeightPercent) ?? 0,
    fixed: numeric(input.fixedWeightPercent) ?? 0,
  }
  const explicitTotal = explicit.spot + explicit.portfolio + explicit.fixed

  if (pricingModel === 'mixed') {
    if (Math.abs(explicitTotal - 100) > 0.0001) {
      throw new Error(`Mixpris måste summera till 100 %. Nuvarande summa är ${explicitTotal} %.`)
    }
    return explicit
  }

  if (pricingModel === 'portfolio') return { spot: 0, portfolio: 100, fixed: 0 }
  if (pricingModel === 'fixed') return { spot: 0, portfolio: 0, fixed: 100 }
  if (pricingModel === 'manual_override') return { spot: 0, portfolio: 0, fixed: 0 }
  return { spot: 100, portfolio: 0, fixed: 0 }
}

function baseRow(input: {
  sourceType: BasePriceComponent['sourceType']
  weightPercent: number
  label: string
  fixedPriceSekPerKwh?: number | null
  validFrom?: string | null
  validTo?: string | null
}): Record<string, unknown> {
  return {
    source_type: input.sourceType,
    weight_percent: input.weightPercent,
    fixed_price_sek_per_kwh: input.fixedPriceSekPerKwh ?? null,
    label: input.label,
    valid_from: input.validFrom ?? null,
    valid_to: input.validTo ?? null,
    metadata: { snapshot_schema: 'gridex_contract_pricing_v2' },
  }
}

function componentRow(component: PriceComponent): Record<string, unknown> {
  return {
    component_type: component.componentType,
    name: component.name,
    description: component.description ?? null,
    calculation_type: component.calculationType,
    amount: component.amount,
    unit: component.unit ?? component.calculationType,
    vat_applicable: component.vatApplicable !== false,
    invoice_line_visible: component.invoiceLineVisible !== false,
    periodization_mode: component.periodizationMode ?? 'none',
    priority: component.priority ?? 100,
    valid_from: component.validFrom ?? null,
    valid_to: component.validTo ?? null,
    metadata: {
      ...(component.metadata ?? {}),
      snapshot_schema: 'gridex_contract_pricing_v2',
    },
  }
}

export function buildCanonicalContractSnapshot(input: ContractSnapshotOfferInput): CanonicalContractSnapshot {
  const pricingModel = canonicalPricingModel(input.contractType, input.billingModel)
  const weights = normalizedWeights(input, pricingModel)
  const fixedPriceOre = numeric(input.fixedPriceOrePerKwh)
  const basePriceComponents: Array<Record<string, unknown>> = []

  if (weights.spot > 0) {
    basePriceComponents.push(baseRow({
      sourceType: 'spot',
      weightPercent: weights.spot,
      label: pricingModel === 'mixed' ? 'Rörlig spotandel' : 'Rörligt spotpris',
      validFrom: input.validFrom,
      validTo: input.validTo,
    }))
  }
  if (weights.portfolio > 0) {
    basePriceComponents.push(baseRow({
      sourceType: 'portfolio',
      weightPercent: weights.portfolio,
      label: pricingModel === 'mixed' ? 'Portföljandel' : 'Portföljpris',
      validFrom: input.validFrom,
      validTo: input.validTo,
    }))
  }
  if (weights.fixed > 0) {
    if (fixedPriceOre === null) throw new Error('Fastpris saknas för fast eller mixad prisandel.')
    basePriceComponents.push(baseRow({
      sourceType: 'fixed',
      weightPercent: weights.fixed,
      fixedPriceSekPerKwh: fixedPriceOre / 100,
      label: pricingModel === 'mixed' ? 'Fastprisandel' : 'Fastpris',
      validFrom: input.validFrom,
      validTo: input.validTo,
    }))
  }

  if (pricingModel === 'manual_override' && fixedPriceOre !== null) {
    basePriceComponents.push(baseRow({
      sourceType: 'manual',
      weightPercent: 100,
      fixedPriceSekPerKwh: fixedPriceOre / 100,
      label: 'Manuellt avtalat pris',
      validFrom: input.validFrom,
      validTo: input.validTo,
    }))
  }

  const priceComponents: Array<Record<string, unknown>> = []
  const push = (component: PriceComponent | null) => {
    if (component) priceComponents.push(componentRow(component))
  }

  const monthlyFee = numeric(input.monthlyFeeSek)
  if (monthlyFee !== null) push({
    componentType: 'fixed_monthly_fee',
    name: 'Månadsavgift',
    calculationType: 'fixed_monthly',
    amount: monthlyFee,
    unit: 'sek_month',
    vatApplicable: true,
    periodizationMode: 'none',
    priority: 200,
  })

  const invoiceFee = numeric(input.invoiceFeeSek)
  if (invoiceFee !== null) push({
    componentType: 'invoice_fee',
    name: 'Fakturaavgift',
    calculationType: 'fixed_once',
    amount: invoiceFee,
    unit: 'sek_invoice',
    vatApplicable: true,
    periodizationMode: 'none',
    priority: 210,
  })

  const spotMarkup = numeric(input.spotMarkupOrePerKwh) ?? numeric(input.markupOrePerKwh)
  if (spotMarkup !== null) push({
    componentType: 'spot_markup',
    name: 'Påslag',
    calculationType: 'ore_per_kwh',
    amount: spotMarkup,
    unit: 'ore_per_kwh',
    vatApplicable: true,
    periodizationMode: 'none',
    priority: 100,
  })

  const variableFee = numeric(input.variableFeeOrePerKwh)
  if (variableFee !== null) push({
    componentType: 'variable_fee',
    name: 'Rörlig avgift',
    calculationType: 'ore_per_kwh',
    amount: variableFee,
    unit: 'ore_per_kwh',
    vatApplicable: true,
    periodizationMode: 'none',
    priority: 110,
  })

  const greenFeeValue = numeric(input.greenFeeValue)
  const greenMode = input.greenFeeMode?.trim().toLowerCase()
  if (greenFeeValue !== null && greenMode && greenMode !== 'none') {
    const calculationType = greenMode === 'sek_month'
      ? 'fixed_monthly'
      : greenMode === 'sek_once'
        ? 'fixed_once'
        : greenMode === 'ore_per_kwh'
          ? 'ore_per_kwh'
          : 'per_kwh'
    push({
      componentType: 'green_energy_fee',
      name: 'Grön el',
      calculationType,
      amount: greenFeeValue,
      unit: greenMode,
      vatApplicable: true,
      periodizationMode: 'none',
      priority: 300,
    })
  }

  return { pricingModel, basePriceComponents, priceComponents, vatRate: 0.25 }
}

export function assertCanonicalSnapshot(input: CanonicalContractSnapshot): void {
  if (input.basePriceComponents.length === 0) throw new Error('Avtalets prisbas saknas.')
  const totalWeight = input.basePriceComponents.reduce((sum, row) => sum + (numeric(row.weight_percent) ?? 0), 0)
  if (Math.abs(totalWeight - 100) > 0.0001) throw new Error(`Avtalets prisandelar måste summera till 100 %. Nuvarande summa är ${totalWeight} %.`)
}
