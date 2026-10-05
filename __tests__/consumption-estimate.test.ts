import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))

import { estimateFromHistory, missingWindows, MONTHLY_CONSUMPTION_SHARE } from '@/lib/billing/consumptionEstimate'

const HOUR = 3_600_000
const WEEK = 7 * 24 * HOUR

function hourlyRows(start: number, hours: number, kwh: (index: number) => number) {
  return Array.from({ length: hours }, (_, index) => ({
    period_start: new Date(start + index * HOUR).toISOString(),
    period_end: new Date(start + (index + 1) * HOUR).toISOString(),
    quantity_kwh: kwh(index),
  }))
}

const periodStart = Date.parse('2026-09-01T00:00:00Z')
const periodEnd = periodStart + 7 * 24 * HOUR

describe('estimateFromHistory', () => {
  it('uses the same period last year, 52 weeks back so weekday and hour match', () => {
    const lastYearStart = periodStart - 52 * WEEK
    const history = hourlyRows(lastYearStart, 7 * 24, (index) => (index % 24) + 1)
    const estimate = estimateFromHistory({ windows: [{ start: periodStart, end: periodEnd }], stepMs: HOUR, history, annualKwh: null })
    expect(estimate?.method).toBe('same_period_last_year')
    expect(estimate?.intervals).toHaveLength(168)
    expect(estimate?.intervals[0].quantity_kwh).toBe(1)
    expect(estimate?.intervals[23].quantity_kwh).toBe(24)
    expect(estimate?.estimatedKwh).toBe(7 * 300)
  })

  it('falls back to the average of the last four weeks', () => {
    const history = hourlyRows(periodStart - 4 * WEEK, 4 * 168, (index) => (Math.floor(index / 168) + 1))
    const estimate = estimateFromHistory({ windows: [{ start: periodStart, end: periodEnd }], stepMs: HOUR, history, annualKwh: null })
    expect(estimate?.method).toBe('recent_four_weeks')
    // weeks hold 1,2,3,4 kWh/h -> average 2.5 kWh/h
    expect(estimate?.intervals[5].quantity_kwh).toBeCloseTo(2.5)
  })

  it('falls back to the annual consumption with the monthly profile', () => {
    const estimate = estimateFromHistory({ windows: [{ start: periodStart, end: periodEnd }], stepMs: HOUR, history: [], annualKwh: 20_000 })
    expect(estimate?.method).toBe('annual_consumption_profile')
    // one week of September: 20000 * share(Sep) * 7/30
    expect(estimate?.estimatedKwh).toBeCloseTo(20_000 * MONTHLY_CONSUMPTION_SHARE[8] * (7 / 30), 3)
  })

  it('returns null when there is nothing to estimate from', () => {
    expect(estimateFromHistory({ windows: [{ start: periodStart, end: periodEnd }], stepMs: HOUR, history: [], annualKwh: null })).toBeNull()
  })

  it('produces quarter-hour slots for quarter-hour contracts', () => {
    const estimate = estimateFromHistory({ windows: [{ start: periodStart, end: periodStart + HOUR }], stepMs: 15 * 60_000, history: [], annualKwh: 8760 })
    expect(estimate?.intervals).toHaveLength(4)
  })

  it('the monthly profile sums to one year', () => {
    expect(MONTHLY_CONSUMPTION_SHARE.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1)
  })
})

describe('missingWindows', () => {
  it('returns only the uncovered parts of the period', () => {
    const rows = hourlyRows(periodStart, 10, () => 1)
    const windows = missingWindows(rows, new Date(periodStart).toISOString(), new Date(periodStart + 24 * HOUR).toISOString())
    expect(windows).toEqual([{ start: periodStart + 10 * HOUR, end: periodStart + 24 * HOUR }])
  })
})
