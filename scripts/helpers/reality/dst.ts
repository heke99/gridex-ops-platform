// Time builders for the reality scenarios (G: end of daylight saving time 2026-10-25, F, J2, K) and their unit
// tests. Pure: no database, network or test runner. Synthetic values only.
//
// Two clocks, never mixed (approved rule ENV-08, owner decision 2026-10-23):
//  - Ediel: every payload time is fixed Swedish normal time, UTC+1, all year (UTILTS DTM+735 +0100). A grid
//    owner's E66 day is 00:00–24:00 +0100 and always has 96 quarter-hours (24 hours), also on the DST days; in
//    summer it covers 01:00–01:00 Stockholm time. No E66 ever carries 92 or 100 values. A Z04 DTM+92 202609010000
//    starts supply at 2026-08-31T23:00Z, and an Ediel month (the billing month of Ediel-based supply) runs from
//    00:00 +0100 on the 1st: September 2026 = [2026-08-31T23:00Z, 2026-09-30T23:00Z).
//  - Civil (Europe/Stockholm): the customer portal, the partner API and spot prices show Stockholm calendar days,
//    with 92 (last Sunday in March), 100 (last Sunday in October) or 96 quarter-hours. A civil day is the sum by
//    instant of the Ediel files that overlap it (25 Oct 2026 = the last 4 of the 24 Oct file + the 96 of 25 Oct).
import { stockholmLocalToUtc } from '@/lib/time/stockholm'
import { edielDayUtc, kwhText, stockholmUnbStamp } from '../live-chain-wire'

export { edielDayUtc } from '../live-chain-wire'
export const QUARTER_MS = 15 * 60_000
const HOUR_MS = 3_600_000
const pad = (n: number, w = 2) => String(n).padStart(w, '0')

function dateParts(day: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) throw Error(`dst_invalid_day:${day}`)
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}
function nextDay(day: string) {
  const { year, month, day: d } = dateParts(day)
  const next = new Date(Date.UTC(year, month - 1, d + 1))
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`
}

// ---- Civil (Europe/Stockholm) days: portal, partner API and spot-price views ----

/** UTC bounds [start, end) of one Europe/Stockholm calendar day, in ms. */
export function stockholmDayUtc(day: string): { start: number; end: number } {
  return { start: stockholmLocalToUtc(dateParts(day)).getTime(), end: stockholmLocalToUtc(dateParts(nextDay(day))).getTime() }
}
/** Quarter-hours in one Stockholm calendar day: 92, 96 or 100. */
export function stockholmQuarterCount(day: string) {
  const { start, end } = stockholmDayUtc(day)
  return (end - start) / QUARTER_MS
}
/** UTC start (ISO, ms precision) of every quarter-hour of one Stockholm calendar day, in order. */
export function stockholmQuarterStarts(day: string): string[] {
  const { start } = stockholmDayUtc(day)
  return Array.from({ length: stockholmQuarterCount(day) }, (_, q) => new Date(start + q * QUARTER_MS).toISOString())
}
/** Calendar days of one month (YYYY-MM). */
export function monthDays(month: string): string[] {
  const [year, m] = month.split('-').map(Number)
  const count = new Date(Date.UTC(year, m, 0)).getUTCDate()
  return Array.from({ length: count }, (_, i) => `${month}-${pad(i + 1)}`)
}
/** The Stockholm calendar day (YYYY-MM-DD) an instant falls on. */
export function stockholmDayOf(instant: number) {
  return new Date(instant).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
}

const wallFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
/** Stockholm wall-clock hour (fractional) of an instant: the repeated 02:00–03:00 hour appears twice. */
export function stockholmWallHour(instant: number) {
  const parts = Object.fromEntries(wallFormatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]))
  return Number(parts.hour) + Number(parts.minute) / 60
}
/** Stockholm UTC offset in minutes at an instant (+120 CEST, +60 CET). */
export function stockholmOffsetMinutes(instant: number) {
  const local = new Date(instant).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', hourCycle: 'h23' })
  const [date, time] = local.split(' ')
  const [y, mo, d] = date.split('-').map(Number), [h, mi, s] = time.split(':').map(Number)
  return Math.round((Date.UTC(y, mo - 1, d, h, mi, s) - Math.floor(instant / 1000) * 1000) / 60_000)
}

// ---- Ediel (fixed +0100) days and months: what a grid owner sends and what Ediel-based supply is billed by ----

/** UTC start (ISO, ms precision) of the 96 quarter-hours of one Ediel day (00:00–24:00 +0100). */
export function edielQuarterStarts(day: string): string[] {
  const { start } = edielDayUtc(day)
  return Array.from({ length: 96 }, (_, q) => new Date(start + q * QUARTER_MS).toISOString())
}
/** UTC bounds [start, end) of one Ediel month (YYYY-MM): from 00:00 +0100 on the 1st to 00:00 +0100 on the next 1st. */
export function edielMonthUtc(month: string): { start: number; end: number } {
  const [year, m] = month.split('-').map(Number)
  return { start: Date.UTC(year, m - 1, 1) - HOUR_MS, end: Date.UTC(year, m, 1) - HOUR_MS }
}
/** Quarter-hours in one Ediel month: always days × 96 (September 2026: 2 880; October 2026: 2 976). */
export const edielMonthQuarterCount = (month: string) => monthDays(month).length * 96

/** Household shape at each given instant (kWh, 3 decimals): follows the Stockholm wall clock, plus its position. */
function profileAt(starts: string[], dayIndex: number, scale: number) {
  return starts.map((iso, q) => {
    const hour = stockholmWallHour(Date.parse(iso))
    const base = 0.06 + 0.04 * Math.max(0, Math.sin(((hour - 6) * Math.PI) / 12))
    const evening = hour >= 17 && hour < 21 ? 0.09 : 0
    const weekend = dayIndex % 7 >= 5 ? 0.015 : 0
    const ripple = ((q * 7 + dayIndex * 13) % 11) / 1000
    return Math.round((base + evening + weekend + ripple) * scale * 1000) / 1000
  })
}
/**
 * Deterministic household profile for one Stockholm civil day: 92/96/100 values, one per actual quarter-hour.
 * For civil views only (a grid owner never sends a civil day); every value carries its own position, so the two
 * passes of the repeated hour differ and a duplicate or a dropped quarter changes the sum.
 */
export function dstDayProfile(day: string, dayIndex = 0, scale = 1): number[] {
  return profileAt(stockholmQuarterStarts(day), dayIndex, scale)
}
/** Deterministic household profile for one Ediel day as a grid owner sends it: always 96 values (00:00–24:00 +0100). */
export function edielDayProfile(day: string, dayIndex = 0, scale = 1): number[] {
  return profileAt(edielQuarterStarts(day), dayIndex, scale)
}

/**
 * How one E66 day is framed on the wire.
 *  - fixed_cet_day (default, the only framing a Swedish grid owner sends): ENV-08's fixed normal-time day
 *    00:00–24:00 +0100, always 96 quarters; in summer it covers 01:00–01:00 Stockholm time.
 *  - civil_fixed_cet / civil_start_offset: COUNTERFACTUAL inputs (a civil day of 92/96/100 quarters in +0100, or
 *    in the offset at its first instant). No grid owner sends them; they exist only so the unit tests can show
 *    what the platform's parser does with such a file. Never send them into the reality world.
 */
export type E66DayFraming = 'fixed_cet_day' | 'civil_fixed_cet' | 'civil_start_offset'

/** Wall clock of an instant in a fixed offset, as EDIFACT format 203 (CCYYMMDDHHMM). */
export function fixedOffsetMinute(instant: number, offsetMinutes: number) {
  const t = new Date(instant + offsetMinutes * 60_000)
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}`
}

