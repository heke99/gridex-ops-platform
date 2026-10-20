import { beforeEach, describe, expect, it, vi } from 'vitest'

type MeterValue = {
  company_id: string
  metering_point_id: string
  period_start: string
  value_kwh: number | null
  quantity_kwh: number | null
}
const company = '11111111-1111-4111-8111-111111111111'
const point = '22222222-2222-4222-8222-222222222222'
const io = vi.hoisted(() => ({
  rows: [] as MeterValue[], apiCap: 1000,
  rpcError: null as { message: string } | null,
  rpcErrorAt: 0,
  rpcOverride: undefined as unknown,
  rpcCalls: [] as Array<{ name: string; args: Record<string, string> }>,
  rawReads: 0,
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  resolve: vi.fn(), finding: vi.fn(), build: vi.fn(),
}))
vi.mock('@/lib/analytics/dataQuality', () => ({
  resolveManagedDataQualityIssue: io.resolve, upsertManagedDataQualityIssue: io.finding,
}))
vi.mock('@/lib/forecasting/consumptionProfiles', () => ({ getMonthlyWeightPercent: async () => 10 }))
vi.mock('@/lib/analytics/monthlyMetricsBuilder', () => ({
  buildCompanyMonthlyMetrics: io.build, hasCustomerAnalyticsData: async () => true,
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    const filters = new Map<string, unknown>()
    const response = () => {
      if (table === 'metering_points') return { data: [{
        id: '22222222-2222-4222-8222-222222222222', customer_id: null, site_id: null,
        grid_owner_id: null, bidding_zone_code: 'SE3', source_customer: null,
        estimated_annual_consumption_kwh: 0, consumption_profile_id: null,
        start_date: null, end_date: null, customer_sites: null,
      }], error: null }
      if (table === 'metering_values') {
        io.rawReads++
        const rows = io.rows.filter(row => row.company_id === filters.get('company_id')
          && row.metering_point_id === filters.get('metering_point_id')
          && Date.parse(row.period_start) >= Date.parse(String(filters.get('gte')))
          && Date.parse(row.period_start) < Date.parse(String(filters.get('lt'))))
        // Explicit model of the configured PostgREST cap. The RPC below
        // models the aggregate response; real SQL is proved in the sibling test.
        return { data: rows.slice(0, io.apiCap), error: null }
      }
      return { data: null, error: null }
    }
    const query = {
      select: () => query, in: () => query, limit: () => query,
      eq(column: string, value: unknown) { filters.set(column, value); return query },
      gte(_column: string, value: string) { filters.set('gte', value); return query },
      lt(_column: string, value: string) { filters.set('lt', value); return query },
      insert(value: Record<string, unknown>) { io.inserts.push(value); return query },
      update(value: Record<string, unknown>) { io.updates.push(value); return query },
      async maybeSingle() { const result = response(); return { ...result, data: result.data?.[0] ?? null } },
      then(resolve: (value: ReturnType<typeof response>) => unknown) { return Promise.resolve(response()).then(resolve) },
    }
    return query
  },
  async rpc(name: string, args: Record<string, string>) {
    if (name !== 'gridex_forecast_metering_period_totals_v1') throw new Error('unexpected_rpc:' + name)
    io.rpcCalls.push({ name, args })
    if (io.rpcError && (!io.rpcErrorAt || io.rpcCalls.length === io.rpcErrorAt)) return { data: null, error: io.rpcError }
    if (io.rpcOverride !== undefined) return { data: io.rpcOverride, error: null }
    const rows = io.rows.filter(row => row.company_id === args.p_company_id
      && row.metering_point_id === args.p_metering_point_id
      && Date.parse(row.period_start) >= Date.parse(args.p_period_start)
      && Date.parse(row.period_start) < Date.parse(args.p_period_end))
    return { data: [{ total_kwh: rows.reduce((sum, row) => sum + (row.value_kwh ?? row.quantity_kwh ?? 0), 0), value_count: rows.length }], error: null }
  },
} }))

