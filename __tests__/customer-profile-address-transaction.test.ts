// ops-api-review: F20, F21, F22
// Permanent regressions from quality/audits/2026-10-07-ops-api-review/evidence/profile-address-state.probe.ts.
// Real route + real address helper with synthetic DB/auth ports, plus the real
// native commit function executed in PGlite.
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PGlite } from '@electric-sql/pglite'

const m = vi.hoisted(() => ({
  customer: {} as any,
  sites: [] as any[],
  updates: [] as any[],
  history: [] as any[],
  conflicts: [] as any[],
  rpc: vi.fn(),
  contactChange: vi.fn(),
  completion: 0,
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    rpc: m.rpc,
    from(table: string) {
      let action = 'read'
      let patch: any = {}
      const filters: Record<string, unknown> = {}
      const matchSite = () => m.sites.find((site) => Object.entries(filters).every(([k, v]) => site[k] === v)) ?? null
      const run = async () => {
        if (table === 'customers') return { data: filters.company_id === m.customer.company_id ? m.customer : null, error: null }
        if (table === 'customer_sites') {
          const site = matchSite()
          if (action === 'update' && site) { m.updates.push(patch); Object.assign(site, patch) }
          return { data: site, error: null }
        }
        if (table === 'customer_portal_completions') { m.completion++; return { data: { id: 'completion', completion_reference: 'completion_public', status: 'accepted', created_at: '2026-10-09' }, error: null } }
        if (table === 'customer_site_address_conflicts') { m.conflicts.push(patch); return { data: null, error: null } }
        if (table === 'customer_site_address_history') { m.history.push(patch); return { data: null, error: null } }
        throw Error(table)
      }
      const b: any = {
        then: (a: any, z: any) => run().then(a, z),
        update: (p: any) => { action = 'update'; patch = p; return b },
        insert: (p: any) => { action = 'insert'; patch = p; return b },
        eq: (k: string, v: unknown) => { filters[k] = v; return b },
      }
      for (const k of ['select', 'single', 'maybeSingle']) b[k] = () => b
      return b
    },
  },
}))
vi.mock('@/lib/customer-service/contactChangeTransaction', async (orig) => ({
  ...await orig<any>(),
  applyCustomerContactChange: m.contactChange,
}))
vi.mock('@/lib/api/strictRequest', async (orig) => ({ ...await orig<any>(), executeIdempotentPortalWrite: async (i: any) => ({ ...await i.execute(), replayed: false }) }))
vi.mock('@/lib/integrations/apiAuth', async (orig) => ({ ...await orig<any>(), logIntegrationApiRequest: vi.fn(), currentIntegrationApiResponseContext: () => null }))
vi.mock('@/lib/customer-portal/externalApi', async (orig) => ({
  ...await orig<any>(),
  requireCustomerPortalApiContext: async () => ({ ok: true, client: { id: 'client', company_id: 'company', scopes: ['customer_contact.write', 'customer_facility_data.write'] }, identity: { id: 'identity', customer_id: 'customer' }, startedAt: Date.now() }),
  logCustomerPortalSuccess: vi.fn(),
}))
vi.mock('@/lib/customer-operations/automation', () => ({ enqueueCustomerDataRequestAutomation: vi.fn() }))
vi.mock('@/lib/customer-portal/db', () => ({ createPortalCompletionCase: vi.fn() }))
vi.mock('@/lib/customers/customerOperationEvents', () => ({ emitCustomerOperationEvent: vi.fn() }))

import { POST } from '@/app/api/v1/customer/profile-update/route'
import { applyCustomerSiteAddressCandidate, computeCustomerSiteAddressHash } from '@/lib/customer-sites/addressIntake'

const original = { street: 'Street 1', postalCode: '12345', city: 'City', country: 'SE' }
const hash = computeCustomerSiteAddressHash(original).hash
const site = (extra: Record<string, unknown> = {}) => ({ id: 'site', company_id: 'company', customer_id: 'customer', facility_reference: 'facility', ...original, postal_code: '12345', address_hash: hash, ...extra })

