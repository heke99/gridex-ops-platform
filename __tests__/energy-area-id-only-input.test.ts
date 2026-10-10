// Geolocation review: facility_id / metering_point_id are references only and
// never resolve an energy area on their own.
import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }))
vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: vi.fn(async () => ({ ok: true, client: { id: 'synthetic-client' }, context: { companyId: 'synthetic-company' } })),
  logIntegrationApiRequest: vi.fn(async () => {}),
  currentIntegrationApiResponseContext: vi.fn(() => null),
}))
vi.mock('@/lib/energy/websiteResolutionCache', () => ({
  resolveWebsiteEnergyContext: vi.fn(async (input: Record<string, unknown>) => {
    m.calls.push(input)
    return {
      resolutionId: null, priceArea: 'SE3', gridAreaCode: null, gridOwnerId: null, gridOwnerName: null, gridAreaName: null,
      resolutionStatus: 'postal_suggested', confidence: 0.85, conflictCode: null, expiresAt: null,
      priceAreaAssurance: { status: 'estimated', priceArea: 'SE3', confidence: 0.85, source: 'postal_consensus', candidateCount: 1, uniquePriceAreaCount: 1, sourceVersion: null, evidence: {} },
      warnings: [], sourceChain: [], nextRequiredAction: null, automationAllowed: false, diagnostics: {},
    }
  }),
}))
import { POST } from '@/app/api/v1/website/energy-area/resolve/route'

const post = (body: Record<string, unknown>) => POST(new NextRequest('https://example.invalid/api/v1/website/energy-area/resolve', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))
beforeEach(() => { m.calls = [] })

it.each([
  [{ facility_id: 'FAC-1' }],
  [{ metering_point_id: '735999000000000001' }],
  [{ facility_id: 'FAC-1', metering_point_id: '735999000000000001' }],
])('ID-only request %j is refused with 422 energy_area_address_required and never resolved', async (body) => {
  const r = await post(body)
  expect(r.status).toBe(422)
  const json = await r.json()
  expect(json.error.code).toBe('energy_area_address_required')
  expect(m.calls).toHaveLength(0)
})

it('IDs together with a postal code are accepted as references and resolution uses the postal code', async () => {
  const r = await post({ facility_id: 'FAC-1', postal_code: '12345' })
  expect(r.status).not.toBe(422)
  expect(m.calls).toHaveLength(1)
  expect(m.calls[0]).toMatchObject({ postalCode: '12345', facilityId: 'FAC-1' })
})
