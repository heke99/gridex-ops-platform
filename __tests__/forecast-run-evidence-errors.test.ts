import { beforeEach, expect, it, vi } from 'vitest'

type DatabaseError = { message: string } | null
const io = vi.hoisted(() => ({
  actualError: null as DatabaseError,
  completionError: null as DatabaseError,
  itemError: null as DatabaseError,
  rows: [] as Array<{ value_kwh: number | null; quantity_kwh: number | null }>,
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  filters: [] as Array<{ table: string; column: string; value: unknown }>,
  rpcCalls: [] as Array<{ name: string; args: Record<string, string> }>,
  forecast: vi.fn(),
  build: vi.fn(),
}))

vi.mock('@/lib/forecasting/meteringPointForecast', async original => ({
  ...await original<typeof import('@/lib/forecasting/meteringPointForecast')>(), calculateMeteringPointForecast: io.forecast,
}))
vi.mock('@/lib/analytics/monthlyMetricsBuilder', () => ({ buildCompanyMonthlyMetrics: io.build }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  async rpc(name: string, args: Record<string, string>) {
    if (name !== 'gridex_forecast_metering_period_totals_v1') throw new Error('unexpected_rpc:' + name)
    io.rpcCalls.push({ name, args })
    return { data: [{ total_kwh: io.rows.reduce((sum, row) => sum + Number(row.value_kwh ?? row.quantity_kwh ?? 0), 0), value_count: io.rows.length }], error: io.actualError }
  },
  from(table: string) {
    const response = () => ({
      data: table === 'metering_points'
        ? [{ id: 'point', customer_id: 'customer', site_id: 'site', grid_owner_id: 'owner', bidding_zone_code: 'SE3' }]
        : table === 'metering_values' ? io.rows : null,
      error: table === 'metering_values' ? io.actualError : table === 'forecast_runs' ? io.completionError : table === 'forecast_run_items' ? io.itemError : null,
    })
    const query = {
      select: () => query,
      in: () => query,
      limit: () => query,
      gte: () => query,
      lt: () => query,
      eq(column: string, value: unknown) { io.filters.push({ table, column, value }); return query },
      insert(payload: Record<string, unknown>) { io.inserts.push(payload); return query },
      update(payload: Record<string, unknown>) { io.updates.push(payload); return query },
      then(resolve: (value: ReturnType<typeof response>) => unknown) { return Promise.resolve(response()).then(resolve) },
    }
    return query
  },
} }))

import { generateForecastRunItems } from '@/lib/forecasting/forecastRuns'
const input = { companyId: 'company', forecastRunId: 'run', periodStart: '2026-09-18' }

beforeEach(() => {
  io.actualError = null
  io.completionError = null
  io.itemError = null
  io.rows = []
  io.inserts = []
  io.updates = []
  io.filters = []
  io.rpcCalls = []
  io.forecast.mockReset().mockResolvedValue({ forecastKwh: 100, confidenceScore: 1, method: 'history', issues: [] })
  io.build.mockReset().mockResolvedValue(undefined)
})

it('rejects actual evidence errors before inserting a false zero or completing a run', async () => {
  io.actualError = { message: 'actual_evidence_unavailable' }
  await expect(generateForecastRunItems(input)).rejects.toMatchObject(io.actualError)
  expect(io.inserts).toEqual([])
  expect(io.updates).toEqual([])
  expect(io.build).not.toHaveBeenCalled()
})

it('rejects completion-write errors without building a healthy monthly rollup', async () => {
  io.completionError = { message: 'completion_write_failed' }
  await expect(generateForecastRunItems(input)).rejects.toMatchObject(io.completionError)
  expect(io.inserts).toHaveLength(1)
  expect(io.build).not.toHaveBeenCalled()
})

it('uses canonical values including zero, falling back to legacy quantities only for null values', async () => {
  io.rows = [{ value_kwh: 120, quantity_kwh: 1 }, { value_kwh: 0, quantity_kwh: 99 }, { value_kwh: null, quantity_kwh: 20 }]
  expect(await generateForecastRunItems(input)).toEqual({ items: 1, missing: 0 })
  expect(io.inserts).toEqual([expect.objectContaining({ company_id: 'company', forecast_run_id: 'run', actual_kwh: 140, diff_kwh: 40, diff_percent: 40 })])
  expect(io.filters).toEqual(expect.arrayContaining([
    { table: 'forecast_runs', column: 'company_id', value: 'company' },
    { table: 'forecast_runs', column: 'id', value: 'run' },
  ]))
  expect(io.rpcCalls).toEqual([{ name: 'gridex_forecast_metering_period_totals_v1', args: {
    p_company_id: 'company', p_metering_point_id: 'point',
    p_period_start: '2026-09-01T00:00:00.000Z', p_period_end: '2026-10-01T00:00:00.000Z',
  } }])
  expect(io.build).toHaveBeenCalledExactlyOnceWith('company', '2026-09-01')
})

it('retains item-write failure behavior without marking the run completed', async () => {
  io.itemError = { message: 'item_write_failed' }
  await expect(generateForecastRunItems(input)).rejects.toMatchObject(io.itemError)
  expect(io.updates).toEqual([])
  expect(io.build).not.toHaveBeenCalled()
})
