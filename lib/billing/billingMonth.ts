// The billing month of a supply period (FINDINGS F108, owner decision 2026-10-23).
//
//   * A supply that rests on received Ediel market messages (the period carries market_start_at and/or
//     market_end_at from PRODAT Z04/Z05 or another received source) is billed per Ediel month: from 00:00 in fixed
//     Swedish normal time (UTC+1, ENV-08) on the 1st to 00:00 +0100 on the 1st of the next month. September 2026 is
//     [2026-08-31T23:00Z, 2026-09-30T23:00Z). The grid owner's E66 days and monthly values use the same frame, so a
//     monthly value fits its billing month exactly (M6) and the hour after a summer-time Z05 end is billed (M5).
//   * A manual/legacy period without any Ediel instant is billed per Swedish civil month (00:00 Europe/Stockholm).
//
// The frame decides only the month boundaries a period crosses. Its own start and end are always its own instants
// (supplyPeriodStartInstant/supplyPeriodEndInstant): a period's segment in the month where it starts begins at its
// start, and in the month where it ends stops at its end. Consecutive months of one period therefore tile without a
// gap or an overlap, and no one-hour segment is ever cut off into a neighbouring month.
//
// The month is still labelled by its calendar month (underlay_year/underlay_month, "September 2026"), and the stored
// Stockholm dates of an Ediel month (1 Sep - 1 Oct) equal those of the civil month, so the underlay uniqueness key and
// every date-based reader are unchanged. The invoice prints the exact covered period (billingPeriodText).
import { parseBillingMonth, stockholmDateForInstant, stockholmLocalToUtc, stockholmMonthBounds } from '@/lib/time/stockholm'
import { supplyPeriodEndInstant, supplyPeriodLastSuppliedDate, supplyPeriodStartInstant } from './supplyPeriodEnd'

export type BillingMonthFrame = 'ediel_fixed_normal_time' | 'stockholm_civil'

type SupplyPeriodInstants = {
  start_date?: unknown
  actual_start_date?: unknown
  end_date?: unknown
  actual_end_date?: unknown
  market_start_at?: unknown
  market_end_at?: unknown
}

const EDIEL_NORMAL_TIME_OFFSET_MS = 3_600_000
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)
const iso = (ms: number) => new Date(ms).toISOString()

/** The Ediel month: 00:00 fixed normal time (UTC+1) on the 1st to 00:00 +0100 on the 1st of the next month. */
export function edielMonthBounds(billingMonth: string): { start: string; end: string } {
  const { year, month } = parseBillingMonth(billingMonth)
  return {
    start: iso(Date.UTC(year, month - 1, 1) - EDIEL_NORMAL_TIME_OFFSET_MS),
    end: iso(Date.UTC(year, month, 1) - EDIEL_NORMAL_TIME_OFFSET_MS),
  }
}

/** A period rests on received Ediel market messages when it carries a received market instant. */
export function isEdielQualifiedSupplyPeriod(period: SupplyPeriodInstants | null | undefined): boolean {
  return Boolean(period && (text(period.market_start_at) || text(period.market_end_at)))
}

export function billingMonthFrame(period: SupplyPeriodInstants | null | undefined): BillingMonthFrame {
  return isEdielQualifiedSupplyPeriod(period) ? 'ediel_fixed_normal_time' : 'stockholm_civil'
}

export function billingMonthBounds(billingMonth: string, frame: BillingMonthFrame): { start: string; end: string } {
  if (frame === 'ediel_fixed_normal_time') return edielMonthBounds(billingMonth)
  const civil = stockholmMonthBounds(billingMonth)
  return { start: civil.start, end: civil.end }
}

/** Every instant any period's segment of the month can cover: the union of the civil and the Ediel month. */
export function billingMonthLoadWindow(billingMonth: string): { start: string; end: string } {
  const civil = billingMonthBounds(billingMonth, 'stockholm_civil')
  const ediel = billingMonthBounds(billingMonth, 'ediel_fixed_normal_time')
  return {
    start: iso(Math.min(Date.parse(civil.start), Date.parse(ediel.start))),
    end: iso(Math.max(Date.parse(civil.end), Date.parse(ediel.end))),
  }
}

