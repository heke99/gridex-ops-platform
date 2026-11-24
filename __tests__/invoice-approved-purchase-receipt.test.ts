import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { POST as sendInvoiceRun } from '@/app/api/internal/invoice-exports/[id]/send/route'
import { POST as resetInvoiceRun } from '@/app/api/internal/invoice-exports/[id]/retry/route'
import { POST as purchaseInvoice } from '@/app/api/internal/invoices/[id]/purchase/route'

const ids = vi.hoisted(() => ({
  company: 'a1000000-0000-4000-8000-000000000001',
  actor: 'a1000000-0000-4000-8000-000000000002',
  run: 'a1000000-0000-4000-8000-000000000003',
  item: 'a1000000-0000-4000-8000-000000000004',
  invoice: 'a1000000-0000-4000-8000-000000000005',
  customer: 'a1000000-0000-4000-8000-000000000006',
  contract: 'a1000000-0000-4000-8000-000000000007',
  underlay: 'a1000000-0000-4000-8000-000000000008',
  pricingRun: 'a1000000-0000-4000-8000-000000000009',
  partner: 'a1000000-0000-4000-8000-000000000010',
}))
const port = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>(), requireAccess: vi.fn() }))

vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('https://invoice-db.example.invalid', 'synthetic-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: port.fetch },
  }) }
})
vi.mock('@/lib/admin/apiGuards', () => ({ requireAdminApiAccess: port.requireAccess }))
vi.mock('@/lib/tenant/scope', () => ({ assertUserCanOperateCompany: async (_actor: string, companyId: string) => companyId }))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: async () => undefined }))
vi.mock('@/lib/platform/outboundFreeze', () => ({ assertOutboundAllowed: async () => undefined }))
vi.mock('@/lib/automation/locks', () => ({ withAutomationLock: ({ run }: { run: (lease: { lockToken: string }) => Promise<unknown> }) => run({ lockToken }) }))
vi.mock('@/lib/ediel/retention/financeCopyRetention', () => ({ requireInvoiceSourceCopiesAvailable: async () => undefined }))
vi.mock('@/lib/integrations/billing/capway/auth', () => ({
  resolveCapwayConnectionConfig: async () => ({
    rawSettings: {}, baseUrl: 'https://synthetic-partner.example.invalid', authMode: 'apikey', apiKey: 'fake-key', apiKeyHeader: 'X-Example-Key',
  }),
}))
vi.mock('@/lib/integrations/billing/capway/payloadBuilder', () => ({ buildCapwayInvoicePayload: () => ({ externalReferenceCode: 'invoice-dispatch-proof' }) }))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: async () => undefined }))

const checkpointField = 'automatic_purchase_reconciliation'
const providerKey = 'invoice-dispatch-proof-key'
const lockToken = 'a1000000-0000-4000-8000-000000000011'
const entryIds: Record<string, string> = {
  create: 'a1000000-0000-4000-8000-000000000012',
  purchase: 'a1000000-0000-4000-8000-000000000013',
  direct: 'a1000000-0000-4000-8000-000000000014',
}
const enteredPhases = new Set<string>()
let directAcknowledged: boolean
type Row = Record<string, unknown>
let tables: Record<string, Row[]>
let checkpointFailure: 'before_commit' | 'after_commit' | null
let finalWriteFails: boolean
let changesCheckpointBeforeFinalize: boolean
const writes: Array<{ table: string; status: unknown }> = []

