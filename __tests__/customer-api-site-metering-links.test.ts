import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as getSites } from '@/app/api/v1/customer/sites/route'
import { GET as getBundle, POST as postBundle } from '@/app/api/v1/customer/portal-bundle/route'
import { publicReference } from '@/lib/integrations/publicReferences'

type Row = Record<string, string | null>
type Endpoint = 'sites' | 'bundle GET' | 'bundle POST'

const fixture = vi.hoisted(() => ({
  meters: [] as Row[],
  sites: [] as Row[],
  sitesUnavailable: false,
  missingMeterColumns: new Set<string>(),
  meterReads: [] as URLSearchParams[],
  meterRowsCap: Infinity,
  meterCountOverride: null as number | null,
  meterReadFailure: null as number | null,
}))

const company = '00000000-0000-4000-8000-000000000001'
const customer = '00000000-0000-4000-8000-000000000002'
const firstSite = '00000000-0000-4000-8000-000000000003'
const secondSite = '00000000-0000-4000-8000-000000000004'
const canonicalMeter = '00000000-0000-4000-8000-000000000005'
const legacyMeter = '00000000-0000-4000-8000-000000000006'
const otherCustomerSite = '00000000-0000-4000-8000-000000000007'
const otherMeter = '00000000-0000-4000-8000-000000000008'
const otherCompany = '00000000-0000-4000-8000-000000000009'
const otherCustomer = '00000000-0000-4000-8000-000000000010'
const conflictingMeter = '00000000-0000-4000-8000-000000000011'
const otherCompanyMeter = '00000000-0000-4000-8000-000000000012'
const storedFacilityReference = 'facility_0123456789abcdef0123456789abcdef'
const subject = 'synthetic-customer'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ediel/retention/customerRecordClasses', () => ({ requirePortalRetentionAccess: vi.fn() }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://synthetic.example.test', 'synthetic-meter-fixture', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: readFixture },
    }),
  }
})
vi.mock('@/lib/customer-portal/externalApi', async (original) => ({
  ...await original<typeof import('@/lib/customer-portal/externalApi')>(),
  requireCustomerPortalApiContext: async () => authenticatedCustomer(),
  requireCustomerPortalApiContextForIdentifiers: async () => authenticatedCustomer(),
  logCustomerPortalSuccess: vi.fn(),
}))

function authenticatedCustomer() {
  return {
    ok: true,
    client: { id: 'synthetic-client', company_id: company },
    startedAt: Date.now(),
    identity: {
      customer_id: customer,
      customer_number: '0001',
      external_customer_id: subject,
      provider: 'synthetic-provider',
      match_strength: 'strong',
      customer: { id: customer, customer_type: 'private', status: 'active' },
    },
  }
}

const emptyBundleTables = new Set([
  'customer_contracts', 'normalized_metering_values', 'customer_legal_acceptances',
  'powers_of_attorney', 'website_customer_applications',
])

function matches(value: string | null | undefined, list: string) {
  return typeof value === 'string' && list.split(',').includes(value)
}

function matchesMeterSiteFilter(row: Row, filter: string) {
  const canonicalFirst = /^\(customer_site_id\.in\.\(([^)]+)\),and\(customer_site_id\.is\.null,site_id\.in\.\(([^)]+)\)\)\)$/.exec(filter)
  if (canonicalFirst) {
    return row.customer_site_id == null
      ? matches(row.site_id, canonicalFirst[2])
      : matches(row.customer_site_id, canonicalFirst[1])
  }
  const eitherLink = /^\(site_id\.in\.\(([^)]+)\),customer_site_id\.in\.\(([^)]+)\)\)$/.exec(filter)
  if (eitherLink) return matches(row.site_id, eitherLink[1]) || matches(row.customer_site_id, eitherLink[2])
  throw new Error('Unexpected synthetic site filter')
}

