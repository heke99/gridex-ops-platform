// The end of a supply period as billing must read it (reality scenario H, "the customer leaves").
//
// Two writers give customer_supply_periods.end_date different meanings:
//   * a received Ediel end (PRODAT Z05 and the source-owned closures) writes end_date = the CET date of the
//     grid owner's end instant (gridex_received_sources.permission_date_v1 of DTM+93) together with
//     market_end_at = that instant (fixed normal time, ENV-08). For an end at 00:00 the date is the FIRST day
//     that is no longer supplied: a switch away on 1 November ends with end_date 2026-11-01.
//   * the manual/legacy end (gridex_end_customer_supply_v1) writes end_date = actual_end_date = the LAST
//     supplied day and no market_end_at ("billing still covers the period up to and including end_date").
// Billing treated every end_date as the last supplied day, so a Z05-ended period was billed one day too long
// (FINDINGS H1). This helper returns the first Stockholm civil day that is no longer supplied.
import { stockholmLocalToUtc } from '@/lib/time/stockholm'

type PeriodEnd = { end_date?: unknown; actual_end_date?: unknown; market_end_at?: unknown }

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function addDays(date: string, days: number) {
  const match = ISO_DATE.exec(date)
  if (!match) throw new Error(`Ogiltigt kalenderdatum: ${date}`)
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days)).toISOString().slice(0, 10)
}

function localMidnight(date: string) {
  const match = ISO_DATE.exec(date)!
  return stockholmLocalToUtc({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }).getTime()
}

/**
 * The first Stockholm civil day that is no longer supplied, or null for an open period.
 * A received market end at the start of its end date (00:00 in Ediel's fixed normal time, i.e. local
 * midnight in winter and 01:00 in summer) is exclusive. Every other end (no market instant, or an end
 * during the day) keeps its end date as the last supplied day.
 */
export function supplyPeriodEndExclusiveDate(period: PeriodEnd): string | null {
  const end = text(period.actual_end_date) ?? text(period.end_date)
  if (!end) return null
  const date = end.slice(0, 10)
  if (!ISO_DATE.test(date)) throw new Error(`Ogiltigt slutdatum för leveransperiod: ${end}`)
  const marketEnd = text(period.market_end_at)
  const marketEndMs = marketEnd ? Date.parse(marketEnd) : Number.NaN
  if (Number.isFinite(marketEndMs) && marketEndMs <= localMidnight(date) + 3_600_000) return date
  return addDays(date, 1)
}

/** The last supplied Stockholm civil day (inclusive), or null for an open period. */
export function supplyPeriodLastSuppliedDate(period: PeriodEnd): string | null {
  const exclusive = supplyPeriodEndExclusiveDate(period)
  return exclusive ? addDays(exclusive, -1) : null
}