function seedRows(): Record<string, Row[]> {
  const company = { company_id: ids.company }
  const approval = { metadata: { approval: { status: 'approved', approved_by: ids.actor } } }
  const totals = { total_kwh: 20, amount_ex_vat: 100, vat_amount: 25, amount_inc_vat: 125 }
  return {
    invoice_export_items: [{ ...company, ...approval, ...totals, id: ids.item, status: 'pending', export_run_id: ids.run, provider: 'capway_aptic', environment: 'test', attempt_count: 0, response_payload: {}, updated_at: '2026-11-01T00:00:00Z',
      customer_id: ids.customer, customer_contract_id: ids.contract, billing_underlay_id: ids.underlay,
      pricing_run_id: ids.pricingRun, provider_idempotency_key: providerKey }],
    invoice_export_runs: [{ ...company, id: ids.run, provider: 'capway_aptic', environment: 'test', status: 'pending', billing_month: '2026-11', financing_mode: 'factoring_with_recourse' }],
    pricing_runs: [{ ...company, id: ids.pricingRun, billing_underlay_id: ids.underlay,
      status: 'locked', locked_at: '2026-11-01T00:00:00Z', total_ex_vat: 100, vat_amount: 25, total_inc_vat: 125 }],
    pricing_preview_lines: [],
    customers: [{ ...company, id: ids.customer, customer_type: 'business' }],
    billing_underlays: [{ ...company, id: ids.underlay, underlay_year: 2026, underlay_month: 11, status: 'validated',
      readiness_status: 'ready', customer_id: ids.customer, customer_contract_id: ids.contract, price_area: 'SE3', total_kwh: 20 }],
    companies: [{ id: ids.company, invoice_export_target_system: 'capway_aptic', billing_provider_environment: 'test', invoice_export_enabled: true }],
    customer_invoices: [{ ...company, ...approval, ...totals, id: ids.invoice, invoice_export_item_id: ids.item,
      status: 'draft', calculation_snapshot_sha256: 'a'.repeat(64) }],
    billing_export_run_items: [{ ...company, id: ids.item, status: 'pending' }],
    billing_export_runs: [{ ...company, id: ids.run, status: 'pending' }],
    invoice_export_attempts: [],
    invoice_dead_letters: [],
  }
}

