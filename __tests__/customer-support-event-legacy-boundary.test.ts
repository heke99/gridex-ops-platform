import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ record: vi.fn(), legacySupport: vi.fn(), log: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: async () => ({ ok: true,
    client: { id: 'synthetic-client', company_id: 'synthetic-tenant', scopes: ['website_events.write'] },
    context: { companyId: 'synthetic-tenant' },
  }),
  logIntegrationApiRequest: fixture.log,
  currentIntegrationApiResponseContext: () => null,
}))
vi.mock('@/lib/customer-portal/customerEvents', async (original) => ({
  ...await original<typeof import('@/lib/customer-portal/customerEvents')>(), recordWebsiteCustomerEvent: fixture.record,
}))
vi.mock('@/lib/customer-cases/support', () => ({ createSupportCaseFromCustomerEvent: fixture.legacySupport }))

import { POST as websitePOST } from '@/app/api/v1/website/customer-events/route'
import { POST as eventsPOST } from '@/app/api/v1/events/route'

const payload = (eventType: string) => ({
  event_type: eventType, event_reference: 'synthetic-event-1', occurred_at: '2026-09-30T12:00:00Z',
  customer: { customer_number: 'SYN-1' }, subject: { type: 'customer', reference: 'SYN-1' },
  data: { message: 'Synthetic event' },
})
const request = (path: string, eventType: string) => new NextRequest(`https://gridex.example.test${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'synthetic-event-key' },
  body: JSON.stringify(payload(eventType)),
})

describe.each([
  ['/api/v1/website/customer-events', websitePOST], ['/api/v1/events', eventsPOST],
] as const)('legacy support-event boundary at %s', (path, post) => {
  beforeEach(() => {
    fixture.record.mockReset().mockResolvedValue({ event_reference: 'synthetic-event-1',
      event_resource_reference: 'event_synthetic-1', event_type: 'customer.preference_observed',
      customer_reference: 'SYN-1', status: 'accepted', occurred_at: '2026-09-30T12:00:00Z',
      replayed: false, _internal_customer_id: '11111111-1111-4111-8111-111111111111',
    })
    fixture.legacySupport.mockReset()
    fixture.log.mockReset().mockResolvedValue(undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it.each(['customer.support_created', 'customer.case_message'])
    ('rejects machine-only %s before persisting an event or creating a support case', async (eventType) => {
      const response = await post(request(path, eventType))
      expect(response.status).toBe(403)
      expect((await response.json()).error.code).toBe('support_event_delegation_required')
      expect(fixture.record).not.toHaveBeenCalled()
      expect(fixture.legacySupport).not.toHaveBeenCalled()
    })

  it('preserves supported non-support events and never exposes its internal customer ID', async () => {
    const response = await post(request(path, 'customer.preference_observed'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toMatchObject({ status: 'accepted', event_reference: 'synthetic-event-1' })
    expect(JSON.stringify(body)).not.toContain('11111111-1111-4111-8111-111111111111')
    expect(fixture.record).toHaveBeenCalledOnce()
    expect(fixture.legacySupport).not.toHaveBeenCalled()
  })

  it('does not fail a committed non-support event because ordinary request telemetry rejects', async () => {
    fixture.log.mockRejectedValue(new Error('synthetic request telemetry unavailable'))
    expect((await post(request(path, 'customer.preference_observed'))).status).toBe(200)
    expect(fixture.record).toHaveBeenCalledOnce()
  })
})
