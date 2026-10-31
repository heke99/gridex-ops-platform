// SITE01 synthetic site specifications and the independent per-site ORACLE.
//
// Pure module: no IO, no app import. Expected values are computed only from the
// inputs below (the same generators the UTILTS files and spot payloads are
// built from), never from app output.
//
// ROUNDING / PRORATION POLICY (cited from the unchanged base, 1c0c088c):
//  - money rounding: lib/pricing/basePriceCalculator.ts:6-8 (roundMoney, half-up to cents), spot line :128-142
//    (quantity * weighted price, rounded ONCE per underlay); lib/pricing/intervalPricing.ts:300-309 (the price is the
//    quantity-weighted mean of the per-interval prices); lib/pricing/priceComponentCalculator.ts:157-166 (per-kWh
//    markup: quantity * ore/100, rounded) and :327-328 (line rounding, VAT per line); lib/pricing/pricePreviewBuilder.ts:17-44
//    (default VAT on the base line, totals).
//  - monthly fee in a PARTIAL month: lib/pricing/priceComponentCalculator.ts:67-96 and :208-224. A fixed monthly
//    fee is quantity 1 unless the component carries an explicit proration policy in its metadata
//    (billing_policy/proration_policy/monthly_fee_policy = prorated_by_days, or proration_enabled/explicit_proration).
//    The seeded offers carry no such policy, so the oracle charges the FULL fee for a delivery that covers only
//    part of the month (site B), i.e. no proration. If the app prorates, the SITE01 amounts will differ and the
//    scenario names the line.
//  - first/annual lifecycle components (priceComponentCalculator.ts:160-180, engine.ts:301-314) are not part of the
//    seeded offers; any extra line shows up as a line-count mismatch.
import { QUARTERS_PER_DAY, QUARTER_MS, formatMilliKwh, hourlySpotE5, intervalStartMs, quarterMilliKwh, syntheticMonth, type SyntheticMonth } from './synthetic'

export type SiteKey = 'A' | 'B'

export type SiteSpec = {
  key: SiteKey
  label: string
  priceArea: 'SE3' | 'SE4'
  /** Three-letter grid area code on the wire, the point and the site. */
  gridAreaCode: string
  gridOwnerName: string
  /** Contract and supply start (Stockholm civil date). */
  startDate: string
  /** Last delivered local day-of-month and (for an ended delivery) the civil end date. */
  firstDay: number
  lastDay: number
  /** Last day for which UTILTS files are delivered (may be after the end: such days must not be billed). */
  deliveredLastDay: number
  endDate: string | null
  markupOrePerKwh: number
  monthlyFeeSek: number
  vatPercent: 25
  /** Salt of the consumption generator. Searched upward for float-unambiguous money. */
  consumptionSaltStart: number
  /** Salt of the hourly spot generator for this price area (spot data is global per area). */
  priceSalt: number
  address: { street: string; postalCode: string; city: string }
}

/**
 * Site A uses the native seed's offer unchanged (SE3, 4 ore/kWh, 49 SEK/month): the seed fixes them.
 * Site B has its own offer, price area, grid owner and grid area. SE3 spot uses salt 1 so it is identical to MAIN03/MAIN04
 * (spot prices are global per source/area/time and may already be imported and locked by them).
 */
export const SITE_A: SiteSpec = {
  key: 'A', label: 'Site A (aktiv hela månaden)', priceArea: 'SE3', gridAreaCode: 'TES', gridOwnerName: 'Synthetic grid owner A', startDate: '2026-09-01',
  firstDay: 1, lastDay: 30, deliveredLastDay: 30, endDate: null, markupOrePerKwh: 4, monthlyFeeSek: 49, vatPercent: 25, consumptionSaltStart: 11, priceSalt: 1,
  address: { street: 'Anläggningsgatan A 1', postalCode: '111 11', city: 'Teststad A' },
}
export const SITE_B: SiteSpec = {
  key: 'B', label: 'Site B (startar 16 sep, slutar 25 sep)', priceArea: 'SE4', gridAreaCode: 'TEB', gridOwnerName: 'Synthetic grid owner B', startDate: '2026-09-16',
  firstDay: 16, lastDay: 25, deliveredLastDay: 30, endDate: '2026-09-25', markupOrePerKwh: 9, monthlyFeeSek: 79, vatPercent: 25, consumptionSaltStart: 23, priceSalt: 7,
  address: { street: 'Anläggningsgatan B 2', postalCode: '222 22', city: 'Teststad B' },
}

