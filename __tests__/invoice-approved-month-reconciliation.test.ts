import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as sendInvoiceRun } from '@/app/api/internal/invoice-exports/[id]/send/route'
import { CapwayApiError, CapwayApticClient } from '@/lib/integrations/billing/capway/client'
import { supabaseService } from '@/lib/supabase/service'

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
const port = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>(), requireAccess: vi.fn(), releaseLock: vi.fn() }))

vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('https://invoice-db.example.invalid', 'synthetic-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: port.fetch },
  }) }
})
vi.mock('@/lib/admin/apiGuards', () => ({ requireAdminApiAccess: port.requireAccess }))
vi.mock('@/lib/tenant/scope', () => ({ assertUserCanOperateCompany: async () => ids.company }))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: async () => undefined }))
vi.mock('@/lib/platform/outboundFreeze', () => ({ assertOutboundAllowed: async () => undefined }))
vi.mock('@/lib/automation/locks', () => ({
  withAutomationLock: async ({ run }: { run: () => Promise<unknown> }) => {
    try {
      return await run()
    } finally {
      port.releaseLock()
    }
  },
}))
vi.mock('@/lib/ediel/retention/financeCopyRetention', () => ({ requireInvoiceSourceCopiesAvailable: async () => undefined }))
vi.mock('@/lib/integrations/billing/capway/auth', () => ({ resolveCapwayConnectionConfig: async () => ({ rawSettings: {} }) }))
vi.mock('@/lib/integrations/billing/capway/payloadBuilder', () => ({ buildCapwayInvoicePayload: () => ({ externalReferenceCode: 'invoice-dispatch-proof' }) }))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: async () => undefined }))

const opaqueLockDetail = 'synthetic-lock-failure-detail'
const providerKey = 'invoice-dispatch-proof-key'
type Row = Record<string, unknown>
let tables: Record<string, Row[]>
let lockFails: boolean
const lockInputs: Row[] = []
const writes: Array<{ table: string; status: unknown }> = []

