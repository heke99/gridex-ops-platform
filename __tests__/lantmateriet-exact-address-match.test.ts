// Geolocation review: Lantmäteriet exact-address match must compare structured
// fields, never substrings of the candidate JSON.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ upserts: [] as unknown[] }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: () => ({ upsert: async (row: unknown) => { m.upserts.push(row); return { error: null } } }),
  },
}))
import { ensureLantmaterietExactAddressPoint } from '@/lib/energy/lantmaterietExactAddress'

const request = { street: 'Storgatan', streetNumber: '1', postalCode: '123 45', city: 'Stad' }

function provider(references: unknown[]) {
  vi.stubGlobal('fetch', async (url: string) => {
    const href = String(url)
    if (href.includes('/autocomplete/')) return Response.json([])
    if (href.includes('/referens/')) return Response.json(references)
    return Response.json({ features: [{ geometry: { coordinates: [674_000, 6_580_000] } }] })
  })
}

beforeEach(() => {
  m.upserts = []
  vi.stubEnv('LANTMATERIET_BELAGENHETSADRESS_USERNAME', 'synthetic')
  vi.stubEnv('LANTMATERIET_BELAGENHETSADRESS_PASSWORD', 'synthetic')
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

it('positive control: an exactly equal structured candidate is cached as the exact point', async () => {
  provider([{ objektidentitet: 'obj-1', adressomrade: 'STORGATAN', adressplatsnummer: '1', postnummer: '12345', postort: 'stad' }])
  const r = await ensureLantmaterietExactAddressPoint(request)
  expect(r.status).toBe('cached')
  expect(r.objectIdentity).toBe('obj-1')
  expect(m.upserts).toHaveLength(1)
})

it('positive control: a text candidate with the same parts matches', async () => {
  provider([{ objektidentitet: 'obj-2', adress: 'Storgatan 1, 123 45 Stad' }])
  const r = await ensureLantmaterietExactAddressPoint(request)
  expect(r.status).toBe('cached')
})

it.each([
  ['house 11', { adressomrade: 'Storgatan', adressplatsnummer: '11', postnummer: '12345', postort: 'Stad' }],
  ['house 21', { adress: 'Storgatan 21, 123 45 Stad' }],
  ['house 1A', { adressomrade: 'Storgatan', adressplatsnummer: '1', bokstavstillagg: 'A', postnummer: '12345', postort: 'Stad' }],
  ['street Lillstorgatan', { adress: 'Lillstorgatan 1, 123 45 Stad' }],
  ['other postal code', { adress: 'Storgatan 1, 123 456 Stad' }],
  ['other town', { adress: 'Storgatan 1, 123 45 Stadsby' }],
])('never caches a substring-only candidate (%s) as an exact address', async (_label, candidate) => {
  provider([{ objektidentitet: 'obj-x', ...candidate }])
  const r = await ensureLantmaterietExactAddressPoint(request)
  expect(r.status).toBe('no_match')
  expect(m.upserts).toHaveLength(0)
})

it('house letter must match when requested', async () => {
  provider([
    { objektidentitet: 'obj-1', adress: 'Storgatan 1, 123 45 Stad' },
    { objektidentitet: 'obj-1a', adress: 'Storgatan 1A, 123 45 Stad' },
  ])
  const r = await ensureLantmaterietExactAddressPoint({ ...request, streetNumber: '1A' })
  expect(r.status).toBe('cached')
  expect(r.objectIdentity).toBe('obj-1a')
})
