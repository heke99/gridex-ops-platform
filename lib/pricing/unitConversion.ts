import type { PriceComponent } from '@/lib/pricing/types'

export type NormalizedPricingUnit =
  | 'ore_per_kwh'
  | 'sek_per_kwh'
  | 'sek_month'
  | 'sek_once'
  | 'percentage'
  | 'unknown'

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .trim()
    .toLowerCase()
    .replace(/å/g, 'a')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/\s+/g, '')
}

export function normalizePricingUnit(input: {
  unit?: string | null
  calculationType?: string | null
  componentType?: string | null
}): NormalizedPricingUnit {
  const unit = normalizeText(input.unit)
  const calculationType = normalizeText(input.calculationType)
  const componentType = normalizeText(input.componentType)
  const candidates = [unit, calculationType, componentType].filter(Boolean)

  if (candidates.some((value) => [
    'ore_per_kwh',
    'ore/kwh',
    'oreperkwh',
    'ore/kwh',
    'ore/kwh',
    'oere_per_kwh',
    'oere/kwh',
    'oreperkwh',
    'oreperkw',
  ].includes(value) || value.includes('ore_per_kwh') || value.includes('ore/kwh'))) {
    return 'ore_per_kwh'
  }

  if (candidates.some((value) => [
    'sek_per_kwh',
    'sek/kwh',
    'kr/kwh',
    'krperkwh',
    'sekperkwh',
  ].includes(value) || value.includes('sek_per_kwh') || value.includes('kr/kwh') || value.includes('sek/kwh'))) {
    return 'sek_per_kwh'
  }

  if (candidates.some((value) => [
    'sek_month',
    'sek_per_month',
    'kr/man',
    'kr/month',
    'kr/manad',
    'sek/manad',
    'fixed_monthly',
  ].includes(value) || value.includes('sek_month') || value.includes('fixed_monthly'))) {
    return 'sek_month'
  }

  if (candidates.some((value) => [
    'sek_once',
    'sek',
    'kr',
    'fixed_once',
  ].includes(value) || value.includes('fixed_once'))) {
    return 'sek_once'
  }

  if (candidates.some((value) => value === '%' || value === 'percent' || value === 'percentage')) {
    return 'percentage'
  }

  return 'unknown'
}

export function sekPerKwhFromComponent(component: PriceComponent): number {
  const unit = normalizePricingUnit({
    unit: component.unit,
    calculationType: component.calculationType,
    componentType: component.componentType,
  })

  if (unit === 'ore_per_kwh') return component.amount / 100
  return component.amount
}

export function displayPricingUnit(unit: NormalizedPricingUnit): string {
  if (unit === 'ore_per_kwh') return 'öre/kWh'
  if (unit === 'sek_per_kwh') return 'kr/kWh'
  if (unit === 'sek_month') return 'kr/mån'
  if (unit === 'sek_once') return 'kr'
  if (unit === 'percentage') return '%'
  return 'okänd enhet'
}
