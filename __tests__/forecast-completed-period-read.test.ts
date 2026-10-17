import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsFilters } from '@/lib/analytics/types'

type Row = Record<string, string | number | null>
const port = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  failures: {} as Record<string, { code: string; message: string }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => { throw new Error('Unexpected portfolio server-client read') },
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('http://127.0.0.1:54321', 'synthetic-unit-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        // The real SDK translates production query builders to this external
        // read port. Hand-authored table rows determine consumer-visible totals.
        fetch: async (input) => {
          const url = new URL(input instanceof Request ? input.url : String(input))
          const table = url.pathname.split('/').at(-1)!
          if (port.failures[table]) {
            return new Response(JSON.stringify(port.failures[table]), { status: 500 })
          }
          let rows = [...(port.tables[table] ?? [])]
          for (const [field, expression] of url.searchParams) {
            if (['select', 'order', 'limit'].includes(field)) continue
            const dot = expression.indexOf('.')
            const op = expression.slice(0, dot)
            const value = expression.slice(dot + 1)
            rows = rows.filter((row) => {
              const actual = row[field]
              if (actual === null || actual === undefined) return false
              if (op === 'eq') return String(actual) === value
              if (op === 'gt') return String(actual) > value
              if (op === 'gte') return String(actual) >= value
              if (op === 'lt') return String(actual) < value
              if (op === 'lte') return String(actual) <= value
              if (op === 'in') return value.slice(1, -1).split(',').includes(String(actual))
              throw new Error(`Unsupported test read operator: ${op}`)
            })
          }
          const order = url.searchParams.get('order')
          if (order) {
            const [field, direction] = order.split('.')
            rows.sort((a, b) => String(a[field]).localeCompare(String(b[field])) * (direction === 'desc' ? -1 : 1))
          }
          const limit = url.searchParams.get('limit')
          if (limit) rows = rows.slice(0, Number(limit))
          return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } })
        },
      },
    }),
  }
})

import { getLatestForecastByBiddingZone, getLatestForecastByGridOwner } from '@/lib/analytics/db'

const company = '11111111-1111-4111-8111-111111111111'
const otherCompany = '22222222-2222-4222-8222-222222222222'
const filters: AnalyticsFilters = { month: '2026-10-01' }

function run(id: string, status = 'completed', overrides: Partial<Row> = {}): Row {
  return {
    id, company_id: company, forecast_type: 'consumption', status,
    period_start: '2026-10-01', period_end: '2026-11-01',
    created_at: '2026-10-01T00:00:00Z', ...overrides,
  }
}

function item(runId: string, forecast: number, overrides: Partial<Row> = {}): Row {
  return {
    id: `item-${runId}-${forecast}`, company_id: company, forecast_run_id: runId,
    period_start: '2026-10-01', period_end: '2026-11-01',
    bidding_zone_code: 'SE3', grid_owner_id: 'owner-a', customer_id: 'customer-a',
    metering_point_id: 'point-a', forecast_kwh: forecast, actual_kwh: forecast - 10,
    diff_kwh: 10, diff_percent: 10, confidence_score: 80, method: 'historical',
    ...overrides,
  }
}

beforeEach(() => {
  port.failures = {}
  port.tables = {
    forecast_runs: [], forecast_run_items: [], bidding_zone_monthly_metrics: [],
    metering_points: [], customers: [],
    grid_owners: [{ id: 'owner-a', company_id: company, name: 'Synthetic owner' }],
  }
})

