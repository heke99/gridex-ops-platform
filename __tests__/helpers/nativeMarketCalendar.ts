/**
 * Native Ediel fixtures were authored around a supply start of 2026-10-01. The received-source
 * ledger epoch is created when the migrations replay, and coverage requires the switch to be
 * created after the epoch and before the supply start. A fixed start therefore expires with the
 * calendar. Native suites run in a "shifted" calendar: every fixture date moves by the same
 * number of whole days, so the start stays a few days ahead of the run, exactly like the
 * original geometry, and all date relations inside a scenario are preserved.
 *
 * Fixture helpers stay in the original calendar. `viaOriginalCalendar` moves string arguments
 * back to the original calendar and the helper's output forward, so helpers and the shifted test
 * world never mix.
 */

const ANCHOR = Date.UTC(2026, 9, 1)
const DAY = 86_400_000
const LEAD_DAYS = 4

function stockholmToday(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const [year, month, day] = parts.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

/** Whole days from the authored anchor (2026-10-01) to the run's market day + LEAD_DAYS. */
export function nativeCalendarShiftDays(now = new Date()): number {
  return Math.max(0, Math.round((stockholmToday(now) + LEAD_DAYS * DAY - ANCHOR) / DAY))
}

function validCompact(token: string): boolean {
  const year = Number(token.slice(0, 4)), month = Number(token.slice(4, 6)), day = Number(token.slice(6, 8))
  if (year < 2020 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return false
  if (token.length === 12) {
    const hour = Number(token.slice(8, 10)), minute = Number(token.slice(10, 12))
    if (hour > 24 || minute > 59) return false
  }
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function shiftYmd(year: number, month: number, day: number, days: number): [string, string, string] {
  const date = new Date(Date.UTC(year, month - 1, day) + days * DAY)
  return [String(date.getUTCFullYear()), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0')]
}

function shiftCompact(token: string, days: number): string {
  const [y, m, d] = shiftYmd(Number(token.slice(0, 4)), Number(token.slice(4, 6)), Number(token.slice(6, 8)), days)
  return `${y}${m}${d}${token.slice(8)}`
}

/**
 * Shifts calendar dates in a string by whole days, keeping the time of day:
 * ISO dates (YYYY-MM-DD, with any time suffix) and compact EDIFACT dates (CCYYMMDD,
 * CCYYMMDDHHMM, including concatenated ranges such as CCYYMMDDHHMMCCYYMMDDHHMM).
 * Digit runs that are not entirely valid dates (identifiers, GSRN, hashes) are untouched.
 */
export function shiftMarketDates(text: string, days: number): string {
  if (!days) return text
  const iso = text.replace(/(?<![0-9])(20\d\d)-(\d\d)-(\d\d)(?![0-9])/g, (match, y, m, d) => {
    if (!validCompact(`${y}${m}${d}`)) return match
    const [ny, nm, nd] = shiftYmd(Number(y), Number(m), Number(d), days)
    return `${ny}-${nm}-${nd}`
  })
  return iso.replace(/(?<![0-9A-Za-z-])\d+(?![0-9-])/g, (run) => {
    for (const size of [12, 8]) {
      if (run.length % size !== 0) continue
      const chunks = run.match(new RegExp(`.{${size}}`, 'g')) ?? []
      if (chunks.length && chunks.every(validCompact)) return chunks.map((chunk) => shiftCompact(chunk, days)).join('')
    }
    return run
  })
}

export function shiftDeep<T>(value: T, days: number): T {
  if (typeof value === 'string') return shiftMarketDates(value, days) as T
  if (Array.isArray(value)) return value.map((item) => shiftDeep(item, days)) as T
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, shiftDeep(item, days)])) as T
  }
  return value
}

/** Calls an original-calendar fixture helper from the shifted calendar. */
export function viaOriginalCalendar<A extends unknown[], R>(helper: (...args: A) => R, days: number): (...args: A) => R {
  return (...args: A) => shiftDeep(helper(...(shiftDeep(args, -days) as A)), days)
}
