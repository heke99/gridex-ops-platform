import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as getSites } from '@/app/api/v1/customer/sites/route'
import { GET as getBundle } from '@/app/api/v1/customer/portal-bundle/route'
import { publicReference } from '@/lib/integrations/publicReferences'

type Endpoint = 'sites' | 'bundle'
type SiteRow = Record<string, string | null>
const fixture = vi.hoisted(() => ({
  reads: [] as URLSearchParams[],
  missing: new Set<string>(),
  failOnRead: 0,
}))

const company = '00000000-0000-4000-8000-000000000001'
const customer = '00000000-0000-4000-8000-000000000002'
const primarySite = '00000000-0000-4000-8000-000000000003'
const storedReference = 'facility_0123456789abcdef0123456789abcdef'
const nonSchemaMessage = 'Synthetic database permission denied (customer_sites)'
const ownSite = { company_id: company, customer_id: customer, created_at: '2026-10-01T00:00:00Z' }
const rows: SiteRow[] = [
  { ...ownSite, id: primarySite, facility_reference: storedReference, street: 'Syntetisk gata 12', care_of: 'Exempelombud', country: 'SE' },
  { ...ownSite, id: '00000000-0000-4000-8000-000000000004', street: 'Syntetisk gata 14', care_of: null },
  { ...ownSite, id: '00000000-0000-4000-8000-000000000005', customer_id: 'synthetic-other-customer', care_of: 'Foreign customer address' },
  { ...ownSite, id: '00000000-0000-4000-8000-000000000006', company_id: 'synthetic-other-company', care_of: 'Foreign company address' },
]

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ediel/retention/customerRecordClasses', () => ({ requirePortalRetentionAccess: vi.fn() }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://synthetic.example.test', 'fixture-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: readFixture },
    }),
  }
})
vi.mock('@/lib/customer-portal/externalApi', async (original) => ({
  ...await original<typeof import('@/lib/customer-portal/externalApi')>(),
  requireCustomerPortalApiContext: async () => ({
    ok: true,
    client: { id: 'synthetic-client', company_id: company },
    startedAt: Date.now(),
    identity: {
      customer_id: customer,
      customer_number: '0001',
      external_customer_id: 'synthetic-customer',
      provider: 'synthetic-provider',
      match_strength: 'strong',
      customer: { id: customer, customer_type: 'private', status: 'active' },
    },
  }),
  logCustomerPortalSuccess: vi.fn(),
}))

const otherReads = new Set([
  'metering_points', 'customer_contracts', 'normalized_metering_values',
  'customer_legal_acceptances', 'powers_of_attorney', 'website_customer_applications',
])
const auditTables = new Set(['customer_portal_api_access_logs', 'integration_api_request_logs'])

async function readFixture(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  expect(url.origin).toBe('https://synthetic.example.test')
  const table = url.pathname.replace(/^\/rest\/v1\//, '')
  if (auditTables.has(table) && init?.method === 'POST') return new Response(null, { status: 201 })
  expect(init?.method).toBe('GET')
  if (otherReads.has(table)) return Response.json([])
  expect(table).toBe('customer_sites')

  const query = url.searchParams
  fixture.reads.push(query)
  const columns = query.get('select')?.split(',') ?? []
  const firstMissing = columns.find(column => fixture.missing.has(column))
  if (firstMissing) {
    return Response.json({ code: '42703', message: `column customer_sites.${firstMissing} does not exist` }, { status: 400 })
  }
  if (fixture.failOnRead === fixture.reads.length) {
    return Response.json({ code: '42501', message: nonSchemaMessage }, { status: 403 })
  }

  // Apply the requested projection and filters, including both tenant columns.
  expect(query.get('company_id')).toBe(`eq.${company}`)
  expect(query.get('customer_id')).toBe(`eq.${customer}`)
  return Response.json(rows.filter(row =>
    query.get('company_id') === `eq.${row.company_id}` && query.get('customer_id') === `eq.${row.customer_id}`,
  ).map(row => Object.fromEntries(columns.map(column => [column, row[column] ?? null]))))
}

function request(endpoint: Endpoint) {
  return endpoint === 'sites'
    ? getSites(new NextRequest('https://gridex.test/api/v1/customer/sites?limit=2'))
    : getBundle(new NextRequest('https://gridex.test/api/v1/customer/portal-bundle?include=metering_values'))
}

beforeEach(() => {
  fixture.reads = []
  fixture.missing.clear()
  fixture.failOnRead = 0
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => vi.restoreAllMocks())

describe.each(['sites', 'bundle'] as const)('portal %s address projection', (endpoint) => {
  it('delivers persisted c/o and genuine null addresses within the authenticated scope', async () => {
    const response = await request(endpoint)
    expect(response.status).toBe(200)
    const raw = await response.text()
    expect(raw).not.toContain('Foreign')
    const { data } = JSON.parse(raw)
    expect(data.sites).toHaveLength(2)
    expect(data.sites[0]).toMatchObject({
      facility_reference: storedReference,
      address: { street: 'Syntetisk gata 12', care_of: 'Exempelombud', country: 'SE' },
    })
    expect(data.sites[1].address.care_of).toBeNull()
    expect(fixture.reads).toHaveLength(1)
    expect(fixture.reads[0].get('limit')).toBe(endpoint === 'sites' ? '3' : '100')
  })

  it('keeps the stored facility reference when an older schema lacks c/o', async () => {
    fixture.missing.add('care_of')
    const response = await request(endpoint)
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.sites[0]).toMatchObject({ facility_reference: storedReference, address: { care_of: null } })
    expect(fixture.reads).toHaveLength(2)
    expect(fixture.reads[1].get('select')?.split(',')).toContain('facility_reference')
  })

  it('still delivers stored c/o when an older schema lacks the canonical key', async () => {
    fixture.missing.add('facility_reference')
    const response = await request(endpoint)
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.sites[0]).toMatchObject({
      facility_reference: publicReference('facility', company, primarySite),
      address: { care_of: 'Exempelombud' },
    })
    expect(fixture.reads.at(-1)?.get('select')?.split(',')).not.toContain('facility_reference')
  })

  it('reports a real database failure encountered after the schema fallback', async () => {
    fixture.missing.add('care_of')
    fixture.failOnRead = 2
    const response = await request(endpoint)
    expect(response.status).toBe(endpoint === 'sites' ? 500 : 503)
    expect(await response.text()).not.toContain(nonSchemaMessage)
    expect(fixture.reads).toHaveLength(2)
  })
})