beforeEach(() => {
  m.customer = { id: 'customer', company_id: 'company', customer_type: 'private', email: 'old@example.test', updated_at: '2026-10-01T00:00:00Z' }
  m.sites = []
  m.updates = []
  m.history = []
  m.conflicts = []
  m.completion = 0
  m.rpc.mockReset()
  m.contactChange.mockReset()
  m.contactChange.mockImplementation(async (i: any) => { Object.assign(m.customer, i.customerPatch); return { changed: true } })
})
const req = (body: any) => new NextRequest('https://example.test/api/v1/customer/profile-update', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'synthetic_20261009' }, body: JSON.stringify(body) })

describe('F22 combined profile update validates the resource chain before mutating', () => {
  it('missing facility reference returns 404 without changing the email', async () => {
    const response = await POST(req({ profile: { email: 'new@example.test' }, facility_data: { facility_reference: 'missing', address: { street: 'Street 1', postal_code: '12345', city: 'City' } } }))
    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('resource_not_found')
    expect(m.customer.email).toBe('old@example.test')
    expect(m.contactChange).not.toHaveBeenCalled()
    expect(m.completion).toBe(0)
  })

  it('other-tenant facility with the same reference is not found and nothing is mutated', async () => {
    m.sites = [site({ company_id: 'other-company' })]
    const response = await POST(req({ profile: { email: 'new@example.test' }, facility_data: { facility_reference: 'facility', address: { street: 'Street 1', postal_code: '12345', city: 'City' } } }))
    expect(response.status).toBe(404)
    expect(m.customer.email).toBe('old@example.test')
    expect(m.updates).toHaveLength(0)
  })

  it('positive control: valid facility and email both apply', async () => {
    m.sites = [site()]
    const response = await POST(req({ profile: { email: 'new@example.test' }, facility_data: { facility_reference: 'facility', address: { street: 'Street 1', postal_code: '12345', city: 'City' } } }))
    expect(response.status).toBe(200)
    expect(m.customer.email).toBe('new@example.test')
    expect(m.completion).toBe(1)
  })
})

