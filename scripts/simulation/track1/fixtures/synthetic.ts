// Track 1 synthetic, deterministic input data and the independent ORACLE.
//
// Pure module: no IO, no import of any app code. The oracle below computes the
// expected kWh and money amounts only from this file's own generated inputs.
// Nothing here is read back from the app's output.
//
// ROUNDING POLICY (read from the unchanged base, documented here because the
// oracle must reproduce the business rule, not the code):
//  - lib/pricing/basePriceCalculator.ts:6-8   roundMoney = Math.round(v * 100) / 100
//    (half away from zero for positive amounts, i.e. half-up to whole cents)
//  - lib/pricing/basePriceCalculator.ts:128-142  spot base line:
//    amount = quantityKwh * (spotAverage * weight/100), then roundMoney, ONCE
//    per underlay. spotAverage is the quantity-weighted mean of the per-interval
//    prices (lib/pricing/intervalPricing.ts:300-309, sum(q*p)/sum(q)), so the
//    unrounded line amount equals sum(q_i * p_i) up to float noise; the per
//    interval amount (intervalPricing.ts:282) is rounded for evidence only and
//    is NOT summed into the line.
//  - lib/pricing/priceComponentCalculator.ts:327  per component:
//    roundedExVat = roundMoney(amountExVat); :328 vat = roundMoney(roundedExVat*rate)
//    per_kwh component (:157-166): amount = quantityKwh * (ore/100)
//    fixed_monthly (:167-182): amount = fee * 1 (no proration by default, :84-96)
//  - lib/pricing/pricePreviewBuilder.ts:17-44  base line has vatRate 0/vatAmount 0
//    so the default VAT is applied: vat = roundMoney(amountExVat * vatRate);
//    totals: totalExVat = roundMoney(sum of rounded lines), vat = roundMoney(sum
//    of per-line vat), totalIncVat = roundMoney(totalExVat + vat).
//  All money is rounded per line first (half-up to cents), VAT per line, then summed.
//
// The app computes in IEEE doubles; this oracle uses exact integers. They can
// only differ when an exact intermediate sits on a half-cent boundary. The
// builder therefore refuses (and re-salts) data whose intermediates are
// "ambiguous" (see `ambiguities`), so a mismatch can never be float noise.

export const SYNTHETIC_TZ = 'Europe/Stockholm'

export type Ymd = { year: number; month: number; day: number }

/** UTC offset (minutes) of Europe/Stockholm at a UTC instant, from Intl (not from app code). */
export function stockholmOffsetMinutes(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SYNTHETIC_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs))
  const get = (type: string) => Number(parts.find(part => part.type === type)!.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000)
}

/** Local Stockholm wall time to UTC ms (valid for non-transition times). */
export function localToUtcMs(year: number, month: number, day: number, hour = 0, minute = 0): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute)
  let guess = naive - stockholmOffsetMinutes(naive) * 60000
  guess = naive - stockholmOffsetMinutes(guess) * 60000
  return guess
}

export type SyntheticMonth = {
  billingMonth: string
  year: number
  month: number
  days: number
  /** Declared offset for the whole month, e.g. 60 for +0100. */
  offsetMinutes: number
  startMs: number
  endMs: number
}

export function syntheticMonth(billingMonth: string): SyntheticMonth {
  const match = /^(\d{4})-(\d{2})$/.exec(billingMonth)
  if (!match) throw new Error(`fixture_month_invalid:${billingMonth}`)
  const year = Number(match[1]), month = Number(match[2])
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const startMs = localToUtcMs(year, month, 1)
  const nextYear = month === 12 ? year + 1 : year, nextMonth = month === 12 ? 1 : month + 1
  const endMs = localToUtcMs(nextYear, nextMonth, 1)
  const startOffset = stockholmOffsetMinutes(startMs), endOffset = stockholmOffsetMinutes(endMs - 1)
  if (startOffset !== endOffset) throw new Error(`fixture_month_contains_dst_transition:${billingMonth}`)
  if ((endMs - startMs) !== days * 86_400_000) throw new Error(`fixture_month_length_unexpected:${billingMonth}`)
  return { billingMonth, year, month, days, offsetMinutes: startOffset, startMs, endMs }
}

export const QUARTERS_PER_DAY = 96
export const QUARTER_MS = 15 * 60_000

export function pad2(value: number): string { return String(value).padStart(2, '0') }

/** `+0100` style offset for DTM+735. */
export function edifactOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  return `${sign}${pad2(Math.floor(abs / 60))}${pad2(abs % 60)}`
}

