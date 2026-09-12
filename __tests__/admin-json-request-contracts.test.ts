import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  denied: false,
  calls: [] as Array<{ name: string; input: unknown }>,
}))

vi.mock('@/lib/admin/apiGuards', () => ({
  requireAdminApiAccess: async () => io.denied
    ? { response: Response.json({ error: 'unauthorized' }, { status: 401 }) }
    : { guard: { userId: 'actor-A', companyId: 'company-A' } },
  assertAdminApiCompanyAccess: async () => 'company-A',
  assertAdminApiCompanyReadAccess: async () => 'company-A',
  adminApiCompanyAccessErrorStatus: () => undefined,
}))
vi.mock('@/lib/tenant/scope', () => ({ requireOperationalCompanyId: async () => 'company-A' }))
vi.mock('@/lib/billing/underlayEngine', () => ({
  generateBillingUnderlaysForMonth: async (input: unknown) => { io.calls.push({ name: 'generate', input }); return {} },
}))
vi.mock('@/lib/billing/invoiceReadiness', () => ({
  getBillingPeriodLock: async () => null,
  lockBillingPeriod: async (input: unknown) => { io.calls.push({ name: 'lock', input }); return {} },
  unlockBillingPeriod: async (input: unknown) => { io.calls.push({ name: 'unlock', input }); return {} },
}))
vi.mock('@/lib/pricing/engine', () => ({
  lockPricingPreview: async (input: unknown) => { io.calls.push({ name: 'lock-preview', input }); return {} },
  calculatePricingPreviewForUnderlay: async (input: unknown) => { io.calls.push({ name: 'underlay', input }); return { status: 'success' } },
  calculatePricingPreviewForBillingMonth: async (input: unknown) => { io.calls.push({ name: 'month', input }); return { underlays: 1, errors: [] } },
}))
vi.mock('@/lib/pricing/spot/spotPriceImporter', () => ({
  importSpotPricesForMonth: async (input: unknown) => { io.calls.push({ name: 'import', input }); return {} },
}))
vi.mock('@/lib/pricing/spot/settlementLocker', () => ({
  lockSpotSettlementMonth: async (input: unknown) => { io.calls.push({ name: 'settlement', input }); return {} },
}))

import { POST as generate } from '@/app/api/internal/billing/generate-underlay/route'
import { POST as period } from '@/app/api/internal/billing/period-locks/route'
import { POST as preview } from '@/app/api/internal/pricing/preview/route'
import { POST as reprice } from '@/app/api/internal/pricing/reprice/route'
import { POST as lockPreview } from '@/app/api/internal/pricing/lock-preview/route'
import { POST as importSpot } from '@/app/api/internal/spot/import-month/route'
import { POST as lockSpot } from '@/app/api/internal/spot/lock-month/route'

type Endpoint = { name: string; run: (request: Request) => Promise<Response>; body: Record<string, unknown> }
const endpoints: Endpoint[] = [
  { name: 'generate underlay', run: generate, body: { billing_month: '2026-08' } },
  { name: 'billing period', run: period, body: { billing_month: '2026-08' } },
  { name: 'pricing preview', run: preview, body: { billing_month: '2026-08' } },
  { name: 'reprice', run: reprice, body: { billing_underlay_id: 'underlay-A' } },
  { name: 'lock preview', run: lockPreview, body: { pricing_run_id: 'run-A' } },
  { name: 'spot import', run: importSpot, body: { billing_month: '2026-08', price_areas: ['SE3'] } },
  { name: 'spot settlement', run: lockSpot, body: { billing_month: '2026-08', price_area: 'SE3' } },
]
function request(body: unknown): Request {
  return new Request('https://example.test/api/internal/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}
function rawRequest(body: string): Request {
  return new Request('https://example.test/api/internal/test', { method: 'POST', body })
}
function oversizedStream(): { request: Request; cancelled: () => boolean; pulls: () => number } {
  let cancelled = false
  let pulls = 0
  const chunk = new TextEncoder().encode('x'.repeat(65_536))
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { pulls += 1; if (pulls > 16) controller.close(); else controller.enqueue(chunk) },
    cancel() { cancelled = true },
  })
  const init: RequestInit & { duplex: 'half' } = { method: 'POST', body: stream, duplex: 'half', headers: { 'content-length': '1' } }
  return { request: new Request('https://example.test/api/internal/test', init), cancelled: () => cancelled, pulls: () => pulls }
}

beforeEach(() => { io.denied = false; io.calls.length = 0; vi.clearAllMocks() })

