import { beforeEach, describe, expect, it, vi } from 'vitest'

type Point = {
  id: string
  customer_id: string | null
  site_id: string | null
  grid_owner_id: string | null
  bidding_zone_code: string | null
  source_customer: { company_id: string; source: string | null } | null
}
const company = '11111111-1111-4111-8111-111111111111'
const io = vi.hoisted(() => ({
  points: [] as Point[], cap: 1000, override: undefined as unknown,
  inventoryError: null as { message: string } | null,
  calls: [] as Array<{ name: string; args: Record<string, string> }>,
  rawLists: 0, inserts: [] as Array<Record<string, unknown>>, updates: [] as Array<Record<string, unknown>>,
  forecast: vi.fn(), build: vi.fn(),
}))
vi.mock('@/lib/forecasting/meteringPointForecast', async original => ({
  ...await original<typeof import('@/lib/forecasting/meteringPointForecast')>(), calculateMeteringPointForecast: io.forecast,
}))
vi.mock('@/lib/analytics/monthlyMetricsBuilder', () => ({ buildCompanyMonthlyMetrics: io.build }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  async rpc(name: string, args: Record<string, string>) {
    io.calls.push({ name, args })
    if (name === 'gridex_forecast_metering_period_totals_v1') return { data: [{ total_kwh: 0, value_count: 0 }], error: null }
    if (name !== 'gridex_forecast_point_inventory_v1') throw new Error('unexpected_rpc:' + name)
    if (io.inventoryError) return { data: null, error: io.inventoryError }
    return { data: io.override === undefined ? [{ points: [...io.points].sort((a, b) => a.id.localeCompare(b.id)), total_count: io.points.length }] : io.override, error: null }
  },
  from(table: string) {
    const response = () => {
      if (table === 'metering_points') {
        io.rawLists++
        // Explicit model of the configured list cap. The single-row RPC
        // is a declared port; its actual SQL is exercised in the sibling test.
        return { data: io.points.slice(0, io.cap), error: null }
      }
      return { data: null, error: null }
    }
    const query = {
      select: () => query, eq: () => query, in: () => query, limit: () => query,
      insert(value: Record<string, unknown>) { io.inserts.push(value); return query },
      update(value: Record<string, unknown>) { io.updates.push(value); return query },
      then(resolve: (value: ReturnType<typeof response>) => unknown) { return Promise.resolve(response()).then(resolve) },
    }
    return query
  },
} }))
import { generateForecastRunItems } from '@/lib/forecasting/forecastRuns'

const input = { companyId: company, forecastRunId: 'synthetic-run', periodStart: '2026-10-18' }
function point(index: number): Point {
  return { id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
    customer_id: null, site_id: null, grid_owner_id: null, bidding_zone_code: 'SE3', source_customer: null }
}
beforeEach(() => {
  io.points = []; io.cap = 1000; io.override = undefined; io.inventoryError = null
  io.calls = []; io.rawLists = 0; io.inserts = []; io.updates = []
  io.forecast.mockReset().mockResolvedValue({ forecastKwh: 100, confidenceScore: 95, method: 'history', issues: [] })
  io.build.mockReset().mockResolvedValue(undefined)
})