/**
 * Billing month of SITE01: September 2026, NOT February 2027. A normal supply start can only be activated once it is due
 * (activate_customer_supply_v1: proof.market_start_at>now() raises normal_supply_activation_not_due) and billing needs the activation
 * (gridex_received_sources.billing_supply_basis_v1 'activated'). The stack's clock is the real one (2026-10-29), so a mid-month start
 * (site B) is only possible in a month that already lies in the past; September 2026 is the last month without a DST change
 * (2026-10-25), which the synthetic UTILTS generator does not support.
 */
export const SITE01_BILLING_MONTH = '2026-09'

export type SiteInterval = { day: number; quarter: number; startMs: number; endMs: number; milliKwh: number; spotE5: number }

export type SiteOracle = {
  spec: SiteSpec
  month: SyntheticMonth
  consumptionSalt: number
  intervals: SiteInterval[]
  perDay: Array<{ day: number; milliKwh: number }>
  totalMilliKwh: number
  totalKwhText: string
  lines: { spotCents: number; markupCents: number; monthlyFeeCents: number }
  vatCents: { spot: number; markup: number; monthlyFee: number; total: number }
  totalExVatCents: number
  totalIncVatCents: number
  /** First billable instant (local start of firstDay) and exclusive end (local start of the day after lastDay). */
  billableStartMs: number
  billableEndMs: number
  ambiguities: string[]
}

const halfUp = (numerator: number, denominator: number): number => Math.floor((2 * numerator + denominator) / (2 * denominator))

export function buildSiteOracle(spec: SiteSpec, consumptionSalt: number, monthName = SITE01_BILLING_MONTH): SiteOracle {
  const month = syntheticMonth(monthName)
  const intervals: SiteInterval[] = []
  const perDay: Array<{ day: number; milliKwh: number }> = []
  let totalMilli = 0, spotRawE8 = 0
  for (let day = spec.firstDay; day <= spec.lastDay; day++) {
    let dayMilli = 0
    for (let quarter = 0; quarter < QUARTERS_PER_DAY; quarter++) {
      const milliKwh = quarterMilliKwh(day, quarter, consumptionSalt)
      const startMs = intervalStartMs(month, day, quarter)
      const spotE5 = hourlySpotE5(day, Math.floor(quarter / 4), spec.priceSalt)
      intervals.push({ day, quarter, startMs, endMs: startMs + QUARTER_MS, milliKwh, spotE5 })
      dayMilli += milliKwh; totalMilli += milliKwh; spotRawE8 += milliKwh * spotE5
    }
    perDay.push({ day, milliKwh: dayMilli })
  }
  const spotCents = halfUp(spotRawE8, 1_000_000)
  const markupExact = totalMilli * spec.markupOrePerKwh
  const markupCents = halfUp(markupExact, 1000)
  const monthlyFeeCents = spec.monthlyFeeSek * 100
  const vat = (cents: number) => halfUp(cents * spec.vatPercent, 100)
  const vatCents = { spot: vat(spotCents), markup: vat(markupCents), monthlyFee: vat(monthlyFeeCents), total: 0 }
  vatCents.total = vatCents.spot + vatCents.markup + vatCents.monthlyFee
  const totalExVatCents = spotCents + markupCents + monthlyFeeCents
  const ambiguities: string[] = []
  if (Math.abs((spotRawE8 % 1_000_000) - 500_000) < 1_000) ambiguities.push('spot_half_cent')
  if (markupExact % 1000 === 500) ambiguities.push('markup_half_cent')
  for (const [name, cents] of [['spot', spotCents], ['markup', markupCents], ['monthlyFee', monthlyFeeCents]] as const) {
    if (cents % 4 === 2) ambiguities.push(`vat_half_cent:${name}`)
  }
  return {
    spec, month, consumptionSalt, intervals, perDay, totalMilliKwh: totalMilli, totalKwhText: formatMilliKwh(totalMilli),
    lines: { spotCents, markupCents, monthlyFeeCents }, vatCents, totalExVatCents, totalIncVatCents: totalExVatCents + vatCents.total,
    billableStartMs: month.startMs + (spec.firstDay - 1) * 86_400_000, billableEndMs: month.startMs + spec.lastDay * 86_400_000, ambiguities,
  }
}

export function chooseSiteOracle(spec: SiteSpec, monthName = SITE01_BILLING_MONTH): SiteOracle {
  for (let salt = spec.consumptionSaltStart; salt < spec.consumptionSaltStart + 500; salt++) {
    const oracle = buildSiteOracle(spec, salt, monthName)
    if (oracle.ambiguities.length === 0) return oracle
  }
  throw new Error(`site01_no_unambiguous_salt:${spec.key}`)
}