/** Local `YYYYMMDDHHmm` for a given local day (1-based) and local minute-of-day. */
export function localStamp(month: SyntheticMonth, day: number, minuteOfDay: number): string {
  const date = new Date(Date.UTC(month.year, month.month - 1, day, 0, minuteOfDay))
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}`
}

export function localDate(month: SyntheticMonth, day: number): string {
  return `${month.year}-${pad2(month.month)}-${pad2(day)}`
}

export function intervalStartMs(month: SyntheticMonth, day: number, quarter: number): number {
  return month.startMs + ((day - 1) * QUARTERS_PER_DAY + quarter) * QUARTER_MS
}

// ---------------------------------------------------------------- consumption

const HOURLY_PROFILE_MILLI = [60, 50, 45, 45, 50, 70, 120, 180, 200, 160, 140, 130, 125, 120, 125, 140, 170, 230, 260, 250, 200, 150, 100, 75]

function mix(a: number, b: number, c: number): number {
  // Small deterministic integer hash (no Math.random, no Date).
  let h = (Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x165667b1, 0x27d4eb2f)) >>> 0
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15
  return h >>> 0
}

/** Consumption for one quarter in integer thousandths of a kWh. Always >= 1. */
export function quarterMilliKwh(day: number, quarter: number, salt: number): number {
  const hour = Math.floor(quarter / 4)
  const noise = mix(day, quarter, salt) % 41
  const dayShape = (mix(day, 99, salt) % 31)
  return HOURLY_PROFILE_MILLI[hour] + noise + dayShape + 1
}

/** Canonical decimal text for thousandths: no trailing zeros, '.' decimal mark. */
export function formatMilliKwh(milli: number): string {
  if (!Number.isInteger(milli) || milli < 0) throw new Error(`fixture_milli_invalid:${milli}`)
  const whole = Math.floor(milli / 1000), frac = milli % 1000
  if (frac === 0) return String(whole)
  return `${whole}.${String(frac).padStart(3, '0').replace(/0+$/, '')}`
}

/** Parse a canonical decimal kWh text (<= 3 decimals) back to thousandths. */
export function parseMilliKwh(text: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(text.trim())
  if (!match) throw new Error(`fixture_decimal_unparsable:${text}`)
  const value = Number(match[2]) * 1000 + Number((match[3] ?? '').padEnd(3, '0'))
  return match[1] ? -value : value
}

// ----------------------------------------------------------------------- spot

/** Hourly spot price in units of 1e-5 SEK/kWh (positive integers). */
export function hourlySpotE5(day: number, hour: number, salt: number): number {
  const peak = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 20) ? 30000 : 0
  return 25000 + (mix(day, hour + 1000, salt + 7) % 80000) + peak
}

export function spotSekPerKwh(e5: number): number { return e5 / 100000 }

/** ISO timestamp with the month's fixed local offset, e.g. 2027-02-01T00:00:00+01:00. */
export function isoWithOffset(utcMs: number, offsetMinutes: number): string {
  const local = new Date(utcMs + offsetMinutes * 60000)
  const sign = offsetMinutes < 0 ? '-' : '+', abs = Math.abs(offsetMinutes)
  return `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}T${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}:00${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
}

/** An elprisetjustnu-format day payload (hourly rows, local offset timestamps). */
export function spotDayPayload(month: SyntheticMonth, day: number, salt: number): Array<Record<string, unknown>> {
  return Array.from({ length: 24 }, (_, hour) => {
    const startMs = month.startMs + ((day - 1) * 24 + hour) * 3_600_000
    const e5 = hourlySpotE5(day, hour, salt)
    return {
      SEK_per_kWh: spotSekPerKwh(e5), EUR_per_kWh: Math.round(spotSekPerKwh(e5) / 11.5 * 1e6) / 1e6, EXR: 11.5,
      time_start: isoWithOffset(startMs, month.offsetMinutes), time_end: isoWithOffset(startMs + 3_600_000, month.offsetMinutes),
    }
  })
}

// --------------------------------------------------------------------- oracle

export type OraclePricing = {
  /** Share of spot in the base price, percent. Only 100 is supported. */
  spotWeightPercent: 100
  /** per-kWh markup, öre/kWh (integer). */
  markupOrePerKwh: number
  /** fixed monthly fee, whole SEK. */
  monthlyFeeSek: number
  /** VAT rate in percent (25). */
  vatPercent: number
}

