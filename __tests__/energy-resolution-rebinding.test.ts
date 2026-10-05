import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const transport = vi.hoisted(() => ({ fetch: undefined as typeof fetch | undefined }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('https://qualification.invalid', 'unit-test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => transport.fetch!(input, init) },
  }) }
})

import { resolveOpsPapiliteGridOwnerForSite } from '@/lib/energy/opsPrecisionGridOwnerResolution'
import { applyUniqueSvkPostalGridOwnerToSite } from '@/lib/energy/svkPostalGridOwnerVerification'
import { resolveEnergyContext } from '@/lib/energy/resolver'
import { processPendingExactAddressResolutions } from '@/lib/energy/pendingExactAddressResolution'

type Row = Record<string, unknown>
const input = { companyId: 'company-a', customerId: 'customer-a', siteId: 'site-a', postalCode: '11122', city: 'Stockholm' }
const initialSite = (): Row => ({
  id: 'site-a', company_id: 'company-a', customer_id: 'customer-a', grid_owner_id: 'owner-a',
  grid_area_code: null, price_area_code: 'SE3', resolution_id: 'prior-resolution',
  resolution_status: 'needs_review', resolution_confidence: 0, metadata: { retained: 'site-evidence' },
  updated_at: '2026-10-05T10:00:00.000Z',
  street: 'Testgatan 1', postal_code: '11122', city: 'Stockholm', country: 'SE',
})

