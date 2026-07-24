import { describe, expect, it } from 'vitest'
import { validateSpotPriceDay } from '@/lib/pricing/spot/intervalCoverage'
import type { SpotPriceInterval } from '@/lib/pricing/types'

function intervals(input: { date: string; count: number; minutes: number; startIso: string }): SpotPriceInterval[] {
  const start = Date.parse(input.startIso)
  return Array.from({ length: input.count }, (_, index) => ({
    source: 'elprisetjustnu',
    priceArea: 'SE3',
    timeStart: new Date(start + index * input.minutes * 60_000).toISOString(),
    timeEnd: new Date(start + (index + 1) * input.minutes * 60_000).toISOString(),
    sekPerKwh: 0.5 + index / 1000,
    eurPerKwh: null,
    exchangeRate: null,
    resolution: input.minutes === 15 ? 'quarter_hour' : 'hourly',
    sourcePayload: {},
  }))
}

describe('spot interval day coverage', () => {
  it('accepts a normal 96 interval quarter-hour day', () => {
    const result = validateSpotPriceDay({
      calendarDate: '2026-02-10',
      priceArea: 'SE3',
      intervals: intervals({ date: '2026-02-10', count: 96, minutes: 15, startIso: '2026-02-09T23:00:00.000Z' }),
    })
    expect(result.status).toBe('complete')
    expect(result.expectedIntervalCount).toBe(96)
    expect(result.issues).toEqual([])
  })

  it('accepts 92 intervals on the spring DST day', () => {
    const result = validateSpotPriceDay({
      calendarDate: '2026-03-29',
      priceArea: 'SE3',
      intervals: intervals({ date: '2026-03-29', count: 92, minutes: 15, startIso: '2026-03-28T23:00:00.000Z' }),
    })
    expect(result.status).toBe('complete')
    expect(result.expectedIntervalCount).toBe(92)
  })

  it('accepts 100 intervals on the autumn DST day', () => {
    const result = validateSpotPriceDay({
      calendarDate: '2026-10-25',
      priceArea: 'SE3',
      intervals: intervals({ date: '2026-10-25', count: 100, minutes: 15, startIso: '2026-10-24T22:00:00.000Z' }),
    })
    expect(result.status).toBe('complete')
    expect(result.expectedIntervalCount).toBe(100)
  })

  it('rejects gaps, overlaps and duplicates', () => {
    const rows = intervals({ date: '2026-02-10', count: 96, minutes: 15, startIso: '2026-02-09T23:00:00.000Z' })
    rows.splice(10, 1)
    rows.push({ ...rows[20] })
    rows[30] = { ...rows[30], timeStart: rows[29].timeStart }
    const result = validateSpotPriceDay({ calendarDate: '2026-02-10', priceArea: 'SE3', intervals: rows })
    expect(result.status).toBe('incomplete')
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['gap', 'duplicate_interval', 'overlap']))
  })
})
