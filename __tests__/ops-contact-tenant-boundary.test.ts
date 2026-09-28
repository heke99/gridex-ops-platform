import { describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  mutations: [] as Array<{ table: string; kind: string; payload: Record<string, unknown>; filters: Array<[string, unknown]> }>,
  authorizedTenant: 'tenant-a',
  customerTenant: 'tenant-b',
  customerStatus: 'active',
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'actor-a' } } }) } }),
}))
vi.mock('@/lib/tenant/scope', () => ({
  assertUserCanOperateCompany: async (actor: string, company: string) => {
    if (actor !== 'actor-a' || company !== fixture.authorizedTenant) throw new Error('Forbidden')
    return company
  },
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      const filters: Array<[string, unknown]> = []
      const query = {
        select: () => query,
        eq: (field: string, value: unknown) => { filters.push([field, value]); return query },
        neq: () => query,
        update: (payload: Record<string, unknown>) => { fixture.mutations.push({ table, kind: 'update', payload, filters }); return query },
        insert: (payload: Record<string, unknown>) => { fixture.mutations.push({ table, kind: 'insert', payload, filters }); return query },
        maybeSingle: async () => ({ data: table === 'customers' ? { id: 'customer-b', company_id: fixture.customerTenant, status: fixture.customerStatus } : null, error: null }),
        single: async () => ({ data: { id: 'contact-b' }, error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
      }
      return query
    },
  },
}))

import { saveCustomerContactAction, saveCustomerAddressAction } from '@/components/admin/customers/CustomerContactsAddressesCard'

function form(fields: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

describe('OPS customer-card contact and address authorization', () => {
  it('denies a forged cross-tenant primary contact before any service-role write', async () => {
    fixture.mutations = []
    fixture.customerTenant = 'tenant-b'
    await expect(saveCustomerContactAction(form({ customer_id: 'customer-b', name: 'Example', is_primary: 'on' }))).rejects.toThrow('Forbidden')
    expect(fixture.mutations).toEqual([])
  })

  it('denies a forged cross-tenant address before any service-role write', async () => {
    fixture.mutations = []
    fixture.customerTenant = 'tenant-b'
    await expect(saveCustomerAddressAction(form({ customer_id: 'customer-b', street_1: 'Example' }))).rejects.toThrow('Forbidden')
    expect(fixture.mutations).toEqual([])
  })

  it('does not clear the existing primary contact when an unrelated contact ID is supplied', async () => {
    fixture.mutations = []
    fixture.customerTenant = 'tenant-a'
    await expect(saveCustomerContactAction(form({
      customer_id: 'customer-b', id: 'contact-from-another-customer', name: 'Example', is_primary: 'on',
    }))).rejects.toThrow('Forbidden')
    expect(fixture.mutations).toEqual([])
  })

  it('scopes each primary contact mutation to the authorized customer tenant', async () => {
    fixture.mutations = []
    fixture.customerTenant = 'tenant-a'
    await saveCustomerContactAction(form({ customer_id: 'customer-b', name: 'Example', is_primary: 'on', phone: '0700000000' }))
    expect(fixture.mutations.map((mutation) => `${mutation.table}.${mutation.kind}`)).toEqual([
      'customer_contacts.update', 'customer_contacts.insert', 'customers.update', 'audit_logs.insert',
    ])
    for (const mutation of fixture.mutations) {
      if (mutation.kind === 'update') expect(mutation.filters).toContainEqual(['company_id', 'tenant-a'])
      else expect(mutation.payload.company_id).toBe('tenant-a')
    }
  })

  it('scopes address insertion and audit to the authorized tenant', async () => {
    fixture.mutations = []
    fixture.customerTenant = 'tenant-a'
    await saveCustomerAddressAction(form({ customer_id: 'customer-b', street_1: 'Example' }))
    expect(fixture.mutations.map((mutation) => mutation.payload.company_id)).toEqual(['tenant-a', 'tenant-a'])
  })
})