/** UTC bounds and wire offset of one day in a framing. */
export function e66DayBounds(day: string, framing: E66DayFraming = 'fixed_cet_day') {
  if (framing === 'fixed_cet_day') return { ...edielDayUtc(day), offsetMinutes: 60 }
  const { start, end } = stockholmDayUtc(day)
  return { start, end, offsetMinutes: framing === 'civil_fixed_cet' ? 60 : stockholmOffsetMinutes(start) }
}
/** UTC start of every quarter-hour of one day in a framing (96 for fixed_cet_day). */
export function e66QuarterStarts(day: string, framing: E66DayFraming = 'fixed_cet_day'): string[] {
  return framing === 'fixed_cet_day' ? edielQuarterStarts(day) : stockholmQuarterStarts(day)
}
/** The deterministic profile for one day in a framing (96 values for fixed_cet_day). */
export function e66DayProfile(day: string, framing: E66DayFraming = 'fixed_cet_day', dayIndex = 0, scale = 1): number[] {
  return profileAt(e66QuarterStarts(day, framing), dayIndex, scale)
}

export type DayE66 = { edifact: string; framing: E66DayFraming; offset: '+0100' | '+0200'; periodStart: string; periodEnd: string
  /** UTC start of each value, in wire order. */ starts: string[]; registeredAt: string }

/**
 * One grid-owner UTILTS E66 for one day, energy-only quarter-hours, in the same segment layout as
 * live-chain-wire's dailyE66. By default (fixed_cet_day) exactly the day a grid owner sends: 96 values from 23:00Z
 * the day before, every DTM in +0100, UNB in Swedish local time. `registeredAt` defaults to 06:00 +0100 the
 * morning after the period; `notAfter` caps it (a grid owner cannot register values in the future: DTM+137 may
 * not lie after reception). A capped registration can lie before the period end when a scenario sends a day
 * that has not ended yet; the scenario reports that (G registrationCappedToNow).
 * `environment` is the interchange's lane: 'test' (default) sets the UNB test indicator (0035=1), 'production'
 * omits it, exactly as dailyE66 does; a tenant live in production receives production files (FINDINGS T7).
 */
