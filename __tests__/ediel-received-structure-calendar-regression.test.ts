import { expect, it } from 'vitest'
import { isProdatCalendarDate, isProdatCalendarMinute, prodatDate203, prodatMarketMinuteToUtc } from '@/lib/ediel/prodat/render/dates'

it('rejects November 31 in the shared calendar, minute reader and strict inverse', () => {
  expect(isProdatCalendarDate('20261131')).toBe(false)
  expect(isProdatCalendarMinute('202611310000')).toBe(false)
  expect(prodatDate203('202611310000')).toBeNull()
  expect(prodatMarketMinuteToUtc('202611310000')).toBeNull()
})

it('accepts December 31 without changing its calendar day or standard-time conversion', () => {
  expect(isProdatCalendarDate('20261231')).toBe(true)
  expect(isProdatCalendarMinute('202612310000')).toBe(true)
  expect(prodatDate203('202612310000')).toBe('202612310000')
  expect(prodatMarketMinuteToUtc('202612310000')).toBe('2026-12-30T23:00:00.000Z')
})

it('preserves Gregorian month-end validity across ordinary and century leap years', () => {
  for (const [year, february] of [[1900, 28], [1999, 28], [2000, 29], [2026, 28], [2400, 29]]) {
    const monthEnds = [31, february, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    for (const [index, lastDay] of monthEnds.entries()) {
      const prefix = String(year) + String(index + 1).padStart(2, '0')
      const last = prefix + String(lastDay)
      const invalid = prefix + String(lastDay + 1)
      expect(isProdatCalendarDate(last), last).toBe(true)
      expect(isProdatCalendarDate(invalid), invalid).toBe(false)
      expect(isProdatCalendarMinute(last + '2359'), last).toBe(true)
      expect(prodatMarketMinuteToUtc(invalid + '0000'), invalid).toBeNull()
    }
  }
})
