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

/** One grid-owner UTILTS E66 for one local (CEST, +0200) day: 96 energy-only quarter-hours. */
export function dailyE66(input: { issuer: string; receiver: string; meterId: string; day: string; values: number[]; reference: string }) {
  if (input.values.length !== 96) throw Error('dailyE66 requires 96 quarter-hours')
  const [y, m, d] = input.day.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  const local = (date: Date, minutes: number) => {
    const t = new Date(date.getTime() + minutes * 60_000)
    return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}`
  }
  const start = new Date(Date.UTC(y, m - 1, d))
  const lines = [
    "UNA:+.? '",
    `UNB+UNOC:3+${input.issuer}:ZZ+${input.receiver}:ZZ+${local(next, 6 * 60).slice(2, 8)}:0600+${input.reference}++23-DDQ-E66-T++++1'`,
    "UNH+1+UTILTS:D:02B:UN:E5SE5A'",
    `BGM+E66::260+M${input.reference}+9+AB'`,
    `DTM+137:${local(next, 6 * 60)}:203'`, "DTM+735:?+0200:406'", "MKS+23+E02::260'",
    `NAD+MS+${input.issuer}:SVK:260'`, `NAD+MR+${input.receiver}:SVK:260'`, "NAD+DDQ'",
    `IDE+24+T${input.reference}'`, `LOC+172+${input.meterId}::9'`, "LOC+239+TES:SVK:260'",
    "LIN+++8716867000030:::9'", `DTM+324:${local(start, 0)}${local(next, 0)}:719'`,
    `DTM+597:${local(next, 6 * 60)}:203'`, "DTM+354:15:806'", "STS+7++E88::260'", "MEA+AAZ++KWH'",
    "CCI+++E12::260'", "CAV+E17::260'",
  ]
  input.values.forEach((value, q) => {
    lines.push(`SEQ++${q + 1}'`, `QTY+136:${kwhText(value)}'`, `DTM+597:${local(start, q * 15)}:203'`, "STS+7++21::260'")
  })
  lines.push(`UNT+${lines.length - 1}+1'`, `UNZ+1+${input.reference}'`)
  return lines.join('\n')
}
