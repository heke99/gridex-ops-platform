import { beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  accounts: [] as Record<string, unknown>[],
  selected: [] as string[],
}))

vi.mock('react', () => ({ cache: <T>(fn: T) => fn }))
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('redirect') } }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user-a', email: 'a@example.test' } } }) } }),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      fixture.selected.push(table)
      const filters: Record<string, unknown> = {}
      const query = {
        select: () => query,
        eq: (field: string, value: unknown) => { filters[field] = value; return query },
        in: () => query,
        order: () => query,
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: rows(), error: null }),
      }
      function rows() {
        const source = table === 'customer_portal_accounts' ? fixture.accounts
          : table === 'customers' ? [{ id: 'customer-a', company_id: 'tenant-a', customer_number: 'C-10' }]
            : table === 'companies' ? [{ id: 'tenant-a', name: 'Tenant A' }] : []
        return source.filter((row) => Object.entries(filters).every(([field, value]) => row[field] === value))
      }
      return query
    },
  },
}))

import { getCustomerPortalContext } from '@/lib/customer-portal/db'

beforeEach(() => {
  fixture.accounts = []
  fixture.selected = []
})

it('does not load customer data for a non-active portal account with a stale is_active flag', async () => {
  fixture.accounts = [{
    customer_id: 'customer-a', company_id: 'tenant-a', user_id: 'user-a',
    status: 'disabled', is_active: true, activated_at: '2026-01-01T00:00:00Z',
  }]
  const context = await getCustomerPortalContext()
  expect(context.customerIds).toEqual([])
  expect(fixture.selected).toEqual(['customer_portal_accounts'])
})

it('retains the customer portal context for an active account', async () => {
  fixture.accounts = [{
    customer_id: 'customer-a', company_id: 'tenant-a', user_id: 'user-a',
    status: 'active', is_active: true, activated_at: '2026-01-01T00:00:00Z',
  }]
  const context = await getCustomerPortalContext()
  expect(context.companyId).toBe('tenant-a')
  expect(context.customerIds).toEqual(['customer-a'])
})