function startMonthLabel(period: SupplyPeriodInstants, startMs: number): string {
  const date = text(period.start_date)?.slice(0, 10)
  return date && ISO_DATE.test(date) ? date.slice(0, 7) : stockholmDateForInstant(new Date(startMs)).slice(0, 7)
}

/**
 * The supplied part of a billing month for one period, or null when the period supplies nothing in it.
 * start/end are ISO instants (end exclusive). See the module comment for the rule.
 */
export function supplyPeriodBillingSegment(
  period: SupplyPeriodInstants,
  billingMonth: string,
): { start: string; end: string; frame: BillingMonthFrame } | null {
  const { value: month } = parseBillingMonth(billingMonth)
  const startMs = supplyPeriodStartInstant(period)
  if (startMs === null) return null
  const frame = billingMonthFrame(period)
  const bounds = billingMonthBounds(month, frame)
  const monthStart = Date.parse(bounds.start)
  const monthEnd = Date.parse(bounds.end)
  const startsIn = startMonthLabel(period, startMs)
  const lastSupplied = supplyPeriodLastSuppliedDate(period)
  const endsIn = lastSupplied ? lastSupplied.slice(0, 7) : null
  if (startsIn > month || (endsIn !== null && endsIn < month)) return null
  const endMs = supplyPeriodEndInstant(period)
  const start = startsIn === month ? startMs : Math.max(monthStart, startMs)
  const end = endsIn === month && endMs !== null ? endMs : endMs === null ? monthEnd : Math.min(monthEnd, endMs)
  return end > start ? { start: iso(start), end: iso(end), frame } : null
}

/**
 * The exclusive end instant of a business date (a contract end or a price snapshot's valid_to) for billing a
 * period: the next Swedish civil midnight, or for an Ediel-qualified period the later of that and 00:00 +0100, so
 * a date that ends a billing month also covers the end of that Ediel month. Never earlier than the civil reading.
 */
export function businessDateEndInstant(date: string, period: SupplyPeriodInstants | null | undefined): number {
  const match = ISO_DATE.exec(date.slice(0, 10))
  if (!match) throw new Error(`Ogiltigt kalenderdatum: ${date}`)
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1))
  const civil = stockholmLocalToUtc({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }).getTime()
  return isEdielQualifiedSupplyPeriod(period) ? Math.max(civil, next.getTime() - EDIEL_NORMAL_TIME_OFFSET_MS) : civil
}

const MONTH_NAMES = ['Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni', 'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December']

/** The invoice's month label, e.g. "September 2026". */
export function billingMonthLabel(billingMonth: string): string {
  const { year, month } = parseBillingMonth(billingMonth)
  return `${MONTH_NAMES[month - 1]} ${year}`
}

function stockholmClock(instant: string): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(instant))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(entry => entry.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`
}

export type InvoiceBillingPeriod = {
  billing_month: string
  label: string
  start: string
  end: string
  end_exclusive: true
  frame: BillingMonthFrame | null
  text: string
}

/**
 * The exact covered period printed on the invoice, in Swedish local time with its end exclusive:
 * an Ediel September for a summer supply is "2026-09-01 01:00 – 2026-10-01 01:00 (svensk tid)".
 * Null when the stored instants are missing or invalid (older underlays keep their date-only period).
 */
export function invoiceBillingPeriod(input: { billingMonth: string; start: unknown; end: unknown; frame?: unknown }): InvoiceBillingPeriod | null {
  const start = text(input.start)
  const end = text(input.end)
  if (!start || !end || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start)) return null
  const frame = input.frame === 'ediel_fixed_normal_time' || input.frame === 'stockholm_civil' ? input.frame : null
  return {
    billing_month: parseBillingMonth(input.billingMonth).value,
    label: billingMonthLabel(input.billingMonth),
    start: iso(Date.parse(start)),
    end: iso(Date.parse(end)),
    end_exclusive: true,
    frame,
    text: `${stockholmClock(start)} – ${stockholmClock(end)} (svensk tid)`,
  }
}