async function readFixture(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.origin !== 'https://synthetic.example.test' || !url.pathname.startsWith('/rest/v1/')) {
    throw new Error('Unexpected synthetic transport')
  }
  const table = url.pathname.slice('/rest/v1/'.length)
  if (table === 'customer_portal_api_access_logs' && init?.method === 'POST') return new Response(null, { status: 201 })
  if (init?.method !== 'GET') throw new Error('Unexpected synthetic operation')

  const params = url.searchParams
  if (emptyBundleTables.has(table)) return Response.json([])
  if (table !== 'customer_sites' && table !== 'metering_points') throw new Error(`Unexpected synthetic table ${table}`)
  if (table === 'customer_sites' && fixture.sitesUnavailable) {
    return Response.json({ code: '22000', message: 'Synthetic site read failure' }, { status: 400 })
  }

  const columns = (params.get('select') ?? '').split(',')
  const filters = [...params.entries()].filter(([, op]) => op.startsWith('eq.') || op.startsWith('in.'))
  const siteFilter = params.get('or')
  if (table === 'metering_points') {
    fixture.meterReads.push(params)
    if (fixture.meterReadFailure === fixture.meterReads.length) {
      return Response.json({ code: '42501', message: 'Synthetic metering point permission error' }, { status: 403 })
    }
    const used = [...columns, ...filters.map(([name]) => name), ...(siteFilter ? ['site_id', 'customer_site_id'] : [])]
    const missing = used.find((name) => fixture.missingMeterColumns.has(name))
    if (missing) return Response.json({ code: '42703', message: `column metering_points.${missing} does not exist` }, { status: 400 })
  }

  let matched = (table === 'metering_points' ? fixture.meters : fixture.sites)
    .filter((row) => filters.every(([name, op]) => op.startsWith('eq.')
      ? row[name] === op.slice(3)
      : matches(row[name], op.slice(4, -1))))
    .filter((row) => !siteFilter || matchesMeterSiteFilter(row, siteFilter))
  const after = params.get('id')
  if (after?.startsWith('gt.')) {
    const cursor = after.slice(3)
    matched = matched.filter((row) => String(row.id) > cursor)
  }
  if (params.get('order') === 'id.asc') {
    matched.sort((left, right) => String(left.id).localeCompare(String(right.id)))
  }
  const limit = params.has('limit') ? Number(params.get('limit')) : Infinity
  const rows = matched.slice(0, Math.min(limit, table === 'metering_points' ? fixture.meterRowsCap : Infinity))
    .map((row) => Object.fromEntries(columns.map((name) => [name, row[name] ?? null])))

  const headers = new Headers()
  if (new Headers(init.headers).get('prefer')?.includes('count=exact')) {
    const count = fixture.meterCountOverride ?? matched.length
    headers.set('content-range', `${rows.length ? `0-${rows.length - 1}` : '*'}/${count}`)
  }
  return Response.json(rows, { headers })
}

function request(endpoint: Endpoint, search = ''): Promise<Response> {
  if (endpoint === 'sites') return getSites(new NextRequest(`https://test.invalid/api/v1/customer/sites${search}`))
  const url = 'https://test.invalid/api/v1/customer/portal-bundle?include=metering_values'
  if (endpoint === 'bundle GET') return getBundle(new NextRequest(url))
  return postBundle(new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ external_customer_id: subject }),
  }))
}

beforeEach(() => {
  fixture.meterReads = []
  fixture.sitesUnavailable = false
  fixture.meterRowsCap = Infinity
  fixture.meterCountOverride = null
  fixture.meterReadFailure = null
  // Committed metering_points uses measurement_type. metering_type is a public DTO key.
  fixture.missingMeterColumns = new Set(['metering_type'])
  const owner = { company_id: company, customer_id: customer, status: 'active', created_at: '2026-10-01T00:00:00Z' }
  fixture.sites = [
    { ...owner, id: firstSite, facility_reference: storedFacilityReference },
    { ...owner, id: secondSite, created_at: '2026-09-01T00:00:00Z' },
    { ...owner, id: otherCustomerSite, customer_id: otherCustomer },
  ]
  fixture.meters = [
    { ...owner, id: canonicalMeter, customer_site_id: firstSite, site_id: null, measurement_type: 'production' },
    { ...owner, id: legacyMeter, customer_site_id: null, site_id: secondSite, measurement_type: 'consumption' },
    { ...owner, id: otherCompanyMeter, customer_site_id: firstSite, company_id: otherCompany },
    { ...owner, id: otherMeter, customer_site_id: otherCustomerSite, customer_id: otherCustomer },
  ]
})

