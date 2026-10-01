import { beforeEach, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, queries: [] as Array<{ table: string; select: string; filters: Record<string, unknown> }> }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/tenant/scope', () => ({ isMissingRelationError: () => false }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => {
    const captured = { table, select: '', filters: {} as Record<string, unknown> }; f.queries.push(captured)
    const q = { select: (fields: string) => { captured.select = fields; return q }, eq: (key: string, value: unknown) => { captured.filters[key] = value; return q },
      not: () => q, or: () => q, order: () => q, range: () => q, limit: () => q, in: () => q,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === 'customers' ? f.rows.map(row => Object.fromEntries(captured.select.split(',').map(key => key.trim()).map(key => [key, row[key]]))) : [], error: null, count: f.rows.length }).then(resolve) }
    return q
  }, rpc: () => ({ single: async () => ({ data: { all_count: f.rows.length }, error: null }) }),
} }))
import { listCustomersPage } from '@/lib/customers/getCustomers'
beforeEach(() => { f.rows = [{ id: 'customer-a', company_id: 'company-a', first_name: 'Synthetic', billing_profile_revision: 3 }]; f.queries = [] })
it.each(['paged', 'search'] as const)('actual %s loader selects and preserves current billing revision with exact tenant filter', async kind => {
  const result = await listCustomersPage({ companyId: 'company-a', query: kind === 'search' ? 'Synthetic' : '' })
  expect(result.rows[0]).toMatchObject({ id: 'customer-a', billing_profile_revision: 3 })
  const query = f.queries.find(query => query.table === 'customers')!
  expect(query.select.split(',')).toContain('billing_profile_revision'); expect(query.filters.company_id).toBe('company-a')
})
it.each([null, undefined, -1, 1.5, '3', Number.MAX_SAFE_INTEGER + 1])('actual loader preserves unavailable revision for %s instead of inventing zero', async revision => {
  f.rows[0].billing_profile_revision = revision
  expect((await listCustomersPage({ companyId: 'company-a' })).rows[0]).toMatchObject({ billing_profile_revision: null })
})
it('actual loader preserves legitimate initial revision zero', async () => {
  f.rows[0].billing_profile_revision = 0
  expect((await listCustomersPage({ companyId: 'company-a' })).rows[0]).toMatchObject({ billing_profile_revision: 0 })
})