// Only the HTTP boundary is replaced: the production modules and actual
// Supabase client build the reads/writes. This fixture models selected columns,
// conditional updates and a resolution projection, not SQL/native acceptance.
function database() {
  const tables: Record<string, Row[]> = {
    customer_sites: [initialSite()], customer_site_resolution: [],
    customer_operation_jobs: [], grid_owner_information_requests: [], manual_email_outbox: [],
    canonical_energy_flow_events: [],
    platform_address_lookup_cache: [{
      address_key: 'postal_centroid|SE|11122', postal_code: '11122', city: 'Stockholm',
      latitude: 59.33, longitude: 18.06, provider: 'papilite_postal_centroid',
      raw_payload: { coordinate_scope: 'postal_centroid' }, expires_at: null,
    }],
    energy_geodata_versions: [{ provider: 'svk_arcgis', status: 'verified', version_key: 'svk-current', verified_at: new Date().toISOString() }],
    grid_owners: [{ id: 'owner-a', company_id: 'company-a' }],
    platform_postal_code_grid_mappings: [{
      postal_code: '11122', city: 'Stockholm', grid_area_code: 'AREA-A', price_area: 'SE3',
      confidence: 0.95, source: 'svk', is_active: true, updated_at: '2026-10-05T10:00:00Z',
      metadata: { materialization_method: 'postal_polygon_grid_area_intersection', source_version: 'svk-current' },
    }],
    platform_grid_areas: [{
      grid_area_code: 'AREA-A', grid_area_name: 'Area A', grid_owner_id: 'platform-owner-a',
      grid_owner_name: 'Owner A', price_area: 'SE3', is_active: true,
      platform_grid_owners: { name: 'Owner A', ops_grid_owner_id: 'owner-a' },
    }],
  }
  const spatial: Row = { grid_area_code: 'AREA-A', grid_area_name: 'Area A', grid_owner_id: 'owner-a', grid_owner_name: 'Owner A', price_area: 'SE3', confidence: 0.95 }
  const requests: { table: string; method: string; url: URL; body: Row | null }[] = []
  let beforeSiteRead: (() => void) | undefined
  let beforeRepair: (() => void) | undefined
  let siteReads = 0
  const atSiteRead = new Map<number, () => void>()
  const matches = (row: Row, params: URLSearchParams) => [...params].every(([key, value]) => {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) return true
    if (key === 'or') {
      const expiry = row.expires_at
      return expiry == null || Date.parse(String(expiry)) > Date.now()
    }
    if (value === 'is.null') return row[key] == null
    if (value.startsWith('eq.')) return row[key] != null && String(row[key]) === value.slice(3)
    if (value.startsWith('in.(')) return value.slice(4, -1).split(',').map(v => v.replace(/^"|"$/g, '')).includes(String(row[key]))
    if (value.startsWith('not.in.')) return !value.slice(8, -1).split(',').includes(String(row[key]))
    throw new Error(`Unhandled fixture filter ${key}=${value}`)
  })
  const project = (row: Row, select: string | null) => {
    if (!select || select === '*') return structuredClone(row)
    return Object.fromEntries(select.split(/,(?![^()]*\))/).map(key => {
      const field = key.split('(')[0]
      return [field, structuredClone(row[field] ?? null)]
    }))
  }
  transport.fetch = async (request, init) => {
    const url = new URL(String(request))
    if (url.hostname !== 'qualification.invalid') throw new Error('Unexpected external request')
    const table = url.pathname.split('/').at(-1)!
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) as Row : null
    requests.push({ table, method, url, body })
    if (table === 'gridex_lonlat_to_grid_area') return Response.json([spatial])
    if (table === 'customer_site_resolution' && method === 'GET' && url.searchParams.get('id') === 'eq.') {
      return Response.json({ code: '22P02', message: 'invalid input syntax for type uuid' }, { status: 400 })
    }
    if (!(table in tables)) throw new Error(`Unhandled fixture table ${table}`)
    if (table === 'customer_sites' && method === 'GET') {
      siteReads += 1
      atSiteRead.get(siteReads)?.()
      if (beforeSiteRead) { const action = beforeSiteRead; beforeSiteRead = undefined; action() }
    }
    if (table === 'customer_sites' && method === 'PATCH' && url.searchParams.get('grid_owner_id')?.startsWith('eq.') && beforeRepair) {
      const action = beforeRepair; beforeRepair = undefined; action()
    }
    let rows: Row[]
    if (method === 'POST') {
      const row = { id: `resolution-${tables[table].length + 1}`, ...body }
      tables[table].push(row); rows = [row]
    } else {
      rows = tables[table].filter(row => matches(row, url.searchParams))
      if (method === 'PATCH') for (const row of rows) {
        Object.assign(row, body)
        if (table === 'customer_sites' && body?.resolution_id) {
          const resolution = tables.customer_site_resolution.find(r => r.id === body.resolution_id)
          if (!resolution) throw new Error('Missing bound resolution')
          row.grid_owner_id = resolution.grid_owner_id
          row.grid_area_code = resolution.grid_area_code
          row.price_area_code = resolution.price_area
        }
      }
    }
    const projected = rows.map(row => project(row, url.searchParams.get('select')))
    const single = new Headers(init?.headers).get('accept')?.includes('vnd.pgrst.object')
    return Response.json(single ? projected[0] ?? null : projected, { headers: { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` } })
  }
  return { tables, spatial, requests,
    onSiteRead(action: () => void) { beforeSiteRead = action },
    onSiteReadAt(index: number, action: () => void) { atSiteRead.set(index, action) },
    onRepair(action: () => void) { beforeRepair = action },
    site() { return tables.customer_sites[0] },
  }
}

beforeEach(() => {
  vi.stubEnv('PAPILITE_API_KEY', 'unit-test-provider-key')
  vi.stubEnv('LANTMATERIET_BELAGENHETSADRESS_USERNAME', '')
  vi.stubEnv('LANTMATERIET_BELAGENHETSADRESS_PASSWORD', '')
  vi.stubGlobal('fetch', async () => { throw new Error('Unexpected live network call') })
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe.each([
  { label: 'OPS centroid', run: resolveOpsPapiliteGridOwnerForSite, refused: 'concurrent_site_update' },
  { label: 'legacy postal polygon', run: applyUniqueSvkPostalGridOwnerToSite, refused: 'ambiguous' },
])('$label conditional resolution repair', ({ run, refused }) => {
  it('repairs an own matching owner with missing area through a resolution binding', async () => {
    const db = database()
    const result = await run(input)
    expect(result.status).toBe('verified')
    expect(db.site()).toMatchObject({ grid_owner_id: 'owner-a', grid_area_code: 'AREA-A', price_area_code: 'SE3', resolution_id: 'resolution-1', metadata: { retained: 'site-evidence' } })
  })

  it('repairs a stale unverified area under the same owner', async () => {
    const db = database(); db.site().grid_area_code = 'OLD-AREA'
    expect((await run(input)).status).toBe('verified')
    expect(db.site().grid_area_code).toBe('AREA-A')
  })

  it.each(['facility_verified', 'manual_verified'])('preserves a completed %s binding that arrived during lookup', async status => {
    const db = database()
    db.onSiteRead(() => Object.assign(db.site(), {
      grid_area_code: 'AREA-B', resolution_id: 'facility-resolution', resolution_status: status,
      resolution_confidence: 1, metadata: { facility_response: 'accepted' },
    }))
    expect((await run(input)).status).toBe(refused)
    expect(db.site()).toMatchObject({ grid_area_code: 'AREA-B', resolution_id: 'facility-resolution', resolution_status: status, metadata: { facility_response: 'accepted' } })
  })

  it.each([
    { field: 'resolution_id', value: 'newer-binding' },
    { field: 'grid_area_code', value: 'AREA-B' },
    { field: 'price_area_code', value: 'SE4' },
    { field: 'resolution_status', value: 'facility_verified' },
    { field: 'updated_at', value: '2026-10-05T11:00:00.000Z' },
    { field: 'grid_owner_id', value: 'other-owner' },
    { field: 'company_id', value: 'company-b' },
    { field: 'customer_id', value: 'customer-b' },
  ])('refuses a concurrent change of $field after the repair read', async ({ field, value }) => {
    const db = database()
    db.onRepair(() => { db.site()[field] = value })
    expect((await run(input)).status).toBe(refused)
    expect(db.site()[field]).toBe(value)
    expect(db.site().resolution_id).toBe(field === 'resolution_id' ? value : 'prior-resolution')
  })

  it('preserves fresh site metadata instead of replacing it with the worker snapshot', async () => {
    const db = database()
    expect((await run({ ...input, metadata: { retained: 'old-worker-evidence' } })).status).toBe('verified')
    expect(db.site().metadata).toMatchObject({ retained: 'site-evidence' })
  })

  it('preserves a conflicting price completed before the repair read', async () => {
    const db = database()
    // For the legacy path the first read may gather price context before insert;
    // for either path the inserted candidate must not replace the fresh price.
    db.onSiteRead(() => { db.site().price_area_code = 'SE4' })
    expect((await run(input)).status).toBe(refused)
    expect(db.site()).toMatchObject({ price_area_code: 'SE4', resolution_id: 'prior-resolution' })
  })
})

describe('OPS cache and evidence boundaries', () => {
  it('uses a valid centroid cache without requiring a provider API key or network lookup', async () => {
    const db = database(); vi.stubEnv('PAPILITE_API_KEY', '')
    const result = await resolveOpsPapiliteGridOwnerForSite(input)
    expect(result).toMatchObject({ status: 'verified', centroidSource: 'cache' })
    expect(db.site().grid_area_code).toBe('AREA-A')
  })
  it.each([
    { field: 'provider', value: 'exact-address-provider' },
    { field: 'raw_payload', value: { coordinate_scope: 'address_point' } },
    { field: 'expires_at', value: '2020-01-01T00:00:00Z' },
  ])('refuses invalid or expired cache $field with no API key', async ({ field, value }) => {
    const db = database(); vi.stubEnv('PAPILITE_API_KEY', '')
    db.tables.platform_address_lookup_cache[0][field] = value
    expect((await resolveOpsPapiliteGridOwnerForSite(input)).status).toBe('papilite_not_configured')
    expect(db.site().resolution_id).toBe('prior-resolution')
  })
  it('refuses confidence below the spatial verification threshold', async () => {
    const db = database(); db.spatial.confidence = 0.9
    expect((await resolveOpsPapiliteGridOwnerForSite(input)).status).toBe('svk_confidence_low')
    expect(db.site().resolution_id).toBe('prior-resolution')
  })
  it('refuses stale SVK geodata', async () => {
    const db = database(); db.tables.energy_geodata_versions[0].verified_at = '2020-01-01T00:00:00Z'
    expect((await resolveOpsPapiliteGridOwnerForSite(input)).status).toBe('svk_geodata_stale')
    expect(db.site().resolution_id).toBe('prior-resolution')
  })
  it('refuses a conflicting current price area', async () => {
    const db = database()
    expect((await resolveOpsPapiliteGridOwnerForSite({ ...input, currentPriceArea: 'SE4' })).status).toBe('price_area_conflict')
    expect(db.site().resolution_id).toBe('prior-resolution')
  })
})

it.each([
  { status: 'verified', confidence: 1 },
  { status: 'estimated', confidence: 0.9 },
])('retains existing $status price assurance when legacy geography has no price', async ({ status, confidence }) => {
  const db = database()
  db.tables.platform_grid_areas[0].price_area = null
  db.tables.platform_postal_code_grid_mappings[0].price_area = null
  db.tables.customer_site_resolution.push({
    id: 'prior-resolution', company_id: 'company-a', customer_id: 'customer-a', customer_site_id: 'site-a',
    price_area: 'SE3', price_area_assurance_status: status, price_area_assurance_source: 'postal_consensus',
    price_area_assurance_confidence: confidence, price_area_assurance_source_version: 'prior-version',
    price_area_candidate_count: 1, price_area_unique_count: 1, price_area_evidence: { preserved: 'price-proof' },
  })
  const result = await applyUniqueSvkPostalGridOwnerToSite(input)
  expect(result.status).toBe('verified')
  expect(db.site()).toMatchObject({ grid_area_code: 'AREA-A', price_area_code: 'SE3' })
  expect(db.tables.customer_site_resolution[1]).toMatchObject({
    price_area: 'SE3', price_area_assurance_status: status, price_area_assurance_source: 'postal_consensus',
    price_area_assurance_confidence: confidence, price_area_assurance_source_version: 'prior-version',
    price_area_evidence: { preserved: 'price-proof' },
  })
})

it('holds unbound existing price without emitting an invalid UUID lookup', async () => {
  const db = database(); db.site().resolution_id = null
  db.tables.platform_grid_areas[0].price_area = null
  db.tables.platform_postal_code_grid_mappings[0].price_area = null
  expect((await applyUniqueSvkPostalGridOwnerToSite(input)).status).toBe('ambiguous')
  expect(db.site()).toMatchObject({ price_area_code: 'SE3', resolution_id: null })
  expect(db.tables.customer_site_resolution).toHaveLength(0)
})

describe('actual public resolver boundaries', () => {
  it('honors a disabled exact provider even with a complete street address', async () => {
    const db = database(); db.tables.platform_postal_code_grid_mappings = []
    const result = await resolveEnergyContext({ ...input, customerSiteId: input.siteId, street: 'Testgatan 1', metadata: { exact_address_provider_allowed: false } })
    expect(result).toMatchObject({ resolutionStatus: 'postal_suggested', priceArea: 'SE3', confidence: 0.7, automationAllowed: false })
    const cacheRequests = db.requests.filter(r => r.table === 'platform_address_lookup_cache')
    expect(cacheRequests.every(r => r.url.searchParams.get('address_key') === 'eq.postal_centroid|SE|11122')).toBe(true)
    expect(db.tables.customer_site_resolution).toHaveLength(1)
    expect(db.tables.canonical_energy_flow_events).toHaveLength(1)
  })

  it('persists centroid price evidence without rebinding stronger site geography', async () => {
    const db = database(); db.tables.platform_postal_code_grid_mappings = []
    const before = structuredClone(db.site())
    const result = await resolveEnergyContext({ ...input, customerSiteId: input.siteId, metadata: { exact_address_provider_allowed: false } })
    expect(result).toMatchObject({ resolutionStatus: 'postal_suggested', resolutionId: 'resolution-1', priceAreaAssurance: { status: 'estimated', confidence: 0.7 } })
    expect(db.site()).toEqual(before)
    expect(db.tables.customer_site_resolution[0]).toMatchObject({ company_id: 'company-a', customer_site_id: 'site-a', price_area: 'SE3', automation_allowed: false })
  })
})

describe('actual pending worker projection boundaries', () => {
  function workerDatabase() {
    const db = database()
    db.tables.customer_operation_jobs.push({
      id: 'job-a', company_id: 'company-a', customer_id: 'customer-a', customer_site_id: 'site-a',
      job_type: 'customer_application_continuation', status: 'queued',
      result: { dependency_code: 'grid_owner_resolution', dependency_wait: true }, payload: {}, run_after: '2020-01-01T00:00:00Z',
    })
    db.tables.grid_owner_information_requests.push({ id: 'request-a', company_id: 'company-a', customer_site_id: 'site-a', request_type: 'facility_lookup', status: 'draft', grid_owner_id: 'old-owner' })
    return db
  }

  it('wakes and reconciles only from the refreshed own site binding', async () => {
    const db = workerDatabase()
    const result = await processPendingExactAddressResolutions()
    expect(result).toMatchObject({ scanned: 1, papiliteVerified: 1, woken: 1, errors: 0 })
    expect(db.tables.customer_operation_jobs[0].result).toMatchObject({ dependency_wait: false, canonical_grid_owner_id: 'owner-a', canonical_grid_area_code: 'AREA-A' })
    expect(db.tables.grid_owner_information_requests[0]).toMatchObject({ grid_owner_id: 'owner-a', grid_area_code: 'AREA-A', price_area: 'SE3' })
  })

  it('does not wake or reconcile when the own site disappears before the projection reread', async () => {
    const db = workerDatabase(); db.onSiteReadAt(3, () => { db.tables.customer_sites = [] })
    expect(await processPendingExactAddressResolutions()).toMatchObject({ woken: 0, errors: 0 })
    expect(db.tables.customer_operation_jobs[0].result).toMatchObject({ dependency_wait: true, exact_address_status: 'site_missing' })
    expect(db.tables.grid_owner_information_requests[0].grid_owner_id).toBe('old-owner')
  })

  it('holds an unbound projection when the exact fallback is unconfigured', async () => {
    const db = workerDatabase(); db.onSiteReadAt(3, () => { db.site().grid_area_code = null })
    expect(await processPendingExactAddressResolutions()).toMatchObject({ woken: 0, errors: 0 })
    expect(db.tables.customer_operation_jobs[0].result).toMatchObject({ dependency_wait: true, exact_address_status: 'papilite_verified_but_site_projection_missing' })
    expect(db.tables.grid_owner_information_requests[0].grid_owner_id).toBe('old-owner')
  })

  it('uses the configured exact fallback without waking an unbound projection', async () => {
    const db = workerDatabase(); db.onSiteReadAt(3, () => { db.site().grid_area_code = null })
    vi.stubEnv('LANTMATERIET_BELAGENHETSADRESS_USERNAME', 'unit-test-user')
    vi.stubEnv('LANTMATERIET_BELAGENHETSADRESS_PASSWORD', 'unit-test-password')
    vi.stubEnv('LANTMATERIET_BELAGENHETSADRESS_BASE_URL', 'https://geotorget.test.invalid')
    const exactRequests: string[] = []
    vi.stubGlobal('fetch', async (url: string) => { expect(new URL(url).hostname).toBe('geotorget.test.invalid'); exactRequests.push(url); return Response.json({ features: [] }) })
    expect(await processPendingExactAddressResolutions()).toMatchObject({ woken: 0, papiliteFallback: 1, errors: 0 })
    expect(exactRequests.length).toBeGreaterThan(0)
    expect(db.tables.customer_operation_jobs[0].result).toMatchObject({ dependency_wait: true, exact_address_status: 'no_match' })
    expect(db.tables.grid_owner_information_requests[0].grid_owner_id).toBe('old-owner')
  })
})
