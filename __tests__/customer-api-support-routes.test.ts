import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  requestedScopes: [] as string[][],
  pageInputs: [] as Array<{ limit: number | null; cursor: string | null }>,
  contexts: [] as Array<{ companyId: string; customerId: string }>,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/customer-portal/externalApi', () => ({
  requireCustomerPortalApiContext: async (_request: unknown, scopes: string[]) => {
    fixture.requestedScopes.push(scopes)
    return {
      ok: true,
      client: { id: 'synthetic-client', company_id: 'synthetic-organization' },
      identity: {
        customer_id: 'synthetic-customer', customer_number: 'SYN-1001',
        external_customer_id: null, provider: 'customer_portal_accounts',
      },
      startedAt: 1,
    }
  },
  customerPortalJson: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  logCustomerPortalSuccess: vi.fn(),
  handleCustomerPortalRouteError: vi.fn(),
}))
vi.mock('@/lib/customer-portal/apiData', () => ({
  portalContextFromResolved: (context: { companyId: string; customerId: string }) => context,
  listPortalContractsPage: async (context: { companyId: string; customerId: string }, page: { limit: number | null; cursor: string | null }) => {
    fixture.contexts.push(context)
    fixture.pageInputs.push(page)
    return {
      items: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: null, created_at: '2026-09-28T00:00:00Z' }],
      page: { limit: 1, offset: 0, returned: 1, has_more: true, next_cursor: 'synthetic-opaque-next-cursor' },
    }
  },
  listPortalSitesPage: async (context: { companyId: string; customerId: string }, page: { limit: number | null; cursor: string | null }) => {
    fixture.contexts.push(context)
    fixture.pageInputs.push(page)
    return {
      items: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', site_name: 'Synthetic site', city: 'Stockholm' }],
      page: { limit: 1, offset: 0, returned: 1, has_more: false, next_cursor: null },
    }
  },
  listPortalMeteringPointsForSites: async (_context: unknown, sites: Array<{ id: string }>) => [{
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', site_id: sites[0].id, metering_point_id: '735999000000000001',
  }],
}))

import { GET as getContracts } from '@/app/api/v1/customer/contracts/route'
import { GET as getSites } from '@/app/api/v1/customer/sites/route'

const request = (path: string) => new NextRequest(`https://gridex.example.test${path}?limit=1`)

describe('actual delegated support route projections against synthetic service rows', () => {
  beforeEach(() => {
    fixture.requestedScopes.length = 0
    fixture.pageInputs.length = 0
    fixture.contexts.length = 0
  })

  it('binds the contract read to its customer and returns its page and public DTO', async () => {
    const response = await getContracts(request('/api/v1/customer/contracts'))
    expect(response.status).toBe(200)
    expect(fixture.requestedScopes).toEqual([['customer_contracts.read']])
    expect(fixture.contexts).toMatchObject([{ companyId: 'synthetic-organization', customerId: 'synthetic-customer' }])
    expect(fixture.pageInputs).toEqual([{ limit: 1, cursor: null }])
    const body = await response.json()
    expect(body.page).toMatchObject({ limit: 1, has_more: true, next_cursor: 'synthetic-opaque-next-cursor' })
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({ status: null, contract_number: null })
    expect(body.data[0].contract_reference).toMatch(/^contract_[A-Za-z0-9_-]{20,64}$/)
    expect(body.data[0].id).toBeUndefined()
  })

  it('projects only the customer page of sites and their public metering points', async () => {
    const response = await getSites(request('/api/v1/customer/sites'))
    expect(response.status).toBe(200)
    expect(fixture.requestedScopes).toEqual([['customer_sites.read']])
    expect(fixture.contexts).toMatchObject([{ companyId: 'synthetic-organization', customerId: 'synthetic-customer' }])
    expect(fixture.pageInputs).toEqual([{ limit: 1, cursor: null }])
    const body = await response.json()
    expect(body.page.sites).toMatchObject({ limit: 1, has_more: false, next_cursor: null })
    expect(body.data.sites[0]).toMatchObject({ name: 'Synthetic site', address: { city: 'Stockholm', country: 'SE' } })
    expect(body.data.metering_points[0].metering_point_id).toBe('735999000000000001')
    expect(body.data.sites[0].id).toBeUndefined()
    expect(body.data.metering_points[0].id).toBeUndefined()
  })
})