// Route all reads, writes and RPCs through the real SDK. Each request sees the last
// state accepted by this synthetic database, including the persisted attempt rows.
async function databasePort(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input))
  expect(url.origin).toBe('https://invoice-db.example.invalid')
  if (url.pathname === '/rest/v1/rpc/gridex_project_direct_capway_ack_v1') {
    const body = JSON.parse(String(init?.body)) as Row
    expect(body).toEqual({ p_company: ids.company, p_item: ids.item, p_run: ids.run, p_actor: ids.actor, p_environment: 'test' })
    if (!directAcknowledged) return Response.json(null)
    Object.assign(tables.invoice_export_items[0], { status: 'sent', provider_invoice_guid: ids.partner, attempt_count: 1 })
    Object.assign(tables.customer_invoices[0], { status: 'sent', partner_invoice_reference: ids.partner })
    writes.push({ table: 'invoice_export_items', status: 'sent' })
    return Response.json({ id: ids.item, status: 'sent', invoiceGuid: ids.partner })
  }
  if (url.pathname === '/rest/v1/rpc/gridex_reserve_direct_capway_invoice_v1') {
    const body = JSON.parse(String(init?.body)) as Row
    expect(body).toMatchObject({ p_company: ids.company, p_item: ids.item, p_run: ids.run, p_actor: ids.actor,
      p_environment: 'test', p_wire_body: JSON.stringify([{ externalReferenceCode: 'invoice-dispatch-proof' }]) })
    expect(enteredPhases.has('direct')).toBe(false)
    enteredPhases.add('direct')
    return Response.json(entryIds.direct)
  }
  if (url.pathname === '/rest/v1/rpc/gridex_reserve_capway_dispatch_entry_v1') {
    const body = JSON.parse(String(init?.body)) as Row
    const phase = String(body.p_phase)
    expect(body).toMatchObject({
      p_company: ids.company, p_item: ids.item, p_invoice: ids.invoice, p_run: ids.run,
      p_actor: ids.actor, p_lease: lockToken, p_provider_key: providerKey,
      p_request_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    if (!entryIds[phase] || enteredPhases.has(phase)) {
      return Response.json({ code: '23514', message: 'capway_dispatch_previous_effect_unresolved' }, { status: 400 })
    }
    enteredPhases.add(phase)
    return Response.json(entryIds[phase])
  }
  if (['/rest/v1/rpc/gridex_record_capway_dispatch_ack_v1','/rest/v1/rpc/gridex_record_direct_capway_ack_v1'].includes(url.pathname)) {
    const body = JSON.parse(String(init?.body)) as Row
    expect(body).toMatchObject({ p_company: ids.company, p_item: ids.item, p_lease: lockToken })
    expect([...enteredPhases].map(phase => entryIds[phase])).toContain(body.p_entry)
    if (body.p_entry === entryIds.direct) { expect(body.p_http_status).toBe(201); directAcknowledged = true }
    return Response.json(body.p_entry)
  }
  if (url.pathname === '/rest/v1/rpc/gridex_finalize_automatic_invoice_purchase_ack_v1') {
    const args = JSON.parse(String(init?.body)) as Row
    const row = tables.invoice_export_items.find(item => item.id === args.p_invoice_export_item_id &&
      item.company_id === args.p_company_id && item.export_run_id === args.p_export_run_id &&
      item.environment === args.p_environment)
    const mirror = tables.customer_invoices.find(invoice => invoice.id === args.p_customer_invoice_id &&
      invoice.company_id === args.p_company_id && invoice.invoice_export_item_id === args.p_invoice_export_item_id)
    const previous = row?.response_payload as Row | undefined
    const held = previous?.[checkpointField] as Row | undefined
    if (!row || !mirror || !held || held.attempt_no !== args.p_attempt_no || held.invoice_guid !== args.p_invoice_guid ||
      row.last_attempt_at !== args.p_started_at || held.provider_idempotency_key !== args.p_provider_key) {
      return Response.json({ code: '23514', message: 'automatic_invoice_purchase_checkpoint_changed' }, { status: 400 })
    }
    if (finalWriteFails) {
      finalWriteFails = false
      return Response.json({ code: 'PGRST000', message: 'synthetic sent result write unavailable' }, { status: 503 })
    }
    const now = new Date().toISOString()
    Object.assign(row, {
      status: 'sent', provider_invoice_guid: args.p_invoice_guid, provider_invoice_id: args.p_invoice_guid,
      provider_request_id: args.p_provider_key, provider_idempotency_key: args.p_provider_key,
      provider_confirmed_at: now, sent_at: now, updated_at: now,
      request_payload: args.p_request_payload, next_retry_at: null, error_code: null, error_payload: {},
      response_payload: { create_invoice: previous?.create_invoice, purchase: args.p_purchase_ack },
    })
    Object.assign(mirror, {
      status: 'sent', partner_invoice_reference: args.p_invoice_guid, due_date: args.p_due_date,
      issued_at: args.p_issued_at, raw_payload: row.response_payload, updated_at: now,
    })
    writes.push({ table: 'invoice_export_items', status: row.status })
    return Response.json({ id: row.id, status: 'sent' })
  }
  if (url.pathname === '/rest/v1/rpc/gridex_set_billing_period_lock_v1') {
    const lock = JSON.parse(String(init?.body)) as Row
    expect(lock).toMatchObject({ p_company_id: ids.company, p_billing_month: '2026-11', p_status: 'exported', p_locked: true })
    expect(tables.invoice_export_items[0].status).toBe('sent')
    expect(tables.customer_invoices[0].status).toBe('sent')
    expect(tables.invoice_export_attempts.at(-1)).toMatchObject({ outcome: 'sent', attempt_no: tables.invoice_export_items[0].attempt_count })
      return Response.json({ lock: { status: 'exported' } })
  }

  const table = url.pathname.replace('/rest/v1/', '')
  if (!Object.hasOwn(tables, table)) throw new Error(`Unexpected test table ${table}`)
  const body = init?.body ? JSON.parse(String(init.body)) as Row : null
  const data = tables[table]
  if (init?.method === 'POST' && body) {
    data.push(body)
    writes.push({ table, status: body.outcome })
    return new Response(null, { status: 201 })
  }

  let rows = data
  for (const [field, filter] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset'].includes(field)) continue
    const prefix = `response_payload->${checkpointField}->>`
    if (filter.startsWith('eq.')) rows = rows.filter(row => {
      const response = row.response_payload as Row | undefined
      const checkpoint = response?.[checkpointField] as Row | undefined
      const value = field.startsWith(prefix) ? checkpoint?.[field.slice(prefix.length)] : row[field]
      return String(value) === filter.slice(3)
    })
    else if (filter.startsWith('in.(')) rows = rows.filter(row => filter.slice(4, -1).split(',').includes(String(row[field])))
    else throw new Error(`Unexpected test filter ${field}`)
  }
  if (init?.method === 'PATCH' && body) {
    expect(url.searchParams.get('company_id')).toBe(`eq.${ids.company}`)
    const response = body.response_payload as Row | undefined
    if (table === 'invoice_export_items' && body.status === 'sent' && finalWriteFails) {
      finalWriteFails = false
      return Response.json({ code: 'PGRST000', message: 'synthetic sent result write unavailable' }, { status: 503 })
    }
    if (table === 'invoice_export_items' && response && Object.hasOwn(response, checkpointField) && checkpointFailure) {
      if (checkpointFailure === 'after_commit') rows.forEach(row => Object.assign(row, body))
      checkpointFailure = null
      return Response.json({ code: 'PGRST000', message: 'synthetic write response unavailable' }, { status: 503 })
    }
    writes.push({ table, status: body.status })
    // The native sent guard refuses a downgrade of a confirmed export item.
    if (table === 'invoice_export_items' &&
      ['pending', 'failed', 'failed_retryable'].includes(String(body.status)) &&
      rows.some(row => ['sent', 'credited'].includes(String(row.status)))) {
      return Response.json({ code: 'P0001', message: 'synthetic sent item downgrade refused' }, { status: 400 })
    }
    rows.forEach(row => Object.assign(row, body))
    if (!url.searchParams.has('select')) return new Response(null, { status: 204 })
  }
  const offset = Number(url.searchParams.get('offset') ?? 0)
  const limit = Number(url.searchParams.get('limit') ?? rows.length)
  rows = rows.slice(offset, offset + limit)
  const accept = new Headers(init?.headers).get('accept')
  return Response.json(accept === 'application/vnd.pgrst.object+json' ? rows[0] : rows)
}

function send(companyId = ids.company) {
  return sendInvoiceRun(new Request(`https://local.example.invalid/api/internal/invoice-exports/${ids.run}/send`, {
    method: 'POST', body: JSON.stringify({ companyId }),
  }), { params: Promise.resolve({ id: ids.run }) })
}

beforeEach(() => {
  tables = seedRows()
  enteredPhases.clear()
  directAcknowledged = false
  checkpointFailure = null
  finalWriteFails = false
  changesCheckpointBeforeFinalize = false
  writes.length = 0
  port.fetch.mockReset().mockImplementation(databasePort)
  port.requireAccess.mockReset().mockResolvedValue({ guard: { userId: ids.actor } })
  partnerAcceptedCreate = false
  losesPurchaseResponse = false
  observedPurchaseReceipts.length = 0
  providerCalls.length = 0
  vi.stubGlobal('fetch', partnerPort)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

let partnerAcceptedCreate: boolean
let losesPurchaseResponse: boolean
const providerCalls: Array<{ method: string; path: string }> = []
const observedPurchaseReceipts: Row[] = []

async function partnerPort(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input))
  expect(url.origin).toBe('https://synthetic-partner.example.invalid')
  const method = init?.method ?? 'GET'
  providerCalls.push({ method, path: url.pathname })
  if (url.pathname === '/v1/Invoices' && method === 'GET') {
    expect(url.searchParams.get('$filter')).toBe("externalReferenceCode eq 'invoice-dispatch-proof'")
    expect(url.searchParams.get('$top')).toBe('2')
    return Response.json({ value: partnerAcceptedCreate ? [{ invoiceGuid: ids.partner }] : [] })
  }
  if (url.pathname === '/v1/Invoices' && method === 'PUT') {
    expect(new Headers(init?.headers).get('idempotency-key')).toBe(providerKey)
    partnerAcceptedCreate = true
    return Response.json({ invoiceGuids: [ids.partner] }, { status: 201 })
  }
  if (url.pathname === `/v1/Invoices/${ids.partner}/Purchase` && method === 'POST') {
    observedPurchaseReceipts.push(structuredClone(tables.invoice_export_items[0]))
    if (losesPurchaseResponse) throw new TypeError('synthetic lost purchase response')
    if (changesCheckpointBeforeFinalize) {
      const response = tables.invoice_export_items[0].response_payload as Row
      const checkpoint = response[checkpointField] as Row | undefined
      if (checkpoint) checkpoint.attempt_no = 2
    }
    return Response.json({ purchaseReference: 'synthetic-purchase-accepted' })
  }
  throw new Error(`Unexpected synthetic provider method ${method} ${url.pathname}`)
}

function purchaseCommands() {
  return providerCalls.filter(call => call.method === 'POST' && call.path.endsWith('/Purchase'))
}

function reset() {
  return resetInvoiceRun(new Request(`https://local.example.invalid/api/internal/invoice-exports/${ids.run}/retry`, {
    method: 'POST', body: JSON.stringify({ companyId: ids.company }),
  }), { params: Promise.resolve({ id: ids.run }) })
}

function manuallyPurchase() {
  return purchaseInvoice(new Request(`https://local.example.invalid/api/internal/invoices/${ids.item}/purchase`, {
    method: 'POST', body: JSON.stringify({ companyId: ids.company }),
  }), { params: Promise.resolve({ id: ids.item }) })
}


const expectedCheckpoint = {
  company_id: ids.company,
  export_run_id: ids.run,
  invoice_export_item_id: ids.item,
  provider: 'capway_aptic',
  environment: 'test',
  financing_mode: 'factoring_with_recourse',
  invoice_guid: ids.partner,
  attempt_no: 1,
  provider_idempotency_key: providerKey,
}

it('saves the exact create receipt before a purchase, then blocks replay after an unknown reply and an authorized reset', async () => {
  losesPurchaseResponse = true
  const initial = await send()
  await expect(initial.json()).resolves.toMatchObject({ data: { sent: 0, failed: 1, results: [{
    status: 'needs_review', errorCode: 'provider_purchase_reconciliation_required',
  }] } })
  expect(observedPurchaseReceipts).toMatchObject([{
    status: 'needs_review', next_retry_at: null,
    response_payload: {
      create_invoice: { invoiceGuids: [ids.partner] },
      [checkpointField]: expectedCheckpoint,
    },
  }])
  expect(tables.invoice_export_items[0].provider_invoice_guid).toBeUndefined()
  expect(tables.customer_invoices[0].status).toBe('draft')
  expect((await manuallyPurchase()).status).toBe(400)
  expect((await reset()).status).toBe(200)
  expect(tables.invoice_export_items[0].status).toBe('pending')
  const existingProviderCalls = providerCalls.length
  const repeated = await send()
  await expect(repeated.json()).resolves.toMatchObject({ data: { sent: 0, failed: 1, results: [{ status: 'needs_review' }] } })
  expect(tables.invoice_export_items[0].status).toBe('needs_review')
  expect(providerCalls).toHaveLength(existingProviderCalls)
  expect(purchaseCommands()).toHaveLength(1)

  expect((await reset()).status).toBe(200)
  tables.invoice_export_runs[0].financing_mode = 'invoice_service'
  const changedMode = await send()
  await expect(changedMode.json()).resolves.toMatchObject({ data: { results: [{ status: 'needs_review' }] } })
  expect(providerCalls).toHaveLength(existingProviderCalls)
})

it('leaves a provider observation for reconciliation when the earlier checkpoint was unconfirmed', async () => {
  checkpointFailure = 'before_commit'
  await send()
  expect(purchaseCommands()).toHaveLength(0)
  expect(providerCalls.filter(call => call.method === 'PUT')).toHaveLength(1)
  expect(tables.invoice_export_items[0].response_payload).toEqual({})
  expect((await reset()).status).toBe(200)
  const repeated = await send()
  await expect(repeated.json()).resolves.toMatchObject({ data: { sent: 0, failed: 1, results: [{
    status: 'needs_review', errorCode: 'provider_create_acceptance_unconfirmed',
  }] } })
  expect(providerCalls.filter(call => call.method === 'PUT')).toHaveLength(1)
  expect(purchaseCommands()).toHaveLength(0)
})

it('does not rearm a durable checkpoint when the process received no acknowledgement of that write', async () => {
  checkpointFailure = 'after_commit'
  await send()
  expect(purchaseCommands()).toHaveLength(0)
  expect(tables.invoice_export_items[0]).toMatchObject({ response_payload: { [checkpointField]: expectedCheckpoint } })
  expect((await reset()).status).toBe(200)
  const existingProviderCalls = providerCalls.length
  const repeated = await send()
  await expect(repeated.json()).resolves.toMatchObject({ data: { sent: 0, failed: 1, results: [{ status: 'needs_review' }] } })
  expect(providerCalls).toHaveLength(existingProviderCalls)
})

it('publishes the original partner identity after an accepted purchase and refuses a repeat send', async () => {
  const initial = await send()
  await expect(initial.json()).resolves.toMatchObject({ data: { sent: 1, failed: 0, results: [{ invoiceGuid: ids.partner }] } })
  expect(tables.invoice_export_items[0]).toMatchObject({ status: 'sent', provider_invoice_guid: ids.partner, response_payload: {
    create_invoice: { invoiceGuids: [ids.partner] }, purchase: { purchaseReference: 'synthetic-purchase-accepted' },
  } })
  expect(tables.invoice_export_items[0].response_payload).not.toHaveProperty(checkpointField)
  expect(tables.customer_invoices[0]).toMatchObject({ status: 'sent', partner_invoice_reference: ids.partner })
  expect((await send()).status).toBe(500)
  expect(purchaseCommands()).toHaveLength(1)
})

it('keeps ordinary invoice service on its existing create and send path', async () => {
  tables.invoice_export_runs[0].financing_mode = 'invoice_service'
  const initial = await send()
  await expect(initial.json()).resolves.toMatchObject({ data: { sent: 1, failed: 0 } })
  expect(writes.filter(write => write.table === 'invoice_export_items')).toEqual([{ table: 'invoice_export_items', status: 'sent' }])
  expect(providerCalls.filter(call => call.method === 'PUT')).toHaveLength(1)
  expect(purchaseCommands()).toHaveLength(0)
})

it('does not start purchase or create for a wrong tenant or a factoring item in another environment', async () => {
  await send('a1000000-0000-4000-8000-000000000099')
  expect(providerCalls).toHaveLength(0)
  tables.invoice_export_items[0].environment = 'production'
  const result = await send()
  await expect(result.json()).resolves.toMatchObject({ data: { sent: 0, failed: 1, results: [{ status: 'configuration_error' }] } })
  expect(providerCalls).toHaveLength(0)
})


it('keeps a purchase parked across an accepted provider response followed by a failed local commit', async () => {
  finalWriteFails = true
  const initial = await send()
  await expect(initial.json()).resolves.toMatchObject({ data: { sent: 0, failed: 1, results: [{ status: 'needs_review' }] } })
  expect(tables.invoice_export_items[0]).toMatchObject({ status: 'needs_review', response_payload: { [checkpointField]: expectedCheckpoint } })
  expect(tables.invoice_export_items[0].provider_invoice_guid).toBeUndefined()
  expect(purchaseCommands()).toHaveLength(1)
  expect((await reset()).status).toBe(200)
  const existingProviderCalls = providerCalls.length
  const repeated = await send()
  await expect(repeated.json()).resolves.toMatchObject({ data: { sent: 0, failed: 1, results: [{ status: 'needs_review' }] } })
  expect(providerCalls).toHaveLength(existingProviderCalls)
})

it('treats an existing provider invoice identity on a legacy factoring item as review-only', async () => {
  tables.invoice_export_items[0].provider_invoice_guid = ids.partner
  const result = await send()
  await expect(result.json()).resolves.toMatchObject({ data: { sent: 0, failed: 1, results: [{ status: 'needs_review' }] } })
  expect(tables.invoice_export_items[0].provider_invoice_guid).toBe(ids.partner)
  expect(providerCalls).toHaveLength(0)
})


it('does not apply a provider response to a different stored purchase attempt', async () => {
  changesCheckpointBeforeFinalize = true
  const response = await send()
  await expect(response.json()).resolves.toMatchObject({ data: { sent: 0, failed: 1, results: [{ status: 'needs_review' }] } })
  expect(tables.invoice_export_items[0].provider_invoice_guid).toBeUndefined()
  expect(tables.customer_invoices[0].status).toBe('draft')
  expect(purchaseCommands()).toHaveLength(1)
  expect((await reset()).status).toBe(200)
  const existingProviderCalls = providerCalls.length
  await send()
  expect(providerCalls).toHaveLength(existingProviderCalls)
})
