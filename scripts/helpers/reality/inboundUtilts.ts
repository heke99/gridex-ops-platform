// Grid-owner UTILTS wire for reality scenario J2 (inbound metering, corrections, estimates, settlement aggregates)
// and its unit tests. Pure: no database, network or test runner. Synthetic values only.
//
// The layout follows the E66 the platform already accepts from the reality grid owner (live-chain-wire dailyE66,
// dst.ts dayE66): one UNB/UNH per file, one IDE transaction per metering point, Stockholm civil days written in
// the fixed offset +0100 (ENV-08, DTM+735). Additions for J2:
//  - a window inside the day (a partial-period correction: DTM+324 covers only the corrected quarter-hours),
//  - estimated quarter-hours: the observation status STS+8+56 in place of STS+7++21 (quality 56, U §3.7 field 520),
//  - an explicit registration time (DTM+137/597, UNB): a correction or a measured replacement of an estimate is
//    the same period registered later (U-04), capped at "now" because DTM+137 may not lie after reception,
//  - an E31 aggregate (grid-area series, no metering point) for the settlement observation.
import { kwhText } from '../live-chain-wire'
import { QUARTER_MS, fixedOffsetMinute, stockholmDayUtc, stockholmQuarterCount } from './dst'

const CET = 60 // minutes; ENV-08 fixed normal time

export type UtiltsFile = { edifact: string; reference: string; periodStart: string; periodEnd: string; registeredAt: string
  /** UTC start of every sent quarter-hour, in wire order. */ starts: string[]; values: number[] }

/**
 * One E66 for one metering point and one Stockholm civil day, or a window of it.
 * `values` are the whole day's quarter-hours (92/96/100); `window` [from, to) selects the quarter indexes sent.
 */
export function utiltsE66(input: { issuer: string; receiver: string; meterId: string; day: string; values: number[]; reference: string
  window?: { from: number; to: number }; estimated?: ReadonlySet<number>; registeredAt?: number; notAfter?: number }): UtiltsFile {
  const count = stockholmQuarterCount(input.day)
  if (input.values.length !== count) throw Error(`utiltsE66 ${input.day} requires ${count} quarter-hour values, got ${input.values.length}`)
  const from = input.window?.from ?? 0, to = input.window?.to ?? count
  if (!(Number.isInteger(from) && Number.isInteger(to) && 0 <= from && from < to && to <= count)) throw Error(`utiltsE66 invalid window ${from}..${to}`)
  const day = stockholmDayUtc(input.day)
  const start = day.start + from * QUARTER_MS, end = day.start + to * QUARTER_MS
  let registered = input.registeredAt ?? day.end + 6 * 3_600_000
  if (input.notAfter !== undefined) registered = Math.min(registered, input.notAfter)
  if (registered < end) throw Error('utiltsE66 a value cannot be registered before its quarter-hour has ended')
  const at = (instant: number) => fixedOffsetMinute(instant, CET)
  const lines = [
    "UNA:+.? '",
    `UNB+UNOC:3+${input.issuer}:ZZ+${input.receiver}:ZZ+${at(registered).slice(2, 8)}:${at(registered).slice(8, 12)}+${input.reference}++23-DDQ-E66-T++++1'`,
    "UNH+1+UTILTS:D:02B:UN:E5SE5A'",
    `BGM+E66::260+M${input.reference}+9+AB'`,
    `DTM+137:${at(registered)}:203'`, "DTM+735:?+0100:406'", "MKS+23+E02::260'",
    `NAD+MS+${input.issuer}:SVK:260'`, `NAD+MR+${input.receiver}:SVK:260'`, "NAD+DDQ'",
    `IDE+24+T${input.reference}'`, `LOC+172+${input.meterId}::9'`, "LOC+239+TES:SVK:260'",
    "LIN+++8716867000030:::9'", `DTM+324:${at(start)}${at(end)}:719'`,
    `DTM+597:${at(registered)}:203'`, "DTM+354:15:806'", "STS+7++E88::260'", "MEA+AAZ++KWH'",
    "CCI+++E12::260'", "CAV+E17::260'",
  ]
  const sent = input.values.slice(from, to)
  sent.forEach((value, i) => {
    const q = from + i
    lines.push(`SEQ++${i + 1}'`, `QTY+136:${kwhText(value)}'`, `DTM+597:${at(day.start + q * QUARTER_MS)}:203'`, input.estimated?.has(q) ? "STS+8+56'" : "STS+7++21::260'")
  })
  lines.push(`UNT+${lines.length - 1}+1'`, `UNZ+1+${input.reference}'`)
  return { edifact: lines.join('\n'), reference: input.reference, periodStart: new Date(start).toISOString(), periodEnd: new Date(end).toISOString(),
    registeredAt: new Date(registered).toISOString(), starts: sent.map((_, i) => new Date(start + i * QUARTER_MS).toISOString()), values: sent }
}

