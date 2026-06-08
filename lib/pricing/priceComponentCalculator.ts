import type { BillingUnderlayInput, PriceComponent, PricingPreviewLine } from '@/lib/pricing/types'

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function daysBetween(start: string, end: string): number {
  const startMs = new Date(start).getTime()
  const endMs = new Date(end).getTime()
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return 0
  return Math.ceil((endMs - startMs) / 86_400_000)
}

function periodizationFactor(underlay: BillingUnderlayInput, component: PriceComponent): number {
  if (component.periodizationMode !== 'active_days') return 1
  const totalDays = Math.max(daysBetween(underlay.periodStart, underlay.periodEnd), 1)
  const activeStart = underlay.activeFrom && underlay.activeFrom > underlay.periodStart ? underlay.activeFrom : underlay.periodStart
  const activeEnd = underlay.activeTo && underlay.activeTo < underlay.periodEnd ? underlay.activeTo : underlay.periodEnd
  const activeDays = Math.min(Math.max(daysBetween(activeStart, activeEnd), 0), totalDays)
  return activeDays / totalDays
}

function normalizedCalculationType(component: PriceComponent): string {
  if (component.calculationType === 'ore_per_kwh') return 'per_kwh_ore'
  if (component.calculationType === 'sek_month') return 'fixed_monthly'
  if (component.calculationType === 'sek_once') return 'fixed_once'
  if (component.calculationType === 'discount_per_kwh') return 'discount_per_kwh'
  if (component.calculationType === 'discount_fixed') return 'discount_fixed'
  return component.calculationType
}

export function calculatePriceComponents(input: {
  underlay: BillingUnderlayInput
  components: PriceComponent[]
  baseAmountExVat: number
  vatRate: number
  startSortOrder?: number
}): { lines: PricingPreviewLine[]; warnings: string[]; errors: string[] } {
  const lines: PricingPreviewLine[] = []
  const warnings: string[] = []
  const errors: string[] = []
  const quantityKwh = input.underlay.quantityKwh
  let sortOrder = input.startSortOrder ?? 100

  const activeComponents = [...input.components].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))
  for (const component of activeComponents) {
    const type = normalizedCalculationType(component)
    let quantity: number | null = 1
    let unit = component.unit ?? 'st'
    let unitPriceExVat: number | null = component.amount
    let amountExVat = 0

    if (type === 'per_kwh' || type === 'per_kwh_ore') {
      if (quantityKwh === null || !Number.isFinite(quantityKwh)) {
        errors.push(`${component.name} kräver kWh för perioden.`)
        continue
      }
      quantity = quantityKwh
      unit = 'kWh'
      const sekPerKwh = type === 'per_kwh_ore' ? component.amount / 100 : component.amount
      unitPriceExVat = sekPerKwh
      amountExVat = quantityKwh * sekPerKwh
    } else if (type === 'fixed_monthly') {
      const factor = periodizationFactor(input.underlay, component)
      quantity = factor
      unit = 'månad'
      amountExVat = component.amount * factor
    } else if (type === 'fixed_once') {
      amountExVat = component.amount
      unit = 'st'
    } else if (type === 'percentage') {
      amountExVat = input.baseAmountExVat * (component.amount / 100)
      unit = '%'
    } else if (type === 'discount_per_kwh') {
      if (quantityKwh === null || !Number.isFinite(quantityKwh)) {
        errors.push(`${component.name} kräver kWh för perioden.`)
        continue
      }
      quantity = quantityKwh
      unit = 'kWh'
      unitPriceExVat = -(Math.abs(component.amount) / 100)
      amountExVat = quantityKwh * unitPriceExVat
    } else if (type === 'discount_fixed') {
      unitPriceExVat = -Math.abs(component.amount)
      amountExVat = unitPriceExVat
    } else if (type === 'rounding') {
      const roundedBase = Math.round(input.baseAmountExVat)
      amountExVat = roundedBase - input.baseAmountExVat
      unitPriceExVat = amountExVat
    } else {
      warnings.push(`Okänd beräkningstyp för ${component.name}: ${component.calculationType}`)
      continue
    }

    if (['discount_ore_per_kwh', 'discount_fixed_amount', 'campaign_discount'].includes(component.componentType) && amountExVat > 0) {
      amountExVat = -Math.abs(amountExVat)
      if (unitPriceExVat !== null) unitPriceExVat = -Math.abs(unitPriceExVat)
    }

    const vatRate = component.vatApplicable === false ? 0 : input.vatRate
    const roundedExVat = roundMoney(amountExVat)
    const vatAmount = roundMoney(roundedExVat * vatRate)
    lines.push({
      lineType: component.componentType,
      description: component.name,
      quantity,
      unit,
      unitPriceExVat,
      amountExVat: roundedExVat,
      vatRate,
      vatAmount,
      amountIncVat: roundMoney(roundedExVat + vatAmount),
      sortOrder,
      metadata: component.metadata ?? {},
    })
    sortOrder += 10
  }

  return { lines, warnings, errors }
}
