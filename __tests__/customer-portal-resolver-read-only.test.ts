import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const fixture = vi.hoisted(() => ({
  accounts: [] as Record<string, unknown>[],
  identities: [] as Record<string, unknown>[],
  mutations: [] as Array<{ table: string; kind: string; payload: Record<string, unknown> }>,
}))

vi.mock('@/lib/supabase/service', () => {
  const customer = {
    id: 'customer-a', company_id: 'tenant-a', customer_number: 'C-10',
    external_customer_id: 'EXT-10', email: 'customer@example.test',
    phone: '0700000000', status: 'active',
  }
  const otherCustomer = {
    id: 'customer-b', company_id: 'tenant-a', customer_number: 'C-20',
    external_customer_id: 'EXT-20', email: 'other@example.test',
    phone: '0700000001', status: 'active',
  }
  function from(table: string) {
    const filters: Record<string, unknown> = {}
    const query = {
      select: () => query,
      eq: (field: string, value: unknown) => { filters[field] = value; return query },
      not: () => query,
      limit: () => query,
      update: (payload: Record<string, unknown>) => { fixture.mutations.push({ table, kind: 'update', payload }); return query },
      insert: (payload: Record<string, unknown>) => { fixture.mutations.push({ table, kind: 'insert', payload }); return query },
      maybeSingle: async () => {
        const data = rows().slice(0, 1)[0] ?? null
        return { data, error: null }
      },
      then: (resolve: (value: unknown) => unknown) => resolve({ data: rows(), error: null }),
    }
    function rows() {
      const source = table === 'customers' ? [customer, otherCustomer]
        : table === 'customer_portal_accounts' ? fixture.accounts
          : table === 'customer_portal_identities' ? fixture.identities : []
      return source.filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value))
    }
    return query
  }
  return { supabaseService: { from, rpc: async () => ({ data: [], error: null }) } }
})

import { ensureCustomerPortalUserLink, resolvePortalCustomer } from '@/lib/customer-portal/customerResolver'

const client = { company_id: 'tenant-a', id: 'api-client-a' } as Parameters<typeof resolvePortalCustomer>[0]['client']
const identifiers = {
  customerPortalUserId: 'd52546e3-3395-4ef7-ac65-1c2c9132bce8',
  customerNumber: 'C-10',
  email: 'customer@example.test',
}

beforeEach(() => {
  fixture.accounts = []
  fixture.identities = []
  fixture.mutations = []
})

