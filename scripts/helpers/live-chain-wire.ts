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

/** Europe/Stockholm offset (minutes east of UTC) at the local midnight that starts `day`: 120 (CEST) or 60 (CET). */
function stockholmMidnightOffsetMinutes(y: number, m: number, d: number) {
  // Local midnight is never inside a Swedish DST transition (they happen at 02:00/03:00), so the offset at
  // UTC 22:00 of the previous day decides it: 22:00Z is local 00:00 in CEST and 23:00 in CET.
  const probe = new Date(Date.UTC(y, m - 1, d) - 2 * 3_600_000)
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Stockholm', hour: '2-digit', hourCycle: 'h23' }).format(probe))
  return hour === 0 ? 120 : 60
}

/**
 * One grid-owner UTILTS E66 for one Stockholm calendar day: energy-only quarter-hours or, with
 * `resolutionMinutes: 60`, hours. The whole message is in the fixed offset that is valid at the day's local
 * midnight (DTM+735 +0200 in summer, +0100 in winter), so the period is exactly the civil day: 96 quarter-hours
 * on a normal day, 100 on the last Sunday in October and 92 on the last Sunday in March (DST-H1; summer days are
 * framed exactly as before). `registeredAfterHours` moves the registration time later, as a grid owner does when
 * it re-sends corrected values for the same day.
 */
export function dailyE66(input: { issuer: string; receiver: string; meterId: string; day: string; values: number[]; reference: string;
  resolutionMinutes?: 15 | 60; registeredAfterHours?: number; environment?: 'production' | 'test' }) {
  const step = input.resolutionMinutes ?? 15
  const [y, m, d] = input.day.split('-').map(Number)
  const offset = stockholmMidnightOffsetMinutes(y, m, d)
  const nextOffset = stockholmMidnightOffsetMinutes(y, m, d + 1)
  // The day's length in the fixed offset: 24 h plus the hour gained (autumn) or lost (spring) during the day.
  const dayMinutes = 24 * 60 + (offset - nextOffset)
  if (input.values.length !== dayMinutes / step) throw Error(`dailyE66 requires ${dayMinutes / step} values for ${step}-minute resolution on ${input.day}`)
  const registered = (6 + (input.registeredAfterHours ?? 0)) * 60
  const local = (date: Date, minutes: number) => {
    const t = new Date(date.getTime() + minutes * 60_000)
    return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}`
  }
  // Wall-clock anchors in the declared fixed offset: the day's start and its (civil) end.
  const start = new Date(Date.UTC(y, m - 1, d))
  const next = new Date(start.getTime() + dayMinutes * 60_000)
  const lines = [
    "UNA:+.? '",
    `UNB+UNOC:3+${input.issuer}:ZZ+${input.receiver}:ZZ+${local(next, registered).slice(2, 8)}:${local(next, registered).slice(8, 12)}+${input.reference}++23-DDQ-E66-T${input.environment === 'production' ? '' : '++++1'}'`,
    "UNH+1+UTILTS:D:02B:UN:E5SE5A'",
    `BGM+E66::260+M${input.reference}+9+AB'`,
    `DTM+137:${local(next, registered)}:203'`, `DTM+735:?+${pad(offset / 60)}00:406'`, "MKS+23+E02::260'",
    `NAD+MS+${input.issuer}:SVK:260'`, `NAD+MR+${input.receiver}:SVK:260'`, "NAD+DDQ'",
    `IDE+24+T${input.reference}'`, `LOC+172+${input.meterId}::9'`, "LOC+239+TES:SVK:260'",
    "LIN+++8716867000030:::9'", `DTM+324:${local(start, 0)}${local(next, 0)}:719'`,
    `DTM+597:${local(next, registered)}:203'`, `DTM+354:${step}:806'`, "STS+7++E88::260'", "MEA+AAZ++KWH'",
    "CCI+++E12::260'", "CAV+E17::260'",
  ]
  input.values.forEach((value, q) => {
    lines.push(`SEQ++${q + 1}'`, `QTY+136:${kwhText(value)}'`, `DTM+597:${local(start, q * step)}:203'`, "STS+7++21::260'")
  })
  lines.push(`UNT+${lines.length - 1}+1'`, `UNZ+1+${input.reference}'`)
  return lines.join('\n')
}

/** Hourly sums of a quarter-hour profile (24 values). */
export function hourlyFromQuarters(values: number[]): number[] {
  return Array.from({ length: 24 }, (_, h) => Math.round(values.slice(h * 4, h * 4 + 4).reduce((a, b) => a + b, 0) * 1000) / 1000)
}
