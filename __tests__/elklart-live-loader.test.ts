import { expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }))
import { readDemoRows } from '@/lib/demo/elklartLiveData'

it('paginates without silently dropping rows and rejects database errors', async () => {
  const page = vi.fn().mockResolvedValueOnce({ data: Array(1000).fill({ id: 1 }), error: null, count: 1001 }).mockResolvedValueOnce({ data: [{ id: 2 }], error: null, count: 1001 })
  const rows = await readDemoRows(() => ({ range: page }))
  expect(rows).toHaveLength(1001)
  expect(page).toHaveBeenNthCalledWith(2, 1000, 1999)
  await expect(readDemoRows(() => ({ range: async () => ({ data: null, error: { message: 'private db detail' } }) }))).rejects.toThrow('demo_data_unavailable')
})
it('refuses an unbounded fixture result instead of publishing partial totals', async () => {
  await expect(readDemoRows(() => ({ range: async () => ({ data: [], error: null, count: 10_001 }) }))).rejects.toThrow('demo_data_limit')
})

it('honours a server row cap below the requested page size', async () => {
  const range = vi.fn().mockResolvedValueOnce({ data: Array(500).fill({}), error: null, count: 501 }).mockResolvedValueOnce({ data: [{}], error: null, count: 501 })
  expect(await readDemoRows(() => ({ range }))).toHaveLength(501)
  expect(range).toHaveBeenNthCalledWith(2, 500, 1499)
})

it('binds reads to the authenticated tenant and exact fixture identities', async () => {
  const { createSupabaseServerClient } = await import('@/lib/supabase/server')
  const { loadLiveDemoData } = await import('@/lib/demo/elklartLiveData')
  const companyId = '00000000-0000-0000-0000-000000000001'
  const customerId = '00000000-0000-0000-0000-000000000002'
  const pointId = '00000000-0000-0000-0000-000000000003'
  const calls: unknown[][] = []
  const from = (table: string) => {
    const query = {
      select: (...args: unknown[]) => { calls.push([table, 'select', ...args]); return query },
      eq: (...args: unknown[]) => { calls.push([table, 'eq', ...args]); return query },
      in: (...args: unknown[]) => { calls.push([table, 'in', ...args]); return query },
      order: () => query, lt: () => query, gt: () => query,
      range: async () => ({ error: null, count: table === 'metering_points' ? 1 : 0, data: table === 'metering_points' ? [{ id: pointId, company_id: companyId, customer_id: customerId, bidding_zone_code: 'SE4' }] : [] }),
    }
    return query
  }
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>)
  const result = await loadLiveDemoData(companyId, [{ profile: 'anna', customerId, meteringPointId: pointId }], '2026-11-10')
  expect(result).toMatchObject({ readings: [], supplies: [] })
  for (const table of ['metering_points', 'customer_supply_periods', 'metering_values']) expect(calls).toContainEqual([table, 'eq', 'company_id', companyId])
  for (const table of ['customer_supply_periods', 'metering_values']) {
    expect(calls).toContainEqual([table, 'in', 'customer_id', [customerId]])
    expect(calls).toContainEqual([table, 'in', 'metering_point_id', [pointId]])
  }
  expect(calls).toContainEqual(['metering_values', 'eq', 'is_current', true])
  await expect(loadLiveDemoData(companyId, [{ profile: 'anna', customerId: pointId, meteringPointId: pointId }], '2026-11-10')).rejects.toThrow('demo_binding_scope_mismatch')
})
