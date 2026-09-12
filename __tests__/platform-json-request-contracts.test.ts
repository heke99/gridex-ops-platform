import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ denied: false, calls: [] as Array<{ name: string; input: unknown }> }))
vi.mock('@/lib/admin/guards', () => ({
  requirePlatformAdminActionAccess: async () => {
    if (io.denied) throw new Error('Endast platform admin kan utföra den här åtgärden.')
    return { userId: 'platform-actor', isPlatformAdmin: true }
  },
  requirePlatformAdminAccess: async () => {
    if (io.denied) throw new Error('Endast platform admin kan utföra den här åtgärden.')
    return { userId: 'platform-actor', isPlatformAdmin: true }
  },
}))
vi.mock('@/lib/pricing/spot/spotPriceImporter', () => ({
  importSpotPricesForMonth: async (input: unknown) => { io.calls.push({ name: 'spot', input }); return {} },
}))
vi.mock('@/lib/energy/resolver', () => ({
  upsertPlatformGridAreaMasterRows: async (input: unknown) => { io.calls.push({ name: 'grid', input }); return [] },
  resolveEnergyContext: async (input: unknown) => { io.calls.push({ name: 'resolve', input }); return {} },
}))
vi.mock('@/lib/energy/svkGeometryImport', () => ({
  runSvkGeometryImport: async (input: unknown) => { io.calls.push({ name: 'svk', input }); return { ok: true } },
  retrySvkGridOwnerReconciliation: async (input: unknown) => { io.calls.push({ name: 'retry', input }); return { ok: true } },
}))
vi.mock('@/lib/customer-operations/z01Finalizer', () => ({
  finalizeStuckZ01GridOwnerDataRequest: async (input: unknown) => { io.calls.push({ name: 'apply', input }); return {} },
  dryRunZ01Finalizer: async (input: unknown) => { io.calls.push({ name: 'dry-run', input }); return {} },
}))

import { POST as spot } from '@/app/api/platform/energy/import/spot-prices/route'
import { POST as grid } from '@/app/api/platform/energy/import/grid-areas/route'
import { POST as svk } from '@/app/api/platform/energy/import/svk-geometries/route'
import { POST as resolve } from '@/app/api/platform/energy/resolve/route'
import { POST as repair } from '@/app/api/internal/z01-repair/route'

const row = { grid_area_code: 'ABC', grid_owner_name: 'Test owner', grid_area_name: 'Test area', price_area: 'SE3' }
const repairBody = { company_id: 'company-A', grid_owner_data_request_id: 'request-A' }
type Endpoint = { name: string; run: (request: NextRequest) => Promise<Response>; body: Record<string, unknown> }
const endpoints: Endpoint[] = [
  { name: 'platform spot import', run: spot, body: { billing_month: '2026-08', price_areas: ['SE3'] } },
  { name: 'grid master import', run: grid, body: { rows: [row] } },
  { name: 'SVK import', run: svk, body: { layer_id: 3, limit: 50, offset: 0 } },
  { name: 'energy resolve', run: resolve, body: { company_id: 'company-A', street: 'Test street', postal_code: '12345', city: 'Test city' } },
  { name: 'Z01 repair', run: repair, body: repairBody },
]
function json(body: unknown): NextRequest { return new NextRequest('https://example.test/api/test', { method: 'POST', body: JSON.stringify(body) }) }
function raw(body: string): NextRequest { return new NextRequest('https://example.test/api/test', { method: 'POST', body }) }
function streamRequest() {
  let pulls = 0
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { if (++pulls > 16) controller.close(); else controller.enqueue(new TextEncoder().encode('x'.repeat(65_536))) },
    cancel() { cancelled = true },
  })
  const init: NonNullable<ConstructorParameters<typeof NextRequest>[1]> & { duplex: 'half' } = { method: 'POST', body: stream, duplex: 'half', headers: { 'content-length': '1' } }
  return { request: new NextRequest('https://example.test/api/test', init), pulls: () => pulls, cancelled: () => cancelled }
}
beforeEach(() => { io.denied = false; io.calls.length = 0; vi.restoreAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => undefined) })

