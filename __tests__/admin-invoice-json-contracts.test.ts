import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  denied: false, foreign: false,
  effects: [] as Array<{ name: string; input: unknown }>,
}))
vi.mock('@/lib/admin/apiGuards', () => ({
  requireAdminApiAccess: async () => io.denied
    ? { response: Response.json({ error: 'unauthorized' }, { status: 401 }) }
    : { guard: { userId: 'actor-A', companyId: 'company-A', isPlatformAdmin: false } },
  assertAdminApiCompanyAccess: async (_guard: unknown, company?: string) => {
    if (io.foreign || (company && company !== 'company-A')) throw new Error('forbidden')
    return 'company-A'
  },
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ from: () => {
    io.effects.push({ name: 'company-query', input: null })
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { billing_provider_environment: 'test', invoice_export_target_system: 'capway_aptic' }, error: null }) }
    return query
  } }),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => {
  io.effects.push({ name: 'query', input: table })
  const query = { select: () => query, eq: () => query,
    insert: (input: unknown) => { io.effects.push({ name: 'insert', input }); return query },
    update: (input: unknown) => { io.effects.push({ name: 'update', input }); return query },
    single: async () => ({ data: { provider_invoice_guid: 'invoice-guid', environment: 'test' }, error: null }),
    then: (resolve: (value: unknown) => unknown) => resolve({ data: null, error: null }),
  }
  return query
} } }))
vi.mock('@/lib/billing/invoiceReviewPrepare', () => ({ prepareInvoiceDraftsForReview: async (input: unknown) => { io.effects.push({ name: 'prepare', input }); return {} } }))
vi.mock('@/lib/integrations/billing/invoiceExportCore', () => ({ resetFailedInvoiceExportItems: async (input: unknown) => { io.effects.push({ name: 'retry', input }) } }))
vi.mock('@/lib/billing/invoiceApprovedDispatch', () => ({ sendApprovedInvoiceExportRun: async (input: unknown) => { io.effects.push({ name: 'send', input }); return {} } }))
vi.mock('@/lib/integrations/billing/capway/client', () => ({ createCapwayApticClient: async () => ({ dispute: async (_guid: string, input: unknown) => { io.effects.push({ name: 'dispute', input }); return {} } }) }))
vi.mock('@/lib/integrations/billing/capway/purchase', () => ({ requestCapwayInvoicePurchase: async (input: unknown) => { io.effects.push({ name: 'purchase', input }); return {} } }))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: async () => undefined }))
vi.mock('@/lib/ediel/inboundRequestAutomation', () => ({ evaluateInboundEdielRequest: async (input: unknown) => { io.effects.push({ name: 'ediel', input }); return {} } }))

import { POST as createExport } from '@/app/api/internal/invoice-exports/create/route'
import { POST as retry } from '@/app/api/internal/invoice-exports/[id]/retry/route'
import { POST as send } from '@/app/api/internal/invoice-exports/[id]/send/route'
import { POST as dispute } from '@/app/api/internal/invoices/[id]/dispute/route'
import { POST as purchase } from '@/app/api/internal/invoices/[id]/purchase/route'
import { POST as ediel } from '@/app/api/internal/ediel/inbound-request-automation/route'

type Endpoint = { name: string; run: (request: Request) => Promise<Response>; body: Record<string, unknown>; empty: boolean }
const context = { params: Promise.resolve({ id: 'item-A' }) }
const endpoints: Endpoint[] = [
  { name: 'create', run: createExport, body: { billing_month: '2026-08' }, empty: false },
  { name: 'retry', run: (r) => retry(r, context), body: {}, empty: true },
  { name: 'send', run: (r) => send(r, context), body: {}, empty: true },
  { name: 'dispute', run: (r) => dispute(r, context), body: {}, empty: true },
  { name: 'purchase', run: (r) => purchase(r, context), body: {}, empty: true },
  { name: 'ediel', run: ediel, body: { message_id: 'message-A' }, empty: false },
]
const raw = (body: string) => new Request('https://example.test/api/internal/test', { method: 'POST', body })
const req = (body: unknown) => raw(JSON.stringify(body))
beforeEach(() => { io.denied = false; io.foreign = false; io.effects.length = 0 })

