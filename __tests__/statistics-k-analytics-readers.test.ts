// reality-defects: K-11 K-12 F101 (scenario K: statistics are computed and shown correctly)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ tables: {} as Record<string, Array<Record<string, unknown>>>, rpc: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ rpc: io.rpc }) }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    rpc: io.rpc,
    from: (table: string) => {
      const filters: Array<(row: Record<string, unknown>) => boolean> = []
      const query: Record<string, unknown> = {}
      const chain = (name: string, apply?: (...args: unknown[]) => void) => { query[name] = (...args: unknown[]) => { apply?.(...args); return query } }
      chain('select'); chain('order'); chain('limit'); chain('lt'); chain('gte'); chain('lte'); chain('or'); chain('not')
      chain('eq', (column, value) => filters.push(row => row[column as string] === value))
      chain('is', (column, value) => filters.push(row => (row[column as string] ?? null) === value))
      chain('in', (column, values) => filters.push(row => (values as unknown[]).includes(row[column as string])))
      chain('gt', (column, value) => filters.push(row => String(row[column as string]) > String(value)))
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: (io.tables[table] ?? []).filter(row => filters.every(f => f(row))), error: null }).then(resolve)
      return query
    },
  },
}))

import { getOverviewBreakdowns } from '@/lib/analytics/db'
import { getActiveCustomerCounts } from '@/lib/analytics/customerPortfolio'
import { monthStart, stockholmToday } from '@/lib/analytics/utils'

beforeEach(() => { io.tables = {}; io.rpc.mockReset() })
afterEach(() => { vi.useRealTimers() })

describe('scenario K: analytics readers', () => {
  it('K-12 the default month and "today" are Swedish: 1 November 00:30 is November, not October', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-31T23:30:00Z'))
    expect(stockholmToday()).toBe('2026-11-01')
    expect(monthStart()).toBe('2026-11-01')
    expect(monthStart('2026-10-15')).toBe('2026-10-01')
    io.rpc.mockResolvedValue({ data: [], error: null })
    await getActiveCustomerCounts(['company'])
    expect(io.rpc).toHaveBeenCalledWith('gridex_customer_portfolio_active_counts', { p_company_ids: ['company'], p_at: '2026-11-01' })
  })

  it('K-11 the SE-area distribution shows metering points; a zone without points is 0, not its forecast kWh', async () => {
    io.tables.bidding_zone_monthly_metrics = [
      { company_id: 'k', month: '2026-10-01', bidding_zone_code: 'SE3', metering_points_count: 2, forecast_kwh: 900 },
      { company_id: 'k', month: '2026-10-01', bidding_zone_code: 'SE4', metering_points_count: 0, forecast_kwh: 12_345 },
    ]
    const { biddingZones } = await getOverviewBreakdowns('k', '2026-10-01')
    expect(biddingZones.map(zone => [zone.label, zone.value])).toEqual([['SE3', 2], ['SE4', 0]])
  })

  it('F101 a shared registry grid owner the tenant\'s points name is shown by name; another tenant\'s grid owner never', async () => {
    io.tables.grid_owner_monthly_metrics = [
      { company_id: 'k', month: '2026-10-01', grid_owner_id: 'own', metering_values_missing: 3 },
      { company_id: 'k', month: '2026-10-01', grid_owner_id: 'shared', metering_values_missing: 2 },
      { company_id: 'k', month: '2026-10-01', grid_owner_id: 'foreign', metering_values_missing: 1 },
    ]
    io.tables.grid_owners = [
      { id: 'own', company_id: 'k', name: 'Egen Nät AB' },
      { id: 'shared', company_id: null, name: 'Delad Nät AB' },
      { id: 'foreign', company_id: 'other', name: 'Annan Tenants Nät AB' },
    ]
    const { missingByGridOwner } = await getOverviewBreakdowns('k', '2026-10-01')
    expect(missingByGridOwner.map(row => [row.key, row.label])).toEqual([
      ['own', 'Egen Nät AB'], ['shared', 'Delad Nät AB'], ['foreign', 'Saknad nätägare']])
  })
})