describe.each([
  { name: 'bidding zone', read: getLatestForecastByBiddingZone },
  { name: 'grid owner', read: getLatestForecastByGridOwner },
])('completed target-period forecast: $name', ({ name, read }) => {
  it.each(['running', 'failed'])('keeps the older completed run when the latest run is %s', async (status) => {
    port.tables.forecast_runs = [run('published'), run('newer', status, { created_at: '2026-10-02T00:00:00Z' })]
    port.tables.forecast_run_items = [item('published', 100), item('newer', 900)]
    expect(await read(company, filters)).toEqual([
      expect.objectContaining({ forecastKwh: 100, actualKwh: 90, confidenceScore: 80 }),
    ])
  })

  it('does not select the preceding run whose exclusive end equals the target month start', async () => {
    port.tables.forecast_runs = [
      run('covering'),
      run('ended', 'completed', {
        period_start: '2026-09-01', period_end: '2026-10-01', created_at: '2026-10-03T00:00:00Z',
      }),
    ]
    port.tables.forecast_run_items = [
      item('covering', 100), item('ended', 900, { period_start: '2026-09-01', period_end: '2026-10-01' }),
    ]
    expect(await read(company, filters)).toEqual([expect.objectContaining({ forecastKwh: 100 })])
  })

  it('reads only the target month of a multi-month run, including a non-first-day month input', async () => {
    port.tables.forecast_runs = [run('quarter', 'completed', { period_start: '2026-09-01', period_end: '2026-12-01' })]
    port.tables.forecast_run_items = [
      item('quarter', 10, { period_start: '2026-09-01', period_end: '2026-10-01' }),
      item('quarter', 20),
      item('quarter', 30, { period_start: '2026-11-01', period_end: '2026-12-01' }),
    ]
    expect(await read(company, { month: '2026-10-22' })).toEqual([
      expect.objectContaining({ forecastKwh: 20, actualKwh: 10 }),
    ])
  })

  it('keeps the whole-run policy rather than adding a missing point from an older run', async () => {
    port.tables.forecast_runs = [run('older'), run('latest', 'completed', { created_at: '2026-10-02T00:00:00Z' })]
    port.tables.forecast_run_items = [
      item('older', 300, { metering_point_id: 'point-b' }), item('latest', 100),
    ]
    expect(await read(company, filters)).toEqual([expect.objectContaining({ forecastKwh: 100 })])
  })

  it('keeps company isolation and existing point/customer/zone/owner filters', async () => {
    port.tables.forecast_runs = [
      run('own'), run('foreign', 'completed', { company_id: otherCompany, created_at: '2026-10-03T00:00:00Z' }),
      run('other-type', 'completed', { forecast_type: 'production', created_at: '2026-10-04T00:00:00Z' }),
    ]
    port.tables.forecast_run_items = [
      item('own', 100), item('own', 200, { metering_point_id: 'point-b' }),
      item('own', 300, { customer_id: 'customer-b' }), item('own', 400, { bidding_zone_code: 'SE4' }),
      item('own', 500, { grid_owner_id: 'owner-b' }),
      item('own', 600, { company_id: otherCompany }),
      item('foreign', 900, { company_id: otherCompany }), item('other-type', 800),
    ]
    port.tables.metering_points = [
      { id: 'point-a', company_id: company, status: 'active', metering_method: 'hourly' },
      { id: 'point-b', company_id: company, status: 'inactive', metering_method: 'hourly' },
    ]
    port.tables.customers = [
      { id: 'customer-a', company_id: company, customer_type: 'private' },
      { id: 'customer-b', company_id: company, customer_type: 'business' },
    ]
    expect(await read(company, {
      ...filters, status: 'active', meteringMethod: 'hourly', customerType: 'private',
      biddingZoneCode: 'SE3', gridOwnerId: 'owner-a',
    })).toEqual([expect.objectContaining({ forecastKwh: 100 })])
  })

  it('preserves the existing fallback when only unpublished runs cover the month', async () => {
    port.tables.forecast_runs = [run('unpublished', 'running')]
    port.tables.forecast_run_items = [item('unpublished', 900)]
    port.tables.bidding_zone_monthly_metrics = [{
      company_id: company, month: '2026-10-01', bidding_zone_code: 'SE3',
      forecast_kwh: 7, actual_kwh: 5, diff_kwh: 2, diff_percent: 28,
    }]
    const rows = await read(company, filters)
    expect(rows).toEqual(name === 'bidding zone' ? [expect.objectContaining({ forecastKwh: 7 })] : [])
  })

  it('does not replace an actual run transport failure with a forecast total', async () => {
    port.failures.forecast_runs = { code: '08006', message: 'Synthetic transport unavailable' }
    await expect(read(company, filters)).rejects.toMatchObject({ code: '08006' })
  })
})
