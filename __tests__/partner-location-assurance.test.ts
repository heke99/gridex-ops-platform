// ops-api-review: F24, F25
// From quality/audits/2026-10-07-ops-api-review/evidence/location-output.probe.ts.
// Real Partner handler + real energy resolver with synthetic DB/auth ports.
// F25 provisional/null semantics; the OpenAPI 3.1 type-union schema part is
// covered by __tests__/partner-response-schema-validation.test.ts.
import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { compileSchema } from './helpers/miniJsonSchema'

const m = vi.hoisted(() => ({ stale: false, name: 'Synthetic area' as string | null, ambiguous: false, saved: [] as any[] }))
vi.mock('@/lib/integrations/apiAuth', () => ({ requireIntegrationApiAccess: vi.fn(async () => ({ ok: true, client: { id: 'synthetic-client', company_id: 'synthetic-company' } })), logIntegrationApiRequest: vi.fn(async () => {}) }))
vi.mock('@/lib/partner-api/simple', () => ({ handleSimplePartnerApi: vi.fn() }))
vi.mock('@/lib/energy/canonicalEnergyEvents', () => ({ recordCanonicalEnergyEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/grid-owners/verification', () => ({ getGridOwnerVerification: vi.fn(async () => ({ verificationStatus: 'verified', verifiedForCustomerFlow: true, canUseForProdat: true, reasons: [] })) }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      let inserted: any = null
      const area = { grid_area_code: 'SYN', grid_area_name: m.name, grid_owner_id: 'platform-owner', grid_owner_name: 'Synthetic owner', price_area: 'SE3', platform_grid_owners: { name: 'Synthetic owner', ops_grid_owner_id: 'ops-owner' } }
      const result = (single = false) => {
        if (table === 'platform_address_lookup_cache') return { data: { address_key: 'synthetic', latitude: 59, longitude: 18, sweref99_x: 123, sweref99_y: 456, confidence: 0.98 }, error: null }
        if (table === 'platform_grid_owners') return { data: { ops_grid_owner_id: 'ops-owner' }, error: null }
        if (table === 'energy_geodata_versions') return { data: { version_key: 'synthetic', verified_at: m.stale ? '2020-01-01T00:00:00Z' : new Date().toISOString() }, error: null }
        if (table === 'customer_site_resolution') { if (inserted) m.saved.push(inserted); return { data: { id: 'synthetic-resolution' }, error: null } }
        if (table === 'platform_postal_code_grid_mappings') return { data: [{ postal_code: '12345', city: 'Synthetic', grid_area_code: 'SYN', price_area: 'SE3', confidence: 0.9 }, ...(m.ambiguous ? [{ postal_code: '12345', city: 'Other', grid_area_code: 'SYO', price_area: 'SE4', confidence: 0.9 }] : [])], count: m.ambiguous ? 2 : 1, error: null }
        if (table === 'platform_grid_areas') return { data: single ? area : [area, ...(m.ambiguous ? [{ grid_area_code: 'SYO', price_area: 'SE4' }] : [])], error: null }
        return { data: null, error: null }
      }
      const b: any = { select: () => b, in: () => b, or: () => b, eq: () => b, order: () => b, limit: () => b, insert: (x: any) => { inserted = x; return b }, single: async () => result(true), maybeSingle: async () => result(true), then: (f: any) => Promise.resolve(result()).then(f) }
      return b
    },
    rpc: async () => ({ data: [{ grid_area_code: 'SYN', grid_area_name: m.name, grid_owner_id: 'platform-owner', grid_owner_name: 'Synthetic owner', price_area: 'SE3', confidence: 0.98 }], error: null }),
  },
}))
import { handleBusinessPartnerApi } from '@/lib/partner-api/business'
import { partnerPublicOpenApi } from '@/lib/partner-api/businessOpenApi'

const validate = compileSchema({ components: partnerPublicOpenApi.components }, partnerPublicOpenApi.components.schemas.LocationResponse as Record<string, unknown>)
const request = (path = 'location', full = true) => new NextRequest('https://example.invalid/api/partner/v1/' + path + '?postal_code=12345' + (full ? '&address=Synthetic%201&city=Synthetic' : ''))
beforeEach(() => { m.stale = false; m.name = 'Synthetic area'; m.ambiguous = false; m.saved = [] })

it('positive control: fresh complete address is resolved and verified, valid against the published schema', async () => {
  const r = await handleBusinessPartnerApi(request(), 'GET', ['location'])
  expect(r?.status).toBe(200)
  const body = await r!.json()
  expect(body.location).toMatchObject({ status: 'resolved', price_area: 'SE3', grid_area: { code: 'SYN', verified: true }, grid_owner: { verified: true } })
  expect(body.location.warnings).not.toContain('location_identifiers_provisional')
  expect(validate(body)).toBe(true)
  expect(m.saved[0]).toMatchObject({ company_id: 'synthetic-company' })
})

it('stale geodata keeps last-known identifiers but presents them as provisional, not resolved/verified', async () => {
  m.stale = true
  const r = await handleBusinessPartnerApi(request(), 'GET', ['location'])
  expect(r?.status).toBe(200)
  const body = await r!.json()
  expect(m.saved[0]).toMatchObject({ price_area_assurance_status: 'unresolved', automation_allowed: false })
  expect(body.location).toMatchObject({ status: 'partial', price_area: 'SE3', grid_area: { code: 'SYN', verified: false }, grid_owner: { name: 'Synthetic owner', verified: false } })
  expect(body.location.warnings).toEqual(expect.arrayContaining(['svk_geodata_stale_or_unverified', 'location_identifiers_provisional']))
  expect(validate(body)).toBe(true)
})

it('stale location never produces a current price or a customer price', async () => {
  m.stale = true
  const current = await handleBusinessPartnerApi(request('price/current'), 'GET', ['price', 'current'])
  expect(current?.status).toBe(422)
  expect((await current!.json()).error.code).toBe('location_not_resolved')
  const price = await handleBusinessPartnerApi(new NextRequest('https://example.invalid/api/partner/v1/price', { method: 'POST', body: JSON.stringify({ postal_code: '12345', address: 'Synthetic 1', city: 'Synthetic', annual_consumption_kwh: 12000, customer_type: 'private' }) }), 'POST', ['price'])
  expect(price?.status).toBe(422)
  expect((await price!.json()).error.code).toBe('location_not_resolved')
})

it('F25 semantics: postal-only partial result marks owner/area provisional (verified=false)', async () => {
  const r = await handleBusinessPartnerApi(request('location', false), 'GET', ['location'])
  expect(r?.status).toBe(200)
  const body = await r!.json()
  expect(body.location).toMatchObject({ status: 'partial', grid_owner: { verified: false }, grid_area: { verified: false } })
})

it('ambiguous postal code is refused with 409 and no guessed price area', async () => {
  m.ambiguous = true
  const r = await handleBusinessPartnerApi(request('location', false), 'GET', ['location'])
  expect(r?.status).toBe(409)
  expect((await r!.json()).error.location).toMatchObject({ status: 'ambiguous', price_area: null, requires_address: true })
})