import * as forecasting from '@/lib/forecasting/meteringPointForecast'
import { generateForecastRunItems } from '@/lib/forecasting/forecastRuns'
const forecastInput = { companyId: company, meteringPointId: point, periodStart: '2026-10-01', periodEnd: '2026-11-01' }
function quarters(count: number, start = '2025-10-01T00:00:00.000Z'): MeterValue[] {
  const instant = Date.parse(start)
  return Array.from({ length: count }, (_, index) => ({ company_id: company, metering_point_id: point,
    period_start: new Date(instant + index * 900_000).toISOString(), value_kwh: 1, quantity_kwh: 99 }))
}
function periodTotal(start: string, end: string) {
  const read = Reflect.get(forecasting, 'actualKwhForPeriod') as ((companyId: string, pointId: string, start: string, end: string) => Promise<number>) | undefined
  expect(read, 'both producers must share the complete scoped period reader').toBeTypeOf('function')
  return read!(company, point, start, end)
}

beforeEach(() => {
  io.rows = []; io.apiCap = 1000; io.rpcError = null; io.rpcErrorAt = 0; io.rpcOverride = undefined
  io.rpcCalls = []; io.rawReads = 0; io.inserts = []; io.updates = []
  io.resolve.mockReset().mockResolvedValue(undefined)
  io.finding.mockReset().mockResolvedValue(undefined)
  io.build.mockReset().mockResolvedValue(undefined)
})

