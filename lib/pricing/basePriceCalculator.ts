import type {
  BasePriceComponent,
  BasePriceResult,
  BasePriceSourceValues,
  BillingUnderlayInput,
  PricingPreviewLine,
} from '@/lib/pricing/types'

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function roundKwhPrice(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function line(params: {
  description: string
  quantity: number | null
  unitPriceExVat: number | null
  amountExVat: number
  sortOrder: number
  metadata?: Record<string, unknown>
}): PricingPreviewLine {
  return {
    lineType: 'base_price',
    description: params.description,
    quantity: params.quantity,
    unit: 'kWh',
    unitPriceExVat: params.unitPriceExVat,
    amountExVat: roundMoney(params.amountExVat),
    vatRate: 0,
    vatAmount: 0,
    amountIncVat: roundMoney(params.amountExVat),
    sortOrder: params.sortOrder,
    metadata: params.metadata ?? {},
  }
}

function sourcePrice(sourceType: BasePriceComponent['sourceType'], values: BasePriceSourceValues, component: BasePriceComponent): number | null {
  if (sourceType === 'spot') return values.spotSekPerKwh ?? null
  if (sourceType === 'portfolio') return values.portfolioSekPerKwh ?? null
  if (sourceType === 'fixed') return component.fixedPriceSekPerKwh ?? values.fixedSekPerKwh ?? null
  if (sourceType === 'manual') return component.fixedPriceSekPerKwh ?? values.manualSekPerKwh ?? null
  return null
}

function labelForSource(sourceType: BasePriceComponent['sourceType']): string {
  if (sourceType === 'spot') return 'Spotpris'
  if (sourceType === 'portfolio') return 'Portföljpris'
  if (sourceType === 'fixed') return 'Fastpris'
  return 'Manuell prisbas'
}

export function calculateBasePrice(input: {
  underlay: BillingUnderlayInput
  components: BasePriceComponent[]
  sourceValues: BasePriceSourceValues
}): BasePriceResult {
  const warnings: string[] = []
  const errors: string[] = []
  const lines: PricingPreviewLine[] = []
  const quantityKwh = input.underlay.quantityKwh

  if (quantityKwh === null || !Number.isFinite(quantityKwh)) {
    errors.push('Mätförbrukning saknas för prisberäkning.')
    return { status: 'failed', baseSekPerKwh: null, lines, warnings, errors }
  }

  const activeComponents = input.components.filter((component) => component.weightPercent > 0)
  if (activeComponents.length === 0) {
    errors.push('Prisbas saknas i avtalets prisregel.')
    return { status: 'failed', baseSekPerKwh: null, lines, warnings, errors }
  }

  const totalWeight = activeComponents.reduce((sum, component) => sum + component.weightPercent, 0)
  if (Math.abs(totalWeight - 100) > 0.0001) {
    errors.push(`Mixpris måste summera till 100 %. Nuvarande summa är ${totalWeight} %.`)
    return { status: 'failed', baseSekPerKwh: null, lines, warnings, errors }
  }

  let baseSekPerKwh = 0
  let sort = 10

  for (const component of activeComponents) {
    const price = sourcePrice(component.sourceType, input.sourceValues, component)
    if (price === null || !Number.isFinite(price)) {
      errors.push(`${labelForSource(component.sourceType)} saknas för perioden och elområdet.`)
      continue
    }

    const weightedPrice = price * (component.weightPercent / 100)
    const amount = quantityKwh * weightedPrice
    baseSekPerKwh += weightedPrice
    lines.push(line({
      description: `${component.label || labelForSource(component.sourceType)} (${component.weightPercent} %)`,
      quantity: quantityKwh,
      unitPriceExVat: roundKwhPrice(weightedPrice),
      amountExVat: amount,
      sortOrder: sort,
      metadata: {
        source_type: component.sourceType,
        source_price_sek_per_kwh: price,
        weight_percent: component.weightPercent,
      },
    }))
    sort += 10
  }

  if (errors.length > 0) return { status: 'failed', baseSekPerKwh: null, lines, warnings, errors }

  return {
    status: 'success',
    baseSekPerKwh: roundKwhPrice(baseSekPerKwh),
    lines,
    warnings,
    errors,
  }
}
