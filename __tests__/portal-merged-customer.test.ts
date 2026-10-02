import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalPortalCustomer, portalCustomerCanLink } from '@/lib/customer-portal/customerLifecycle'

const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, company_id: 'tenant-a', status: 'active', ...extra })

const state = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, writes: [] as string[] }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => {
    const filters: Array<(row: Record<string, unknown>) => boolean> = []
    const data = () => (state.tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)))
    const query = {
      select: () => query,
      eq: (field: string, value: unknown) => { filters.push((row) => row[field] === value); return query },
      not: () => query,
      limit: () => query,
      order: () => query,
      insert: () => { state.writes.push(table); return query },
      update: () => { state.writes.push(table); return query },
      upsert: () => { state.writes.push(table); return query },
      maybeSingle: async () => ({ data: data()[0] ?? null, error: null }),
      single: async () => ({ data: data()[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: data(), error: null }),
    }
    return query
  },
  rpc: async () => ({ data: [], error: null }),
} }))

const user = '20000000-0000-4000-8000-000000000001'
const client = { id: 'client-a', company_id: 'tenant-a' } as import('@/lib/integrations/apiAuth').IntegrationApiClient

describe('real resolver uses merged customer identity for support/profile', () => {
  beforeEach(() => {
    process.env.GRIDEX_PORTAL_IDENTITY_ENFORCEMENT = 'enforce'
    state.writes = []
    state.tables = {
      customers: [row('source', { status: 'inactive', customer_number: 'OLD', merged_into_customer_id: 'primary' }), row('primary', { customer_number: 'CURRENT' })],
      customer_portal_accounts: [{ id: 'account', company_id: 'tenant-a', customer_id: 'source', portal_user_id: user, status: 'active', is_active: true }],
      customer_profiles: [{ company_id: 'tenant-a', customer_id: 'primary', user_id: user, full_name: 'Canonical profile' }],
    }
  })
  afterEach(() => { delete process.env.GRIDEX_PORTAL_IDENTITY_ENFORCEMENT })

  it('returns primary customer ID and canonical profile without changing portal bindings on read', async () => {
    const { resolvePortalCustomer } = await import('@/lib/customer-portal/customerResolver')
    const result = await resolvePortalCustomer({ client, strict: true, identifiers: { externalCustomerId: null, customerNumber: null, email: null, authUserId: user, customerPortalUserId: user } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.customer.customer_id).toBe('primary')
    expect(result.customer.customer_number).toBe('CURRENT')
    expect(result.customer.customer.full_name).toBe('Canonical profile')
    expect(state.writes).toEqual([])
  })

  it('refuses new direct links to a stale merged customer ID', async () => {
    const { ensureCustomerPortalUserLink } = await import('@/lib/customer-portal/customerResolver')
    const result = await ensureCustomerPortalUserLink({ client, customerId: 'source', userId: user }).catch(() => null)
    expect(result).toBeNull()
    expect(state.writes).toEqual([])
  })

  it('exposes the canonical number even after the account has already been moved', async () => {
    state.tables.customer_portal_accounts[0].customer_id = 'primary'
    state.tables.customer_portal_accounts[0].customer_number = 'OLD'
    const { resolvePortalCustomer } = await import('@/lib/customer-portal/customerResolver')
    const result = await resolvePortalCustomer({ client, strict: true, identifiers: { externalCustomerId: null, customerNumber: null, email: null, authUserId: user, customerPortalUserId: user } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.customer.customer_number).toBe('CURRENT')
    expect(state.tables.customer_portal_accounts[0].customer_number).toBe('OLD')
  })

  it('does not redirect an identifier-only caller through another user\'s existing alias', async () => {
    const { resolvePortalCustomer } = await import('@/lib/customer-portal/customerResolver')
    const result = await resolvePortalCustomer({ client, identifiers: { externalCustomerId: null, customerNumber: 'OLD', email: null, authUserId: null, customerPortalUserId: null } })
    expect(result.ok).toBe(false)
    expect(state.writes).toEqual([])
  })
})

describe('portal merged customer lifecycle', () => {
  it('returns the actual surviving customer for a verified source binding', async () => {
    const primary = row('primary')
    const result = await canonicalPortalCustomer({ companyId: 'tenant-a', customer: row('source', { status: 'inactive', merged_into_customer_id: 'primary' }), allowMergedAlias: true, load: async () => primary })
    expect(result).toBe(primary)
  })

  it('never grants first-link access using an archived alias', async () => {
    let loads = 0
    const result = await canonicalPortalCustomer({ companyId: 'tenant-a', customer: row('source', { merged_into_customer_id: 'primary' }), allowMergedAlias: false, load: async () => { loads += 1; return row('primary') } })
    expect(result).toBeNull()
    expect(loads).toBe(0)
    expect(portalCustomerCanLink(row('source', { merged_into_customer_id: 'primary' }))).toBe(false)
  })

  it.each([
    ['cross-tenant', row('primary', { company_id: 'tenant-b' })],
    ['archived target', row('primary', { status: 'archived' })],
    ['missing target', null],
    ['cyclic target', row('source', { merged_into_customer_id: 'source' })],
  ])('rejects %s without returning another customer', async (_label, target) => {
    const result = await canonicalPortalCustomer({ companyId: 'tenant-a', customer: row('source', { merged_into_customer_id: 'primary' }), allowMergedAlias: true, load: async () => target })
    expect(result).toBeNull()
  })

  it('bounds malformed long merge chains', async () => {
    let loads = 0
    const result = await canonicalPortalCustomer({ companyId: 'tenant-a', customer: row('0', { merged_into_customer_id: '1' }), allowMergedAlias: true, load: async (id) => { loads += 1; return row(id, { merged_into_customer_id: String(Number(id) + 1) }) } })
    expect(result).toBeNull()
    expect(loads).toBe(8)
  })
})
