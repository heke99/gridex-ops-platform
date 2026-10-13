import { normalizePricingUnitForComponent } from '@/lib/pricing/unitConversion'
import { normalizePriceComponent } from '@/lib/pricing/snapshotComponents'
import type { PriceComponent } from '@/lib/pricing/types'

// Pure customer-facing projection of the accepted snapshot; never re-quote an offer.
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function number(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const parsed = typeof value === 'number' ? value : Number(value.trim().replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function rows(snapshot: Record<string, unknown>, keys: string[]): Record<string, unknown>[] | null {
  for (const key of keys) {
    if (Array.isArray(snapshot[key])) return (snapshot[key] as unknown[]).map(object)
  }
  return null
}

function priceRows(snapshot: Record<string, unknown>): PriceComponent[] | null {
  const raw = rows(snapshot, ['price_components_snapshot', 'price_components', 'components'])
  return raw?.map(normalizePriceComponent).filter((row): row is PriceComponent => row !== null) ?? null
}

function code(row: PriceComponent): string {
  return text(row.componentCode ?? row.componentType).toLowerCase()
}

function included(row: PriceComponent): boolean {
  return row.selected !== false && row.eligible !== false && row.calculationInclusion !== 'excluded'
}

function unitFor(row: PriceComponent): string {
  const explicit = text(row.unit)
  // Preserve the more specific canonical lifecycle units before legacy normalization.
  if (['sek_site_month', 'sek_year', 'sek_contract', 'sek_event'].includes(explicit)) return explicit
  return normalizePricingUnitForComponent({
    unit: explicit,
    calculationType: row.calculationType,
    componentType: row.componentType,
  })
}

function amount(snapshot: Record<string, unknown>, keys: string[], codes: string[], units: string[]): number | null {
  const components = priceRows(snapshot)
  // A resolved component array is authoritative, including an intentionally empty one.
  if (components !== null) {
    const matching = components.filter(row => included(row) && codes.includes(code(row)) && units.includes(unitFor(row)))
    return matching.length === 1 ? matching[0].amount : null
  }
  for (const key of keys) {
    const value = number(snapshot[key])
    if (value !== null) return value
  }
  return null
}

export function pricingFacts(snapshot: Record<string, unknown>) {
  const bases = rows(snapshot, ['base_price_components_snapshot', 'base_price_components'])
  const fixed = bases?.filter(row => ['fixed', 'manual'].includes(text(row.source_type)) && number(row.fixed_price_sek_per_kwh) !== null) ?? []
  return {
    monthlyFeeSek: amount(snapshot, ['monthly_fee_sek', 'monthlyFeeSek'], ['monthly_fee', 'fixed_monthly_fee'], ['sek_month']),
    invoiceFeeSek: amount(snapshot, ['invoice_fee_sek', 'invoiceFeeSek'], ['invoice_fee', 'invoice_administration_fee'], ['sek_invoice']),
    spotMarkupOrePerKwh: amount(snapshot, ['spot_markup_ore_per_kwh', 'spotMarkupOrePerKwh'], ['spot_markup'], ['ore_per_kwh']),
    fixedPriceOrePerKwh: bases !== null ? (fixed.length === 1 ? number(fixed[0].fixed_price_sek_per_kwh)! * 100 : null) : amount(snapshot, ['fixed_price_ore_per_kwh', 'fixedPriceOrePerKwh'], ['fixed_price'], ['ore_per_kwh']),
    variableFeeOrePerKwh: amount(snapshot, ['variable_fee_ore_per_kwh', 'variableFeeOrePerKwh'], ['variable_fee'], ['ore_per_kwh']),
    bindingMonths: number(snapshot.binding_months ?? snapshot.bindingMonths),
    noticeMonths: number(snapshot.notice_months ?? snapshot.noticeMonths),
  }
}

const UNIT_LABELS: Record<string, string> = {
  ore_per_kwh: 'öre/kWh', sek_per_kwh: 'kr/kWh', sek_month: 'kr/mån',
  sek_site_month: 'kr/anläggning/mån', sek_invoice: 'kr/faktura', sek_year: 'kr/år',
  sek_contract: 'kr/avtal', sek_once: 'kr engångsavgift', sek_event: 'kr/händelse', percentage: '%',
}

function formatted(value: number): string {
  return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 20 }).format(value)
}