function seedRows(): Record<string, Row[]> {
  const company = { company_id: ids.company }
  const approval = { metadata: { approval: { status: 'approved', approved_by: ids.actor } } }
  const totals = { total_kwh: 20, amount_ex_vat: 100, vat_amount: 25, amount_inc_vat: 125 }
  return {
    invoice_export_items: [{ ...company, ...approval, ...totals, id: ids.item, status: 'pending', export_run_id: ids.run,
      customer_id: ids.customer, customer_contract_id: ids.contract, billing_underlay_id: ids.underlay,
      pricing_run_id: ids.pricingRun, provider_idempotency_key: providerKey }],
    invoice_export_runs: [{ ...company, id: ids.run, provider: 'capway_aptic', environment: 'test', status: 'pending', billing_month: '2026-11' }],
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
  if (url.pathname === '/rest/v1/rpc/gridex_set_billing_period_lock_v1') {
    const lock = JSON.parse(String(init?.body)) as Row
    expect(lock).toMatchObject({ p_company_id: ids.company, p_billing_month: '2026-11', p_status: 'exported', p_locked: true })
    expect(tables.invoice_export_items[0].status).toBe('sent')
    expect(tables.customer_invoices[0].status).toBe('sent')
    expect(tables.invoice_export_attempts).toMatchObject([{ outcome: 'sent', attempt_no: 1 }])
    lockInputs.push(lock)
    if (lockFails) return Response.json({ code: 'PGRST000', message: opaqueLockDetail }, { status: 503 })
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
    if (filter.startsWith('eq.')) rows = rows.filter(row => String(row[field]) === filter.slice(3))
    else if (filter.startsWith('in.(')) rows = rows.filter(row => filter.slice(4, -1).split(',').includes(String(row[field])))
    else throw new Error(`Unexpected test filter ${field}`)
  }
  if (init?.method === 'PATCH' && body) {
    expect(url.searchParams.get('company_id')).toBe(`eq.${ids.company}`)
    rows.forEach(row => Object.assign(row, body))
    writes.push({ table, status: body.status })
    if (!url.searchParams.has('select')) return new Response(null, { status: 204 })
  }
  const offset = Number(url.searchParams.get('offset') ?? 0)
  const limit = Number(url.searchParams.get('limit') ?? rows.length)
  rows = rows.slice(offset, offset + limit)
  const accept = new Headers(init?.headers).get('accept')
  return Response.json(accept === 'application/vnd.pgrst.object+json' ? rows[0] : rows)
}

function send() {
  return sendInvoiceRun(new Request(`https://local.example.invalid/api/internal/invoice-exports/${ids.run}/send`, {
    method: 'POST', body: JSON.stringify({ companyId: ids.company }),
  }), { params: Promise.resolve({ id: ids.run }) })
}

beforeEach(() => {
  tables = seedRows()
  writes.length = 0
  lockInputs.length = 0
  lockFails = false
  port.fetch.mockReset().mockImplementation(databasePort)
  port.requireAccess.mockReset().mockResolvedValue({ guard: { userId: ids.actor } })
  port.releaseLock.mockReset()
  vi.spyOn(CapwayApticClient.prototype, 'createInvoices').mockResolvedValue({ invoiceGuids: [ids.partner] })
})

afterEach(() => vi.restoreAllMocks())

describe('approved invoice month reconciliation', () => {
  it('preserves the sent receipt and skips sending on an identical request after a lost response', async () => {
    lockFails = true
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await send()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toMatchObject({ sent: 1, failed: 0, results: [{ status: 'sent', invoiceGuid: ids.partner, monthReconciliation: 'failed' }] })
    expect(JSON.stringify(body)).not.toContain(opaqueLockDetail)
    expect(warning).toHaveBeenCalledWith('[invoice-approved-dispatch] month reconciliation failed', {
      companyId: ids.company, billingMonth: '2026-11', exportRunId: ids.run,
    })

    const item = await supabaseService.from('invoice_export_items').select('*').eq('company_id', ids.company).eq('id', ids.item).single()
    const attempts = await supabaseService.from('invoice_export_attempts').select('*').eq('company_id', ids.company).eq('invoice_export_item_id', ids.item)
    expect(item.data).toMatchObject({ status: 'sent', provider_invoice_guid: ids.partner, next_retry_at: null })
    expect(attempts.data).toMatchObject([{ outcome: 'sent', attempt_no: 1, idempotency_key: providerKey }])
    expect((await send()).status).toBe(500)
    expect(CapwayApticClient.prototype.createInvoices).toHaveBeenCalledExactlyOnceWith([expect.anything()], providerKey)
    expect(lockInputs).toHaveLength(1)
    expect(writes.filter(({ table }) => table === 'invoice_export_items' || table === 'customer_invoices')).toEqual([
      { table: 'invoice_export_items', status: 'sent' }, { table: 'customer_invoices', status: 'sent' },
    ])
  })

  it('preserves the successful response even if recording the lock failure throws', async () => {
    lockFails = true
    vi.spyOn(console, 'warn').mockImplementation(() => { throw new Error('synthetic logger failure') })
    const response = await send()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: { sent: 1, failed: 0, results: [{ monthReconciliation: 'failed' }] } })
    expect(tables.customer_invoices[0].status).toBe('sent')
    expect(tables.invoice_export_items[0].status).toBe('sent')
    expect(tables.invoice_export_attempts).toMatchObject([{ outcome: 'sent' }])
  })

  it('keeps the sent records if a lock release error reaches the outer route handler', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    port.releaseLock.mockImplementationOnce(() => { throw new Error('synthetic lock release failure') })
    expect((await send()).status).toBe(500)
    expect(tables.invoice_export_items[0]).toMatchObject({ status: 'sent', provider_invoice_guid: ids.partner, next_retry_at: null })
    expect(tables.customer_invoices[0].status).toBe('sent')
    expect(tables.invoice_export_attempts).toMatchObject([{ outcome: 'sent', attempt_no: 1 }])
    expect((await send()).status).toBe(500)
    expect(CapwayApticClient.prototype.createInvoices).toHaveBeenCalledTimes(1)
  })

  it('reports the successful lock separately after an ordinary send', async () => {
    const response = await send()
    await expect(response.json()).resolves.toMatchObject({ data: { sent: 1, failed: 0, results: [{ monthReconciliation: 'locked' }] } })
    expect(lockInputs).toHaveLength(1)
  })

  it('keeps a month open while another validated underlay has no sent invoice', async () => {
    tables.billing_underlays.push({ ...tables.billing_underlays[0], id: 'a1000000-0000-4000-8000-000000000011' })
    const response = await send()
    await expect(response.json()).resolves.toMatchObject({ data: { sent: 1, failed: 0, results: [{ monthReconciliation: 'not_locked' }] } })
    expect(lockInputs).toHaveLength(0)
  })

  it('keeps the existing retry status and idempotency key when the provider fails first', async () => {
    vi.mocked(CapwayApticClient.prototype.createInvoices).mockRejectedValueOnce(new CapwayApiError({
      message: 'synthetic provider failure before sending', httpStatus: 503,
    }))
    const response = await send()
    await expect(response.json()).resolves.toMatchObject({ data: { sent: 0, failed: 1, results: [{ status: 'failed_retryable' }] } })
    expect(tables.invoice_export_items[0]).toMatchObject({ status: 'failed_retryable', next_retry_at: expect.any(String) })
    expect(tables.customer_invoices[0].status).toBe('draft')
    expect(tables.invoice_export_attempts).toMatchObject([{ outcome: 'failed_retryable', idempotency_key: providerKey }])
    expect(lockInputs).toHaveLength(0)
  })
})
