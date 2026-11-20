import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/internal/invoices/[id]/purchase/route'

const scope = vi.hoisted(() => ({
  company: 'b1000000-0000-4000-8000-000000000001',
  other: 'b1000000-0000-4000-8000-000000000002',
  actor: 'b1000000-0000-4000-8000-000000000003',
  item: 'b1000000-0000-4000-8000-000000000004',
  run: 'b1000000-0000-4000-8000-000000000005',
  partner: 'b1000000-0000-4000-8000-000000000006',
}))
const ports = vi.hoisted(() => ({ db: vi.fn<typeof fetch>(), access: vi.fn() }))

vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('https://manual-db.example.invalid', 'synthetic-sdk-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: ports.db },
  }) }
})
vi.mock('@/lib/admin/apiGuards', () => ({ requireAdminApiAccess: ports.access }))
vi.mock('@/lib/tenant/scope', () => ({ assertUserCanOperateCompany: async (_actor: string, companyId: string) => companyId }))
vi.mock('@/lib/integrations/billing/capway/auth', () => ({
  resolveCapwayConnectionConfig: async () => ({
    rawSettings: {}, baseUrl: 'https://manual-provider.example.invalid', authMode: 'apikey', apiKey: 'test-key', apiKeyHeader: 'X-Test-Key',
  }),
}))

const manual = 'manual_purchase_reconciliation'
const automatic = 'automatic_purchase_reconciliation'
const updatedAt = '2026-11-20T01:00:02.123456+00:00'
type Row = Record<string, unknown>
let item: Row
let losePartnerReply: boolean
let failAudit: boolean
let omitAuditReceipt: boolean
let loseReservationReply: boolean
let advanceFinanceBeforeReservation: boolean
let cancelAtReservation: boolean
let concurrentReads: { arrivals: number; wait: Promise<void>; release: () => void } | null
const atPartner: Row[] = []
const auditRequests: Row[] = []

function beginConcurrentReads() {
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  concurrentReads = { arrivals: 0, wait, release }
}

function matches(column: string, filter: string) {
  const asText = column.startsWith('response_payload->>')
  const asJson = column.startsWith('response_payload->') && !asText
  if (asText || asJson) {
    const field = column.slice(asText ? 'response_payload->>'.length : 'response_payload->'.length)
    const payload = item.response_payload as Row
    const absent = !Object.hasOwn(payload, field)
    if (filter === 'is.null') return absent || (asText && payload[field] === null)
    throw new Error(`Unexpected synthetic JSON filter ${filter}`)
  }
  if (filter === 'is.null') return item[column] === null
  if (filter.startsWith('eq.')) return String(item[column]) === filter.slice(3)
  throw new Error(`Unexpected synthetic filter ${column} ${filter}`)
}

async function databasePort(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input))
  expect(url.origin).toBe('https://manual-db.example.invalid')
  const body = init?.body ? JSON.parse(String(init.body)) as Row : null
  if (url.pathname === '/rest/v1/rpc/gridex_record_invoice_purchase_request_v1') {
    expect(body).toMatchObject({ p_company_id: scope.company, p_invoice_export_item_id: scope.item, p_actor_user_id: scope.actor })
    auditRequests.push(body!)
    if (failAudit) return Response.json({ code: 'PGRST000', message: 'synthetic audit failure' }, { status: 503 })
    // Canonical function on the frozen baseline writes requested after provider return.
    item.purchase_status = 'requested'
    return Response.json(omitAuditReceipt ? null : { event_id: 'synthetic-native-event' })
  }
  expect(url.pathname).toBe('/rest/v1/invoice_export_items')
  if (init?.method === 'PATCH' && advanceFinanceBeforeReservation) {
    item.purchase_status = 'purchased_with_recourse'
    advanceFinanceBeforeReservation = false
  }
  if (init?.method === 'PATCH' && cancelAtReservation) {
    // The signed cancellation keeps a sent export row sent and may carry no finance status.
    item.provider_status = 'cancelled'
    cancelAtReservation = false
  }
  const match = [...url.searchParams].every(([column, filter]) => column === 'select' || matches(column, filter))
  if (init?.method === 'PATCH' && body) {
    expect(url.searchParams.get('company_id')).toBe(`eq.${scope.company}`)
    expect(url.searchParams.get('id')).toBe(`eq.${scope.item}`)
    if (!match) return Response.json([])
    Object.assign(item, body)
    if (loseReservationReply) return Response.json({ code: 'PGRST000', message: 'synthetic lost reservation response' }, { status: 503 })
    return Response.json([{ id: item.id }])
  }
  if (!match) return Response.json({ code: 'PGRST116', message: 'missing synthetic row' }, { status: 406 })
  const snapshot = structuredClone(item)
  if (concurrentReads) {
    const barrier = concurrentReads
    barrier.arrivals += 1
    if (barrier.arrivals === 2) {
      concurrentReads = null
      barrier.release()
    }
    await barrier.wait
  }
  return Response.json(snapshot)
}

