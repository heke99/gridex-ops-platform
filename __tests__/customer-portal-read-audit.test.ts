import { NextRequest } from 'next/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GET as documents } from '@/app/api/v1/customer/documents/route'
import { GET as sites } from '@/app/api/v1/customer/sites/route'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  trace: [] as string[],
  audit: [] as Row[],
  hasSite: false,
  failRetention: false,
  failDocuments: false,
  failMeters: false,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/integrations/apiAuth', async original => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(),
  logIntegrationApiRequest: vi.fn(),
  currentIntegrationApiResponseContext: () => null,
}))
vi.mock('@/lib/customer-portal/externalApi', async original => ({
  ...await original<typeof import('@/lib/customer-portal/externalApi')>(),
  requireCustomerPortalApiContext: async () => ({
    ok: true, client: { id: 'synthetic-client', company_id: companyId },
    identity: { customer_id: customerId }, startedAt: 20,
  }),
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://synthetic.example.test', 'fixture-only', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: syntheticFetch },
    }),
  }
})

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const companyId = id(1), customerId = id(2), siteId = id(3)
const failure = () => Response.json({ code: '58000', message: 'Synthetic database failure' }, { status: 500 })
const origin = 'https://ops.example.test/api/v1/customer/'

async function syntheticFetch(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, init)
  const url = new URL(request.url)
  expect(url.origin).toBe('https://synthetic.example.test')
  switch (url.pathname) {
    case '/rest/v1/rpc/ediel_require_portal_retention_access_v1':
      io.trace.push('retention')
      expect(await request.json()).toEqual({ p_company_id: companyId, p_customer_id: customerId })
      return io.failRetention ? failure() : Response.json(null)
    case '/rest/v1/rpc/portal_customer_documents_page_v1':
      io.trace.push('documents')
      expect(await request.json()).toMatchObject({ p_company_id: companyId, p_customer_id: customerId })
      return io.failDocuments ? failure() : Response.json([])
    case '/rest/v1/customer_portal_api_access_logs': {
      const row = await request.json() as Row
      expect(row).toMatchObject({ company_id: companyId, customer_id: customerId })
      io.audit.push(row)
      io.trace.push(String(row.action))
      return new Response(null, { status: 201 })
    }
    case '/rest/v1/customer_sites':
      io.trace.push('sites')
      expect(url.searchParams.get('company_id')).toBe('eq.' + companyId)
      expect(url.searchParams.get('customer_id')).toBe('eq.' + customerId)
      return Response.json(io.hasSite ? [{
        id: siteId, company_id: companyId, customer_id: customerId,
        facility_reference: 'facility_synthetic', created_at: '2026-10-12T00:00:00Z',
      }] : [])
    case '/rest/v1/metering_points':
      io.trace.push('meters')
      expect(url.searchParams.get('company_id')).toBe('eq.' + companyId)
      expect(url.searchParams.getAll('or').join(',')).toContain(customerId)
      expect(url.searchParams.getAll('or').join(',')).toContain(siteId)
      return io.failMeters ? failure() : Response.json([])
    default:
      throw new Error(`Unexpected synthetic query ${url.pathname}`)
  }
}

beforeEach(() => {
  io.trace = []
  io.audit = []
  io.failRetention = false
  io.failDocuments = false
  io.failMeters = false
  io.hasSite = false
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

it('does not log a document read when the cursor cannot be used', async () => {
  expect((await documents(new NextRequest(origin + 'documents?cursor=invalid'))).ok).toBe(false)
  expect(io.trace).toEqual(['retention'])
  expect(io.audit).toEqual([])
})

it.each([false, true])('records the actual document RPC outcome when read failure is %s', async fail => {
  io.failDocuments = fail
  expect((await documents(new NextRequest(origin + 'documents'))).ok).toBe(!fail)
  expect(io.trace).toEqual(['retention', 'documents', 'read_documents_page'])
  expect(io.audit).toEqual([expect.objectContaining({ action: 'read_documents_page',
    metadata: expect.objectContaining({ outcome: fail ? 'failed' : 'succeeded' }) })])
})

it('keeps the retention denial before the actual read and any later access audit', async () => {
  io.failRetention = true
  expect((await documents(new NextRequest(origin + 'documents?cursor=invalid'))).ok).toBe(false)
  expect(io.trace).toEqual(['retention'])
  expect(io.audit).toEqual([])
})

it('does not log a metering point read for an empty Sites page', async () => {
  const response = await sites(new NextRequest(origin + 'sites'))
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ data: { sites: [], metering_points: [] } })
  expect(io.trace).toEqual(['retention', 'read_sites_page', 'sites', 'retention'])
  expect(io.audit.map(row => row.action)).toEqual(['read_sites_page'])
})

it.each([false, true])('records the actual scoped metering query outcome when read failure is %s', async fail => {
  io.hasSite = true
  io.failMeters = fail
  const response = await sites(new NextRequest(origin + 'sites'))
  expect(response.status).toBe(fail ? 503 : 200)
  expect(io.trace).toEqual(['retention', 'read_sites_page', 'sites', 'retention', 'meters', 'read_metering_points_for_site_page'])
  expect(io.audit[1]).toMatchObject({ action: 'read_metering_points_for_site_page',
    metadata: { outcome: fail ? 'failed' : 'succeeded' },
  })
})