describe('F20 care_of change on the same physical address is persisted', () => {
  it('route persists new care_of without native re-commit or routing invalidation', async () => {
    m.sites = [site({ care_of: 'Old Recipient', address_source: 'grid_owner_response', address_verified_at: '2026-10-01T00:00:00Z', address_verification_method: 'grid_owner_response' })]
    const response = await POST(req({ facility_data: { facility_reference: 'facility', address: { street: 'Street 1', postal_code: '12345', city: 'City', country: 'SE', care_of: 'New Recipient' } } }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toMatchObject({ facility_updated: true, status: 'accepted', address_result: { status: 'unchanged', reason: 'care_of_updated' } })
    expect(m.sites[0].care_of).toBe('New Recipient')
    expect(m.sites[0].address_hash).toBe(hash)
    expect(m.sites[0].address_verified_at).toBe('2026-10-01T00:00:00Z')
    expect(m.rpc).not.toHaveBeenCalled()
    expect(m.history).toEqual([expect.objectContaining({ address_hash: hash, snapshot: expect.objectContaining({ care_of: 'New Recipient', previous_care_of: 'Old Recipient' }) })])
  })

  it('omitted care_of keeps the stored recipient (patch semantics) and writes no history', async () => {
    m.sites = [site({ care_of: 'Old Recipient' })]
    const result = await applyCustomerSiteAddressCandidate({ companyId: 'company', customerId: 'customer', siteId: 'site', address: { ...original, source: 'customer_portal' } })
    expect(result).toMatchObject({ status: 'unchanged' })
    expect(result.reason).toBeUndefined()
    expect(m.sites[0].care_of).toBe('Old Recipient')
    expect(m.updates[0]).not.toHaveProperty('care_of')
    expect(m.history).toHaveLength(0)
  })

  it('care_of is not part of the physical identity hash', () => {
    expect(computeCustomerSiteAddressHash({ ...original, careOf: 'Someone' } as any).hash).toBe(hash)
  })
})

describe('F21 same-address refresh keeps authoritative provenance', () => {
  const verified = () => site({ address_source: 'grid_owner_response', address_source_reference: 'z-ref', address_verified_at: '2026-10-01T00:00:00Z', address_verification_method: 'grid_owner_response' })
  const call = (street: string, source: any = 'customer_portal') => applyCustomerSiteAddressCandidate({ companyId: 'company', customerId: 'customer', siteId: 'site', address: { ...original, street, source } })

  it('lower-ranked same-hash refresh keeps the source and the next different address is still a conflict', async () => {
    m.sites = [verified()]
    expect((await call('Street 2')).status).toBe('conflict')
    expect((await call('Street 1')).status).toBe('unchanged')
    expect(m.sites[0]).toMatchObject({ address_source: 'grid_owner_response', address_source_reference: 'z-ref', address_verified_at: '2026-10-01T00:00:00Z' })
    expect((await call('Street 2')).status).toBe('conflict')
    expect(m.rpc).not.toHaveBeenCalled()
    expect(m.conflicts.length).toBeGreaterThanOrEqual(2)
  })

  it('equal or higher rank same-hash refresh still records the observing source', async () => {
    m.sites = [site({ address_source: 'customer_portal' })]
    await call('Street 1', 'tenant_api')
    expect(m.sites[0].address_source).toBe('tenant_api')
  })

  it('native verified_address_conflict raised under the lock becomes a conflict result', async () => {
    m.sites = [site({ address_source: 'customer_portal' })]
    m.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'verified_address_conflict' } })
    const result = await call('Street 2')
    expect(result).toMatchObject({ status: 'conflict', reason: 'verified_address_conflict' })
    expect(m.conflicts).toHaveLength(1)
  })

  it('positive control: unverified site accepts a different address through the native commit', async () => {
    m.sites = [site({ address_source: 'customer_portal' })]
    m.rpc.mockResolvedValue({ data: null, error: null })
    expect((await call('Street 2')).status).toBe('updated')
    expect(m.rpc).toHaveBeenCalledWith('gridex_commit_customer_site_address', expect.objectContaining({ p_street: 'Street 2', p_source: 'customer_portal' }))
  })
})

