const STOCKHOLM_TIME_ZONE = 'Europe/Stockholm'

function formatter() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: STOCKHOLM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
}

function partsFor(date: Date): Record<string, number> {
  const result: Record<string, number> = {}
  for (const part of formatter().formatToParts(date)) {
    if (part.type !== 'literal') result[part.type] = Number(part.value)
  }
  return result
}

function timeZoneOffsetMs(date: Date): number {
  const parts = partsFor(date)
  const representedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return representedUtc - date.getTime()
}

export function stockholmLocalToUtc(input: {
  year: number
  month: number
  day: number
  hour?: number
  minute?: number
  second?: number
}): Date {
  const baseUtc = Date.UTC(input.year, input.month - 1, input.day, input.hour ?? 0, input.minute ?? 0, input.second ?? 0)
  let candidate = new Date(baseUtc)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    candidate = new Date(baseUtc - timeZoneOffsetMs(candidate))
  }
  const parts = partsFor(candidate)
  if (
    parts.year !== input.year ||
    parts.month !== input.month ||
    parts.day !== input.day ||
    parts.hour !== (input.hour ?? 0) ||
    parts.minute !== (input.minute ?? 0)
  ) {
    throw new Error('Ogiltig eller tvetydig svensk lokal tid.')
  }
  return candidate
}

export function parseBillingMonth(value: string): { year: number; month: number; value: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) throw new Error('Fakturamånad måste anges som YYYY-MM.')
  const year = Number(match[1])
  const month = Number(match[2])
  if (year < 2000 || year > 2200 || month < 1 || month > 12) throw new Error('Fakturamånad är ogiltig.')
  return { year, month, value }
}

export function stockholmMonthBounds(value: string) {
  const { year, month } = parseBillingMonth(value)
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const start = stockholmLocalToUtc({ year, month, day: 1 })
  const end = stockholmLocalToUtc({ year: nextYear, month: nextMonth, day: 1 })
  return {
    year,
    month,
    start: start.toISOString(),
    end: end.toISOString(),
    startDate: `${value}-01`,
    endDateExclusive: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`,
    timeZone: STOCKHOLM_TIME_ZONE,
  }
}

export function previousStockholmBillingMonth(now = new Date()): string {
  const parts = partsFor(now)
  const month = parts.month === 1 ? 12 : parts.month - 1
  const year = parts.month === 1 ? parts.year - 1 : parts.year
  return `${year}-${String(month).padStart(2, '0')}`
}

export function strictIsoDate(value: unknown, fieldName = 'date'): string {
  const text = typeof value === 'string' ? value.trim() : ''
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) throw new Error(`${fieldName} måste anges som YYYY-MM-DD.`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new Error(`${fieldName} är inte ett giltigt kalenderdatum.`)
  }
  return text
}

export function stockholmDateForInstant(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Ogiltig tidpunkt.')
  const parts = partsFor(date)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}


export function previousStockholmCalendarDate(now = new Date()): string {
  const parts = partsFor(now)
  const previous = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - 1))
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}-${String(previous.getUTCDate()).padStart(2, '0')}`
}

export function currentStockholmCalendarDate(now = new Date()): string {
  return stockholmDateForInstant(now)
}

export function nextStockholmCalendarDate(now = new Date()): string {
  const current = currentStockholmCalendarDate(now)
  const [year, month, day] = current.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + 1))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
}

export function stockholmHourForInstant(now = new Date()): number {
  return partsFor(now).hour
}

const WITHDRAWAL_PERIOD_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

function addCalendarDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
}

/**
 * Customer-facing last day (inclusive, Europe/Stockholm) of the 14-day
 * cooling-off period (ångerrätt): the period ends at the end of the Stockholm
 * calendar day that is 14 days after the Stockholm signing date.
 *
 * Pass `acceptedAt` when known. Otherwise the stored `withdrawal_deadline_at`
 * (= accepted_at + interval '14 days', computed in UTC by the database) is
 * accepted and the signing instant is recovered from it.
 */
export function stockholmWithdrawalDeadlineDate(input: {
  acceptedAt?: string | Date | null
  storedDeadlineAt?: string | Date | null
}): string | null {
  let accepted: Date | null = null
  if (input.acceptedAt) {
    accepted = input.acceptedAt instanceof Date ? input.acceptedAt : new Date(input.acceptedAt)
  } else if (input.storedDeadlineAt) {
    const stored =
      input.storedDeadlineAt instanceof Date ? input.storedDeadlineAt : new Date(input.storedDeadlineAt)
    accepted = new Date(stored.getTime() - WITHDRAWAL_PERIOD_DAYS * DAY_MS)
  }
  if (!accepted || Number.isNaN(accepted.getTime())) return null
  return addCalendarDays(stockholmDateForInstant(accepted), WITHDRAWAL_PERIOD_DAYS)
}
