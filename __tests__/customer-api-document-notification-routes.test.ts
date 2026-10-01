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
  listPortalDocumentsPage: async (context: { companyId: string; customerId: string }, page: { limit: number | null; cursor: string | null }) => {
    fixture.contexts.push(context)
    fixture.inputs.push(page)
    return {
      items: [{ id: '11111111-1111-4111-8111-111111111111', document_type: 'agreement',
        title: 'Synthetic agreement', file_name: null, mime_type: null, file_size_bytes: null,
        status: 'published', public_url: null, document_version: null,
        created_at: '2026-09-29T00:00:00Z', customer_id: 'private-customer' }],
      page: { limit: 1, offset: 0, returned: 1, has_more: true, next_cursor: 'next-document' },
    }
  },
  listPortalNotificationsPage: async (context: { companyId: string; customerId: string }, page: { limit: number | null; cursor: string | null }) => {
    fixture.contexts.push(context)
    fixture.inputs.push(page)
    return {
      items: [{ id: '22222222-2222-4222-8222-222222222222', type: 'info',
        title: 'Synthetic notice', message: null, status: 'unread', read_at: null,
        created_at: '2026-09-29T00:00:00Z', customer_id: 'private-customer' }],
      page: { limit: 1, offset: 0, returned: 1, has_more: true, next_cursor: 'next-notification' },
    }
  },
}))

import { GET as getDocuments } from '@/app/api/v1/customer/documents/route'
import { GET as getNotifications } from '@/app/api/v1/customer/notifications/route'

describe('actual delegated document and notification routes with synthetic rows', () => {
  beforeEach(() => {
    for (const value of Object.values(fixture)) value.length = 0
  })

  it('returns a customer-scoped document page without source identifiers', async () => {
    const response = await getDocuments(new NextRequest('https://gridex.example.test/api/v1/customer/documents?limit=1'))
    expect(response.status).toBe(200)
    expect(fixture.scopes).toEqual([['customer_documents.read']])
    expect(fixture.contexts).toMatchObject([{ companyId: 'synthetic-company', customerId: 'synthetic-customer' }])
    expect(fixture.inputs).toEqual([{ limit: 1, cursor: null }])
    const body = await response.json()
    expect(body.page).toMatchObject({ returned: 1, has_more: true, next_cursor: 'next-document' })
    expect(body.data[0]).toMatchObject({ title: 'Synthetic agreement', file_size_bytes: null, secure_url: null })
    expect(body.data[0].document_reference).toMatch(/^document_[A-Za-z0-9_-]{32}$/)
    expect(JSON.stringify(body)).not.toContain('private-customer')
  })

  it('returns a customer-scoped notification page with an optional read timestamp', async () => {
    const response = await getNotifications(new NextRequest(
      'https://gridex.example.test/api/v1/customer/notifications?limit=1&cursor=prior-page',
    ))
    expect(response.status).toBe(200)
    expect(fixture.scopes).toEqual([['customer_notifications.read']])
    expect(fixture.contexts).toMatchObject([{ companyId: 'synthetic-company', customerId: 'synthetic-customer' }])
    expect(fixture.inputs).toEqual([{ limit: 1, cursor: 'prior-page' }])
    const body = await response.json()
    expect(body.page).toMatchObject({ returned: 1, has_more: true, next_cursor: 'next-notification' })
    expect(body.data[0]).toMatchObject({ title: 'Synthetic notice', read_at: null })
    expect(body.data[0].notification_reference).toMatch(/^notification_[A-Za-z0-9_-]{32}$/)
    expect(JSON.stringify(body)).not.toContain('private-customer')
  })
})