describe('F21 native gridex_commit_customer_site_address under the locked row (PGlite)', () => {
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const S = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  let db: PGlite
  const commit = (company: string, street: string, h: string, source: string, careOf: string | null = null) => db.query(
    `select public.gridex_commit_customer_site_address($1,$2,$3,$4,'12345','City','SE',$5,null,$6,$7,$8,'ref-'||$8,'{}'::jsonb,null)`,
    [company, C, S, street, careOf, `${street}|12345|city|se`, h, source],
  )
  const row = async () => (await db.query<any>(`select * from customer_sites where id = '${S}'`)).rows[0]

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
      CREATE TABLE customer_sites(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,street text,postal_code text,city text,country text,care_of text,apartment_number text,
        address_normalized text,address_hash text,address_source text,address_source_reference text,address_received_at timestamptz,address_verified_at timestamptz,
        address_verification_method text,address_confidence numeric,address_status text,address_quality_status text,address_quality_warnings jsonb,
        grid_owner_id uuid,selected_grid_owner_id uuid,grid_area_code text,price_area_code text,bidding_zone_code text,resolution_id uuid,resolution_status text,
        resolution_confidence numeric,facility_data_status text,metadata jsonb,updated_at timestamptz);
      CREATE TABLE customer_operation_jobs(company_id uuid,customer_site_id uuid,status text,stale_reason text,last_error text,completed_at timestamptz,locked_at timestamptz,locked_by text,lock_token text,updated_at timestamptz);
      CREATE TABLE customer_info_requests(company_id uuid,customer_id uuid,site_id uuid,status text,blocker_reason text,updated_at timestamptz);
      CREATE TABLE grid_owner_information_requests(id uuid,company_id uuid,customer_id uuid,customer_site_id uuid,status text,last_error_code text,last_error_message text,metadata jsonb,updated_at timestamptz);
      CREATE TABLE manual_email_outbox(request_id uuid,status text,last_error text,updated_at timestamptz);
      CREATE TABLE metering_points(company_id uuid,site_id uuid,customer_site_id uuid,status text,grid_owner_id uuid,grid_area_code text,price_area_code text,verification_status text,updated_at timestamptz);
      CREATE TABLE customer_addresses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,customer_id uuid,type text,street_1 text,street_2 text,postal_code text,city text,country text,is_active boolean,metadata jsonb,created_at timestamptz,updated_at timestamptz);
      CREATE TABLE customer_site_address_history(company_id uuid,customer_id uuid,customer_site_id uuid,address_hash text,source text,source_reference text,actor_user_id uuid,snapshot jsonb);`)
    await db.exec(readFileSync('supabase/migrations/20261009140000_customer_site_address_source_authority.sql', 'utf8'))
  }, 20_000)
  afterAll(async () => { await db?.close() })
  beforeEach(async () => {
    await db.exec(`DELETE FROM customer_sites; DELETE FROM customer_site_address_history;
      INSERT INTO customer_sites(id,company_id,customer_id,street,postal_code,city,country,care_of,address_hash,address_source,address_source_reference,address_verified_at,
        address_verification_method,address_confidence,address_status,grid_area_code,resolution_status,facility_data_status,metadata)
      VALUES('${S}','${A}','${C}','Street 1','12345','City','SE','Old','h1','grid_owner_response','z-ref','2026-10-01T00:00:00Z','grid_owner_response',1,'verified','SYN','resolved','verified','{}')`)
  })

  it('lower-ranked different address against a verified row raises verified_address_conflict and leaves the row', async () => {
    await expect(commit(A, 'Street 2', 'h2', 'customer_portal')).rejects.toThrow(/verified_address_conflict/)
    expect(await row()).toMatchObject({ street: 'Street 1', address_hash: 'h1', address_source: 'grid_owner_response', grid_area_code: 'SYN' })
  })

  it('lower-ranked same hash keeps source/verification but persists care_of', async () => {
    await commit(A, 'Street 1', 'h1', 'customer_portal', 'New')
    expect(await row()).toMatchObject({ care_of: 'New', address_source: 'grid_owner_response', address_source_reference: 'z-ref', address_verification_method: 'grid_owner_response', address_status: 'verified', facility_data_status: 'verified', grid_area_code: 'SYN' })
    expect((await row()).address_verified_at).not.toBeNull()
  })

  it('positive control: higher-ranked grid-owner response replaces and invalidates derived routing', async () => {
    await db.exec(`UPDATE customer_sites SET address_source='superadmin'`)
    await commit(A, 'Street 2', 'h2', 'grid_owner_response')
    expect(await row()).toMatchObject({ street: 'Street 2', address_hash: 'h2', address_source: 'grid_owner_response', grid_area_code: null, resolution_status: 'pending_resolution' })
  })

  it('positive control: unverified row accepts a lower-ranked change', async () => {
    await db.exec(`UPDATE customer_sites SET address_verified_at=null,address_verification_method=null,address_source='tenant_api'`)
    await commit(A, 'Street 2', 'h2', 'customer_portal')
    expect(await row()).toMatchObject({ street: 'Street 2', address_source: 'customer_portal', address_status: 'candidate' })
  })

  it('other-tenant commit is not found and does not touch the row', async () => {
    await expect(commit(B, 'Street 2', 'h2', 'grid_owner_response')).rejects.toThrow(/customer_site_not_found/)
    expect(await row()).toMatchObject({ street: 'Street 1', address_hash: 'h1' })
  })
})
