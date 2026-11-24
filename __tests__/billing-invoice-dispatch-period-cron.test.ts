import { NextRequest } from 'next/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GET, POST } from '@/app/api/cron/billing/invoice-dispatch-period/route'

const worker = vi.hoisted(() => vi.fn())
vi.mock('@/lib/billing/invoiceDispatchPeriodReconciliation', () => ({ runInvoiceDispatchPeriodReconciliation: worker }))

const secret = 'synthetic-dispatch-period-scheduler'
const url = 'https://fixture.invalid/api/cron/billing/invoice-dispatch-period'
const summary = { scanned: 3, locked: 1, alreadyLocked: 0, superseded: 1, waiting: 1, deferred: 0, failed: 0 }

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', secret)
  vi.stubEnv('BILLING_AUTOMATION_CRON_SECRET', undefined)
  worker.mockReset().mockResolvedValue(summary)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

it('denies untrusted requests before touching the dispatch-period queue', async () => {
  const denied = await GET(new NextRequest(url, { headers: { 'user-agent': 'vercel-cron/1.0' } }))
  expect(denied.status).toBe(401)
  expect(denied.headers.get('cache-control')).toBe('no-store')
  expect(worker).not.toHaveBeenCalled()
})

it('uses its fixed tenant-independent work budget and exposes only counters', async () => {
  worker.mockResolvedValue({ ...summary, privateScope: 'private-tenant' })
  const result = await POST(new NextRequest(url + '?company=ignored&limit=10000', {
    method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify({ month: 'ignored' }),
  }))
  expect(result.status).toBe(200)
  expect(await result.json()).toEqual({ ok: true, ...summary })
  expect(worker).toHaveBeenCalledExactlyOnceWith()
})

it('reports a failed attempt separately from a legitimate pending confirmation', async () => {
  worker.mockResolvedValue({ ...summary, failed: 1 })
  const result = await GET(new NextRequest(url, { headers: { authorization: `Bearer ${secret}` } }))
  expect(result.status).toBe(503)
  expect(await result.json()).toEqual({ ok: false, ...summary, failed: 1 })
})

it('keeps unexpected errors behind an opaque trace ID', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  worker.mockRejectedValue(new Error('private upstream response'))
  const result = await GET(new NextRequest(url, { headers: { authorization: `Bearer ${secret}` } }))
  expect(result.status).toBe(503)
  const body = await result.json()
  expect(body).toEqual({ ok: false, error: 'invoice_dispatch_period_unavailable', trace_id: expect.stringMatching(/^[a-f0-9-]{36}$/) })
  expect(log.mock.calls).toEqual([['[invoice-dispatch-period-cron] reconciliation failed', { traceId: body.trace_id }]])
})
