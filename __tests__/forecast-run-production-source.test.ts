import { beforeEach, expect, it, vi } from 'vitest'

type Point = {
  id: string
  customer_id: string | null
  site_id: string | null
  grid_owner_id: string | null
  bidding_zone_code: string | null
  source_customer: { company_id: string; source: string | null } | Array<{ company_id: string; source: string | null }> | null
}
const io = vi.hoisted(() => ({
  hasData: vi.fn(), forecast: vi.fn(), build: vi.fn(), audit: vi.fn(),
  points: [] as Point[], inserts: [] as Array<{ table: string; payload: Record<string, unknown> }>,
  reads: [] as Array<{ table: string; fields: string }>,
  filters: [] as Array<{ table: string; column: string; value: unknown }>,
  inventoryCalls: [] as Array<{ name: string; args: Record<string, string> }>,
}))
vi.mock('@/lib/analytics/monthlyMetricsBuilder', () => ({
  hasCustomerAnalyticsData: io.hasData, buildCompanyMonthlyMetrics: io.build,
}))
vi.mock('@/lib/forecasting/meteringPointForecast', async original => ({
  ...await original<typeof import('@/lib/forecasting/meteringPointForecast')>(), calculateMeteringPointForecast: io.forecast,
}))
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminAccess: async () => ({ userId: 'admin' }) }))
vi.mock('@/lib/analytics/cron', () => ({ listAnalyticsCompanyIds: async () => ['empty', 'real'] }))
vi.mock('@/lib/analytics/dataQuality', () => ({ scanCompanyDataQuality: vi.fn() }))
vi.mock('@/lib/audit/actionLogger', () => ({ logAdminActionAndUsage: io.audit }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  async rpc(name: string, args: Record<string, string>) {
    if (name === 'gridex_forecast_point_inventory_v1') {
      io.inventoryCalls.push({ name, args })
      return { data: [{ points: [...io.points].sort((a, b) => a.id.localeCompare(b.id)), total_count: io.points.length }], error: null }
    }
    if (name !== 'gridex_forecast_metering_period_totals_v1') throw new Error('unexpected_rpc:' + name)
    return { data: [{ total_kwh: 0, value_count: 0 }], error: null }
  },
  from(table: string) {
    const response = () => ({ data: table === 'metering_points' ? io.points : [], error: null })
    const query = {
      select(fields: string) { io.reads.push({ table, fields }); return query },
      in: () => query, limit: () => query, gte: () => query, lt: () => query,
      eq(column: string, value: unknown) { io.filters.push({ table, column, value }); return query },
      insert(payload: Record<string, unknown>) { io.inserts.push({ table, payload }); return query },
      update: () => query,
      single: async () => ({ data: { id: 'new-run' }, error: null }),
      then(resolve: (value: ReturnType<typeof response>) => unknown) { return Promise.resolve(response()).then(resolve) },
    }
    return query
  },
} }))

import { generateForecastRunItems, runCompanyForecast } from '@/lib/forecasting/forecastRuns'
import { runCompanyForecastAction, runPlatformForecastAction } from '@/app/admin/platform/analytics/actions'

const input = { companyId: 'real', periodStart: '2026-10-18' }
function point(id: string, source: string | null = null, customerCompany = 'real'): Point {
  return { id, customer_id: 'customer-' + id, site_id: null, grid_owner_id: null, bidding_zone_code: 'SE1',
    source_customer: { company_id: customerCompany, source } }
}
beforeEach(() => {
  io.hasData.mockReset().mockImplementation(async (companyId: string) => companyId !== 'empty')
  io.forecast.mockReset().mockResolvedValue({ forecastKwh: 100, confidenceScore: 1, method: 'history', issues: [] })
  io.build.mockReset().mockResolvedValue(undefined)
  io.audit.mockReset().mockResolvedValue(undefined)
  io.points = [point('normal')]
  io.inserts = []; io.reads = []; io.filters = []; io.inventoryCalls = []
})

