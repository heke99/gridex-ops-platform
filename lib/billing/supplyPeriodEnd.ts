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

/**
 * Supply period statuses billing reads. 'ending' is a period whose received market end lies ahead; it is
 * still supplied up to that end (FINDINGS H2). 'ending' and 'ended' bill only up to their end date.
 */
export const BILLED_SUPPLY_PERIOD_STATUSES = ['active', 'confirmed_by_grid_owner', 'ending', 'ended'] as const

type ContractEnd = { status?: unknown; termination_reason?: unknown; ended_at?: unknown }

/** The Stockholm civil date of an instant (a plain date stays as it is). */
function stockholmDate(value: string) {
  if (ISO_DATE.test(value)) return value
  const instant = new Date(value)
  if (!Number.isFinite(instant.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(entry => entry.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/**
 * A contract that the supply-end follow-up (gridex_supply_end_followup_v1) terminated because exactly this
 * period ended still carries the period up to that end (FINDINGS H3). Same rule as the database's qualified
 * supply basis (20261002235300) and billing gate (20261022150000): status 'terminated', termination_reason
 * 'supply_end' and ended_at on the period's end date (UTC or Stockholm date). Any other terminated,
 * cancelled or expired contract is refused.
 */
export function contractEndedBySupplyPeriod(contract: ContractEnd | null | undefined, period: { end_date?: unknown } | null | undefined): boolean {
  if (!contract || !period || text(contract.status)?.toLowerCase() !== 'terminated' || text(contract.termination_reason) !== 'supply_end') return false
  const endDate = text(period.end_date)?.slice(0, 10), endedAt = text(contract.ended_at)
  if (!endDate || !endedAt) return false
  const utc = Number.isFinite(Date.parse(endedAt)) && !ISO_DATE.test(endedAt) ? new Date(endedAt).toISOString().slice(0, 10) : endedAt.slice(0, 10)
  return utc === endDate || stockholmDate(endedAt) === endDate
}
