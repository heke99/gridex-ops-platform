import { NextRequest } from 'next/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GET, POST } from '@/app/api/v1/customer/portal-bundle/route'

type AuditRow = Record<string, unknown>
const transport = vi.hoisted(() => ({
  audit: [] as AuditRow[],
  dataReads: [] as string[],
  retention: [] as AuditRow[],
  failGate: false,
  failInvoices: false,
}))
const ROUTE = '/api/v1/customer/portal-bundle'
const COMPANY = '00000000-0000-4000-8000-000000000010'
const CUSTOMER = '00000000-0000-4000-8000-000000000011'
const CLIENT = '00000000-0000-4000-8000-000000000012'
const CALLER_ID = 'synthetic-inbound-request-id'
const BACKEND_DETAIL = 'synthetic SQL/Storage detail'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/customer-portal/externalApi', async (original) => {
  const context = async () => ({
    ok: true,
    client: { id: CLIENT, company_id: COMPANY },
    startedAt: Date.now(),
    identity: {
      customer_id: CUSTOMER, external_customer_id: 'fixture-customer', provider: 'synthetic',
      customer: { id: CUSTOMER, status: 'active' },
    },
  })
  return {
    ...await original<typeof import('@/lib/customer-portal/externalApi')>(),
    requireCustomerPortalApiContext: context,
    requireCustomerPortalApiContextForIdentifiers: context,
  }
})
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://synthetic.example.test', 'fixture-only', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: syntheticFetch },
    }),
  }
})

async function syntheticFetch(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, init)
  const url = new URL(request.url)
  expect(url.origin).toBe('https://synthetic.example.test')
  if (url.pathname === '/rest/v1/rpc/ediel_require_portal_retention_access_v1') {
    transport.retention.push(await request.json())
    return transport.failGate
      ? Response.json({ code: '58000', message: BACKEND_DETAIL }, { status: 500 })
      : Response.json(null)
  }
  if (url.pathname === '/rest/v1/integration_api_requests' && request.method === 'POST') {
    transport.audit.push(await request.json())
    return new Response(null, { status: 201 })
  }
  expect(request.method).toBe('GET')
  expect(url.searchParams.get('company_id')).toBe(`eq.${COMPANY}`)
  transport.dataReads.push(url.pathname)
  if (transport.failInvoices && url.pathname === '/rest/v1/customer_invoices') {
    return Response.json({ code: '58000', message: BACKEND_DETAIL }, { status: 500 })
  }
  return Response.json([])
}

function bundleRequest(method: 'GET' | 'POST') {
  const url = 'https://ops.example.test' + ROUTE
  const headers = { 'x-request-id': CALLER_ID, 'content-type': 'application/json' }
  return method === 'GET'
    ? GET(new NextRequest(url, { headers }))
    : POST(new NextRequest(url + '?include=none', {
        method, headers, body: JSON.stringify({ external_customer_id: 'fixture-customer' }),
      }))
}

async function expectAuditMatchesResponse(response: Response, method: 'GET' | 'POST', status: number, partial: boolean) {
  expect(response.status).toBe(status)
  const body = await response.json()
  const requestId = response.headers.get('x-request-id')
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/)
  expect(requestId).not.toBe(CALLER_ID)
  expect(body.request_id).toBe(requestId)
  expect(transport.audit).toHaveLength(1)
  expect(transport.audit[0]).toMatchObject({
    company_id: COMPANY, api_client_id: CLIENT, request_id: requestId,
    method, route: ROUTE, status_code: status,
    metadata: { result_count: 1, partial_bundle: partial },
  })
  expect(JSON.stringify(transport.audit[0])).not.toContain(BACKEND_DETAIL)
  expect(JSON.stringify(body)).not.toContain(BACKEND_DETAIL)
  return body.data as Record<string, unknown>
}

beforeEach(() => {
  transport.audit = []
  transport.dataReads = []
  transport.retention = []
  transport.failGate = false
  transport.failInvoices = false
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

it.each(['GET', 'POST'] as const)('logs exactly the unavailable Bundle status for %s', async (method) => {
  transport.failGate = true
  const data = await expectAuditMatchesResponse(await bundleRequest(method), method, 503, true)
  expect(data.bundle_status).toMatchObject({ status: 'unavailable', complete: false })
  expect(data.contracts).toEqual([])
  expect(data.sites).toEqual([])
  expect(transport.dataReads).toEqual([])
  expect(transport.retention).toEqual([{ p_company_id: COMPANY, p_customer_id: CUSTOMER }])
})

it('records a complete available response as 200 under its own response identifier', async () => {
  const data = await expectAuditMatchesResponse(await bundleRequest('GET'), 'GET', 200, false)
  expect(data.bundle_status).toMatchObject({ status: 'complete', complete: true })
  expect(transport.dataReads.length).toBeGreaterThan(0)
})

it('keeps an optional-section error as the existing partial 200 response and audit status', async () => {
  transport.failInvoices = true
  const data = await expectAuditMatchesResponse(await bundleRequest('GET'), 'GET', 200, true)
  expect(data.bundle_status).toMatchObject({ status: 'partial', complete: true, unavailable_sections: ['invoices'] })
  expect(transport.dataReads).toContain('/rest/v1/customer_invoices')
})