it('skips an empty or portal-test-only company before inserting a forecast run', async () => {
  io.hasData.mockResolvedValue(false)
  await expect(runCompanyForecast(input)).rejects.toMatchObject({ name: 'ForecastRunSkippedError', reason: 'no_customer_data' })
  expect(io.hasData).toHaveBeenCalledExactlyOnceWith('real')
  expect(io.inserts).toEqual([])
  expect(io.forecast).not.toHaveBeenCalled()
  expect(io.build).not.toHaveBeenCalled()
})

it('propagates source-gate read failures before creating an apparently healthy run', async () => {
  io.hasData.mockRejectedValue(new Error('customer_source_unavailable'))
  await expect(runCompanyForecast(input)).rejects.toThrow('customer_source_unavailable')
  expect(io.inserts).toEqual([])
})

it('forecasts real and orphan sources in a mixed company while excluding its portal-test point', async () => {
  io.points = [point('normal'), point('portal', 'ediel_portal_test'), { ...point('orphan'), customer_id: null, source_customer: null }]
  expect(await runCompanyForecast(input)).toEqual({ forecastRunId: 'new-run', items: 2, missing: 0 })
  expect(io.forecast.mock.calls.map(([value]) => value.meteringPointId)).toEqual(['normal', 'orphan'])
  expect(io.inserts.filter(value => value.table === 'forecast_run_items').map(value => value.payload.metering_point_id)).toEqual(['normal', 'orphan'])
  // The actual forward's composite-parent join is exercised by the SQL test;
  // the producer now requests the complete company snapshot through its RPC.
  expect(io.inventoryCalls).toEqual([{ name: 'gridex_forecast_point_inventory_v1', args: { p_company_id: 'real' } }])
  expect(io.reads).not.toContainEqual({ table: 'metering_points', fields: expect.any(String) })
})

it('also excludes portal-test points from direct item generation without changing its return shape', async () => {
  io.points = [point('portal', 'ediel_portal_test'), point('normal')]
  expect(await generateForecastRunItems({ ...input, forecastRunId: 'existing-run' })).toEqual({ items: 1, missing: 0 })
  expect(io.forecast).toHaveBeenCalledExactlyOnceWith({ companyId: 'real', meteringPointId: 'normal', periodStart: '2026-10-01', periodEnd: '2026-11-01' })
})

it('handles an empty-company skip through the actual company platform action', async () => {
  const form = new FormData(); form.set('companyId', 'empty')
  await expect(runCompanyForecastAction(form)).resolves.toBeUndefined()
  expect(io.inserts).toEqual([])
  expect(io.audit).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'empty', metadata: expect.objectContaining({ skipped: 'no_customer_data' }) }))
})

it('continues the actual platform action after an empty company and records its skip', async () => {
  await expect(runPlatformForecastAction()).resolves.toBeUndefined()
  expect(io.inserts.filter(value => value.table === 'forecast_runs')).toEqual([
    { table: 'forecast_runs', payload: expect.objectContaining({ company_id: 'real', created_by: 'admin' }) },
  ])
  expect(io.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ companyCount: 2, skippedCompanyCount: 1 }) }))
})

it('does not silently skip an unexpected producer failure in a platform action', async () => {
  io.hasData.mockRejectedValue(new Error('source_database_failed'))
  const form = new FormData(); form.set('companyId', 'real')
  await expect(runCompanyForecastAction(form)).rejects.toThrow('source_database_failed')
  expect(io.audit).not.toHaveBeenCalled()
})

it('accepts an array-shaped embedded customer while preserving the same company source rule', async () => {
  io.points = [{ ...point('portal'), source_customer: [{ company_id: 'real', source: 'ediel_portal_test' }] },
    { ...point('normal'), source_customer: [{ company_id: 'real', source: 'manual' }] }]
  expect(await runCompanyForecast(input)).toEqual({ forecastRunId: 'new-run', items: 1, missing: 0 })
  expect(io.forecast.mock.calls.map(([value]) => value.meteringPointId)).toEqual(['normal'])
})