async function providerPort(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input))
  expect(url.origin).toBe('https://manual-provider.example.invalid')
  expect(url.pathname).toBe(`/v1/Invoices/${scope.partner}/Purchase`)
  expect(init?.method).toBe('POST')
  atPartner.push(structuredClone(item))
  if (losePartnerReply) throw new TypeError('synthetic lost HTTP response after provider dispatch')
  return Response.json({ purchaseReference: 'synthetic-accepted' })
}

function submit(companyId = scope.company) {
  return POST(new Request(`https://operator.example.invalid/api/internal/invoices/${scope.item}/purchase`, {
    method: 'POST', body: JSON.stringify({ companyId, financing_mode: 'factoring_with_recourse' }),
  }), { params: Promise.resolve({ id: scope.item }) })
}

beforeEach(() => {
  item = { id: scope.item, company_id: scope.company, export_run_id: scope.run, provider: 'capway_aptic', environment: 'test', status: 'sent',
    provider_invoice_guid: scope.partner, provider_status: null, purchase_status: 'service', provider_purchase_confirmed_at: null,
    response_payload: { create_invoice: { invoiceGuids: [scope.partner] }, purchase: null }, updated_at: updatedAt }
  losePartnerReply = false
  failAudit = false
  omitAuditReceipt = false
  loseReservationReply = false
  advanceFinanceBeforeReservation = false
  cancelAtReservation = false
  concurrentReads = null
  atPartner.length = 0
  auditRequests.length = 0
  ports.db.mockReset().mockImplementation(databasePort)
  ports.access.mockReset().mockResolvedValue({ guard: { userId: scope.actor } })
  vi.stubGlobal('fetch', providerPort)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const reserved = { company_id: scope.company, invoice_export_item_id: scope.item, export_run_id: scope.run,
  provider: 'capway_aptic', environment: 'test', invoice_guid: scope.partner, financing_mode: 'factoring_with_recourse', actor_user_id: scope.actor }

it('gives one partner request and one accounting event to concurrent callers sharing the same old snapshot', async () => {
  beginConcurrentReads()
  const responses = await Promise.all([submit(), submit()])
  expect(responses.map(response => response.status).sort()).toEqual([200, 409])
  expect(atPartner).toMatchObject([{ response_payload: { [manual]: reserved }, purchase_status: 'service' }])
  expect(auditRequests).toHaveLength(1)
  expect(item.purchase_status).toBe('requested')
  expect((await submit()).status).toBe(409)
  expect(atPartner).toHaveLength(1)
})

it('keeps manual replay blocked after a lost provider reply even when the current provider state still says service', async () => {
  losePartnerReply = true
  expect((await submit()).status).toBe(500)
  expect(item.response_payload).toMatchObject({ [manual]: reserved })
  expect(item.purchase_status).toBe('service')
  expect(auditRequests).toHaveLength(0)
  expect((await submit()).status).toBe(409)
  expect(atPartner).toHaveLength(1)
})

it('keeps manual replay blocked after provider acceptance followed by a lost local audit', async () => {
  failAudit = true
  expect((await submit()).status).toBe(500)
  expect(item.response_payload).toMatchObject({ [manual]: reserved })
  expect((await submit()).status).toBe(409)
  expect(atPartner).toHaveLength(1)
  expect(auditRequests).toHaveLength(1)
})

it('does not call the provider without an acknowledged reservation or rearm it after process restart', async () => {
  loseReservationReply = true
  expect((await submit()).status).toBe(500)
  expect(item.response_payload).toMatchObject({ [manual]: reserved })
  expect((await submit()).status).toBe(409)
  expect(atPartner).toHaveLength(0)
  expect(auditRequests).toHaveLength(0)
})

it.each([
  ['historical purchase request', { purchase_status: 'requested' }],
  ['signed positive finance state', { purchase_status: 'purchased_with_recourse' }],
  ['persisted provider purchase confirmation', { provider_purchase_confirmed_at: updatedAt }],
  ['accepted automatic purchase', { response_payload: { purchase: {} } }],
  ['uncertain automatic purchase', { response_payload: { [automatic]: { attempt_no: 1 } } }],
])('does not make another provider request after %s', async (_label, prior) => {
  Object.assign(item, prior)
  expect((await submit()).status).toBe(409)
  expect(atPartner).toHaveLength(0)
  expect(auditRequests).toHaveLength(0)
})

it('gives a signed finance change before the reservation precedence even at the same row timestamp', async () => {
  advanceFinanceBeforeReservation = true
  expect((await submit()).status).toBe(409)
  expect(item.purchase_status).toBe('purchased_with_recourse')
  expect(atPartner).toHaveLength(0)
})

it('keeps wrong tenant and foreign invoice provider away from a Capway purchase', async () => {
  await submit(scope.other)
  expect(atPartner).toHaveLength(0)
  item.provider = 'file_export'
  expect((await submit()).status).toBe(409)
  expect(atPartner).toHaveLength(0)
})


it('requires the persisted sent state even if a previous placeholder has a Capway invoice id', async () => {
  item.status = 'failed'
  const response = await submit()
  expect(response.status).toBe(409)
  await expect(response.json()).resolves.toMatchObject({ code: 'invoice_purchase_invoice_not_sent' })
  expect(atPartner).toHaveLength(0)
})

it('preserves the first approved purchase on a historical sent invoice with no purchase state', async () => {
  item.purchase_status = null
  const response = await submit()
  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toMatchObject({ data: { purchaseReference: 'synthetic-accepted' } })
  expect(atPartner).toMatchObject([{ purchase_status: null, response_payload: { [manual]: reserved } }])
  const patch = ports.db.mock.calls.find(([, init]) => init?.method === 'PATCH')
  expect(new URL(String(patch?.[0])).searchParams.get('provider_status')).toBe('is.null')
  expect(auditRequests).toHaveLength(1)
})


it('reports the unverified audit outcome when its response lacks an event id', async () => {
  omitAuditReceipt = true
  expect((await submit()).status).toBe(500)
  expect((await submit()).status).toBe(409)
  expect(item.response_payload).toMatchObject({ [manual]: reserved })
  expect(atPartner).toHaveLength(1)
  expect(auditRequests).toHaveLength(1)
})

it('does not arm a purchase when the signed partner cancelled a still-sent invoice without finance status', async () => {
  item.provider_status = 'cancelled'
  const response = await submit()
  expect(response.status).toBe(409)
  await expect(response.json()).resolves.toMatchObject({ code: 'invoice_purchase_provider_cancelled' })
  expect(item.response_payload).not.toHaveProperty(manual)
  expect(atPartner).toHaveLength(0)
  expect(auditRequests).toHaveLength(0)
})

it('gives a signed cancellation the reservation race even at the same row timestamp', async () => {
  item.provider_status = 'unpaid'
  cancelAtReservation = true
  const response = await submit()
  expect(response.status).toBe(409)
  expect(item.provider_status).toBe('cancelled')
  expect(item.status).toBe('sent')
  expect(item.purchase_status).toBe('service')
  expect(item.response_payload).not.toHaveProperty(manual)
  expect(atPartner).toHaveLength(0)
  expect(auditRequests).toHaveLength(0)
})

it('accepts the ordinary provider unpaid state and binds the observed value to the reservation', async () => {
  item.provider_status = 'unpaid'
  expect((await submit()).status).toBe(200)
  const patch = ports.db.mock.calls.find(([, init]) => init?.method === 'PATCH')
  expect(new URL(String(patch?.[0])).searchParams.get('provider_status')).toBe('eq.unpaid')
  expect(atPartner).toHaveLength(1)
})
