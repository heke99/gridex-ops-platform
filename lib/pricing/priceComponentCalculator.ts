import type { BillingUnderlayInput, PriceComponent, PricingPreviewLine } from '@/lib/pricing/types'
import { displayPricingUnit, normalizePricingUnitForComponent, sekPerKwhFromComponent } from '@/lib/pricing/unitConversion'

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
  if (component.periodizationMode !== 'active_days' && component.periodizationMode !== 'prorated_by_days') return 1
  const totalDays = Math.max(daysBetween(underlay.periodStart, underlay.periodEnd), 1)
  const activeStart = underlay.activeFrom && underlay.activeFrom > underlay.periodStart ? underlay.activeFrom : underlay.periodStart
  const activeEnd = underlay.activeTo && underlay.activeTo < underlay.periodEnd ? underlay.activeTo : underlay.periodEnd
  const activeDays = Math.min(Math.max(daysBetween(activeStart, activeEnd), 0), totalDays)
  return activeDays / totalDays
}

function normalizedCalculationType(component: PriceComponent): string {
  const unit = normalizePricingUnitForComponent({
    unit: component.unit,
    calculationType: component.calculationType,
    componentType: component.componentType,
  })

  if (component.calculationType === 'discount_per_kwh') return 'discount_per_kwh'
  if (component.calculationType === 'discount_fixed') return 'discount_fixed'
  if (component.calculationType === 'rounding') return 'rounding'
  if (unit === 'ore_per_kwh' || unit === 'sek_per_kwh') return 'per_kwh'
  if (unit === 'sek_month') return 'fixed_monthly'
  if (unit === 'sek_invoice' || unit === 'sek_once') return 'fixed_once'
  if (unit === 'percentage') return 'percentage'
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
      const sekPerKwh = type === 'per_kwh_ore' ? component.amount / 100 : sekPerKwhFromComponent(component)
      unitPriceExVat = sekPerKwh
      amountExVat = quantityKwh * sekPerKwh
      unit = 'kWh'
    } else if (type === 'fixed_monthly') {
      // Monthly fees are charged once per billing period by default.
      // Proration must be an explicit contract/campaign choice; legacy active_days rows
      // must not turn a normal monthly fee into quantity 0 when dates are incomplete/misaligned.
      const factor = component.periodizationMode === 'prorated_by_days'
        ? Math.max(periodizationFactor(input.underlay, component), 0)
        : 1
      quantity = factor
      unit = 'månad'
      unitPriceExVat = component.amount
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
      const sekPerKwh = Math.abs(sekPerKwhFromComponent(component))
      unitPriceExVat = -sekPerKwh
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
      metadata: {
        ...(component.metadata ?? {}),
        input_amount: component.amount,
        input_unit: component.unit ?? component.calculationType ?? null,
        normalized_pricing_unit: normalizePricingUnitForComponent({ unit: component.unit, calculationType: component.calculationType, componentType: component.componentType }),
        display_pricing_unit: displayPricingUnit(normalizePricingUnitForComponent({ unit: component.unit, calculationType: component.calculationType, componentType: component.componentType })),
      },
    })
    sortOrder += 10
  }

  return { lines, warnings, errors }
}
