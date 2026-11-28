import { expect, it } from 'vitest'
import { validateIntervalCoverage } from '@/lib/billing/underlayIntervals'

const start = '2026-11-01T00:00:00Z'
const end = '2026-11-01T00:15:00Z'

it('accepts an interval that matches the entire segment', () => {
  expect(validateIntervalCoverage([{ id: 'first', period_start: start, period_end: end }], start, end))
    .toEqual({ missing: 0, warnings: [] })
})

it('warns when the final interval extends beyond the segment', () => {
  expect(validateIntervalCoverage([
    { id: 'first', period_start: start, period_end: '2026-11-01T00:30:00Z' },
  ], start, end)).toEqual({
    missing: 0,
    warnings: ['Ett mätintervall sträcker sig utanför fakturasegmentets sluttid.'],
  })
})

it('still warns when the first interval starts before the segment', () => {
  expect(validateIntervalCoverage([
    { id: 'first', period_start: '2026-10-31T23:45:00Z', period_end: end },
  ], start, end)).toEqual({
    missing: 0,
    warnings: ['Överlappande mätintervall finns i fakturasegmentet.'],
  })
})

it('rejects an empty or reversed segment even without a reading', () => {
  for (const invalidEnd of [start, '2026-10-31T23:45:00Z']) {
    expect(validateIntervalCoverage([], start, invalidEnd)).toEqual({
      missing: 1,
      warnings: ['Fakturasegmentet har ogiltig start eller sluttid.'],
    })
  }
})