export function dayE66(input: { issuer: string; receiver: string; meterId: string; day: string; values: number[]; reference: string
  framing?: E66DayFraming; registeredAfterHours?: number; notAfter?: number; environment?: 'production' | 'test' }): DayE66 {
  const framing = input.framing ?? 'fixed_cet_day'
  const { start, end, offsetMinutes } = e66DayBounds(input.day, framing)
  const count = (end - start) / QUARTER_MS
  if (input.values.length !== count) throw Error(`dayE66 ${input.day} ${framing} requires ${count} quarter-hour values, got ${input.values.length}`)
  let registered = end + (6 + (input.registeredAfterHours ?? 0)) * HOUR_MS
  if (input.notAfter !== undefined) registered = Math.min(registered, input.notAfter)
  const at = (instant: number) => fixedOffsetMinute(instant, offsetMinutes)
  const offset = offsetMinutes === 60 ? '+0100' : '+0200'
  const lines = [
    "UNA:+.? '",
    `UNB+UNOC:3+${input.issuer}:ZZ+${input.receiver}:ZZ+${stockholmUnbStamp(registered)}+${input.reference}++23-DDQ-E66-T${input.environment === 'production' ? '' : '++++1'}'`,
    "UNH+1+UTILTS:D:02B:UN:E5SE5A'",
    `BGM+E66::260+M${input.reference}+9+AB'`,
    `DTM+137:${at(registered)}:203'`, `DTM+735:?${offset}:406'`, "MKS+23+E02::260'",
    `NAD+MS+${input.issuer}:SVK:260'`, `NAD+MR+${input.receiver}:SVK:260'`, "NAD+DDQ'",
    `IDE+24+T${input.reference}'`, `LOC+172+${input.meterId}::9'`, "LOC+239+TES:SVK:260'",
    "LIN+++8716867000030:::9'", `DTM+324:${at(start)}${at(end)}:719'`,
    `DTM+597:${at(registered)}:203'`, "DTM+354:15:806'", "STS+7++E88::260'", "MEA+AAZ++KWH'",
    "CCI+++E12::260'", "CAV+E17::260'",
  ]
  input.values.forEach((value, q) => {
    lines.push(`SEQ++${q + 1}'`, `QTY+136:${kwhText(value)}'`, `DTM+597:${at(start + q * QUARTER_MS)}:203'`, "STS+7++21::260'")
  })
  lines.push(`UNT+${lines.length - 1}+1'`, `UNZ+1+${input.reference}'`)
  return { edifact: lines.join('\n'), framing, offset, periodStart: new Date(start).toISOString(), periodEnd: new Date(end).toISOString(),
    starts: input.values.map((_, q) => new Date(start + q * QUARTER_MS).toISOString()), registeredAt: new Date(registered).toISOString() }
}

/**
 * The expected value count per Stockholm civil day of a set of sent Ediel files, by instant: each sent value
 * counts on the civil day its UTC start falls on (portal / partner API / spot views).
 */
export function civilDayTotals(files: Array<{ starts: string[]; values: number[] }>) {
  const days: Record<string, { count: number; kwh: number }> = {}
  for (const file of files) file.starts.forEach((iso, q) => {
    const day = stockholmDayOf(Date.parse(iso))
    const entry = days[day] ??= { count: 0, kwh: 0 }
    entry.count += 1
    entry.kwh = Math.round((entry.kwh + file.values[q]) * 1000) / 1000
  })
  return days
}

/**
 * Deterministic SE-area quarter-hour spot curve (SEK/kWh) for one Stockholm day in elprisetjustnu's shape:
 * 92/96/100 rows, each with its real UTC instant (spot prices are civil delivery days). The shape follows the wall
 * clock; the second pass of the repeated autumn hour is priced 0.05 SEK higher so an invoice that drops or
 * double-prices it is visible.
 */
export function syntheticSpotDay(date: string, area: string) {
  const areaFactor = ({ SE1: 0.6, SE2: 0.65, SE3: 1, SE4: 1.25 } as Record<string, number>)[area] ?? 1
  const seen = new Set<number>()
  return stockholmQuarterStarts(date).map(iso => {
    const start = Date.parse(iso), hour = stockholmWallHour(start)
    const repeated = seen.has(Math.round(hour * 4)); seen.add(Math.round(hour * 4))
    const shape = 0.35 + 0.25 * Math.max(0, Math.sin(((hour - 5) * Math.PI) / 14)) + (hour >= 17 && hour < 20 ? 0.3 : 0) + (repeated ? 0.05 : 0)
    const sek = Math.round(shape * areaFactor * 100000) / 100000
    return { SEK_per_kWh: sek, EUR_per_kWh: Math.round((sek / 11.2) * 100000) / 100000, EXR: 11.2,
      time_start: new Date(start).toISOString().replace('.000Z', '+00:00'), time_end: new Date(start + QUARTER_MS).toISOString().replace('.000Z', '+00:00') }
  })
}

/** Sum with three decimals, as the scenarios compare kWh. */
export const kwhSum = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 1000) / 1000
