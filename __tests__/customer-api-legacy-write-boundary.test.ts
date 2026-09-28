import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  customerUpdates: [] as Record<string, unknown>[],
  completionAttempts: 0,
  addressApplies: 0,
  scope: ['customer_contact.write', 'customer_facility_data.write'],
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/customer-portal/externalApi', () => ({
  customerPortalJson: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  requireCustomerPortalApiContext: async () => ({ ok: true, client: {
    id: 'synthetic-client', company_id: 'synthetic-tenant', scopes: fixture.scope,
  }, identity: { customer_id: 'synthetic-customer', customer_portal_user_id: 'synthetic-account' }, startedAt: 1 }),
  logCustomerPortalSuccess: vi.fn(),
  handleCustomerPortalRouteError: () => Response.json({ error: { code: 'write_failed' } }, { status: 500 }),
}))
vi.mock('@/lib/api/strictRequest', async (original) => ({
  ...(await original<typeof import('@/lib/api/strictRequest')>()),
  executeIdempotentPortalWrite: async ({ execute }: { execute: () => Promise<unknown> }) => execute(),
}))
vi.mock('@/lib/customer-operations/contactCommand', () => ({
  ContactCommandError: class ContactCommandError extends Error {},
  changeCustomerContact: vi.fn(),
}))
vi.mock('@/lib/customer-sites/addressIntake', () => ({
  applyCustomerSiteAddressCandidate: async () => {
    fixture.addressApplies += 1
    return { status: 'updated', siteId: 'synthetic-site' }
  },
}))
vi.mock('@/lib/customer-operations/automation', () => ({ enqueueCustomerDataRequestAutomation: async () => null }))
vi.mock('@/lib/customer-portal/db', () => ({ createPortalCompletionCase: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      if (table === 'customers') return {
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { metadata: {} }, error: null }) }) }) }),
        update: (payload: Record<string, unknown>) => ({
          eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => {
            fixture.customerUpdates.push(payload)
            return { data: { id: 'synthetic-customer' }, error: null }
          } }) }) }),
        }),
      }
      if (table === 'customer_sites') return {
        select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: {
          id: 'synthetic-site', facility_reference: 'SITE-1',
        }, error: null }) }) }) }) }),
      }
      if (table === 'customer_portal_completions') return {
        insert: () => ({ select: () => ({ single: async () => {
          fixture.completionAttempts += 1
          return { data: null, error: { code: 'synthetic_completion_failure' } }
        } }) }),
      }
      throw new Error(`unexpected table: ${table}`)
    },
  },
}))

import { POST } from '@/app/api/v1/customer/profile-update/route'

const request = (body: unknown) => new NextRequest('https://gridex.example.test/api/v1/customer/profile-update', {
  method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'synthetic-write-1' },
  body: JSON.stringify(body),
})

describe('open legacy API write gap, with a synthetic failure after the business mutation', () => {
  beforeEach(() => {
    fixture.customerUpdates.length = 0
    fixture.completionAttempts = 0
    fixture.addressApplies = 0
  })

  it('shows a noncontact profile write preceding its separately failed completion', async () => {
    const response = await POST(request({ profile: { first_name: 'Synthetic' } }))
    expect(response.status).toBe(500)
    expect(fixture.customerUpdates).toMatchObject([{ first_name: 'Synthetic' }])
    expect(fixture.completionAttempts).toBe(1)
  })

  it('shows a facility address write preceding its separately failed completion', async () => {
    const response = await POST(request({ facility_data: {
      facility_reference: 'SITE-1', address: { street: 'Example 1', postal_code: '11122', city: 'Stockholm' },
    } }))
    expect(response.status).toBe(500)
    expect(fixture.addressApplies).toBe(1)
    expect(fixture.completionAttempts).toBe(1)
  })
})
