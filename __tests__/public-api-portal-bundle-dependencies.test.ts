import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from '@/app/api/v1/customer/portal-bundle/route'
import { publicReference } from '@/lib/integrations/publicReferences'

const io = vi.hoisted(() => ({
  reads: [] as Array<{ table: string; query: URLSearchParams }>,
  gates: new Map<string, Promise<void>>(),
  fail: new Set<string>(),
  log: vi.fn(),
}))

const companyId = '00000000-0000-4000-8000-000000000001'
const customerId = '00000000-0000-4000-8000-000000000002'
const siteId = '00000000-0000-4000-8000-000000000003'
const meteringPointId = '00000000-0000-4000-8000-000000000004'
const externalCustomerId = 'synthetic-customer-subject'
const meteringValues = 'normalized_metering_values'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ediel/retention/customerRecordClasses', () => ({ requirePortalRetentionAccess: vi.fn() }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://synthetic.example.test', 'synthetic-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: readFixture },
    }),
  }
})
vi.mock('@/lib/customer-portal/externalApi', async (original) => ({
  ...await original<typeof import('@/lib/customer-portal/externalApi')>(),
  requireCustomerPortalApiContext: async () => authenticatedCustomer(),
  requireCustomerPortalApiContextForIdentifiers: async () => authenticatedCustomer(),
  logCustomerPortalSuccess: io.log,
}))

function authenticatedCustomer() {
  return {
    ok: true,
    client: { id: 'synthetic-client', company_id: companyId },
    startedAt: Date.now(),
    identity: {
      customer_id: customerId,
      external_customer_id: externalCustomerId,
      customer_number: '0001',
      provider: 'synthetic-provider',
      match_strength: 'strong',
      customer: { id: customerId, customer_type: 'private', status: 'active' },
    },
  }
}

async function readFixture(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.origin !== 'https://synthetic.example.test' || !url.pathname.startsWith('/rest/v1/') || init?.method !== 'GET') {
    throw new Error('Unexpected synthetic transport request')
  }
  const table = url.pathname.slice('/rest/v1/'.length)
  io.reads.push({ table, query: url.searchParams })
  await io.gates.get(table)

  if (io.fail.has(table)) {
    return Response.json({ code: '22000', message: 'Synthetic private table error' }, { status: 400 })
  }
  if (table === 'customer_sites') {
    return Response.json([{ id: siteId, customer_id: customerId, status: 'active' }])
  }
  if (table === 'metering_points') {
    return Response.json([{ id: meteringPointId, customer_id: customerId, customer_site_id: siteId, status: 'active' }])
  }
  return Response.json([])
}

function hold(table: string): () => void {
  let release!: () => void
  io.gates.set(table, new Promise<void>(resolve => { release = resolve }))
  return release
}

function readsFor(table: string): URLSearchParams[] {
  return io.reads.filter(read => read.table === table).map(read => read.query)
}

function requestBundle(method: 'GET' | 'POST'): Promise<Response> {
  const url = 'https://test.invalid/api/v1/customer/portal-bundle?include=metering_values'
  if (method === 'GET') return GET(new NextRequest(url))
  return POST(new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ external_customer_id: externalCustomerId }),
  }))
}

beforeEach(() => {
  io.reads = []
  io.gates.clear()
  io.fail.clear()
  io.log.mockClear()
})

afterEach(() => vi.restoreAllMocks())

describe('Portal Bundle metering-point dependency', () => {
  it.each(['GET', 'POST'] as const)('%s reads metering points when sites finish while independent metering values wait', async (method) => {
    const releaseSites = hold('customer_sites')
    const releaseValues = hold(meteringValues)
    const pending = requestBundle(method)
    let response: Response
    try {
      await vi.waitFor(() => {
        expect(readsFor('customer_sites')).toHaveLength(1)
        expect(readsFor(meteringValues)).toHaveLength(1)
      })
      expect(readsFor('metering_points')).toHaveLength(0)
      releaseSites()
      await vi.waitFor(() => expect(readsFor('metering_points')).toHaveLength(1), { timeout: 500 })
    } finally {
      releaseSites()
      releaseValues()
      response = await pending
    }

    expect(response.status).toBe(200)
    expect(readsFor('customer_sites')[0].get('company_id')).toBe(`eq.${companyId}`)
    expect(readsFor('customer_sites')[0].get('customer_id')).toBe(`eq.${customerId}`)
    expect(readsFor('metering_points')[0].get('company_id')).toBe(`eq.${companyId}`)
    expect(readsFor('metering_points')[0].get('or')).toBe(`(site_id.in.(${siteId}),customer_site_id.in.(${siteId}))`)
    const { data } = await response.json()
    expect(data.metering_points).toEqual([expect.objectContaining({
      metering_point_reference: publicReference('metering_point', companyId, meteringPointId),
      facility_reference: publicReference('facility', companyId, siteId),
    })])
    expect(data).toMatchObject({ metering_values: [], documents: [], bundle_status: { status: 'complete', complete: true } })
    expect(io.log).toHaveBeenCalledOnce()
  })

  it.each([
    { table: meteringValues, section: 'metering_values', status: 200, bundle: 'partial', complete: true },
    { table: 'metering_points', section: 'metering_points', status: 503, bundle: 'unavailable', complete: false },
  ])('preserves the bundle result when $section fails', async ({ table, section, status, bundle, complete }) => {
    io.fail.add(table)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await requestBundle('GET')
    expect(response.status).toBe(status)
    const { data } = await response.json()
    expect(data[section]).toEqual([])
    expect(data.bundle_status).toMatchObject({
      status: bundle,
      complete,
      unavailable_sections: [section],
      warnings: [expect.objectContaining({ section, code: 'section_unavailable' })],
    })
    expect(JSON.stringify(data)).not.toContain('Synthetic private table error')
    expect(data.metering_points).toHaveLength(section === 'metering_points' ? 0 : 1)
    expect(io.log).toHaveBeenCalledOnce()
  })

  it('keeps metering-point warnings last even if that read fails before an optional section', async () => {
    io.fail.add('metering_points')
    io.fail.add(meteringValues)
    const releaseValues = hold(meteringValues)
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const pending = requestBundle('GET')
    let response: Response
    try {
      await vi.waitFor(() => expect(logError).toHaveBeenCalledExactlyOnceWith(
        '[customer portal bundle] section failed', expect.objectContaining({ section: 'metering_points' }),
      ), { timeout: 500 })
    } finally {
      releaseValues()
      response = await pending
    }

    expect(response.status).toBe(503)
    const { data } = await response.json()
    expect(data.bundle_status.unavailable_sections).toEqual(['metering_values', 'metering_points'])
    expect(io.log).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ failed_sections: ['metering_values', 'metering_points'] }),
    }))
  })

  it('keeps the customer-scoped fallback and required warning when sites fail', async () => {
    io.fail.add('customer_sites')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await requestBundle('POST')
    expect(response.status).toBe(503)
    const { data } = await response.json()
    expect(data.bundle_status.unavailable_sections).toEqual(['sites'])
    expect(readsFor('metering_points')).toHaveLength(1)
    expect(readsFor('metering_points')[0].get('company_id')).toBe(`eq.${companyId}`)
    expect(readsFor('metering_points')[0].get('customer_id')).toBe(`eq.${customerId}`)
    expect(readsFor('metering_points')[0].has('or')).toBe(false)
  })
})