describe('complete metering-period totals at the application boundary', () => {
  it.each([999, 1000, 1001, 2880])('uses all %i historical quarters without changing the history method or confidence', async count => {
    io.rows = quarters(count)
    expect(await forecasting.calculateMeteringPointForecast(forecastInput)).toMatchObject({
      forecastKwh: count, method: 'history', confidenceScore: 95, issues: [],
    })
    expect(io.rawReads).toBe(0)
    expect(io.rpcCalls).toEqual([{ name: 'gridex_forecast_metering_period_totals_v1', args: {
      p_company_id: company, p_metering_point_id: point,
      p_period_start: '2025-10-01T00:00:00.000Z', p_period_end: '2025-11-01T00:00:00.000Z',
    } }])
  })

  it.each([1001, 2880])('persists complete actual and forecast totals for %i quarters before completing the run', async count => {
    io.rows = [...quarters(count), ...quarters(count, '2026-10-01T00:00:00.000Z')]
    expect(await generateForecastRunItems({ companyId: company, forecastRunId: 'synthetic-run', periodStart: '2026-10-01' }))
      .toEqual({ items: 1, missing: 0 })
    expect(io.inserts).toEqual([expect.objectContaining({ company_id: company, metering_point_id: point,
      forecast_kwh: count, actual_kwh: count, diff_kwh: 0, confidence_score: 95 })])
    expect(io.updates).toEqual([expect.objectContaining({ status: 'completed' })])
    expect(io.rpcCalls).toHaveLength(2)
    expect(io.rawReads).toBe(0)
  })

  it.each([35040, 35136])('returns all %i annual quarters even when a raw-list cap is lower than the configured cap', async count => {
    io.rows = quarters(count, count === 35136 ? '2024-01-01T00:00:00.000Z' : '2025-01-01T00:00:00.000Z')
    io.apiCap = 137
    expect(await periodTotal(count === 35136 ? '2024-01-01' : '2025-01-01', count === 35136 ? '2025-01-01' : '2026-01-01')).toBe(count)
    expect(io.rpcCalls).toHaveLength(1)
    expect(io.rawReads).toBe(0)
  })

  it.each(['2026-03-01', '2026-10-01'])('preserves the existing UTC, inclusive-start/exclusive-end contract at %s', async start => {
    const end = start === '2026-03-01' ? '2026-04-01' : '2026-11-01'
    io.rows = quarters(1, start + 'T00:00:00.000Z')
    io.rows.push({ ...io.rows[0], period_start: new Date(Date.parse(start + 'T00:00:00.000Z') - 1).toISOString(), value_kwh: 100 },
      { ...io.rows[0], period_start: end + 'T00:00:00.000Z', value_kwh: 200 },
      { ...io.rows[0], company_id: 'foreign-company', value_kwh: 300 },
      { ...io.rows[0], metering_point_id: 'foreign-point', value_kwh: 400 })
    expect(await periodTotal(start, end)).toBe(1)
    expect(io.rpcCalls[0].args).toEqual({ p_company_id: company, p_metering_point_id: point,
      p_period_start: start + 'T00:00:00.000Z', p_period_end: end + 'T00:00:00.000Z' })
  })

  it('keeps zero canonical values and uses the quantity fallback only for NULL', async () => {
    io.rows = quarters(3)
    Object.assign(io.rows[0], { value_kwh: 120, quantity_kwh: 1 })
    Object.assign(io.rows[1], { value_kwh: 0, quantity_kwh: 99 })
    Object.assign(io.rows[2], { value_kwh: null, quantity_kwh: 20 })
    expect(await forecasting.calculateMeteringPointForecast(forecastInput)).toMatchObject({ forecastKwh: 140, method: 'history' })
  })

  it('keeps successful empty history as missing basis rather than inventing consumption', async () => {
    expect(await forecasting.calculateMeteringPointForecast(forecastInput)).toMatchObject({ forecastKwh: null, method: 'missing_basis', confidenceScore: 0 })
    expect(io.rpcCalls).toHaveLength(3)
    expect(io.finding).toHaveBeenCalledOnce()
    expect(io.resolve).not.toHaveBeenCalled()
  })

  it('propagates an aggregate error without a capped fallback or healthy basis marker', async () => {
    io.rows = quarters(2880); io.rpcError = { message: 'aggregate_unavailable' }
    await expect(forecasting.calculateMeteringPointForecast(forecastInput)).rejects.toMatchObject(io.rpcError)
    expect(io.rawReads).toBe(0)
    expect(io.resolve).not.toHaveBeenCalled()
    expect(io.finding).not.toHaveBeenCalled()
  })

  it('stops before item insertion and completion if actual-period evidence fails', async () => {
    io.rows = quarters(1001); io.rpcError = { message: 'actual_aggregate_unavailable' }; io.rpcErrorAt = 2
    await expect(generateForecastRunItems({ companyId: company, forecastRunId: 'synthetic-run', periodStart: '2026-10-01' }))
      .rejects.toMatchObject(io.rpcError)
    expect(io.inserts).toEqual([]); expect(io.updates).toEqual([]); expect(io.build).not.toHaveBeenCalled()
  })

  it.each([
    { result: [] }, { result: [{ total_kwh: 1, value_count: 1 }, { total_kwh: 2, value_count: 1 }] },
    { result: [{ total_kwh: null, value_count: 0 }] }, { result: [{ total_kwh: 'NaN', value_count: 1 }] },
    { result: [{ total_kwh: 1, value_count: -1 }] }, { result: [{ total_kwh: 1, value_count: 0 }] },
    { result: [{ total_kwh: 1, value_count: 0.5 }] },
  ])('rejects malformed or inconsistent aggregate result $result', async ({ result }) => {
    io.rpcOverride = result
    await expect(forecasting.calculateMeteringPointForecast(forecastInput)).rejects.toThrow('forecast_metering_period_totals_result_invalid')
    expect(io.resolve).not.toHaveBeenCalled(); expect(io.finding).not.toHaveBeenCalled()
  })

  it('accepts finite numeric JSON strings without losing negative or decimal totals', async () => {
    io.rpcOverride = [{ total_kwh: '-12.25', value_count: '2' }]
    expect(await periodTotal('2026-10-01', '2026-11-01')).toBe(-12.25)
  })
})
