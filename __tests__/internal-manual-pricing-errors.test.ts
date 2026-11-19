import { once } from 'node:events'
import { createServer } from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as preview } from '@/app/api/internal/pricing/preview/route'
import { POST as reprice } from '@/app/api/internal/pricing/reprice/route'

const ports = vi.hoisted(() => ({ access: vi.fn(), price: vi.fn(), month: vi.fn() }))
vi.mock('@/lib/admin/apiGuards', () => ({
  requireAdminApiAccess: ports.access,
  requireAdminOperationalCompany: async (guard: { companyId: string }) => guard.companyId,
}))
vi.mock('@/lib/pricing/engine', () => ({
  calculatePricingPreviewForUnderlay: ports.price,
  calculatePricingPreviewForBillingMonth: ports.month,
}))

const routes = [
  { path: '/api/internal/pricing/reprice', handler: reprice, fallback: 'pricing_reprice_failed', success: 'repriced' },
  { path: '/api/internal/pricing/preview', handler: preview, fallback: 'pricing_preview_failed', success: 'success' },
]
const companyId = 'authorized-company'
const underlayId = 'underlay-a'
let server: ReturnType<typeof createServer>
let origin: string

// Mount the real Next POST handlers over loopback. The admin and pricing
// ports are synthetic; request dispatch and JSON responses use the handlers.
beforeAll(async () => {
  server = createServer(async (request, response) => {
    const route = routes.find((item) => item.path === request.url && request.method === 'POST')
    if (!route) {
      response.writeHead(404).end()
      return
    }
    try {
      const chunks = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const result = await route.handler(new Request(origin + route.path, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.concat(chunks).toString('utf8'),
      }))
      response.writeHead(result.status, Object.fromEntries(result.headers)).end(await result.text())
    } catch {
      response.writeHead(502).end()
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Loopback HTTP address missing')
  origin = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

beforeEach(() => {
  ports.access.mockReset().mockResolvedValue({ guard: { companyId } })
  ports.price.mockReset()
  ports.month.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

const post = (path: string, body: Record<string, unknown> = { billing_underlay_id: underlayId, company_id: 'foreign' }) =>
  fetch(origin + path, {
    method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify(body),
  })

describe.each(routes)('$path', ({ path, fallback, success }) => {
  it('surfaces the exact temporary lock result without replaying the request', async () => {
    ports.price.mockRejectedValue({ code: '55P03', message: 'pricing_source_basis_busy_retry', details: 'private fixture detail' })
    const response = await post(path)
    const body = await response.json()
    expect(response.status).toBe(503)
    expect(body).toMatchObject({ code: 'pricing_source_basis_busy_retry', error: expect.stringContaining('Försök igen'), trace_id: expect.any(String) })
    expect(JSON.stringify(body)).not.toContain('private fixture detail')
    expect(ports.price.mock.calls).toEqual([[{ companyId, billingUnderlayId: underlayId, persist: true }]])
    expect(ports.access).toHaveBeenCalledWith(['pricing.write'])
  })

  it.each([
    { code: '23514', message: 'billing_finalized_source_basis_required' },
    { code: '23514', message: 'billing_finalized_supply_basis_changed' },
    new Error('pricing_source_basis_unavailable'),
  ])('holds a recognized invalid source for review', async (error) => {
    ports.price.mockRejectedValue(error)
    const response = await post(path)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'pricing_source_basis_unavailable', error: expect.stringContaining('granskas'), trace_id: expect.any(String) })
    expect(ports.price).toHaveBeenCalledTimes(1)
  })

  it.each([
    { code: '55P03', message: 'some_other_lock' },
    { code: 'XX000', message: 'pricing_source_basis_busy_retry' },
    { code: '23514', message: 'source_bound_pricing_snapshot_mismatch' },
    { code: '23514', message: 'pricing_linked_settlement_scope_unavailable' },
    { code: '23514', message: 'finance_copy_retention_tombstoned' },
    { code: 'XX000', message: 'billing_finalized_source_basis_required' },
  ])('preserves generic failure handling for an unrelated error', async (error) => {
    ports.price.mockRejectedValue(error)
    const response = await post(path)
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ code: fallback, trace_id: expect.any(String) })
    expect(ports.price).toHaveBeenCalledTimes(1)
  })

  it('keeps the successful result and authorized company', async () => {
    ports.price.mockResolvedValue({ status: 'success', pricingRunId: 'fixture-run' })
    const response = await post(path)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { status: success, pricingRunId: 'fixture-run' } })
    expect(ports.price.mock.calls).toEqual([[{ companyId, billingUnderlayId: underlayId, persist: true }]])
  })

  it('returns an access denial before pricing', async () => {
    ports.access.mockResolvedValue({ response: Response.json({ error: 'forbidden' }, { status: 403 }) })
    expect((await post(path)).status).toBe(403)
    expect(ports.price).not.toHaveBeenCalled()
  })
})

it('keeps the billing-period 409 in preview', async () => {
  ports.price.mockRejectedValue(new Error('Fakturaperioden 2026-10 är locked'))
  const response = await post('/api/internal/pricing/preview')
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({ code: 'pricing_preview_failed' })
})

it('returns the existing monthly result from the separate pricing path', async () => {
  const result = { underlays: 1, failed: 1, results: [{ status: 'failed' }] }
  ports.month.mockResolvedValue(result)
  const response = await post('/api/internal/pricing/preview', { billing_month: '2026-10', persist: false })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ data: result })
  expect(ports.month.mock.calls).toEqual([[{ companyId, billingMonth: '2026-10', persist: false }]])
  expect(ports.price).not.toHaveBeenCalled()
})