describe('complete company point inventory at the actual forecast producer', () => {
  it.each([0, 999, 1000, 1001, 10000])('processes exactly all %i selected points before completing the run', async count => {
    io.points = Array.from({ length: count }, (_, index) => point(index + 1)).reverse()
    expect(await generateForecastRunItems(input)).toEqual({ items: count, missing: 0 })
    expect(io.inserts.map(item => item.metering_point_id)).toEqual([...io.points].reverse().map(row => row.id))
    expect(io.forecast).toHaveBeenCalledTimes(count)
    expect(io.calls.filter(call => call.name === 'gridex_forecast_point_inventory_v1')).toEqual([
      { name: 'gridex_forecast_point_inventory_v1', args: { p_company_id: company } },
    ])
    expect(io.rawLists).toBe(0)
    expect(io.updates).toEqual([expect.objectContaining({ status: 'completed' })])
    expect(io.build).toHaveBeenCalledExactlyOnceWith(company, '2026-10-01')
  })

  it('does not depend on the raw API cap or replace the existing portal and orphan source policy', async () => {
    io.cap = 1
    io.points = [point(1), { ...point(2), customer_id: 'portal-customer', source_customer: { company_id: company, source: 'ediel_portal_test' } },
      { ...point(3), customer_id: 'real-customer', source_customer: { company_id: company, source: 'manual' } }]
    expect(await generateForecastRunItems(input)).toEqual({ items: 2, missing: 0 })
    expect(io.inserts.map(row => row.metering_point_id)).toEqual([point(1).id, point(3).id])
    expect(io.rawLists).toBe(0)
  })

  it('refuses more than 10000 points before any item, forecast or completion is produced', async () => {
    io.points = Array.from({ length: 10001 }, (_, index) => point(index + 1))
    await expect(generateForecastRunItems(input)).rejects.toThrow('forecast_point_inventory_result_invalid')
    expect(io.inserts).toEqual([]); expect(io.updates).toEqual([])
    expect(io.forecast).not.toHaveBeenCalled(); expect(io.build).not.toHaveBeenCalled()
  })

  it('propagates inventory dependency errors without a capped fallback or a healthy completion', async () => {
    io.points = [point(1)]; io.inventoryError = { message: 'inventory_unavailable' }
    await expect(generateForecastRunItems(input)).rejects.toMatchObject(io.inventoryError)
    expect(io.inserts).toEqual([]); expect(io.updates).toEqual([]); expect(io.rawLists).toBe(0)
    expect(io.forecast).not.toHaveBeenCalled(); expect(io.build).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'no row', rows: [] }, { label: 'null', rows: null },
    { label: 'two rows', rows: [{ points: [], total_count: 0 }, { points: [], total_count: 0 }] },
    { label: 'short list', rows: [{ points: [], total_count: 1 }] },
    { label: 'long list', rows: [{ points: [point(1)], total_count: 0 }] },
    { label: 'fractional count', rows: [{ points: [], total_count: 0.5 }] },
    { label: 'negative count', rows: [{ points: [], total_count: -1 }] },
    { label: 'null count', rows: [{ points: [], total_count: null }] },
    { label: 'invalid count', rows: [{ points: [], total_count: 'NaN' }] },
    { label: 'nonarray list', rows: [{ points: {}, total_count: 0 }] },
    { label: 'duplicate point', rows: [{ points: [point(1), point(1)], total_count: 2 }] },
    { label: 'unstable order', rows: [{ points: [point(2), point(1)], total_count: 2 }] },
    { label: 'invalid id', rows: [{ points: [{ ...point(1), id: null }], total_count: 1 }] },
    { label: 'invalid field', rows: [{ points: [{ ...point(1), customer_id: 42 }], total_count: 1 }] },
    { label: 'missing field', rows: [{ points: [{ id: point(1).id }], total_count: 1 }] },
    { label: 'foreign parent', rows: [{ points: [{ ...point(1), source_customer: { company_id: 'foreign', source: 'manual' } }], total_count: 1 }] },
    { label: 'invalid parent source', rows: [{ points: [{ ...point(1), source_customer: { company_id: company, source: 42 } }], total_count: 1 }] },
  ])('rejects $label evidence before producing partial results', async ({ rows }) => {
    io.points = [point(1)]; io.override = rows
    await expect(generateForecastRunItems(input)).rejects.toThrow('forecast_point_inventory_result_invalid')
    expect(io.inserts).toEqual([]); expect(io.updates).toEqual([])
    expect(io.forecast).not.toHaveBeenCalled(); expect(io.build).not.toHaveBeenCalled()
  })

  it('accepts a valid bigint count serialized as a decimal string', async () => {
    io.override = [{ points: [point(1)], total_count: '1' }]
    expect(await generateForecastRunItems(input)).toEqual({ items: 1, missing: 0 })
  })
})
