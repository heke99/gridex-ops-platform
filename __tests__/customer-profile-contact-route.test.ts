import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiInputError } from '@/lib/api/strictRequest'

const fixture = vi.hoisted(() => ({
  command: vi.fn(),
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
})
