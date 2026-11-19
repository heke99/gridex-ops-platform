import { NextRequest } from 'next/server'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { GET, POST } from '@/app/api/v1/customer/portal-bundle/route'

type Scope = { p_company_id: string; p_customer_id: string }
const io = vi.hoisted(() => ({ retention: [] as Scope[], dataReads: [] as string[], finished: new Set<string>(), fail: new Set<string>() }))
const syntheticId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const scopes = [{ p_company_id: syntheticId(10), p_customer_id: syntheticId(11) }, { p_company_id: syntheticId(20), p_customer_id: syntheticId(21) }]
const bundleUrl = 'https://ops.example.test/api/v1/customer/portal-bundle'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/integrations/apiAuth', async original => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(), logIntegrationApiRequest: vi.fn(), currentIntegrationApiResponseContext: () => null,
}))
vi.mock('@/lib/customer-portal/externalApi', async original => {
  const context = async (request: NextRequest) => {
    const index = request.headers.get('x-synthetic-scope') === 'other' ? 1 : 0
    const { p_company_id: company, p_customer_id: customer } = scopes[index]
    return { ok: true, client: { id: syntheticId(100 + index), company_id: company }, startedAt: Date.now(),
      identity: { customer_id: customer, provider: 'synthetic', external_customer_id: 'fixture', customer: { id: customer, status: 'active' } } }
  }
  return { ...await original<typeof import('@/lib/customer-portal/externalApi')>(), requireCustomerPortalApiContext: context,
    requireCustomerPortalApiContextForIdentifiers: context, logCustomerPortalSuccess: vi.fn() }
})
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('https://synthetic.example.test', 'fixture-only', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: syntheticFetch },
  }) }
})

async function syntheticFetch(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, init)
  const url = new URL(request.url)
  expect(url.origin).toBe('https://synthetic.example.test')
  if (url.pathname.endsWith('/rpc/ediel_require_portal_retention_access_v1')) {
    const args = await request.json() as Scope
    expect(scopes).toContainEqual(args)
    io.retention.push(args)
    // Yield so independent bundle queries overlap before the gate replies.
    await new Promise<void>(resolve => setImmediate(resolve))
    if (io.fail.has(args.p_company_id)) return Response.json({ code: '58000', message: 'Synthetic retention storage failure' }, { status: 500 })
    io.finished.add(args.p_company_id)
    return Response.json(null)
  }
  expect(request.method).toBe('GET')
  const company = url.searchParams.get('company_id')?.slice(3)
  expect(company).toBeDefined()
  expect(io.finished.has(company!)).toBe(true)
  io.dataReads.push(url.pathname)
  return Response.json([])
}

beforeEach(() => {
  io.retention = []; io.dataReads = []; io.finished.clear(); io.fail.clear()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

it('uses the same verified gate for every section of one full GET', async () => {
  const response = await GET(new NextRequest(bundleUrl))
  expect(response.status).toBe(200)
  expect(io.dataReads.length).toBeGreaterThanOrEqual(10)
  expect(io.retention).toEqual([scopes[0]])
})

it('uses one gate for the required sections of a reduced POST', async () => {
  const response = await POST(new NextRequest(bundleUrl + '?include=none', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ external_customer_id: 'fixture' }),
  }))
  expect(response.status).toBe(200)
  expect(io.dataReads.length).toBeGreaterThanOrEqual(6)
  expect(io.retention).toEqual([scopes[0]])
})

it('starts a fresh gate for each new request including another tenant', async () => {
  const responses = await Promise.all([
    GET(new NextRequest(bundleUrl)), GET(new NextRequest(bundleUrl)),
    GET(new NextRequest(bundleUrl, { headers: { 'x-synthetic-scope': 'other' } })),
  ])
  expect(responses.map(x => x.status)).toEqual([200, 200, 200])
  expect(io.retention.filter(x => x.p_company_id === scopes[0].p_company_id)).toHaveLength(2)
  expect(io.retention.filter(x => x.p_company_id === scopes[1].p_company_id)).toHaveLength(1)
})

it('keeps the existing unavailable response and no section queries when retention fails', async () => {
  io.fail.add(scopes[0].p_company_id)
  const response = await GET(new NextRequest(bundleUrl))
  expect(response.status).toBe(503)
  expect(io.dataReads).toEqual([])
  expect(io.retention).toEqual([scopes[0]])
})

it('checks a changed verdict on new requests after a success and after a failure', async () => {
  expect((await GET(new NextRequest(bundleUrl))).status).toBe(200)
  io.fail.add(scopes[0].p_company_id)
  io.finished.clear()
  io.dataReads = []
  expect((await GET(new NextRequest(bundleUrl))).status).toBe(503)
  expect(io.dataReads).toEqual([])
  io.fail.clear()
  expect((await GET(new NextRequest(bundleUrl))).status).toBe(200)
  expect(io.retention).toEqual([scopes[0], scopes[0], scopes[0]])
})