function vatLabel(row: PriceComponent): string {
  // The billing normalizer resolves canonical VAT applicability; amounts are net.
  return row.vatApplicable === false ? ' momsfri' : ' exkl. moms'
}

export function frozenPriceLines(snapshot: Record<string, unknown>): string[] {
  const bases = rows(snapshot, ['base_price_components_snapshot', 'base_price_components'])
  const components = priceRows(snapshot)
  if (bases !== null || components !== null) {
    const lines: string[] = []
    for (const base of bases ?? []) {
      const source = text(base.source_type)
      const weight = number(base.weight_percent)
      const share = weight !== null && weight !== 100 ? ` (${formatted(weight)} %)` : ''
      const label = text(base.label) || ({ fixed: 'Fast pris', manual: 'Avtalat pris', spot: 'Spotpris', portfolio: 'Portföljpris' } as Record<string, string>)[source]
      if (!label || weight === 0) continue
      const fixed = number(base.fixed_price_sek_per_kwh)
      if (['fixed', 'manual'].includes(source) && fixed !== null) lines.push(`${label}${share}: ${formatted(fixed)} kr/kWh exkl. moms`)
      else if (source === 'spot' || source === 'portfolio') lines.push(`${label}${share} enligt avtalets frysta prisvillkor`)
    }
    for (const row of components ?? []) {
      if (!included(row)) continue
      const value = row.amount
      const normalizedUnit = unitFor(row)
      const unit = UNIT_LABELS[normalizedUnit]
      const label = row.name
      if (value === null || !unit || !label) continue
      const calculationBase = text(row.calculationBase)
      const basisLabels: Record<string, string> = {
        spot: 'spotpriset', spot_price: 'spotpriset', portfolio: 'portföljpriset', portfolio_price: 'portföljpriset',
        spot_cost: 'spotkostnaden', portfolio_cost: 'portföljkostnaden',
        energy: 'energipriset', base_energy: 'energipriset', energy_amount: 'energipriset',
        energy_cost_ex_vat: 'energikostnaden exkl. moms', energy_cost_inc_vat: 'energikostnaden inkl. moms',
        total_variable_cost: 'den totala rörliga kostnaden',
        invoice_subtotal: 'fakturans delsumma', monthly_fixed: 'månadsavgiften', monthly_fixed_amount: 'månadsavgiften',
      }
      const basis = normalizedUnit === 'percentage' && calculationBase ? ` av ${basisLabels[calculationBase] ?? 'avtalad beräkningsgrund'}` : ''
      lines.push(`${label}: ${formatted(value)} ${unit}${basis}${vatLabel(row)}`)
    }
    const siteCount = number(snapshot.site_count)
    if (siteCount !== null && (components ?? []).some(row => included(row) && unitFor(row) === 'sek_site_month')) {
      lines.push(`Antal anläggningar i prisvalet: ${formatted(siteCount)}`)
    }
    return lines
  }
  const facts = pricingFacts(snapshot)
  return [
    [facts.monthlyFeeSek, 'kr/mån'], [facts.invoiceFeeSek, 'kr/faktura'],
    [facts.spotMarkupOrePerKwh, 'öre/kWh spotpåslag'], [facts.variableFeeOrePerKwh, 'öre/kWh rörlig avgift'],
    [facts.fixedPriceOrePerKwh, 'öre/kWh fast pris'],
  ].flatMap(([value, unit]) => typeof value === 'number' ? [`${formatted(value)} ${unit}`] : [])
}

export function frozenPriceSummary(snapshot: Record<string, unknown>): string {
  return frozenPriceLines(snapshot).join(', ') || 'Pris enligt den frysta prisversionen i avtalet.'
}
