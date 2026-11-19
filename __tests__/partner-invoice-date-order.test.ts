import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/partner/v1/[[...path]]/route'

const fixture = vi.hoisted(() => ({
  reads: [] as URL[],
  siteCustomerId: '',
  log: vi.fn(),
  access: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/integrations/apiAuth', async (original) => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(),
  requireIntegrationApiAccess: fixture.access,
  logIntegrationApiRequest: fixture.log,
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://database.synthetic.example', 'synthetic-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: readRows },
    }),
  }
})

const companyId = '10000000-0000-4000-8000-000000000001'
const customerId = '10000000-0000-4000-8000-000000000002'
const siteId = '10000000-0000-4000-8000-000000000003'
const contractId = '10000000-0000-4000-8000-000000000004'
const tableName = (url: URL) => url.pathname.split('/').at(-1)

async function readRows(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  expect(url.origin).toBe('https://database.synthetic.example')
  expect(init?.method ?? 'GET').toBe('GET')
  expect(url.searchParams.get('company_id')).toBe(`eq.${companyId}`)
  fixture.reads.push(url)

  switch (tableName(url)) {
    case 'customers': return Response.json([{ id: customerId }])
    case 'customer_sites': return Response.json([{ id: siteId, customer_id: fixture.siteCustomerId }])
    case 'customer_contracts':
      expect(url.searchParams.get('customer_id')).toBe(`eq.${customerId}`)
      expect(url.searchParams.get('customer_site_id')).toBe(`eq.${siteId}`)
      return Response.json([{ id: contractId }])
    case 'customer_invoices':
      expect(url.searchParams.get('customer_id')).toBe(`eq.${customerId}`)
      return Response.json([])
    default: throw new Error(`Unexpected synthetic read ${url.pathname}`)
  }
}

const invoicePath = ['customer', 'customer_example', 'site', 'facility_example', 'invoice']
function get(path: string[], query = '') {
  const request = new NextRequest(`https://app.synthetic.example/api/partner/v1/${path.join('/')}${query}`)
  return GET(request, { params: Promise.resolve({ path }) })
}

beforeEach(() => {
  fixture.reads = []
  fixture.siteCustomerId = customerId
  vi.clearAllMocks()
  fixture.log.mockResolvedValue(undefined)
  fixture.access.mockResolvedValue({ ok: true, client: { id: 'synthetic', company_id: companyId } })
})

describe('Partner site invoice date filters', () => {
  it('rejects reversed dates after site authorization and before querying contracts or invoices', async () => {
    const response = await get(invoicePath, '?from_date=2026-11-03&to_date=2026-11-02')
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: { code: 'invoice_date_range_invalid', field: 'from_date' } })
    expect(fixture.reads.map(tableName)).toEqual(['customers', 'customer_sites'])
    expect(fixture.log).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422, errorCode: 'invoice_date_range_invalid' }))
  })

  it.each([
    ['single lower bound', '?from_date=2026-11-02', ['gte.2026-11-01T23:00:00.000Z']],
    ['single upper bound', '?to_date=2026-11-02', ['lt.2026-11-02T23:00:00.000Z']],
    ['same local day', '?from_date=2026-11-02&to_date=2026-11-02', ['gte.2026-11-01T23:00:00.000Z', 'lt.2026-11-02T23:00:00.000Z']],
  ])('retains the Stockholm day boundaries for %s', async (_label, query, bounds) => {
    const response = await get(invoicePath, query)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ invoices: [] })
    expect(fixture.reads.find((url) => tableName(url) === 'customer_invoices')?.searchParams.getAll('issued_at')).toEqual(bounds)
  })

  it('preserves site authorization and malformed-date outcomes', async () => {
    fixture.siteCustomerId = 'other-customer'
    const unowned = await get(invoicePath, '?from_date=2026-11-03&to_date=2026-11-02')
    expect(unowned.status).toBe(404)
    expect(await unowned.json()).toMatchObject({ error: { code: 'site_not_found' } })

    fixture.siteCustomerId = customerId
    const invalid = await get(invoicePath, '?from_date=2026-02-30')
    expect(invalid.status).toBe(422)
    expect(await invalid.json()).toMatchObject({ error: { code: 'invalid_date' } })
  })

  it('describes the range error in the served Partner OpenAPI', async () => {
    const response = await get(['openapi.json'])
    expect(response.status).toBe(200)
    const openApi = await response.json()
    const operation = openApi.paths['/customer/{customer_id}/site/{site_id}/invoice'].get
    expect(operation.responses['422'].description).toContain('invoice_date_range_invalid')
  })
})
