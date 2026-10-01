import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiInputError } from '@/lib/api/strictRequest'

const fixture = vi.hoisted(() => ({ facility: vi.fn(), legacyOperations: 0 }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/customer-portal/externalApi', () => ({
  customerPortalJson: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  requireCustomerPortalApiContext: async () => ({ ok: true, client: {
    id: 'synthetic-client', company_id: 'synthetic-tenant', scopes: ['customer_contact.write', 'customer_facility_data.write'],
  }, identity: { customer_id: 'synthetic-customer', customer_portal_user_id: 'verified-subject' }, startedAt: 1 }),
  logCustomerPortalSuccess: vi.fn(),
  handleCustomerPortalRouteError: ({ error }: { error: unknown }) => error instanceof ApiInputError
    ? Response.json({ error: { code: error.code } }, { status: error.status })
    : Response.json({ error: { code: 'write_failed' } }, { status: 500 }),
}))
vi.mock('@/lib/customer-operations/contactCommand', () => ({
  ContactCommandError: class ContactCommandError extends Error {}, changeCustomerContact: vi.fn(),
}))
vi.mock('@/lib/billing/billingProfileCommand', () => ({
  BillingProfileCommandError: class BillingProfileCommandError extends Error {}, changeCustomerBillingProfileFromApi: vi.fn(),
}))
vi.mock('@/lib/customer-operations/profilePreferencesCommand', () => ({ changeCustomerProfilePreferences: vi.fn() }))
vi.mock('@/lib/customer-operations/facilityProfileCommand', () => ({ changeCustomerFacilityProfile: fixture.facility }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: () => { fixture.legacyOperations += 1; throw new Error('separate legacy mutation/completion') },
} }))
vi.mock('@/lib/customer-sites/addressIntake', () => ({ applyCustomerSiteAddressCandidate: () => {
  fixture.legacyOperations += 1; throw new Error('legacy address mutation')
} }))

import { POST } from '@/app/api/v1/customer/profile-update/route'

const request = (body: unknown) => new NextRequest('https://gridex.example.test/api/v1/customer/profile-update', {
  method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'synthetic-write-1' }, body: JSON.stringify(body),
})

describe('legacy API alternate writers cannot bypass protected commands (adapter regression)', () => {
  beforeEach(() => { fixture.legacyOperations = 0; fixture.facility.mockReset() })

  it('rejects legal identity before any customer update or completion', async () => {
    const response = await POST(request({ profile: { first_name: 'Synthetic' } }))
    expect(response.status).toBe(422)
    expect((await response.json()).error.code).toBe('profile_field_not_supported')
    expect(fixture.legacyOperations).toBe(0)
  })

  it('does not invoke separate legacy address writers after a failed atomic command', async () => {
    fixture.facility.mockRejectedValue({ code: 'XX000', message: 'synthetic late completion failure' })
    const payload = { facility_data: { facility_reference: 'SITE-1', expected_address_revision: 2,
      address: { street: 'Example 1', postal_code: '11122', city: 'Stockholm' } } }
    const response = await POST(request(payload))
    expect(response.status).toBe(500)
    expect(fixture.facility).toHaveBeenCalledWith({ companyId: 'synthetic-tenant', customerId: 'synthetic-customer',
      actor: { kind: 'api', clientId: 'synthetic-client', subject: 'verified-subject' }, idempotencyKey: 'synthetic-write-1', payload,
    })
    expect(fixture.legacyOperations).toBe(0)
  })
})
