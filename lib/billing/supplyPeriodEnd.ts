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
// The start of a received supply is its market instant (supplyPeriodStartInstant, FINDINGS F108).
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

/**
 * The first supplied instant (ms) of a period, or null without a start.
 * A received market start (PRODAT Z04 DTM+92 and the source-owned starts) is stored as the instant the grid owner
 * stated: 00:00 in Ediel's fixed normal time (ENV-08, PRODAT field 206 "1:805"), i.e. local midnight in winter and
 * 01:00 in summer (2026-09-01 → 2026-08-31T23:00Z). The database's qualified supply basis
 * (gridex_received_sources.billing_supply_basis_v1) bills nothing before it, so billing reads the same instant.
 * Only a period without a market instant (manual/legacy) starts at local midnight of its start date (FINDINGS F108).
 */
export function supplyPeriodStartInstant(period: { start_date?: unknown; market_start_at?: unknown }): number | null {
  const marketStart = text(period.market_start_at)
  const marketStartMs = marketStart ? Date.parse(marketStart) : Number.NaN
  if (Number.isFinite(marketStartMs)) return marketStartMs
  const start = text(period.start_date)
  if (!start) return null
  if (ISO_DATE.test(start)) return localMidnight(start)
  const parsed = Date.parse(start)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The first instant (ms) that is no longer supplied, or null for an open period. Same rule as
 * supplyPeriodEndExclusiveDate: a received market end at the start of its end date is exclusive and ends at the
 * market instant itself, 00:00 in Ediel's fixed normal time (23:00Z in summer, ENV-08), so the last civil hour
 * before it (22:00Z-23:00Z on the last supplied day) is still ours (FINDINGS F108 M5; the database's qualified
 * supply basis bills up to market_end_at). Every other end (manual/legacy, or a market end during the day) ends
 * at Swedish civil midnight after its last supplied day (owner decision 2026-10-23).
 */
export function supplyPeriodEndInstant(period: PeriodEnd): number | null {
  const exclusive = supplyPeriodEndExclusiveDate(period)
  if (!exclusive) return null
  const marketEnd = text(period.market_end_at)
  const marketEndMs = marketEnd ? Date.parse(marketEnd) : Number.NaN
  const endDate = (text(period.actual_end_date) ?? text(period.end_date))!.slice(0, 10)
  if (exclusive === endDate && Number.isFinite(marketEndMs)) return marketEndMs
  return localMidnight(exclusive)
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
 * Termination reasons of a contract ended BY the end of its own supply period, which still carries that period up
 * to its end:
 *   * 'supply_end': the supply-end follow-up (gridex_supply_end_followup_v1) after a received end (Z05; FINDINGS H3);
 *   * 'move_out': a manual move-out, gridex_end_customer_supply_v1(p_end_reason 'move_out') or
 *     gridex_close_customer_lifecycle_v1/_v2 (owner decision 2026-10-23 "Fakturera slutmånaden", FINDINGS H3b);
 *   * 'grid_contract_ended': the close's mode for a customer whose grid contract ended (no supply although the notice
 *     period runs on; owner decision B1, FINDINGS H3d);
 *   * 'customer_termination': the close's mode 'terminate' when no supply is ongoing after its date (FINDINGS H3d D9;
 *     with ongoing supply a termination is only registered and the supply continues, owner decision B3).
 * Every other reason ('supplier_switch' of the manual end, 'customer_request', a withdrawal) is not an end of supply
 * billing may rely on and stays refused.
 */
export const CONTRACT_END_REASONS_CARRYING_FINAL_PERIOD = ['supply_end', 'move_out', 'grid_contract_ended', 'customer_termination'] as const

