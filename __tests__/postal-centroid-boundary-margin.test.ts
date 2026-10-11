/* eslint-disable @typescript-eslint/no-explicit-any -- loose test doubles for Supabase/PostgREST ports */
// Geolocation review: postal-centroid polygon margin and Sweden bounding box.
// Real resolver with a synthetic Supabase port; only the HTTP/DB boundary is faked.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  polygonConfidence: 0.98 as number | null,
  cachedCentroid: true,
  rpcCalls: 0,
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      const result = () => {
        if (table === 'platform_address_lookup_cache') {
          return m.cachedCentroid
            ? { data: { address_key: 'postal_centroid|SE|12345', postal_code: '12345', city: 'Synthetic', latitude: 59.3, longitude: 18.0, provider: 'papilite_postal_centroid', confidence: 0.7, raw_payload: { coordinate_scope: 'postal_centroid' } }, error: null }
            : { data: null, error: null }
        }
        if (table === 'energy_geodata_versions') return { data: { version_key: 'synthetic', verified_at: new Date().toISOString() }, error: null }
        if (table === 'platform_postal_code_grid_mappings') return { data: [], count: 0, error: null }
        return { data: null, error: null }
      }
      const b: any = { select: () => b, in: () => b, or: () => b, eq: () => b, order: () => b, limit: () => b, gt: () => b, upsert: () => b, insert: () => b, single: async () => result(), maybeSingle: async () => result(), then: (f: any, r: any) => Promise.resolve(result()).then(f, r) }
      return b
    },
    rpc: async () => {
      m.rpcCalls += 1
      return { data: [{ grid_area_code: 'SYN', price_area: 'SE3', confidence: m.polygonConfidence }], error: null }
    },
  },
}))
import { publicPriceAreaByPostalCode } from '@/lib/energy/resolver'

beforeEach(() => {
  m.polygonConfidence = 0.98
  m.cachedCentroid = true
  m.rpcCalls = 0
  vi.stubEnv('PAPILITE_API_KEY', 'unit-test-provider-key')
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

it('positive control: a centroid well inside one polygon (>= 0.95) keeps estimated price area', async () => {
  const r = await publicPriceAreaByPostalCode('12345')
  expect(r.priceArea).toBe('SE3')
  expect(r.confidence).toBeGreaterThan(0)
})

it.each([0.75, 0.8, 0.94, null])('a centroid near an area boundary (polygon confidence %s) is never price-ready', async (confidence) => {
  m.polygonConfidence = confidence
  const r = await publicPriceAreaByPostalCode('12345')
  expect(r.priceArea).toBeNull()
  expect(r.confidence).toBe(0)
})

it('rejects Papilite centroids outside the Sweden bounding box before any polygon lookup', async () => {
  m.cachedCentroid = false
  vi.stubGlobal('fetch', async () => Response.json([{ postal_code: '12345', city: 'Synthetic', latitude: 40.1, longitude: 18.0 }]))
  const r = await publicPriceAreaByPostalCode('12345')
  expect(r.priceArea).toBeNull()
  expect(m.rpcCalls).toBe(0)
})
