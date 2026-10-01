import { describe, expect, it } from 'vitest'
import { nativeCalendarShiftDays, shiftDeep, shiftMarketDates, viaOriginalCalendar } from './helpers/nativeMarketCalendar'

describe('native market calendar shift', () => {
  it('keeps the authored geometry: start a few market days after the run', () => {
    expect(nativeCalendarShiftDays(new Date('2026-09-26T10:00:00Z'))).toBe(0)
    expect(nativeCalendarShiftDays(new Date('2026-10-01T19:00:00Z'))).toBe(4)
    expect(nativeCalendarShiftDays(new Date('2026-12-31T23:30:00Z'))).toBe(96)
  })

  it('shifts ISO, compact and concatenated EDIFACT dates but not identifiers', () => {
    const text = "DTM+92:202610010000:203'DTM+324:202610010000202610150000?+0100:719' 2026-09-30T20:00:00Z 20261001 735123456789012345 10000000-0000-4000-8000-000000001202 M-GRIDEX-2607-01"
    expect(shiftMarketDates(text, 4)).toBe(
      "DTM+92:202610050000:203'DTM+324:202610050000202610190000?+0100:719' 2026-10-04T20:00:00Z 20261005 735123456789012345 10000000-0000-4000-8000-000000001202 M-GRIDEX-2607-01",
    )
  })

  it('crosses month and year boundaries and round-trips', () => {
    expect(shiftMarketDates('2026-12-30 202612300000', 3)).toBe('2027-01-02 202701020000')
    const original = { raw: 'DTM+92:202610010000:203', nested: ['2026-10-15'] }
    expect(shiftDeep(shiftDeep(original, 37), -37)).toEqual(original)
  })

  it('runs helpers in the original calendar without double shifting', () => {
    const helper = (date: string) => ({ raw: `DTM+92:${date.replaceAll('-', '')}0000:203`, date })
    const shifted = viaOriginalCalendar(helper, 4)
    expect(shifted('2026-10-05')).toEqual({ raw: 'DTM+92:202610050000:203', date: '2026-10-05' })
  })
})

describe('identifier safety', () => {
  it('never treats UUID segments as dates', () => {
    expect(shiftMarketDates('id 3f0e1a2b-1234-4abc-8def-202610050000', 4)).toBe('id 3f0e1a2b-1234-4abc-8def-202610050000')
  })
})
