/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// VENDORED COPY. Origin: claude/gifted-hamilton-vss1hj @ 2711f86287fd77da12e48aa5fd26a695f4a51426:scripts/helpers/live-chain-wire.ts
// Only the edits listed in chain/vendor-sync.py PATCHES (and @/ import rewrites) differ from the origin.
// Pure EDIFACT/metering builders shared by the live-chain fixture and the
// reality simulators. No test-runner, database or network dependency.

/** 17-digit body + GS1 mod-10 check digit (anläggnings-ID). */
export function gs1(body17: string) {
  let sum = 0
  for (let i = 0; i < body17.length; i += 1) sum += Number(body17[body17.length - 1 - i]) * (i % 2 === 0 ? 3 : 1)
  return body17 + String((10 - (sum % 10)) % 10)
}

/** Exact decimal without trailing zeros, as a grid owner would write it. */
export function kwhText(value: number) {
  return value.toFixed(3).replace(/\.?0+$/, '') || '0'
}

/** Deterministic household quarter-hour profile for one local day (kWh, 3 decimals). */
export function dayProfile(dayIndex: number): number[] {
  const values: number[] = []
  for (let q = 0; q < 96; q += 1) {
    const hour = q / 4
    const base = 0.06 + 0.04 * Math.max(0, Math.sin(((hour - 6) * Math.PI) / 12))
    const evening = hour >= 17 && hour < 21 ? 0.09 : 0
    const weekend = dayIndex % 7 >= 5 ? 0.015 : 0
    const ripple = ((q * 7 + dayIndex * 13) % 11) / 1000
    values.push(Math.round((base + evening + weekend + ripple) * 1000) / 1000)
  }
  return values
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
const HOUR_MS = 3_600_000

/** ENV-08: every Ediel payload time is fixed Swedish normal time, UTC+1, all year (DTM+735 +0100). */
export const EDIEL_OFFSET_MINUTES = 60

/** Wall clock of an instant in Ediel fixed normal time (+0100), as EDIFACT format 203 (CCYYMMDDHHMM). */
export function edielMinute(instant: number) {
  const t = new Date(instant + EDIEL_OFFSET_MINUTES * 60_000)
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}`
}

/** UTC bounds [start, end) of one Ediel day: 00:00–24:00 +0100 (23:00Z the day before to 23:00Z), always 24 hours. */
export function edielDayUtc(day: string): { start: number; end: number } {
  const [y, m, d] = day.split('-').map(Number)
  const start = Date.UTC(y, m - 1, d) - EDIEL_OFFSET_MINUTES * 60_000
  return { start, end: start + 24 * HOUR_MS }
}

const unbFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Stockholm', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
/**
 * UNB 0017/0019 (YYMMDD:HHMM) of an instant. Unlike the payload, the interchange header is Swedish local time
 * (ENV-08 "UNB lokal tid enligt regeln"; the platform's own UNB, edifactEnvelopeCodec serializeUnb, does the same).
 */
export function stockholmUnbStamp(instant: number) {
  const parts = Object.fromEntries(unbFormatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]))
  return `${parts.year}${parts.month}${parts.day}:${parts.hour}${parts.minute}`
}

/**
 * One grid-owner UTILTS E66 for one Ediel day: energy-only quarter-hours or, with `resolutionMinutes: 60`, hours.
 * A Swedish grid owner's day is 00:00–24:00 in fixed normal time (ENV-08, U-10, UG-122-16: DTM+735 +0100), so it
 * always has 96 quarter-hours (24 hours) and starts at 23:00Z the day before, also on the DST days (no E66 ever
 * carries 92 or 100 values). In summer it covers 01:00–01:00 Stockholm time. Every DTM (324, 597, 137) is in
 * +0100; the UNB is Swedish local time. `registeredAfterHours` moves the registration (default 06:00 +0100 the
 * morning after) later, as a grid owner does when it re-sends corrected values for the same day.
 */
export function dailyE66(input: { issuer: string; receiver: string; meterId: string; day: string; values: number[]; reference: string;
  resolutionMinutes?: 15 | 60; registeredAfterHours?: number; notAfter?: number; environment?: 'production' | 'test' }) {
  const step = input.resolutionMinutes ?? 15
  const count = (24 * 60) / step
  if (input.values.length !== count) throw Error(`dailyE66 requires ${count} values for ${step}-minute resolution on ${input.day}`)
  const { start, end } = edielDayUtc(input.day)
  // `notAfter` caps the registration: a grid owner cannot register values in the future (DTM+137 may not lie after
  // reception; FINDINGS H-B5b, a day that ended just before midnight UTC was stamped 06:00 the next morning).
  const registered = Math.min(end + (6 + (input.registeredAfterHours ?? 0)) * HOUR_MS, input.notAfter ?? Number.POSITIVE_INFINITY)
  const lines = [
    "UNA:+.? '",
    `UNB+UNOC:3+${input.issuer}:ZZ+${input.receiver}:ZZ+${stockholmUnbStamp(registered)}+${input.reference}++23-DDQ-E66-T${input.environment === 'production' ? '' : '++++1'}'`,
    "UNH+1+UTILTS:D:02B:UN:E5SE5A'",
    `BGM+E66::260+M${input.reference}+9+AB'`,
    `DTM+137:${edielMinute(registered)}:203'`, "DTM+735:?+0100:406'", "MKS+23+E02::260'",
    `NAD+MS+${input.issuer}:SVK:260'`, `NAD+MR+${input.receiver}:SVK:260'`, "NAD+DDQ'",
    `IDE+24+T${input.reference}'`, `LOC+172+${input.meterId}::9'`, "LOC+239+TES:SVK:260'",
    "LIN+++8716867000030:::9'", `DTM+324:${edielMinute(start)}${edielMinute(end)}:719'`,
    `DTM+597:${edielMinute(registered)}:203'`, `DTM+354:${step}:806'`, "STS+7++E88::260'", "MEA+AAZ++KWH'",
    "CCI+++E12::260'", "CAV+E17::260'",
  ]
  input.values.forEach((value, q) => {
    lines.push(`SEQ++${q + 1}'`, `QTY+136:${kwhText(value)}'`, `DTM+597:${edielMinute(start + q * step * 60_000)}:203'`, "STS+7++21::260'")
  })
  lines.push(`UNT+${lines.length - 1}+1'`, `UNZ+1+${input.reference}'`)
  return lines.join('\n')
}

/** Hourly sums of a quarter-hour profile (24 values). */
export function hourlyFromQuarters(values: number[]): number[] {
  return Array.from({ length: 24 }, (_, h) => Math.round(values.slice(h * 4, h * 4 + 4).reduce((a, b) => a + b, 0) * 1000) / 1000)
}
