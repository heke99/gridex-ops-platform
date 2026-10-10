import { stockholmDateForInstant, stockholmLocalToUtc } from '@/lib/time/stockholm'

/** Same allow-list as the customer portal invoice reads: drafts and failed invoices are never exposed. */
export const PARTNER_VISIBLE_INVOICE_STATUSES = ['issued', 'sent', 'paid', 'overdue', 'cancelled', 'credited'] as const

function dateParts(isoDate: string) {
  const [year, month, day] = isoDate.split('-').map(Number)
  return { year, month, day }
}

/** UTC instant of 00:00 Europe/Stockholm on the given calendar date (YYYY-MM-DD). */
export function stockholmDayStartUtc(isoDate: string): Date {
  return stockholmLocalToUtc(dateParts(isoDate))
}

/** UTC instant of 00:00 Europe/Stockholm on the day after the given date (half-open upper bound). */
export function stockholmNextDayStartUtc(isoDate: string): Date {
  const { year, month, day } = dateParts(isoDate)
  const next = new Date(Date.UTC(year, month - 1, day + 1))
  return stockholmLocalToUtc({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() })
}

/** Calendar date of an instant in Europe/Stockholm, or null. */
export function stockholmInvoiceDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  try {
    return stockholmDateForInstant(String(value))
  } catch {
    return null
  }
}

/** Number of Stockholm calendar days in the inclusive range from..to. */
export function calendarDaysInclusive(from: string, to: string): number {
  const a = dateParts(from)
  const b = dateParts(to)
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000) + 1
}