describe('customer portal read boundary', () => {
  it('does not promote a linked reader to owner during lookup', async () => {
    fixture.accounts = [{
      id: 'account-a', company_id: 'tenant-a', customer_id: 'customer-a',
      portal_user_id: identifiers.customerPortalUserId, status: 'active',
      is_active: true, role: 'reader',
    }]

    const result = await resolvePortalCustomer({ client, identifiers }).catch(() => ({ ok: false as const }))
    expect(result.ok).toBe(true)
    expect(fixture.mutations).toEqual([])
  })

  it('does not reactivate a disabled account by falling back to customer attributes', async () => {
    fixture.accounts = [{
      id: 'account-a', company_id: 'tenant-a', customer_id: 'customer-a',
      portal_user_id: identifiers.customerPortalUserId, status: 'disabled',
      is_active: false, role: 'reader',
    }]

    const result = await resolvePortalCustomer({ client, identifiers }).catch(() => ({ ok: false as const }))
    expect(result.ok).toBe(false)
    expect(fixture.mutations).toEqual([])
  })

  it('uses the claimed customer number to select one of two active accounts', async () => {
    fixture.accounts = [
      {
        id: 'account-a', company_id: 'tenant-a', customer_id: 'customer-a',
        customer_number: 'C-10', portal_user_id: identifiers.customerPortalUserId,
        status: 'active', is_active: true,
      },
      {
        id: 'account-b', company_id: 'tenant-a', customer_id: 'customer-b',
        customer_number: 'C-20', portal_user_id: identifiers.customerPortalUserId,
        status: 'active', is_active: true,
      },
    ]
    const result = await resolvePortalCustomer({ client, identifiers })
    expect(result.ok && result.customer.customer_id).toBe('customer-a')
    expect(fixture.mutations).toEqual([])
  })

  it('requires an existing link instead of creating one from two presented identifiers', async () => {
    const result = await resolvePortalCustomer({ client, identifiers }).catch(() => ({ ok: false as const }))
    expect(result.ok).toBe(false)
    expect(fixture.mutations).toEqual([])
  })

  it.each([
    { externalCustomerId: 'EXT-20', customerNumber: 'C-10' },
    { externalCustomerId: 'EXT-10', customerNumber: 'C-20' },
    { customerNumber: 'C-10', email: 'other@example.test' },
  ])('rejects conflicting presented identifiers before returning a customer: %j', async (presented) => {
    const result = await resolvePortalCustomer({ client, identifiers: presented })
    expect(result).toMatchObject({ ok: false, status: 403, code: 'customer_identifier_mismatch' })
    expect(fixture.mutations).toEqual([])
  })

  it('preserves a single tenant-scoped customer number lookup', async () => {
    const result = await resolvePortalCustomer({ client, identifiers: { customerNumber: 'C-10' } })
    expect(result.ok && result.customer.customer_id).toBe('customer-a')
    expect(fixture.mutations).toEqual([])
  })

  it('rejects a body customer that conflicts with the same identifier in the request header', async () => {
    const request = new NextRequest('http://localhost/api/v1/customer/portal-bundle', {
      headers: { 'x-gridex-customer-number': 'C-20' },
    })
    const result = await resolvePortalCustomer({ client, request, identifiers: { customerNumber: 'C-10' } })
    expect(result).toMatchObject({ ok: false, status: 403, code: 'customer_identifier_mismatch' })
    expect(fixture.mutations).toEqual([])
  })

  it.each([
    new NextRequest('http://localhost/api/v1/customer/portal-bundle', {
      headers: { 'x-gridex-customer-number': 'C-10', 'x-customer-number': 'C-20' },
    }),
    new NextRequest('http://localhost/api/v1/customer/portal-bundle?customer_number=C-10&customer_number=C-20'),
    new NextRequest('http://localhost/api/v1/customer/portal-bundle?customer_number=C-20', {
      headers: { 'x-gridex-customer-number': 'C-10' },
    }),
  ])('rejects contradictory aliases within the same request before returning a customer', async (request) => {
    const result = await resolvePortalCustomer({ client, request })
    expect(result).toMatchObject({ ok: false, status: 403, code: 'customer_identifier_mismatch' })
    expect(fixture.mutations).toEqual([])
  })

  it('accepts repeated equivalent request identifiers', async () => {
    const request = new NextRequest('http://localhost/api/v1/customer/portal-bundle?customer_number=C-10&customerNumber=C-10', {
      headers: { 'x-gridex-customer-number': 'C-10' },
    })
    const result = await resolvePortalCustomer({ client, request })
    expect(result.ok && result.customer.customer_id).toBe('customer-a')
    expect(fixture.mutations).toEqual([])
  })

  it('preserves an existing portal role and verification state on an explicit website link retry', async () => {
    fixture.accounts = [{
      id: 'account-a', company_id: 'tenant-a', customer_id: 'customer-a',
      portal_user_id: identifiers.customerPortalUserId, status: 'active',
      is_active: true, role: 'reader', verified_at: '2026-01-01T00:00:00Z',
    }]
    fixture.identities = [{
      id: 'identity-a', company_id: 'tenant-a', customer_id: 'customer-a',
      auth_user_id: identifiers.customerPortalUserId,
      customer_portal_user_id: identifiers.customerPortalUserId,
      status: 'active',
    }]

    const linked = await ensureCustomerPortalUserLink({
      client, customerId: 'customer-a', userId: identifiers.customerPortalUserId,
      identityId: 'identity-a',
    })
    expect(linked?.accountId).toBe('account-a')
    const accountUpdate = fixture.mutations.find((entry) => entry.table === 'customer_portal_accounts')
    expect(accountUpdate?.payload).not.toHaveProperty('role')
    expect(accountUpdate?.payload).not.toHaveProperty('status')
    expect(accountUpdate?.payload).not.toHaveProperty('is_active')
    expect(accountUpdate?.payload).not.toHaveProperty('verified_at')
  })

  it('refuses an explicit link retry for a disabled account before writing', async () => {
    fixture.accounts = [{
      id: 'account-a', company_id: 'tenant-a', customer_id: 'customer-a',
      portal_user_id: identifiers.customerPortalUserId, status: 'disabled', is_active: false,
    }]
    await expect(ensureCustomerPortalUserLink({
      client, customerId: 'customer-a', userId: identifiers.customerPortalUserId,
    })).rejects.toThrow('customer_portal_account_inactive')
    expect(fixture.mutations).toEqual([])
  })
})