describe.each(endpoints)('$name bounded strict contract', (endpoint) => {
  it('preserves a valid operation', async () => { expect((await endpoint.run(json(endpoint.body))).status).toBe(200); expect(io.calls).toHaveLength(1) })
  it.each(['unexpected', 'actorUserId', 'permissions'])('rejects unknown field %s without effects', async (key) => {
    expect((await endpoint.run(json({ ...endpoint.body, [key]: 'forged' }))).status).toBe(400)
    expect(io.calls).toHaveLength(0)
  })
  it.each(['null', '[]', 'true', '7', '"body"', '{'])('rejects invalid object %s without effects', async (body) => {
    expect((await endpoint.run(raw(body))).status).toBe(400); expect(io.calls).toHaveLength(0)
  })
  it('enforces the actual stream limit before domain I/O', async () => {
    const input = streamRequest()
    expect((await endpoint.run(input.request)).status).toBe(413)
    expect(input.cancelled()).toBe(true); expect(input.pulls()).toBeLessThan(16); expect(io.calls).toHaveLength(0)
  })
  it('does not read an unauthenticated body', async () => {
    io.denied = true
    const input = json(endpoint.body)
    expect((await endpoint.run(input)).status).toBeGreaterThanOrEqual(400)
    expect(input.bodyUsed).toBe(false); expect(io.calls).toHaveLength(0)
  })
})

it.each(['2026-00', '2026-13', '0000-08', 202608, null])('rejects invalid spot month %s', async (value) => {
  expect((await spot(json({ billing_month: value }))).status).toBe(400); expect(io.calls).toHaveLength(0)
})
it.each([false, 3, null, [], ['SE3', 'BAD'], [3]].map((value) => ({ value })))('rejects invalid spot areas $value without broadening to all areas', async ({ value }) => {
  expect((await spot(json({ billing_month: '2026-08', price_areas: value }))).status).toBe(400); expect(io.calls).toHaveLength(0)
})
it('retains valid comma-separated area strings and normalized equivalent aliases', async () => {
  expect((await spot(json({ billing_month: '2026-08', price_areas: ' se3, SE4 ', priceAreas: ['SE3', 'SE4'] }))).status).toBe(200)
  expect(io.calls[0]).toEqual({ name: 'spot', input: { billingMonth: '2026-08', priceAreas: ['SE3', 'SE4'], createdBy: 'platform-actor', triggerSource: 'manual' } })
})
it('retains the omitted-area default', async () => { expect((await spot(json({ billingMonth: '2026-08' }))).status).toBe(200); expect(io.calls[0].input).toMatchObject({ priceAreas: ['SE1', 'SE2', 'SE3', 'SE4'] }) })
it('rejects conflicting spot month aliases', async () => { expect((await spot(json({ billing_month: '2026-08', billingMonth: '2026-09' }))).status).toBe(400); expect(io.calls).toHaveLength(0) })

it.each([null, 1, 'row', [], { ...row, grid_area_code: 5 }, { ...row, price_area: 'BAD' }, { ...row, unknown: true }])('does not silently discard malformed grid rows %#', async (value) => {
  expect((await grid(json({ rows: [row, value] }))).status).toBe(400); expect(io.calls).toHaveLength(0)
})
it('retains legacy Swedish row aliases and metadata', async () => {
  const input = { elnatsforetag: 'Test owner', natomrade_name: 'Area', natomradeskod: 'ABC', elomrade: 'SE3', metadata: { source: 'test' } }
  expect((await grid(json({ data: [input] }))).status).toBe(200)
  expect(io.calls[0]).toEqual({ name: 'grid', input: [{ gridOwnerName: 'Test owner', gridAreaName: 'Area', gridAreaCode: 'ABC', priceArea: 'SE3', metadata: input }] })
})
it('rejects conflicting grid row aliases', async () => { expect((await grid(json({ rows: [{ ...row, gridAreaCode: 'OTHER' }] }))).status).toBe(400); expect(io.calls).toHaveLength(0) })
it('rejects conflicting grid root aliases', async () => { expect((await grid(json({ rows: [row], data: [{ ...row, grid_area_code: 'OTHER' }] }))).status).toBe(400); expect(io.calls).toHaveLength(0) })