describe.each(endpoints)('$name strict JSON contract', (endpoint) => {
  it('retains the valid request and invokes exactly one domain operation', async () => {
    expect((await endpoint.run(request(endpoint.body))).status).toBe(200)
    expect(io.calls).toHaveLength(1)
  })
  it.each(['unexpected', 'company_id', 'companyId', 'actorUserId'])('rejects unknown or forged field %s before domain I/O', async (field) => {
    expect((await endpoint.run(request({ ...endpoint.body, [field]: 'foreign' }))).status).toBe(400)
    expect(io.calls).toHaveLength(0)
  })
  it.each(['null', '[]', 'true', '7', '"text"', '{', ''])('rejects non-object/malformed body %s as a client error', async (body) => {
    expect((await endpoint.run(rawRequest(body))).status).toBe(400)
    expect(io.calls).toHaveLength(0)
  })
  it('enforces actual stream bytes, cancels early, and performs no domain I/O', async () => {
    const input = oversizedStream()
    expect((await endpoint.run(input.request)).status).toBe(413)
    expect(input.cancelled()).toBe(true)
    expect(input.pulls()).toBeLessThan(16)
    expect(io.calls).toHaveLength(0)
  })
  it('authenticates before reading the body', async () => {
    io.denied = true
    const input = request(endpoint.body)
    expect((await endpoint.run(input)).status).toBe(401)
    expect(input.bodyUsed).toBe(false)
    expect(io.calls).toHaveLength(0)
  })
})

for (const endpoint of endpoints.filter((value) => 'billing_month' in value.body)) {
  describe(`${endpoint.name} month and alias validation`, () => {
    it.each(['2026-00', '2026-13', '0000-01', 202608, null, false])('rejects invalid month %s', async (month) => {
      expect((await endpoint.run(request({ ...endpoint.body, billing_month: month }))).status).toBe(400)
      expect(io.calls).toHaveLength(0)
    })
    it('rejects conflicting aliases', async () => {
      expect((await endpoint.run(request({ ...endpoint.body, billingMonth: '2026-09' }))).status).toBe(400)
      expect(io.calls).toHaveLength(0)
    })
    it('retains matching aliases', async () => {
      expect((await endpoint.run(request({ ...endpoint.body, billingMonth: '2026-08' }))).status).toBe(200)
      expect(io.calls).toHaveLength(1)
    })
    it('retains camelCase-only input', async () => {
      const { billing_month: month, ...body } = endpoint.body
      expect((await endpoint.run(request({ ...body, billingMonth: month }))).status).toBe(200)
    })
  })
}

it.each(['false', 0, null])('does not coerce invalid persist=%s into a write', async (persist) => {
  expect((await preview(request({ billing_underlay_id: 'underlay-A', persist }))).status).toBe(400)
  expect(io.calls).toHaveLength(0)
})
it('preserves persist=false and underlay selection', async () => {
  expect((await preview(request({ billing_underlay_id: 'underlay-A', persist: false }))).status).toBe(200)
  expect(io.calls[0]).toEqual({ name: 'underlay', input: { companyId: 'company-A', billingUnderlayId: 'underlay-A', persist: false } })
})
it.each(['typo', false, 1, null])('does not turn an invalid action %s into a period lock', async (action) => {
  expect((await period(request({ billing_month: '2026-08', action }))).status).toBe(400)
  expect(io.calls).toHaveLength(0)
})
it.each(['unlock', 'reopen'])('preserves action=%s', async (action) => {
  expect((await period(request({ billing_month: '2026-08', action }))).status).toBe(200)
  expect(io.calls[0].name).toBe('unlock')
})
it.each(['invalid', false, null])('rejects invalid period status %s rather than defaulting it', async (status) => {
  expect((await period(request({ billing_month: '2026-08', status }))).status).toBe(400)
  expect(io.calls).toHaveLength(0)
})
it.each([['SE3', 'BAD'], [], 'SE3', null, [3]].map((priceAreas) => ({ priceAreas })))('does not drop invalid areas or broaden the import: $priceAreas', async ({ priceAreas }) => {
  expect((await importSpot(request({ billing_month: '2026-08', price_areas: priceAreas }))).status).toBe(400)
  expect(io.calls).toHaveLength(0)
})
it('retains default area selection when the optional array is absent', async () => {
  expect((await importSpot(request({ billing_month: '2026-08' }))).status).toBe(200)
  expect(io.calls[0]).toEqual({ name: 'import', input: { billingMonth: '2026-08', priceAreas: undefined, createdBy: 'actor-A' } })
})
it('rejects disagreeing price area aliases', async () => {
  expect((await lockSpot(request({ billing_month: '2026-08', price_area: 'SE3', priceArea: 'SE4' }))).status).toBe(400)
  expect(io.calls).toHaveLength(0)
})
it('preserves documented spot normalization and metadata', async () => {
  const response = await lockSpot(request({ billingMonth: '2026-08', priceArea: 'se3', provider: 'ELPRISETJUSTNU', reason: ' operator ' }))
  expect(response.status).toBe(200)
  expect(io.calls[0]).toEqual({ name: 'settlement', input: { billingMonth: '2026-08', priceArea: 'SE3', provider: 'elprisetjustnu', actorUserId: 'actor-A', reason: 'operator' } })
  expect((await response.json()).correlation_id).toEqual(expect.any(String))
})
it('retains the specific spot input error envelope', async () => {
  const response = await lockSpot(request({ billing_month: '2026-08', price_area: 'BAD' }))
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ error_code: 'invalid_price_area', retryable: false, correlation_id: expect.any(String) })
  expect(io.calls).toHaveLength(0)
})