export type OracleDay = { day: number; intervals: number; milliKwh: number }
export type OracleInterval = { day: number; quarter: number; startMs: number; endMs: number; milliKwh: number; spotE5: number }

export type Oracle = {
  month: SyntheticMonth
  salt: number
  intervals: OracleInterval[]
  perDay: OracleDay[]
  intervalCount: number
  totalMilliKwh: number
  totalKwhText: string
  /** sum(q_milli * p_e5) in units of 1e-8 SEK. */
  spotRawE8: number
  lines: { spotCents: number; markupCents: number; monthlyFeeCents: number }
  vatCents: { spot: number; markup: number; monthlyFee: number; total: number }
  totalExVatCents: number
  totalIncVatCents: number
  /** Non-empty = some exact intermediate is on a half-cent boundary; do not use this salt. */
  ambiguities: string[]
}

const halfUp = (numerator: number, denominator: number): number => Math.floor((2 * numerator + denominator) / (2 * denominator))

export function buildOracle(monthName: string, salt: number, pricing: OraclePricing): Oracle {
  const month = syntheticMonth(monthName)
  const intervals: OracleInterval[] = []
  const perDay: OracleDay[] = []
  let totalMilli = 0, spotRawE8 = 0
  for (let day = 1; day <= month.days; day++) {
    let dayMilli = 0
    for (let quarter = 0; quarter < QUARTERS_PER_DAY; quarter++) {
      const milli = quarterMilliKwh(day, quarter, salt)
      const startMs = intervalStartMs(month, day, quarter)
      const spotE5 = hourlySpotE5(day, Math.floor(quarter / 4), salt)
      intervals.push({ day, quarter, startMs, endMs: startMs + QUARTER_MS, milliKwh: milli, spotE5 })
      dayMilli += milli; totalMilli += milli; spotRawE8 += milli * spotE5
    }
    perDay.push({ day, intervals: QUARTERS_PER_DAY, milliKwh: dayMilli })
  }
  // sum(q*p): milli-kWh * 1e-5 SEK/kWh = 1e-8 SEK; 1 cent = 1e6 of those units.
  const spotCents = halfUp(spotRawE8, 1_000_000)
  // total_kWh * ore/100: milli * ore = 1e-3 kWh * 1e-2 SEK = 1e-5 SEK = 1e-3 cent.
  const markupExact = totalMilli * pricing.markupOrePerKwh
  const markupCents = halfUp(markupExact, 1000)
  const monthlyFeeCents = pricing.monthlyFeeSek * 100
  const vat = (cents: number) => halfUp(cents * pricing.vatPercent, 100)
  const vatCents = { spot: vat(spotCents), markup: vat(markupCents), monthlyFee: vat(monthlyFeeCents), total: 0 }
  vatCents.total = vatCents.spot + vatCents.markup + vatCents.monthlyFee
  const totalExVatCents = spotCents + markupCents + monthlyFeeCents
  const ambiguities: string[] = []
  const spotRemainder = spotRawE8 % 1_000_000
  if (Math.abs(spotRemainder - 500_000) < 1_000) ambiguities.push(`spot_half_cent:${spotRemainder}`)
  if (markupExact % 1000 === 500) ambiguities.push('markup_half_cent')
  // VAT of a whole-cent amount lands exactly on a half cent when cents % 4 == 2 (25 %).
  if (pricing.vatPercent === 25) {
    for (const [name, cents] of [['spot', spotCents], ['markup', markupCents], ['monthlyFee', monthlyFeeCents]] as const) {
      if (cents % 4 === 2) ambiguities.push(`vat_half_cent:${name}`)
    }
  }
  return {
    month, salt, intervals, perDay, intervalCount: intervals.length, totalMilliKwh: totalMilli, totalKwhText: formatMilliKwh(totalMilli),
    spotRawE8, lines: { spotCents, markupCents, monthlyFeeCents }, vatCents, totalExVatCents,
    totalIncVatCents: totalExVatCents + vatCents.total, ambiguities,
  }
}

/** Search a salt for which the oracle has no float-ambiguous intermediate. */
export function chooseSafeSalt(monthName: string, startSalt: number, pricing: OraclePricing): { salt: number; oracle: Oracle } {
  for (let salt = startSalt; salt < startSalt + 500; salt++) {
    const oracle = buildOracle(monthName, salt, pricing)
    if (oracle.ambiguities.length === 0) return { salt, oracle }
  }
  throw new Error('fixture_no_unambiguous_salt_found')
}

export function centsText(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${pad2(abs % 100)}`
}
