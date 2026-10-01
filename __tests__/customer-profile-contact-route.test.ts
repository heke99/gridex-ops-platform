import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiInputError } from '@/lib/api/strictRequest'

const fixture = vi.hoisted(() => ({
  command: vi.fn(),
  billing: vi.fn(),
  preferences: vi.fn(),
  facility: vi.fn(),
  context: { company_id: 'tenant-a', id: 'client-a', scopes: ['customer_contact.write'] },
  identity: { customer_id: 'customer-a', customer_portal_user_id: 'subject-a' as string | null },
  log: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { from: () => { throw new Error('contact route made a separate table write') } },
}))
vi.mock('@/lib/customer-operations/contactCommand', () => ({
  ContactCommandError: class ContactCommandError extends Error {
    constructor(readonly code: string, readonly status: number) { super(code) }
  },
  changeCustomerContact: fixture.command,
}))
vi.mock('@/lib/billing/billingProfileCommand', () => ({
  BillingProfileCommandError: class BillingProfileCommandError extends Error {
    constructor(readonly code: string, readonly status: number) { super(code) }
  },
  changeCustomerBillingProfileFromApi: fixture.billing,
  changeCustomerBillingProfile: () => { throw new Error('API used the unscoped billing writer') },
}))
vi.mock('@/lib/customer-operations/profilePreferencesCommand', () => ({
  changeCustomerProfilePreferences: fixture.preferences,
}))
vi.mock('@/lib/customer-operations/facilityProfileCommand', () => ({
  changeCustomerFacilityProfile: fixture.facility,
}))
vi.mock('@/lib/customer-portal/externalApi', () => ({
  customerPortalJson: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  requireCustomerPortalApiContext: async () => ({
    ok: true, client: fixture.context, identity: fixture.identity, startedAt: 1,
  }),
  logCustomerPortalSuccess: fixture.log,
  handleCustomerPortalRouteError: ({ error }: { error: unknown }) => error instanceof ApiInputError
    ? Response.json({ code: error.code }, { status: error.status })
    : Response.json({ code: 'unexpected_error' }, { status: 500 }),
}))
vi.mock('@/lib/customer-sites/addressIntake', () => ({ applyCustomerSiteAddressCandidate: vi.fn() }))
vi.mock('@/lib/customer-operations/automation', () => ({ enqueueCustomerDataRequestAutomation: vi.fn() }))
vi.mock('@/lib/customer-portal/db', () => ({ createPortalCompletionCase: vi.fn() }))

import { POST } from '@/app/api/v1/customer/profile-update/route'

function request(body: unknown, key = 'p2-api-retry-key') {
  return new NextRequest('https://gridex.test/api/v1/customer/profile-update', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(body),
  })
}

