// Ursprung: 3ea5cd2b6d37b910674e71993ac94e5720ed31a8 (origin/claude/sim-20261029-track1):scripts/simulation/track1/fixtures/synthetic.ts
// Utdrag (månadsgeometri, spotpriser) + nytt: timvärden (24 per dygn) i stället för kvartsvärden. Ren modul, ingen app-import.

export const SYNTHETIC_TZ = 'Europe/Stockholm'

/** UTC offset (minutes) of Europe/Stockholm at a UTC instant, from Intl (not from app code). */
export function stockholmOffsetMinutes(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SYNTHETIC_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs))
  const get = (type: string) => Number(parts.find(part => part.type === type)!.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000)
}

/** Local Stockholm wall time to UTC ms (valid for non-transition times). */
export function localToUtcMs(year: number, month: number, day: number, hour = 0, minute = 0): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute)
  let guess = naive - stockholmOffsetMinutes(naive) * 60000
  guess = naive - stockholmOffsetMinutes(guess) * 60000
  return guess
}

export type SyntheticMonth = {
  billingMonth: string
  year: number
  month: number
  days: number
  /** Declared offset for the whole month, e.g. 120 for +0200. */
  offsetMinutes: number
  startMs: number
  endMs: number
}

export function syntheticMonth(billingMonth: string): SyntheticMonth {
  const match = /^(\d{4})-(\d{2})$/.exec(billingMonth)
  if (!match) throw new Error(`fixture_month_invalid:${billingMonth}`)
  const year = Number(match[1]), month = Number(match[2])
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const startMs = localToUtcMs(year, month, 1)
  const nextYear = month === 12 ? year + 1 : year, nextMonth = month === 12 ? 1 : month + 1
  const endMs = localToUtcMs(nextYear, nextMonth, 1)
  const startOffset = stockholmOffsetMinutes(startMs), endOffset = stockholmOffsetMinutes(endMs - 1)
  // DST transitions inside the month are allowed (October 2026): use offsetAtDay()/spotDayPayload() for per-day offsets.
  void endOffset
  return { billingMonth, year, month, days, offsetMinutes: startOffset, startMs, endMs }
}

/** Stockholm offset (minutes) at local noon of a day (days used by DELIVERY01 are not transition days). */
export function offsetAtDay(month: SyntheticMonth, day: number): number {
  return stockholmOffsetMinutes(localToUtcMs(month.year, month.month, day, 12))
}

export const HOURS_PER_DAY = 24

export function pad2(value: number): string { return String(value).padStart(2, '0') }

/** `+0100` style offset for DTM+735. */
export function edifactOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  return `${sign}${pad2(Math.floor(abs / 60))}${pad2(abs % 60)}`
}

/** Local `YYYYMMDDHHmm` for a given local day (1-based) and local minute-of-day (may be 1440 = next day 00:00). */
export function localStamp(month: SyntheticMonth, day: number, minuteOfDay: number): string {
  const date = new Date(Date.UTC(month.year, month.month - 1, day, 0, minuteOfDay))
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}`
}

const HOURLY_PROFILE_MILLI = [60, 50, 45, 45, 50, 70, 120, 180, 200, 160, 140, 130, 125, 120, 125, 140, 170, 230, 260, 250, 200, 150, 100, 75]

function mix(a: number, b: number, c: number): number {
  // Small deterministic integer hash (no Math.random, no Date).
  let h = (Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x165667b1, 0x27d4eb2f)) >>> 0
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15
  return h >>> 0
}

/** NEW (not in T1): consumption for one hour in integer thousandths of a kWh. Always >= 1. */
export function hourMilliKwh(day: number, hour: number, salt: number): number {
  return HOURLY_PROFILE_MILLI[hour] * 4 + (mix(day, hour, salt) % 41) + (mix(day, 99, salt) % 31) + 1
}

/** Canonical decimal text for thousandths: no trailing zeros, '.' decimal mark. */
export function formatMilliKwh(milli: number): string {
  if (!Number.isInteger(milli) || milli < 0) throw new Error(`fixture_milli_invalid:${milli}`)
  const whole = Math.floor(milli / 1000), frac = milli % 1000
  if (frac === 0) return String(whole)
  return `${whole}.${String(frac).padStart(3, '0').replace(/0+$/, '')}`
}

/** Hourly spot price in units of 1e-5 SEK/kWh (positive integers). */
export function hourlySpotE5(day: number, hour: number, salt: number): number {
  const peak = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 20) ? 30000 : 0
  return 25000 + (mix(day, hour + 1000, salt + 7) % 80000) + peak
}

export function spotSekPerKwh(e5: number): number { return e5 / 100000 }

/** ISO timestamp with the month's fixed local offset, e.g. 2026-09-01T00:00:00+02:00. */
export function isoWithOffset(utcMs: number, offsetMinutes: number): string {
  const local = new Date(utcMs + offsetMinutes * 60000)
  const sign = offsetMinutes < 0 ? '-' : '+', abs = Math.abs(offsetMinutes)
  return `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}T${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}:00${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
}

/** An elprisetjustnu-format day payload: one row per real UTC hour of the local day (23/24/25 rows), each with the offset valid at that instant. */
export function spotDayPayload(month: SyntheticMonth, day: number, salt: number): Array<Record<string, unknown>> {
  const from = localToUtcMs(month.year, month.month, day), to = localToUtcMs(month.year, month.month, day + 1)
  const rows: Array<Record<string, unknown>> = []
  for (let startMs = from, index = 0; startMs < to; startMs += 3_600_000, index++) {
    const e5 = hourlySpotE5(day, index, salt)
    rows.push({
      SEK_per_kWh: spotSekPerKwh(e5), EUR_per_kWh: Math.round(spotSekPerKwh(e5) / 11.5 * 1e6) / 1e6, EXR: 11.5,
      time_start: isoWithOffset(startMs, stockholmOffsetMinutes(startMs)), time_end: isoWithOffset(startMs + 3_600_000, stockholmOffsetMinutes(startMs + 3_600_000 - 1)),
    })
  }
  return rows
}

/** Billing month of DELIVERY01: WINTER time. A summer-time start day cannot be covered (finding 001: first local hour 22:00Z < market_start_at 23:00Z; and a
 *  gap before the first value otherwise). DST ended 2026-10-25; the clock reads 2026-10-30. */
export const DELIVERY01_BILLING_MONTH = '2026-10'
/** Supply start (local date). PRODAT DTM is read as UTC+1 -> market_start_at 2026-10-27T23:00Z = local midnight in winter time. */
export const DELIVERY01_START_DATE = '2026-10-28'
/** Days of the billing month with one hourly E66 each (24 values): 28, 29, 30 and 31 (31 is in the future of the stack clock; recorded, not assumed). */
export const DELIVERY01_E66_DAYS = [28, 29, 30, 31] as const