/**
 * A contract terminated because this period ended still carries the period up to that end (FINDINGS H3, H3b, H3d
 * D8). Same rule as the database's billing gate, underlay store and pricing/export readers (20261022150000,
 * 20261023196000, 20261023199000, 20261023200000, 20261023203000): status 'terminated', a termination_reason of
 * CONTRACT_END_REASONS_CARRYING_FINAL_PERIOD and ended_at ON OR AFTER the period's end date (UTC or Stockholm date):
 * the contract may run on through its notice period after the supply ended (owner decision B1), and it carries only
 * the supplied days (contractCarriesBilledPeriod bounds the billed period by the supply end). A contract ended before
 * its period's end date, and any other terminated, cancelled or expired contract, is refused.
 */
export function contractEndedBySupplyPeriod(contract: ContractEnd | null | undefined, period: { end_date?: unknown } | null | undefined): boolean {
  const reason = text(contract?.termination_reason)
  if (!contract || !period || text(contract.status)?.toLowerCase() !== 'terminated'
    || !reason || !(CONTRACT_END_REASONS_CARRYING_FINAL_PERIOD as readonly string[]).includes(reason)) return false
  const endDate = text(period.end_date)?.slice(0, 10), endedAt = text(contract.ended_at)
  if (!endDate || !endedAt) return false
  const utc = Number.isFinite(Date.parse(endedAt)) && !ISO_DATE.test(endedAt) ? new Date(endedAt).toISOString().slice(0, 10) : endedAt.slice(0, 10)
  const stockholm = stockholmDate(endedAt)
  return (ISO_DATE.test(utc) && utc >= endDate) || (stockholm !== null && stockholm >= endDate)
}

type BilledSupplyPeriod = PeriodEnd & { status?: unknown; start_date?: unknown }

/**
 * Whether a contract carries the billed period [billedStartMs, billedEndMs) of this supply period (FINDINGS H3,
 * owner decision 2026-10-22). Exactly the rule of the database billing gate and underlay store
 * (gridex_set_metering_billing_gate, gridex_store_billing_underlay; 20261022150000, 20261023196000) and of the
 * pricing readers (20261023199000; move-out 20261023200000):
 *   * a 'signed' or 'active' contract carries it; or
 *   * a contract terminated because this period ended, by a Z05 supply end or a manual end on or before the contract's
 *     end (contractEndedBySupplyPeriod; FINDINGS H3/H3b/H3d D8), on a billed period status ('ending'/'ended' only with an end
 *     date), and only for a billed period inside the supplied window: not before civil midnight of the start date and
 *     not after the period's end instant (supplyPeriodEndInstant: a received Z05 end at the market instant, F108 M5;
 *     a move-out end at civil midnight after its last supplied day).
 * Any other terminated, cancelled or expired contract, and any billed period after the supply end, is refused.
 * Tenant, customer and metering-point identity are checked by the caller.
 */
export function contractCarriesBilledPeriod(
  contract: ContractEnd | null | undefined,
  period: BilledSupplyPeriod | null | undefined,
  billedStartMs: number,
  billedEndMs: number,
): boolean {
  if (!contract) return false
  const status = text(contract.status)?.toLowerCase()
  if (status === 'signed' || status === 'active') return true
  if (!period || !contractEndedBySupplyPeriod(contract, period)) return false
  const periodStatus = text(period.status)
  if (!periodStatus || !(BILLED_SUPPLY_PERIOD_STATUSES as readonly string[]).includes(periodStatus)) return false
  if ((periodStatus === 'ending' || periodStatus === 'ended') && !(text(period.actual_end_date) ?? text(period.end_date))) return false
  if (!Number.isFinite(billedStartMs) || !Number.isFinite(billedEndMs)) return false
  // The gate's start bound: civil midnight of the start date (sp.start_date AT TIME ZONE 'Europe/Stockholm').
  const startDate = text(period.start_date)?.slice(0, 10)
  if (!startDate || !ISO_DATE.test(startDate) || localMidnight(startDate) > billedStartMs) return false
  const endMs = supplyPeriodEndInstant(period)
  return endMs === null || billedEndMs <= endMs
}
