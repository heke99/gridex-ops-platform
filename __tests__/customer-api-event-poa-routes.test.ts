import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  scopes: [] as string[][],
  contexts: [] as Array<{ companyId: string; customerId: string }>,
  inputs: [] as Array<{ limit: number | null; cursor: string | null }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/customer-portal/externalApi', () => ({
  requireCustomerPortalApiContext: async (_request: unknown, scopes: string[]) => {
    fixture.scopes.push(scopes)
    return {
      ok: true, startedAt: 1,
      client: { id: 'synthetic-client', company_id: 'synthetic-company' },
      identity: { customer_id: 'synthetic-customer', external_customer_id: null,
        customer_number: 'SYN-1001', provider: 'customer_portal_accounts' },
    }
  },
  customerPortalJson: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  logCustomerPortalSuccess: vi.fn(),
  handleCustomerPortalRouteError: vi.fn(),
}))
vi.mock('@/lib/customer-portal/apiData', () => ({
  portalContextFromResolved: (context: { companyId: string; customerId: string }) => context,
  listPortalEventsPage: async (context: { companyId: string; customerId: string }, page: { limit: number | null; cursor: string | null }) => {
    fixture.contexts.push(context)
    fixture.inputs.push(page)
    return {
      items: [{ id: '11111111-1111-4111-8111-111111111111', event_type: 'contact.updated',
        occurred_at: '2026-09-29T00:00:00Z', source: 'tenant', source_table: 'domain_events',
        payload: { private: 'secret' }, customer_id: 'private-customer' }],
      page: { limit: 1, offset: 0, returned: 1, has_more: true, next_cursor: 'next-event' },
    }
  },
  listPortalPowersOfAttorneyPage: async (context: { companyId: string; customerId: string }, page: { limit: number | null; cursor: string | null }) => {
    fixture.contexts.push(context)
    fixture.inputs.push(page)
    return {
      items: [{ id: '22222222-2222-4222-8222-222222222222', contract_id: null,
        customer_site_id: null, scope: 'metering', status: 'active',
        valid_until: '2026-10-29T00:00:00Z', created_at: '2026-09-29T00:00:00Z',
        scope_summary: 'private summary', customer_id: 'private-customer' }],
      page: { limit: 1, offset: 0, returned: 1, has_more: true, next_cursor: 'next-authority' },
    }
  },
}))

import { GET as getEvents } from '@/app/api/v1/customer/events/route'
import { GET as getPowers } from '@/app/api/v1/customer/powers-of-attorney/route'

describe('actual delegated event and power-of-attorney routes', () => {
  beforeEach(() => {
    for (const value of Object.values(fixture)) value.length = 0
  })

  it('uses the customer event scope and sends only the public event page', async () => {
    const response = await getEvents(new NextRequest('https://gridex.example.test/api/v1/customer/events?limit=1&cursor=prior'))
    expect(response.status).toBe(200)
    expect(fixture.scopes).toEqual([['customer_events.read']])
    expect(fixture.contexts).toMatchObject([{ companyId: 'synthetic-company', customerId: 'synthetic-customer' }])
    expect(fixture.inputs).toEqual([{ limit: 1, cursor: 'prior' }])
    const body = await response.json()
    expect(body.page).toMatchObject({ returned: 1, next_cursor: 'next-event' })
    expect(body.data[0]).toMatchObject({ event_type: 'contact.updated', event_version: null })
    expect(body.data[0].event_reference).toMatch(/^event_[A-Za-z0-9_-]{32}$/)
    expect(JSON.stringify(body)).not.toMatch(/secret|private-customer|source_table/)
  })

  it('uses the authority scope and omits its internal relationship identifiers', async () => {
    const response = await getPowers(new NextRequest('https://gridex.example.test/api/v1/customer/powers-of-attorney?limit=1'))
    expect(response.status).toBe(200)
    expect(fixture.scopes).toEqual([['customer_power_of_attorney.read']])
    expect(fixture.contexts).toMatchObject([{ companyId: 'synthetic-company', customerId: 'synthetic-customer' }])
    expect(fixture.inputs).toEqual([{ limit: 1, cursor: null }])
    const body = await response.json()
    expect(body.page).toMatchObject({ returned: 1, next_cursor: 'next-authority' })
    expect(body.data[0]).toMatchObject({ contract_reference: null, facility_reference: null, valid_to: '2026-10-29T00:00:00Z' })
    expect(body.data[0].power_of_attorney_reference).toMatch(/^power_of_attorney_[A-Za-z0-9_-]{32}$/)
    expect(JSON.stringify(body)).not.toMatch(/private summary|private-customer|customer_site_id/)
  })
})