describe('delegated API contact route', () => {
  beforeEach(() => {
    fixture.command.mockReset()
    fixture.billing.mockReset()
    fixture.preferences.mockReset()
    fixture.facility.mockReset()
    fixture.context.scopes = ['customer_contact.write']
    fixture.log.mockReset()
    fixture.identity.customer_portal_user_id = 'subject-a'
    fixture.command.mockResolvedValue({
      revision: 3, changed: true, replayed: false,
      completionReference: 'synthetic-completion', createdAt: '2026-09-28T12:00:00Z',
    })
  })

  it('uses the verified customer, client and account subject for a phone-only update', async () => {
    const response = await POST(request({ profile: { phone: '+46123456789' }, expected_contact_revision: 2 }))
    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({
      contact_revision: 3, completion_reference: 'synthetic-completion', facility_updated: false,
    })
    expect(fixture.command).toHaveBeenCalledWith({
      companyId: 'tenant-a', customerId: 'customer-a',
      actor: { kind: 'api', clientId: 'client-a', subject: 'subject-a' },
      expectedRevision: 2, idempotencyKey: 'p2-api-retry-key',
      changes: { phone: '+46123456789' },
    })
  })

  it('rejects missing link or mixed writes before invoking the command', async () => {
    fixture.identity.customer_portal_user_id = null
    expect((await POST(request({ profile: { phone: '+46123456789' }, expected_contact_revision: 2 }))).status).toBe(403)
    fixture.identity.customer_portal_user_id = 'subject-a'
    expect((await POST(request({ profile: { phone: '+46123456789', first_name: 'New' }, expected_contact_revision: 2 }))).status).toBe(422)
    expect(fixture.command).not.toHaveBeenCalled()
  })

  it('returns the committed replay without a second table writer', async () => {
    fixture.command.mockResolvedValue({ revision: 3, changed: true, replayed: true, completionReference: 'synthetic-completion' })
    const response = await POST(request({ profile: { email: 'after@example.invalid' }, expected_contact_revision: 2 }))
    expect(response.status).toBe(200)
    expect(fixture.log).toHaveBeenCalledWith(expect.objectContaining({
      metadata: { idempotency_replay: true },
    }))
  })

  it('does not let contact permission mutate billing or legal identity', async () => {
    const billingResponse = await POST(request({ profile: { invoice_email: 'billing@example.invalid' }, expected_billing_revision: 2 }))
    expect(billingResponse.status).toBe(403)
    expect((await billingResponse.json()).code).toBe('api_scope_missing')
    const legalResponse = await POST(request({ profile: { company_name: 'Another legal party' } }))
    expect(legalResponse.status).toBe(422)
    expect((await legalResponse.json()).code).toBe('profile_field_not_supported')
    expect(fixture.command).not.toHaveBeenCalled()
    expect(fixture.billing).not.toHaveBeenCalled()
  })

  it('updates only the billing standard through the revision-protected billing command', async () => {
    fixture.context.scopes = ['customer_billing.write']
    fixture.billing.mockResolvedValue({ statusCode: 200, replayed: false, body: { data: {
      billing_revision: 3, profile_updated: true, affected_contract_count: 1,
      completion_reference: 'completion-1', created_at: '2026-09-30T12:00:00Z',
      status: 'accepted', facility_updated: false, address_result: null,
      affectedContractIds: ['11111111-1111-4111-8111-111111111111'],
    } },
    })
    const response = await POST(request({ profile: { invoice_email: 'Billing@example.invalid' }, expected_billing_revision: 2 }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toMatchObject({ billing_revision: 3, affected_contract_count: 1, profile_updated: true })
    expect(JSON.stringify(body)).not.toContain('11111111-1111-4111-8111-111111111111')
    expect(fixture.billing).toHaveBeenCalledWith({ companyId: 'tenant-a', customerId: 'customer-a',
      actor: { kind: 'api', clientId: 'client-a', subject: 'subject-a' },
      idempotencyKey: 'p2-api-retry-key', payload: { profile: { invoice_email: 'Billing@example.invalid' }, expected_billing_revision: 2 },
    })
  })

  it('preserves the authorized legacy billing response and status without inventing a revision', async () => {
    fixture.context.scopes = ['customer_billing.write']
    const storedBody = { data: { status: 'accepted', profile_updated: true, facility_updated: false,
      address_result: null, completion_reference: 'old-billing-completion', created_at: '2026-08-01T01:02:03.123456Z' } }
    fixture.billing.mockResolvedValue({ statusCode: 201, body: storedBody, replayed: true })
    const response = await POST(request({ profile: { invoice_email: 'Billing@example.invalid' } }))
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(storedBody)
    expect(fixture.billing.mock.calls[0][0].payload).toEqual({ profile: { invoice_email: 'Billing@example.invalid' } })
    expect(fixture.log).toHaveBeenCalledWith(expect.objectContaining({ metadata: { idempotency_replay: true } }))
    expect(fixture.command).not.toHaveBeenCalled(); expect(fixture.preferences).not.toHaveBeenCalled(); expect(fixture.facility).not.toHaveBeenCalled()
  })

  it('preserves the exact completed billing replay lookup with historical metadata', async () => {
    fixture.context.scopes = ['customer_billing.write']
    const payload = { profile: { invoice_email: 'Billing@example.invalid' }, metadata: { z: 1e-7, a: 'Ä' } }
    const storedBody = { data: { status: 'accepted', profile_updated: true, facility_updated: false,
      address_result: null, completion_reference: 'historical-billing-metadata', created_at: '2026-08-01T01:02:03.123456Z' } }
    fixture.billing.mockResolvedValue({ statusCode: 201, body: storedBody, replayed: true })
    const response = await POST(request(payload))
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(storedBody)
    expect(fixture.billing).toHaveBeenCalledExactlyOnceWith({ companyId: 'tenant-a', customerId: 'customer-a',
      actor: { kind: 'api', clientId: 'client-a', subject: 'subject-a' }, idempotencyKey: 'p2-api-retry-key', payload })
    expect(fixture.command).not.toHaveBeenCalled(); expect(fixture.preferences).not.toHaveBeenCalled(); expect(fixture.facility).not.toHaveBeenCalled()
  })

  it('keeps fresh billing metadata writes denied by the atomic command without another writer', async () => {
    fixture.context.scopes = ['customer_billing.write']
    fixture.billing.mockRejectedValue(new ApiInputError('Unsupported metadata', 'invalid_billing_profile_command', 422))
    const response = await POST(request({ profile: { invoice_email: 'Billing@example.invalid' },
      expected_billing_revision: 2, metadata: { request_id: 'history-only' } }))
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ code: 'invalid_billing_profile_command' })
    expect(fixture.billing).toHaveBeenCalledTimes(1)
    expect(fixture.command).not.toHaveBeenCalled(); expect(fixture.preferences).not.toHaveBeenCalled(); expect(fixture.facility).not.toHaveBeenCalled()
  })

  it('allows authorized historical contact replay without inventing a new revision', async () => {
    const publicBody = { data: { completion_reference: 'old-completion', status: 'accepted', profile_updated: true, facility_updated: false, address_result: null } }
    fixture.command.mockResolvedValue({ publicBody, statusCode: 200, replayed: true })
    const response = await POST(request({ profile: { phone: '+46123456789' } }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(publicBody)
    expect(fixture.command).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: undefined }))
  })

  it('uses the atomic preferences command with its independent revision and verified actor', async () => {
    fixture.preferences.mockResolvedValue({ statusCode: 200, replayed: false,
      body: { data: { status: 'accepted', profile_updated: true, profile_revision: 3, facility_updated: false, address_result: null } },
    })
    const response = await POST(request({ profile: { language_code: 'sv', timezone: 'Europe/Stockholm' }, expected_profile_revision: 2 }))
    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({ profile_revision: 3, profile_updated: true })
    expect(fixture.preferences).toHaveBeenCalledWith({ companyId: 'tenant-a', customerId: 'customer-a',
      actor: { kind: 'api', clientId: 'client-a', subject: 'subject-a' }, idempotencyKey: 'p2-api-retry-key',
      payload: { profile: { language_code: 'sv', timezone: 'Europe/Stockholm' }, expected_profile_revision: 2 },
    })
    expect(fixture.command).not.toHaveBeenCalled()
    expect(fixture.billing).not.toHaveBeenCalled()
  })

  it('uses the atomic facility command and preserves its committed/replayed public result', async () => {
    fixture.context.scopes = ['customer_facility_data.write']
    const body = { data: { status: 'accepted', facility_updated: true, profile_updated: false,
      address_revision: 3, address_result: { status: 'updated', address_hash: 'a'.repeat(64) } } }
    fixture.facility.mockResolvedValue({ statusCode: 200, replayed: true, body })
    const payload = { facility_data: { facility_reference: 'SITE-1', expected_address_revision: 2,
      address: { street: 'Example 1', postal_code: '11122', city: 'Stockholm' } } }
    const response = await POST(request(payload))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(body)
    expect(fixture.facility).toHaveBeenCalledWith({ companyId: 'tenant-a', customerId: 'customer-a',
      actor: { kind: 'api', clientId: 'client-a', subject: 'subject-a' }, idempotencyKey: 'p2-api-retry-key', payload,
    })
    expect(fixture.command).not.toHaveBeenCalled()
    expect(fixture.billing).not.toHaveBeenCalled()
  })
  it('replays historical facility completion through a public allowlist without leaking raw address internals', async () => {
    fixture.context.scopes = ['customer_facility_data.write']
    const internalId = '11111111-1111-4111-8111-111111111111'
    fixture.facility.mockResolvedValue({ statusCode: 200, replayed: true, body: { data: {
      completion_reference: 'preserved-completion', created_at: '2026-09-28T01:02:03.123456Z',
      status: 'accepted', facility_updated: true, profile_updated: false,
      address_result: { status: 'updated', siteId: internalId, normalized: 'private canonical address', addressHash: 'a'.repeat(64) },
      internal_note: 'private support text',
    }, private_trace: internalId } })
    const response = await POST(request({ facility_data: { facility_reference: 'SITE-1', address: { city: 'Stockholm' } } }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: {
      completion_reference: 'preserved-completion', created_at: '2026-09-28T01:02:03.123456Z',
      status: 'accepted', facility_updated: true, profile_updated: false,
      address_result: { status: 'updated', address_hash: 'a'.repeat(64) },
    } })
    expect(fixture.command).not.toHaveBeenCalled()
    expect(fixture.billing).not.toHaveBeenCalled()
  })

  it.each([
    { data: { status: 'accepted', profile_updated: false, facility_updated: true, address_result: { status: 'updated', addressHash: { siteId: '11111111-1111-4111-8111-111111111111', metadata: 'private' } } } },
    { data: { status: { private_text: 'private' }, profile_updated: true, facility_updated: false, address_result: null } },
    { data: { status: 'accepted', profile_updated: true, facility_updated: false, contact_revision: { private_text: 'private' }, address_result: null } },
    {},
  ])('rejects malformed persisted profile replay with a canonical safe503', async (body) => {
    fixture.preferences.mockResolvedValue({ statusCode: 200, replayed: true, body })
    const response = await POST(request({ profile: { language_code: 'sv' } }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ code: 'profile_result_invalid' })
    expect(fixture.command).not.toHaveBeenCalled(); expect(fixture.billing).not.toHaveBeenCalled()
  })

})
