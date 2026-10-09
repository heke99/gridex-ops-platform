/* eslint-disable @typescript-eslint/no-explicit-any -- loose test doubles for Supabase/PostgREST ports */
// Geolocation review: a postal code spanning several grid areas/owners must not
// name one grid owner, and must require an address.
// Real Partner handler + real energy resolver with synthetic DB/auth ports.
import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ multi: true, lowConfidence: false }))
vi.mock('@/lib/integrations/apiAuth', () => ({ requireIntegrationApiAccess: vi.fn(async () => ({ ok: true, client: { id: 'synthetic-client', company_id: 'synthetic-company' } })), logIntegrationApiRequest: vi.fn(async () => {}) }))
vi.mock('@/lib/partner-api/simple', () => ({ handleSimplePartnerApi: vi.fn() }))
vi.mock('@/lib/energy/canonicalEnergyEvents', () => ({ recordCanonicalEnergyEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/grid-owners/verification', () => ({ getGridOwnerVerification: vi.fn(async () => ({ verificationStatus: 'verified', verifiedForCustomerFlow: true, canUseForProdat: true, reasons: [] })) }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      const areaA = { grid_area_code: 'SYA', grid_area_name: 'Area A', grid_owner_id: 'platform-owner-a', grid_owner_name: 'Owner A', price_area: 'SE3', platform_grid_owners: { name: 'Owner A', ops_grid_owner_id: 'ops-owner-a' } }
      const areaB = { grid_area_code: 'SYB', grid_area_name: 'Area B', grid_owner_id: 'platform-owner-b', grid_owner_name: 'Owner B', price_area: 'SE3', platform_grid_owners: { name: 'Owner B', ops_grid_owner_id: 'ops-owner-b' } }
      const confidence = m.lowConfidence ? 0.5 : 0.9
      const result = (single = false) => {
        if (table === 'platform_address_lookup_cache') return { data: null, error: null }
        if (table === 'platform_grid_owners') return { data: { ops_grid_owner_id: 'ops-owner-a' }, error: null }
        if (table === 'energy_geodata_versions') return { data: { version_key: 'synthetic', verified_at: new Date().toISOString() }, error: null }
        if (table === 'customer_site_resolution') return { data: { id: 'synthetic-resolution' }, error: null }
        if (table === 'platform_postal_code_grid_mappings') return { data: [{ postal_code: '12345', city: 'Synthetic', grid_area_code: 'SYA', price_area: 'SE3', confidence }, ...(m.multi ? [{ postal_code: '12345', city: 'Synthetic', grid_area_code: 'SYB', price_area: 'SE3', confidence }] : [])], count: m.multi ? 2 : 1, error: null }
        if (table === 'platform_grid_areas') return { data: single ? areaA : [areaA, ...(m.multi ? [areaB] : [])], error: null }
        return { data: null, error: null }
      }
      const b: any = { select: () => b, in: () => b, or: () => b, eq: () => b, order: () => b, limit: () => b, insert: () => b, upsert: () => b, single: async () => result(true), maybeSingle: async () => result(true), then: (f: any, r: any) => Promise.resolve(result()).then(f, r) }
      return b
    },
    rpc: async () => ({ data: null, error: null }),
  },
}))
import { handleBusinessPartnerApi } from '@/lib/partner-api/business'


const request = () => new NextRequest('https://example.invalid/api/partner/v1/location?postal_code=12345&city=Synthetic')
beforeEach(() => { m.multi = true; m.lowConfidence = false })

it('positive control: a single grid area candidate still names its (unverified) grid owner', async () => {
  m.multi = false
  const r = await handleBusinessPartnerApi(request(), 'GET', ['location'])
  expect(r?.status).toBe(200)
  const body = await r!.json()
  expect(body.location).toMatchObject({ price_area: 'SE3', grid_owner: { name: 'Owner A', verified: false }, requires_address: false })
})

it('postal code spanning several grid owners returns grid_owner null and requires an address', async () => {
  const r = await handleBusinessPartnerApi(request(), 'GET', ['location'])
  expect(r?.status).toBe(200)
  const body = await r!.json()
  expect(body.location.price_area).toBe('SE3')
  expect(body.location.grid_owner).toBeNull()
  expect(body.location.grid_area).toBeNull()
  expect(body.location.requires_address).toBe(true)
  expect(body.location.required_fields).toEqual(['address', 'city'])
})

it('requires an address whenever price-area assurance is not usable', async () => {
  m.multi = false
  m.lowConfidence = true
  const r = await handleBusinessPartnerApi(request(), 'GET', ['location'])
  expect(r?.status).toBe(200)
  const body = await r!.json()
  expect(body.location.requires_address).toBe(true)
})
