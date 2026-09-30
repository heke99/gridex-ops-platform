import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  mutations: [] as Array<{ table: string; kind: string; payload: Record<string, unknown>; filters: Array<[string, unknown]> }>,
  authorizedTenant: 'tenant-a',
  selectedTenant: 'tenant-a',
  customerTenant: 'tenant-b',
  customerStatus: 'active',
  commands: [] as Array<Record<string, unknown>>,
  commandRevision: 7,
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminActionAccess: async () => ({ userId: 'actor-a', companyId: fixture.selectedTenant, isPlatformAdmin: false }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'actor-a' } } }) } }),
}))
vi.mock('@/lib/tenant/scope', () => ({
  assertUserCanOperateCompany: async (actor: string, company: string) => {
    if (actor !== 'actor-a' || company !== fixture.authorizedTenant) throw new Error('Forbidden')
    return company
  },
}))
vi.mock('@/lib/customer-operations/contactCommand', () => ({
  changeCustomerContact: async (input: Record<string, unknown>) => {
    fixture.commands.push(input)
    if (input.expectedRevision !== fixture.commandRevision) throw new Error('contact_revision_conflict')
    return { revision: 1, changed: true, replayed: false }
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
  beforeEach(() => {
    fixture.mutations = []
    fixture.authorizedTenant = 'tenant-a'
    fixture.selectedTenant = 'tenant-a'
    fixture.customerTenant = 'tenant-b'
    fixture.customerStatus = 'active'
    fixture.commands = []
    fixture.commandRevision = 7
  })
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

  it('does not reuse a write permission from selected tenant A for a member of tenant B', async () => {
    fixture.mutations = []
    fixture.customerTenant = 'tenant-b'
    fixture.authorizedTenant = 'tenant-b'
    fixture.selectedTenant = 'tenant-a'
    await expect(saveCustomerContactAction(form({ customer_id: 'customer-b', name: 'Example', is_primary: 'on' }))).rejects.toThrow('Forbidden')
    expect(fixture.mutations).toEqual([])
    fixture.authorizedTenant = 'tenant-a'
  })

  it('does not clear the existing primary contact when an unrelated contact ID is supplied', async () => {
    fixture.mutations = []
    fixture.customerTenant = 'tenant-a'
    await expect(saveCustomerContactAction(form({
      customer_id: 'customer-b', id: 'contact-from-another-customer', name: 'Example', is_primary: 'on',
    }))).rejects.toThrow('Forbidden')
    expect(fixture.mutations).toEqual([])
  })

  it('passes the verified actor, tenant and displayed revision to one primary contact command', async () => {
    fixture.mutations = []
    fixture.customerTenant = 'tenant-a'
    await saveCustomerContactAction(form({
      customer_id: 'customer-b', name: 'Example', is_primary: 'on', phone: '0700000000',
      expected_revision: '7', idempotency_key: 'p2-ops-repeatable-key',
    }))
    expect(fixture.mutations).toEqual([])
    expect(fixture.commands).toEqual([{
      companyId: 'tenant-a', customerId: 'customer-b', contactId: null,
      actor: { kind: 'ops', userId: 'actor-a', reason: 'OPS customer contact form' },
      expectedRevision: 7, idempotencyKey: 'p2-ops-repeatable-key',
      changes: { name: 'Example', title: null, email: null, phone: '0700000000' },
    }])
  })

  it('rejects a stale secondary-contact save before any direct service-role mutation', async () => {
    fixture.customerTenant = 'tenant-a'
    fixture.commandRevision = 8
    await expect(saveCustomerContactAction(form({
      customer_id: 'customer-b', name: 'Billing contact', type: 'billing',
      email: 'billing@example.invalid', expected_revision: '7',
      idempotency_key: 'secondary-stale-key',
    }))).rejects.toThrow('contact_revision_conflict')
    expect(fixture.mutations).toEqual([])
    expect(fixture.commands).toHaveLength(1)
  })

  it('creates a secondary contact through the same tenant-scoped command', async () => {
    fixture.customerTenant = 'tenant-a'
    await saveCustomerContactAction(form({
      customer_id: 'customer-b', name: 'Billing contact', type: 'billing',
      email: 'billing@example.invalid', expected_revision: '7',
      idempotency_key: 'secondary-create-key',
    }))
    expect(fixture.mutations).toEqual([])
    expect(fixture.commands).toEqual([{
      companyId: 'tenant-a', customerId: 'customer-b', contactId: null,
      contactTarget: 'secondary', contactType: 'billing',
      actor: { kind: 'ops', userId: 'actor-a', reason: 'OPS customer contact form' },
      expectedRevision: 7, idempotencyKey: 'secondary-create-key',
      changes: { name: 'Billing contact', title: null, email: 'billing@example.invalid', phone: null },
    }])
  })

  it('scopes address insertion and audit to the authorized tenant', async () => {
    fixture.mutations = []
    fixture.customerTenant = 'tenant-a'
    await saveCustomerAddressAction(form({ customer_id: 'customer-b', street_1: 'Example' }))
    expect(fixture.mutations.map((mutation) => mutation.payload.company_id)).toEqual(['tenant-a', 'tenant-a'])
  })
})
