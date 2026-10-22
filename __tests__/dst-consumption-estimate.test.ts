// reality-defects: (reality scenario G, finding DST-E1: preliminary estimates shift one hour across the DST change)
// estimateFromHistory (lib/billing/consumptionEstimate.ts) repeats reference weeks by subtracting 7 × 24 h of UTC
// time and assigns the annual profile by UTC month. After 25 October 2026 a reference week that lies in summer
// time is read one Stockholm wall-clock hour late, and the first hour of a Stockholm month is profiled as the
// previous month. These tests state the correct (wall-clock) behaviour and are marked `fails` while the defect
// is open; they turn red the day the estimator is fixed so the marker can be removed.
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
import { estimateFromHistory, MONTHLY_CONSUMPTION_SHARE } from '@/lib/billing/consumptionEstimate'
import { stockholmWallHour } from '../scripts/helpers/reality/dst'

const HOUR = 3_600_000
/** Hourly history: 5 kWh in the 18:00–19:00 Stockholm wall-clock hour, 1 kWh otherwise. */
function history(fromIso: string, toIso: string) {
  const rows: Array<Record<string, unknown>> = []
  for (let t = Date.parse(fromIso); t < Date.parse(toIso); t += HOUR) {
    rows.push({ period_start: new Date(t).toISOString(), period_end: new Date(t + HOUR).toISOString(), quantity_kwh: Math.floor(stockholmWallHour(t)) === 18 ? 5 : 1 })
  }
  return rows
}

describe('DST-E1 preliminary consumption estimate across the end of DST', () => {
  // Missing hour: Monday 2 November 2026, 18:00–19:00 CET (17:00Z–18:00Z). The four reference weeks before it are
  // 26 Oct (CET) and 19/12/5 Oct (CEST). Each reference week has its 18:00 peak.
  const gap = { start: Date.parse('2026-11-02T17:00:00Z'), end: Date.parse('2026-11-02T18:00:00Z') }

  it('the reference history is complete for the recent-four-weeks method', () => {
    const estimate = estimateFromHistory({ windows: [gap], stepMs: HOUR, history: history('2026-10-05T00:00:00Z', '2026-11-02T17:00:00Z'), annualKwh: null })
    expect(estimate?.method).toBe('recent_four_weeks')
    // Current behaviour: only the CET week (26 Oct) contributes its 18:00 peak; the three CEST weeks are read at 19:00.
    expect(estimate?.estimatedKwh).toBe(2)
  })

  it.fails('repeats the same Stockholm wall-clock hour of each reference week (expected 5 kWh)', () => {
    const estimate = estimateFromHistory({ windows: [gap], stepMs: HOUR, history: history('2026-10-05T00:00:00Z', '2026-11-02T17:00:00Z'), annualKwh: null })
    expect(estimate?.estimatedKwh).toBe(5)
  })

  it.fails('profiles the first hour of a Stockholm month with that month (1 November 00:00 CET is November)', () => {
    const first = { start: Date.parse('2026-10-31T23:00:00Z'), end: Date.parse('2026-11-01T00:00:00Z') }
    const estimate = estimateFromHistory({ windows: [first], stepMs: HOUR, history: [], annualKwh: 10_000 })
    expect(estimate?.method).toBe('annual_consumption_profile')
    const novemberHours = 30 * 24
    expect(estimate!.estimatedKwh).toBeCloseTo(10_000 * MONTHLY_CONSUMPTION_SHARE[10] / novemberHours, 6)
  })
})