/**
 * One E31 (aggregated metered data, Ediel "avräkningsunderlag") for a grid area and one Stockholm civil day in
 * hourly values. Its identity is the grid area (LOC+239) and the balance responsible/supplier receiving it; it
 * names no metering point and may never touch an individual customer (DB-06, inboundBusinessOutcome grid_area_aggregate).
 */
export function utiltsE31(input: { issuer: string; receiver: string; gridArea: string; day: string; hourlyKwh: number[]; reference: string; registeredAt?: number; notAfter?: number }): UtiltsFile {
  const day = stockholmDayUtc(input.day)
  const hours = (day.end - day.start) / 3_600_000
  if (input.hourlyKwh.length !== hours) throw Error(`utiltsE31 ${input.day} requires ${hours} hourly values`)
  let registered = input.registeredAt ?? day.end + 6 * 3_600_000
  if (input.notAfter !== undefined) registered = Math.min(registered, input.notAfter)
  const at = (instant: number) => fixedOffsetMinute(instant, CET)
  const lines = [
    "UNA:+.? '",
    `UNB+UNOC:3+${input.issuer}:ZZ+${input.receiver}:ZZ+${at(registered).slice(2, 8)}:${at(registered).slice(8, 12)}+${input.reference}++23-DDQ-E31-S++++1'`,
    "UNH+1+UTILTS:D:02B:UN:E5SE5A'",
    `BGM+E31::260+M${input.reference}+9+AB'`,
    `DTM+137:${at(registered)}:203'`, "DTM+735:?+0100:406'", "MKS+23+E02::260'",
    `NAD+MS+${input.issuer}:SVK:260'`, `NAD+MR+${input.receiver}:SVK:260'`,
    `IDE+24+T${input.reference}'`, `LOC+239+${input.gridArea}:SVK:260'`, "LIN+++8716867000030:::9'",
    `DTM+324:${at(day.start)}${at(day.end)}:719'`, `DTM+597:${at(registered)}:203'`, "DTM+354:60:806'", "STS+7++E88::260'", "MEA+AAZ++KWH'",
  ]
  input.hourlyKwh.forEach((value, h) => lines.push(`SEQ++${h + 1}'`, `QTY+136:${kwhText(value)}'`))
  lines.push(`UNT+${lines.length - 1}+1'`, `UNZ+1+${input.reference}'`)
  return { edifact: lines.join('\n'), reference: input.reference, periodStart: new Date(day.start).toISOString(), periodEnd: new Date(day.end).toISOString(),
    registeredAt: new Date(registered).toISOString(), starts: input.hourlyKwh.map((_, h) => new Date(day.start + h * 3_600_000).toISOString()), values: input.hourlyKwh }
}

/** A grid owner's correction: every `every`-th quarter-hour from `offset` changed by `deltaKwh` (3 decimals). */
export function correctedValues(values: number[], input: { every: number; offset?: number; deltaKwh: number; from?: number; to?: number }) {
  const from = input.from ?? 0, to = input.to ?? values.length
  return values.map((value, q) => q >= from && q < to && (q - (input.offset ?? 0)) % input.every === 0 ? Math.round((value + input.deltaKwh) * 1000) / 1000 : value)
}

/** Quarter-hour indexes whose value differs. */
export const changedQuarters = (before: number[], after: number[]) => after.flatMap((value, q) => value !== before[q] ? [q] : [])

/** Hourly sums of quarter-hour values (a grid-area aggregate is reported per hour). */
export function hourlyFromQuarterValues(values: number[]) {
  const hours: number[] = []
  for (let q = 0; q < values.length; q += 4) hours.push(Math.round(values.slice(q, q + 4).reduce((a, b) => a + b, 0) * 1000) / 1000)
  return hours
}
