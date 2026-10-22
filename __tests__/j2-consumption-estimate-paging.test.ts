// reality-defects: J2 (reality scenario J2 "inbound UTILTS", J2-09 the estimate's history read stops at PostgREST's 1 000 rows)
// lib/billing/consumptionEstimate.ts estimateMissingConsumption (the monthly billing engine's preliminary
// consumption) against a fake PostgREST that, like the real one (supabase/config.toml max_rows = 1000), returns at
// most 1 000 rows per request whatever .limit() asks for. A quarter-hour meter has ≈ 35 000 values a year.
// Synthetic values only.
import { beforeEach, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ history: [] as Row[], requests: 0 }))
vi.mock('@/lib/supabase/service', () => {
  const from = (table: string) => {
    let range: [number, number] | null = null, limit: number | null = null
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'lt', 'gt', 'order']) builder[method] = () => builder
    builder.limit = (n: number) => { limit = n; return builder }
    builder.range = (a: number, b: number) => { range = [a, b]; return builder }
    builder.maybeSingle = async () => ({ data: table === 'metering_points' ? { estimated_annual_consumption_kwh: 3500, customer_site_id: null, site_id: null } : null, error: null })
    builder.then = (resolve: (value: unknown) => unknown) => {
      io.requests += 1
      const start = range ? range[0] : 0
      const end = Math.min(range ? range[1] + 1 : io.history.length, limit === null ? Infinity : start + limit, start + 1000)
      return Promise.resolve({ data: io.history.slice(start, end), error: null }).then(resolve)
    }
    return builder
  }
  return { supabaseService: { from } }
})

import { estimateMissingConsumption } from '@/lib/billing/consumptionEstimate'

const QUARTER = 15 * 60_000
beforeEach(() => {
  io.requests = 0
  // A full year of quarter-hour values before the gap: 0.1 kWh at night, 0.3 kWh 06–22 UTC.
  const start = Date.parse('2025-08-30T22:00:00Z'), end = Date.parse('2026-08-31T22:00:00Z')
  io.history = []
  for (let t = start; t < end; t += QUARTER) {
    const hour = new Date(t).getUTCHours()
    io.history.push({ period_start: new Date(t).toISOString(), period_end: new Date(t + QUARTER).toISOString(), quantity_kwh: hour >= 6 && hour < 22 ? '0.3' : '0.1', quality_status: null })
  }
})

it('a missing September is estimated from the same period last year, not from the intake annual consumption', async () => {
  const windows = [{ start: Date.parse('2026-08-31T22:00:00Z'), end: Date.parse('2026-09-30T22:00:00Z') }]
  const estimate = await estimateMissingConsumption({ companyId: 'company-j2', meteringPointId: 'mp-1', windows, stepMs: QUARTER })
  // Before the fix only the oldest 1 000 rows (≈ 10 days of August 2025) were read: neither last year's
  // September nor the latest four weeks were covered, so the 3 500 kWh/year profile priced the month.
  expect(estimate?.method).toBe('same_period_last_year')
  expect(estimate?.intervals).toHaveLength(2880)
  expect(estimate?.estimatedKwh).toBeCloseTo(30 * (64 * 0.3 + 32 * 0.1), 6)
  expect(io.requests).toBeGreaterThan(30)
})