describe.each(endpoints)('$name request contract', (endpoint) => {
  it('retains valid input', async () => {
    expect((await endpoint.run(req(endpoint.body))).status).toBe(200)
    expect(io.effects.length).toBeGreaterThan(0)
  })
  it.each(['unknown', 'actorUserId', 'environment', 'approved'])('rejects unknown field %s before I/O', async (key) => {
    expect((await endpoint.run(req({ ...endpoint.body, [key]: 'forged' }))).status).toBe(400)
    expect(io.effects).toHaveLength(0)
  })
  it.each(['null', '[]', 'true', '2', '"value"', '{'])('rejects malformed/non-object %s', async (value) => {
    expect((await endpoint.run(raw(value))).status).toBe(400)
    expect(io.effects).toHaveLength(0)
  })
  it('preserves the explicit route-specific empty-body contract', async () => {
    expect((await endpoint.run(raw(''))).status).toBe(endpoint.empty ? 200 : 400)
    if (!endpoint.empty) expect(io.effects).toHaveLength(0)
  })
  it('authenticates without consuming the body when denied', async () => {
    io.denied = true
    const input = req(endpoint.body)
    expect((await endpoint.run(input)).status).toBe(401)
    expect(input.bodyUsed).toBe(false)
    expect(io.effects).toHaveLength(0)
  })
  it('does not perform business I/O on company denial', async () => {
    io.foreign = true
    expect((await endpoint.run(req(endpoint.body))).status).toBeGreaterThanOrEqual(400)
    expect(io.effects).toHaveLength(0)
  })
  it('limits and cancels actual streamed bytes despite a lying Content-Length', async () => {
    let pulls = 0
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { if (++pulls > 20) controller.close(); else controller.enqueue(new Uint8Array(65536)) },
      cancel() { cancelled = true },
    })
    const init: RequestInit & { duplex: 'half' } = { method: 'POST', duplex: 'half', body: stream, headers: { 'content-length': '1' } }
    expect((await endpoint.run(new Request('https://example.test', init))).status).toBe(413)
    expect(cancelled).toBe(true)
    expect(pulls).toBeLessThan(20)
    expect(io.effects).toHaveLength(0)
  })
})

it.each(['2026-00', '2026-13', 202608, null])('rejects invalid billing month %s', async (billing_month) => {
  expect((await createExport(req({ billing_month }))).status).toBe(400)
  expect(io.effects).toHaveLength(0)
})
it('rejects conflicting company aliases instead of selecting the permitted one', async () => {
  expect((await send(req({ companyId: 'company-A', company_id: 'company-B' }), context)).status).toBe(400)
  expect(io.effects).toHaveLength(0)
})
it.each(['wrong', true, 5, null])('does not silently default financing mode %s', async (financing_mode) => {
  expect((await purchase(req({ financing_mode }), context)).status).toBe(400)
  expect(io.effects).toHaveLength(0)
})
it.each(['30', false, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid recourse days %s', async (recourse_days) => {
  expect((await purchase(req({ recourse_days }), context)).status).toBe(400)
  expect(io.effects).toHaveLength(0)
})
it('rejects conflicting financing aliases', async () => {
  expect((await purchase(req({ financing_mode: 'factoring_with_recourse', financingMode: 'factoring_without_recourse' }), context)).status).toBe(400)
  expect(io.effects).toHaveLength(0)
})
it('retains valid purchase semantics', async () => {
  expect((await purchase(req({ company_id: 'company-A', financing_mode: 'factoring_with_recourse', recourse_days: 30, note: 'reviewed' }), context)).status).toBe(200)
  expect(io.effects.find((effect) => effect.name === 'purchase')?.input).toMatchObject({ companyId: 'company-A', financingMode: 'factoring_with_recourse', recourseDays: 30, note: 'reviewed' })
})
it.each(['true', 1, null])('rejects forceManualReview=%s without invoking Ediel', async (forceManualReview) => {
  expect((await ediel(req({ message_id: 'message-A', forceManualReview }))).status).toBe(400)
  expect(io.effects).toHaveLength(0)
})
it('preserves the false force flag and canonical company', async () => {
  expect((await ediel(req({ messageId: 'message-A', forceManualReview: false }))).status).toBe(200)
  expect(io.effects[0]).toEqual({ name: 'ediel', input: { messageId: 'message-A', forceManualReview: false, companyId: 'company-A' } })
})
it('preserves default dispute reason', async () => {
  expect((await dispute(raw(''), context)).status).toBe(200)
  expect(io.effects.find((effect) => effect.name === 'dispute')?.input).toMatchObject({ reason: 'Bestridd via Gridex', isDisputed: true })
})
