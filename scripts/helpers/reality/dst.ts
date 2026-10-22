// DST-aware builders for reality scenario G (end of daylight saving time, 2026-10-25) and its unit tests.
// Pure: no database, network or test runner. Synthetic values only.
//
// Europe/Stockholm civil days have 92 (last Sunday in March), 100 (last Sunday in October) or 96 quarter-hours.
// Ediel's UTILTS payload states every time in ONE fixed offset per message (DTM+735, ENV-08: +0100 normal time),
// so a civil DST day is simply a 23- or 25-hour period in that fixed offset; nothing on the wire is ambiguous.
import { stockholmLocalToUtc } from '@/lib/time/stockholm'
import { kwhText } from '../live-chain-wire'

export const QUARTER_MS = 15 * 60_000
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

/**
 * Deterministic household profile for one Stockholm day (kWh, 3 decimals), one value per actual quarter-hour:
 * 92/96/100 values. The shape follows the wall clock; every value also carries its own position, so the two
 * passes of the repeated hour differ and a duplicate or a dropped quarter changes the sum.
 */
export function dstDayProfile(day: string, dayIndex = 0, scale = 1): number[] {
  return stockholmQuarterStarts(day).map((iso, q) => {
    const hour = stockholmWallHour(Date.parse(iso))
    const base = 0.06 + 0.04 * Math.max(0, Math.sin(((hour - 6) * Math.PI) / 12))
    const evening = hour >= 17 && hour < 21 ? 0.09 : 0
    const weekend = dayIndex % 7 >= 5 ? 0.015 : 0
    const ripple = ((q * 7 + dayIndex * 13) % 11) / 1000
    return Math.round((base + evening + weekend + ripple) * scale * 1000) / 1000
  })
}

/**
 * How the grid owner frames one day on the wire.
 *  - civil_fixed_cet:   the Stockholm civil day (92/96/100 quarters), all times in fixed +0100 (ENV-08 offset).
 *  - civil_start_offset: the civil day in the fixed offset valid at its first instant (+0200 for 25 Oct), as the
 *                        reality grid-owner simulator writes summer days.
 *  - fixed_cet_day:     ENV-08's fixed normal-time day 00:00–24:00 +0100 (always 96 quarters; in summer it
 *                        covers 01:00–01:00 Stockholm time).
 */
export type E66DayFraming = 'civil_fixed_cet' | 'civil_start_offset' | 'fixed_cet_day'

/** Wall clock of an instant in a fixed offset, as EDIFACT format 203 (CCYYMMDDHHMM). */
export function fixedOffsetMinute(instant: number, offsetMinutes: number) {
  const t = new Date(instant + offsetMinutes * 60_000)
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}`
}

export type DayE66 = { edifact: string; framing: E66DayFraming; offset: '+0100' | '+0200'; periodStart: string; periodEnd: string
  /** UTC start of each value, in wire order. */ starts: string[]; registeredAt: string }

/**
 * One grid-owner UTILTS E66 for one day, energy-only quarter-hours, in the same segment layout as
 * live-chain-wire's dailyE66 (which the platform already accepts), but with the period and value count that
 * follow from the framing. `registeredAt` defaults to 06:00 the morning after the period; `notAfter` caps it
 * (a grid owner cannot register values in the future: DTM+137 may not lie after reception).
 */
export function dayE66(input: { issuer: string; receiver: string; meterId: string; day: string; values: number[]; reference: string
  framing?: E66DayFraming; registeredAfterHours?: number; notAfter?: number }): DayE66 {
  const framing = input.framing ?? 'civil_fixed_cet'
  let start: number, end: number, offsetMinutes: number
  if (framing === 'fixed_cet_day') {
    const { year, month, day } = dateParts(input.day)
    offsetMinutes = 60
    start = Date.UTC(year, month - 1, day) - 60 * 60_000
    end = start + 24 * 3_600_000
  } else {
    ;({ start, end } = stockholmDayUtc(input.day))
    offsetMinutes = framing === 'civil_fixed_cet' ? 60 : stockholmOffsetMinutes(start)
  }
  const count = (end - start) / QUARTER_MS
  if (input.values.length !== count) throw Error(`dayE66 ${input.day} ${framing} requires ${count} quarter-hour values, got ${input.values.length}`)
  let registered = end + (6 + (input.registeredAfterHours ?? 0)) * 3_600_000
  if (input.notAfter !== undefined) registered = Math.min(registered, input.notAfter)
  const at = (instant: number) => fixedOffsetMinute(instant, offsetMinutes)
  const offset = offsetMinutes === 60 ? '+0100' : '+0200'
  const lines = [
    "UNA:+.? '",
    `UNB+UNOC:3+${input.issuer}:ZZ+${input.receiver}:ZZ+${at(registered).slice(2, 8)}:${at(registered).slice(8, 12)}+${input.reference}++23-DDQ-E66-T++++1'`,
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
 * Deterministic SE-area quarter-hour spot curve (SEK/kWh) for one Stockholm day in elprisetjustnu's shape:
 * 92/96/100 rows, each with its real UTC instant. The shape follows the wall clock; the second pass of the
 * repeated autumn hour is priced 0.05 SEK higher so an invoice that drops or double-prices it is visible.
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
