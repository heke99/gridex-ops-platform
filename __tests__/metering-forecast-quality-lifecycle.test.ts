import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  history: [] as number[],
  canonicalHistory: [] as Array<{ value_kwh: number | null; quantity_kwh: number | null }>,
  annualEstimate: 0,
  resolution: vi.fn(),
  finding: vi.fn(),
  valueError: false as boolean | string,
}))
vi.mock('@/lib/analytics/dataQuality', () => ({
  resolveManagedDataQualityIssue: io.resolution,
  upsertManagedDataQualityIssue: io.finding,
}))
vi.mock('@/lib/forecasting/consumptionProfiles', () => ({ getMonthlyWeightPercent: async () => 10 }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    async rpc(name: string) {
      if (name !== 'gridex_forecast_metering_period_totals_v1') throw new Error('unexpected_rpc:' + name)
      const row = io.canonicalHistory.shift() ?? { quantity_kwh: io.history.shift() ?? 0 }
      return {
        data: [{ total_kwh: Number(('value_kwh' in row ? row.value_kwh : null) ?? row.quantity_kwh ?? 0), value_count: 1 }],
        error: io.valueError ? { message: typeof io.valueError === 'string' ? io.valueError : 'database_read_failed' } : null,
      }
    },
    from(table: string) {
      if (table === 'metering_points') {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({ data: {
            id: 'point', estimated_annual_consumption_kwh: io.annualEstimate,
            customer_sites: null, start_date: null, end_date: null, consumption_profile_id: null,
          }, error: null }),
        }
        return query
      }
      const query = {
        select: () => query,
        eq: () => query,
        gte: () => query,
        lt: async () => ({
          data: [io.canonicalHistory.shift() ?? { quantity_kwh: io.history.shift() ?? 0 }],
          error: io.valueError ? { message: typeof io.valueError === 'string' ? io.valueError : 'database_read_failed' } : null,
        }),
      }
      return query
    },
  },
}))

import { calculateMeteringPointForecast } from '@/lib/forecasting/meteringPointForecast'
import { resolveBiddingZone } from '@/lib/analytics/biddingZoneResolver'

describe('forecast producers report healthy and failed quality windows', () => {
  beforeEach(() => {
    io.history = []
    io.canonicalHistory = []
    io.annualEstimate = 0
    io.valueError = false
    io.resolution.mockReset().mockResolvedValue(undefined)
    io.finding.mockReset().mockResolvedValue(undefined)
  })

  it.each([
    { history: [120], estimate: 0, method: 'history' },
    { history: [0, 120], estimate: 0, method: 'history' },
    { history: [0, 0, 120], estimate: 0, method: 'hybrid' },
    { history: [0, 0, 0], estimate: 1200, method: 'annual_estimate' },
  ])('resolves the evaluated window for $method/$history', async ({ history, estimate, method }) => {
    io.history = [...history]
    io.annualEstimate = estimate
    const result = await calculateMeteringPointForecast({ companyId: 'company', meteringPointId: 'point', periodStart: '2026-10-01', periodEnd: '2026-11-01' })
    expect(result.method).toBe(method)
    expect(result.forecastKwh).toBeGreaterThan(0)
    expect(io.resolution).toHaveBeenCalledExactlyOnceWith({ companyId: 'company', entityId: 'point', issueType: 'forecast_basis_missing', periodMonth: '2026-10-01' })
    expect(io.finding).not.toHaveBeenCalled()
  })

  it('records missing basis for only the evaluated month', async () => {
    const result = await calculateMeteringPointForecast({ companyId: 'company', meteringPointId: 'point', periodStart: '2026-10-01', periodEnd: '2026-11-01' })
    expect(result.method).toBe('missing_basis')
    expect(io.finding).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ companyId: 'company', entityId: 'point', issueType: 'forecast_basis_missing', periodMonth: '2026-10-01' }))
    expect(io.resolution).not.toHaveBeenCalled()
  })

  it('uses the canonical historical value before the legacy quantity fallback', async () => {
    io.canonicalHistory = [{ value_kwh: 120, quantity_kwh: 1 }]
    const result = await calculateMeteringPointForecast({ companyId: 'company', meteringPointId: 'point', periodStart: '2026-10-01', periodEnd: '2026-11-01' })
    expect(result.forecastKwh).toBe(120)
    expect(result.method).toBe('history')
    expect(io.resolution).toHaveBeenCalledOnce()
  })

  it('does not clear an issue when reading forecast evidence fails', async () => {
    io.valueError = true
    await expect(calculateMeteringPointForecast({ companyId: 'company', meteringPointId: 'point', periodStart: '2026-10-01', periodEnd: '2026-11-01' })).rejects.toMatchObject({ message: 'database_read_failed' })
    expect(io.resolution).not.toHaveBeenCalled()
    expect(io.finding).not.toHaveBeenCalled()
  })

  it.each([
    'relation metering_values does not exist',
    'column value_kwh does not exist',
    'Could not find the quantity_kwh column in the schema cache',
  ])('keeps existing basis findings when evidence fails with %s despite an annual estimate', async message => {
    io.valueError = message
    io.annualEstimate = 1200
    await expect(calculateMeteringPointForecast({ companyId: 'company', meteringPointId: 'point', periodStart: '2026-10-01', periodEnd: '2026-11-01' })).rejects.toMatchObject({ message })
    expect(io.resolution).not.toHaveBeenCalled()
    expect(io.finding).not.toHaveBeenCalled()
  })

  it('does not create an aggregate missing-zone issue before a physical meter exists', async () => {
    expect((await resolveBiddingZone({ companyId: 'company' })).source).toBe('unknown')
    expect(io.finding).not.toHaveBeenCalled()
  })

  it('reports missing bidding zone through the shared managed source identity', async () => {
    expect((await resolveBiddingZone({ companyId: 'company', meteringPointId: 'point' })).source).toBe('unknown')
    expect(io.finding).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ companyId: 'company', entityId: 'point', issueType: 'missing_bidding_zone' }))
  })
})