describe('customer sites and metering point references', () => {
  it.each(['sites', 'bundle GET', 'bundle POST'] as const)('%s returns modern and legacy points in one tenant-scoped read', async (endpoint) => {
    const response = await request(endpoint)
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.sites.map((site: Row) => site.facility_reference)).toEqual([
      storedFacilityReference, publicReference('facility', company, secondSite),
    ])
    expect(data.metering_points).toMatchObject([
      { metering_point_reference: publicReference('metering_point', company, canonicalMeter), facility_reference: storedFacilityReference, metering_type: 'production' },
      { metering_point_reference: publicReference('metering_point', company, legacyMeter), facility_reference: data.sites[1].facility_reference, metering_type: 'consumption' },
    ])
    expect(fixture.meterReads).toHaveLength(1)
    expect(fixture.meterReads[0].get('company_id')).toBe(`eq.${company}`)
    const ids = `${firstSite},${secondSite}`
    expect(fixture.meterReads[0].get('or')).toBe(`(customer_site_id.in.(${ids}),and(customer_site_id.is.null,site_id.in.(${ids})))`)
    expect(fixture.meterReads[0].get('limit')).toBe(endpoint === 'sites' ? '500' : '100')
  })

  it('returns all 1,001 points from the sole Sites page below a reduced PostgREST row cap', async () => {
    fixture.sites = [fixture.sites[0]]
    fixture.meterRowsCap = 250
    const matches = Array.from({ length: 1001 }, (_, index) => ({
      ...fixture.meters[0],
      id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    }))
    fixture.meters = [fixture.meters[2], fixture.meters[3], ...matches.slice().reverse()]
    const response = await request('sites')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.page.sites).toMatchObject({ returned: 1, has_more: false })
    expect(body.data.metering_points.map((point: Row) => point.metering_point_reference)).toEqual(
      matches.map((point) => publicReference('metering_point', company, point.id)),
    )
    expect(fixture.meterReads.map((query) => query.get('id'))).toEqual([
      null, ...[249, 499, 749, 999].map((index) => `gt.${matches[index].id}`),
    ])
    for (const query of fixture.meterReads) {
      expect(query.get('company_id')).toBe(`eq.${company}`)
      expect(query.get('or')).toBe(`(customer_site_id.in.(${firstSite}),and(customer_site_id.is.null,site_id.in.(${firstSite})))`)
      expect(query.get('order')).toBe('id.asc')
    }
  })

  it('keeps the Bundle preview bounded when the full Sites page has more points', async () => {
    fixture.meters = Array.from({ length: 110 }, (_, index) => ({
      ...fixture.meters[0],
      id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    }))
    const response = await request('bundle GET')
    expect(response.status).toBe(200)
    expect((await response.json()).data.metering_points).toHaveLength(100)
    expect(fixture.meterReads).toHaveLength(1)
    expect(fixture.meterReads[0].get('limit')).toBe('100')
  })

  it.each(['later permission error', 'unconfirmed count', 'over the row budget'] as const)(
    'returns 503 without a partial list for %s', async (problem) => {
      fixture.meterRowsCap = 1
      if (problem === 'later permission error') fixture.meterReadFailure = 2
      if (problem === 'unconfirmed count') fixture.meterCountOverride = 0
      if (problem === 'over the row budget') fixture.meterCountOverride = 10_001
      const response = await request('sites')
      expect(response.status).toBe(503)
      const raw = await response.text()
      expect(raw).toContain('site_metering_points_read_incomplete')
      expect(raw).not.toContain('Synthetic metering point permission error')
      expect(raw).not.toContain('metering_points"')
      expect(fixture.meterReads).toHaveLength(problem === 'later permission error' ? 2 : 1)
    },
  )

  it.each(['sites', 'bundle GET'] as const)('%s keeps both links if optional modern meter columns are unavailable', async (endpoint) => {
    fixture.missingMeterColumns.add('onboarding_status')
    const response = await request(endpoint)
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.metering_points.map((point: Row) => point.facility_reference)).toEqual([
      storedFacilityReference, publicReference('facility', company, secondSite),
    ])
    expect(fixture.meterReads).toHaveLength(2)
    expect(fixture.meterReads[1].get('or')).toBe(fixture.meterReads[0].get('or'))
  })

  it('keeps the canonical link with the minimal supported meter projection', async () => {
    fixture.missingMeterColumns.add('measurement_type')
    const response = await request('sites')
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.metering_points).toMatchObject([
      { metering_point_reference: publicReference('metering_point', company, canonicalMeter), facility_reference: storedFacilityReference, metering_type: null },
      { metering_point_reference: publicReference('metering_point', company, legacyMeter), facility_reference: data.sites[1].facility_reference, metering_type: null },
    ])
    expect(fixture.meterReads).toHaveLength(3)
    expect(fixture.meterReads[2].get('or')).toBe(fixture.meterReads[0].get('or'))
  })

  it('keeps the canonical link when a stale legacy link points to another returned site', async () => {
    fixture.meters[0].site_id = secondSite
    const response = await request('sites')
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.metering_points[0]).toMatchObject({
      metering_point_reference: publicReference('metering_point', company, canonicalMeter),
      facility_reference: storedFacilityReference,
    })
  })

  it.each(['sites', 'bundle GET', 'bundle POST'] as const)('%s excludes a foreign canonical site even if the legacy site is authorized', async (endpoint) => {
    fixture.meters.push({
      ...fixture.meters[0], id: conflictingMeter, site_id: firstSite, customer_site_id: otherCustomerSite,
    })
    const response = await request(endpoint)
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.metering_points.map((point: Row) => point.metering_point_reference)).toEqual([
      publicReference('metering_point', company, canonicalMeter), publicReference('metering_point', company, legacyMeter),
    ])
  })

  it('lets only the canonical site page grant access when both links are populated', async () => {
    fixture.meters[0].site_id = secondSite
    fixture.meters.push({
      ...fixture.meters[0], id: conflictingMeter, site_id: firstSite, customer_site_id: secondSite,
    })
    const response = await request('sites', '?limit=1')
    expect(response.status).toBe(200)
    const { data, page } = await response.json()
    expect(page.sites).toMatchObject({ returned: 1, has_more: true })
    expect(data.sites[0].facility_reference).toBe(storedFacilityReference)
    expect(data.metering_points).toMatchObject([
      { metering_point_reference: publicReference('metering_point', company, canonicalMeter), facility_reference: storedFacilityReference },
    ])
  })

  it('preserves a customer-scoped Bundle meter without disclosing an unmatched canonical site reference', async () => {
    fixture.sites = fixture.sites.filter((site) => site.customer_id === otherCustomer)
    fixture.meters[0].customer_site_id = otherCustomerSite
    fixture.meters.splice(1, 1)
    const response = await request('bundle GET')
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.sites).toEqual([])
    expect(data.bundle_status).toMatchObject({ status: 'complete', warnings: [] })
    expect(data.metering_points).toMatchObject([
      { metering_point_reference: publicReference('metering_point', company, canonicalMeter), facility_reference: null },
    ])
    expect(fixture.meterReads).toHaveLength(1)
    expect(fixture.meterReads[0].get('company_id')).toBe(`eq.${company}`)
    expect(fixture.meterReads[0].get('customer_id')).toBe(`eq.${customer}`)
    expect(fixture.meterReads[0].get('or')).toBeNull()
  })

  it('preserves the degraded Bundle warning and legacy reference when the sites read fails', async () => {
    fixture.sitesUnavailable = true
    fixture.meters[1].customer_site_id = otherCustomerSite
    const response = await request('bundle POST')
    expect(response.status).toBe(503)
    const { data } = await response.json()
    expect(data.sites).toEqual([])
    expect(data.bundle_status).toMatchObject({ status: 'unavailable', unavailable_sections: ['sites'] })
    expect(data.metering_points).toMatchObject([
      { metering_point_reference: publicReference('metering_point', company, canonicalMeter), facility_reference: null },
      { metering_point_reference: publicReference('metering_point', company, legacyMeter), facility_reference: publicReference('facility', company, secondSite) },
    ])
  })

  it.each(['sites', 'bundle GET'] as const)('%s supports the original site_id schema and reuses the site reference', async (endpoint) => {
    fixture.missingMeterColumns.add('customer_site_id')
    fixture.meters[1].site_id = firstSite
    const response = await request(endpoint)
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.metering_points).toMatchObject([
      { metering_point_reference: publicReference('metering_point', company, legacyMeter), facility_reference: storedFacilityReference },
    ])
    const executed = fixture.meterReads.at(-1)
    expect(executed?.get('company_id')).toBe(`eq.${company}`)
    expect(executed?.get('site_id')).toBe(`in.(${firstSite},${secondSite})`)
    expect(executed?.get('or')).toBeNull()
  })
})
