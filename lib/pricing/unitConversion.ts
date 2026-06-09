import type { PriceComponent } from '@/lib/pricing/types'

export type NormalizedPricingUnit =
  | 'ore_per_kwh'
  | 'sek_per_kwh'
  | 'sek_month'
  | 'sek_invoice'
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

function normalizeSingleUnit(value: unknown): NormalizedPricingUnit | null {
  const normalized = normalizeText(value)
  if (!normalized) return null

  if (
    [
      'ore_per_kwh',
      'ore/kwh',
      'oreperkwh',
      'oere_per_kwh',
      'oere/kwh',
      'oereperkwh',
      'oreperkw',
    ].includes(normalized) ||
    normalized.includes('ore_per_kwh') ||
    normalized.includes('ore/kwh') ||
    normalized.includes('oere/kwh')
  ) {
    return 'ore_per_kwh'
  }

  if (
    [
      'sek_per_kwh',
      'sek/kwh',
      'kr/kwh',
      'krperkwh',
      'sekperkwh',
      'kronorperkwh',
    ].includes(normalized) ||
    normalized.includes('sek_per_kwh') ||
    normalized.includes('kr/kwh') ||
    normalized.includes('sek/kwh')
  ) {
    return 'sek_per_kwh'
  }

  if (
    [
      'sek_month',
      'sek_per_month',
      'kr/man',
      'kr/month',
      'kr/manad',
      'sek/manad',
      'sek/month',
      'fixed_monthly',
      'permonth',
    ].includes(normalized) ||
    normalized.includes('sek_month') ||
    normalized.includes('fixed_monthly') ||
    normalized.includes('kr/manad')
  ) {
    return 'sek_month'
  }

  if (
    [
      'sek_invoice',
      'sek_per_invoice',
      'kr/faktura',
      'kr/invoice',
      'invoice_fee',
      'perinvoice',
    ].includes(normalized) ||
    normalized.includes('sek_invoice') ||
    normalized.includes('kr/faktura') ||
    normalized.includes('invoice_fee')
  ) {
    return 'sek_invoice'
  }

  if ([
    'sek_once',
    'sek',
    'kr',
    'fixed_once',
    'one_time',
    'engangsbelopp',
  ].includes(normalized) || normalized.includes('fixed_once')) {
    return 'sek_once'
  }

  if (normalized === '%' || normalized === 'percent' || normalized === 'percentage' || normalized.includes('percent')) {
    return 'percentage'
  }

  return null
}

export function normalizePricingUnit(input: {
  unit?: string | null
  calculationType?: string | null
  componentType?: string | null
}): NormalizedPricingUnit {
  // Explicit unit from admin/customer price setup is source of truth.
  // calculationType and componentType are legacy fallbacks only.
  return (
    normalizeSingleUnit(input.unit) ??
    normalizeSingleUnit(input.calculationType) ??
    normalizeSingleUnit(input.componentType) ??
    'unknown'
  )
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
  if (unit === 'sek_invoice') return 'kr/faktura'
  if (unit === 'sek_once') return 'kr'
  if (unit === 'percentage') return '%'
  return 'okänd enhet'
}

export function calculationTypeForPricingUnit(unit: string | null | undefined): string {
  const normalized = normalizePricingUnit({ unit })
  if (normalized === 'ore_per_kwh' || normalized === 'sek_per_kwh') return 'per_kwh'
  if (normalized === 'sek_month') return 'fixed_monthly'
  if (normalized === 'percentage') return 'percentage'
  return 'fixed_once'
}