for (const field of ['layer_id', 'limit', 'offset']) {
  it.each(['5', 1.5, -1, true, null])(`rejects invalid SVK ${field}=%s`, async (value) => {
    expect((await svk(json({ [field]: value }))).status).toBe(400); expect(io.calls).toHaveLength(0)
  })
}
it.each([{ layer_id: 51 }, { limit: 0 }, { limit: 251 }, { offset: 10_000_001 }, { action: 'retrry' }, { action: 'retry_reconciliation' }, { run_id: 3 }, { service_url: false }, { offset: 2, result_offset: 3 }])('rejects invalid SVK control %# before an import', async (body) => {
  expect((await svk(json(body))).status).toBe(400); expect(io.calls).toHaveLength(0)
})
it('retains empty-body default SVK import', async () => { expect((await svk(raw(''))).status).toBe(200); expect(io.calls[0].name).toBe('svk') })
it('retains explicit retry without entering import', async () => {
  expect((await svk(json({ action: 'retry_reconciliation', runId: 'run-A' }))).status).toBe(200)
  expect(io.calls).toEqual([{ name: 'retry', input: 'run-A' }])
})
it('retains numeric SVK aliases and actor identity', async () => {
  expect((await svk(json({ layerId: 0, limit: 20, result_offset: 100, runId: 'run-A' }))).status).toBe(200)
  expect(io.calls[0].input).toMatchObject({ layerId: 0, limit: 20, offset: 100, runId: 'run-A', actorUserId: 'platform-actor' })
})

it.each([{ company_id: 5 }, { street: [] }, { postal_code: 12345 }, { metadata: [] }, { metadata: null }, { company_id: 'A', companyId: 'B' }, { street: 'A', address: 'B' }])('rejects invalid resolver input %#', async (body) => {
  expect((await resolve(json(body))).status).toBe(400); expect(io.calls).toHaveLength(0)
})
it('retains resolver camelCase fields and explicit metadata', async () => {
  expect((await resolve(json({ companyId: 'company-A', customerSiteId: 'site-A', streetNumber: '1', gridAreaCode: 'ABC', metadata: { note: 'test' } }))).status).toBe(200)
  expect(io.calls[0].input).toMatchObject({ companyId: 'company-A', customerSiteId: 'site-A', streetNumber: '1', gridAreaCode: 'ABC', metadata: { note: 'test' } })
})

it.each(['false', 'true', 0, null, {}])('never turns malformed dry_run=%s into a real repair', async (value) => {
  expect((await repair(json({ ...repairBody, dry_run: value }))).status).toBe(400); expect(io.calls).toHaveLength(0)
})
it.each([{ ...repairBody, environment: 'live' }, { ...repairBody, dry_run: true, dryRun: false }, { company_id: 'A' }, { ...repairBody, company_id: '' }])('rejects invalid repair input %#', async (body) => {
  expect((await repair(json(body))).status).toBe(400); expect(io.calls).toHaveLength(0)
})
it('retains the safe default dry run and explicit apply', async () => {
  expect((await repair(json(repairBody))).status).toBe(200)
  expect(io.calls[0]).toEqual({ name: 'dry-run', input: { companyId: 'company-A', actorUserId: 'platform-actor', gridOwnerDataRequestId: 'request-A', customerInfoRequestId: null, environment: null, dryRun: true } })
  io.calls.length = 0
  expect((await repair(json({ ...repairBody, dryRun: false, environment: 'test' }))).status).toBe(200)
  expect(io.calls[0]).toMatchObject({ name: 'apply', input: { dryRun: false, environment: 'test' } })
})
