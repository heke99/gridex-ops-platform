/** PRODAT P26.A r3 p43 uses standard time UTC+1 throughout the year.
 * Compact and offset-free ISO inputs are market wall times. Offset-bearing ISO
 * inputs and Date objects are instants, converted to that fixed offset. */
const STANDARD_OFFSET_MS = 60 * 60 * 1000

/** Validate Gregorian dates without Date's rollover or special years 00–99. */
export function isProdatCalendarDate(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false
  const year = Number(value.slice(0, 4)), month = Number(value.slice(4, 6)), day = Number(value.slice(6, 8))
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 31, 30, 31]
  return year > 0 && month >= 1 && month <= 12 && day > 0 && day <= days[month - 1]
}

/** Wire format203 has exactly minute precision; no stripping or truncation. */
export function isProdatCalendarMinute(value: string): boolean {
  return /^\d{12}$/.test(value) && isProdatCalendarDate(value.slice(0, 8))
    && Number(value.slice(8, 10)) < 24 && Number(value.slice(10, 12)) < 60
}

/** A birth-date input is a calendar date, never an arbitrary digit-containing ID. */
export function prodatDate102(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const input = value.trim()
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input) ? input.replace(/-/g, '') : input
  return isProdatCalendarDate(date) ? date : null
}

/** Serialize an absolute creation instant to the P-profile fixed UTC+1 minute.
 * Seconds are deliberately projected to the precision of wire format203. */
export function prodatNowDate203(date = new Date()): string {
  if (!Number.isFinite(date.getTime())) throw new Error('prodat_date_invalid_instant')
  const iso = new Date(date.getTime() + STANDARD_OFFSET_MS).toISOString()
  const result = iso.slice(0, 16).replace(/[-T:]/g, '')
  if (!isProdatCalendarMinute(result)) throw new Error('prodat_date_out_of_range')
  return result
}

/** Accept exact compact dates/minutes or explicit ISO dates/timestamps.
 * ISO timestamps may carry seconds: their minute projection is explicit here,
 * unlike wire values, whose precision and length are validated separately. */
export function prodatDate203(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const input = value.trim()
  if (isProdatCalendarMinute(input)) return input
  const dateOnly = prodatDate102(input)
  if (dateOnly) return `${dateOnly}0000`
  const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?$/)
  if (!iso) return null
  const compact = iso.slice(1, 6).join('')
  if (!isProdatCalendarMinute(compact) || Number(iso[6] ?? '0') > 59) return null
  const offset = iso[8]
  if (!offset) return compact
  if (offset !== 'Z' && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59)) return null
  const instant = new Date(input)
  if (!Number.isFinite(instant.getTime())) return null
  try { return prodatNowDate203(instant) } catch { return null }
}

/** Explicit date-only projection for database DATE columns; minute precision
 * remains available from the parsed field and must not be reconstructed later. */
export function prodatDateToIsoDate(value?: string | null): string | null {
  const minute = prodatDate203(value)
  return minute ? `${minute.slice(0, 4)}-${minute.slice(4, 6)}-${minute.slice(6, 8)}` : null
}

export function normalizeProdatDate(value?: string | null): string | null {
  const minute = prodatDate203(value)
  return minute ? `${minute.slice(0, 4)}-${minute.slice(4, 6)}-${minute.slice(6, 8)}T${minute.slice(8, 10)}:${minute.slice(10, 12)}` : null
}

/** Opt-in loss of clock precision, not the default business-date renderer. */
export function prodatDate203AtStartOfDay(value?: string | null): string | null {
  const minute = prodatDate203(value)
  return minute ? `${minute.slice(0, 8)}0000` : null
}

/** Strict inverse of a P-profile wire minute, always standard time UTC+1.
 * Unlike convenience render inputs, no trimming, date-only or timezone guess. */
export function prodatMarketMinuteToUtc(value?: string | null): string | null {
  if (typeof value !== 'string' || !isProdatCalendarMinute(value)) return null
  const date = new Date(0)
  date.setUTCFullYear(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)))
  date.setUTCHours(Number(value.slice(8, 10)), Number(value.slice(10, 12)), 0, 0)
  return new Date(date.getTime() - STANDARD_OFFSET_MS).toISOString()
}
