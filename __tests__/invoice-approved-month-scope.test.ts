import { beforeEach, expect, it, vi } from 'vitest'
import { approveAndSendReadyInvoicesForMonth } from '@/lib/billing/invoiceApprovedDispatch'

const adapter = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>(), event: vi.fn(), provider: vi.fn() }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('https://month-approval.example.invalid', 'fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: adapter.fetch },
  }) }
})
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: adapter.event }))
vi.mock('@/lib/ediel/retention/financeCopyRetention', () => ({ requireInvoiceSourceCopiesAvailable: async () => undefined }))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: async () => undefined }))
vi.mock('@/lib/integrations/billing/capway/auth', () => ({ resolveCapwayConnectionConfig: adapter.provider }))
vi.mock('@/lib/automation/locks', () => ({ withAutomationLock: ({ run }: { run: () => Promise<unknown> }) => run() }))
vi.mock('@/lib/platform/outboundFreeze', () => ({ assertOutboundAllowed: async () => undefined }))

type Row = Record<string, unknown>
const companyId = 'a1234000-0000-4000-8000-000000000001'
const anotherCompany = 'a1234000-0000-4000-8000-000000000002'
const actorId = 'a1234000-0000-4000-8000-000000000003'
const month = '2026-11'
let tables: Record<string, Row[]>
let collectionCap: number
let changeScope: 'after-list' | 'before-update' | null
const writes: string[] = []
const lists: Array<{ table: string; url: URL }> = []

function seed(index: number, runScope: Row = {}, itemScope: Row = {}) {
  const id = (base: number) => `b1234000-0000-4000-8000-${String(base * 100 + index).padStart(12, '0')}`
  const defaultScope = { company_id: companyId, environment: 'production', provider: 'file_export' }
  const scope = { ...defaultScope, ...runScope }
  const tenant = { company_id: scope.company_id }
  const money = { total_kwh: 20, amount_ex_vat: 100, vat_amount: 25, amount_inc_vat: 125 }
  tables.invoice_export_runs.push({ ...scope, id: id(1), billing_month: month })
  const item = { ...scope, ...itemScope, ...money, id: id(2), status: 'pending', export_run_id: id(1),
    pricing_run_id: id(3), customer_id: id(4), billing_underlay_id: id(5), customer_contract_id: id(6), metadata: {} }
  tables.invoice_export_items.push(item)
  tables.pricing_runs.push({ ...tenant, id: id(3), status: 'locked', locked_at: '2026-11-19T00:00:00Z',
    billing_underlay_id: id(5), total_ex_vat: 100, vat_amount: 25, total_inc_vat: 125 })
  tables.customers.push({ ...tenant, id: id(4) })
  tables.billing_underlays.push({ ...tenant, id: id(5), customer_id: id(4), customer_contract_id: id(6),
    price_area: 'SE3', status: 'validated', readiness_status: 'ready', total_kwh: 20 })
  tables.customer_invoices.push({ ...tenant, ...money, id: id(7), invoice_export_item_id: id(2),
    status: 'draft', calculation_snapshot_sha256: 'a'.repeat(64), metadata: {} })
  return item
}

async function db(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input))
  expect(url.origin).toBe('https://month-approval.example.invalid')
  const table = url.pathname.replace('/rest/v1/', '')
  if (!Object.hasOwn(tables, table)) throw Error(`Unexpected database table ${table}`)
  const isList = url.searchParams.has('order') && ['invoice_export_runs', 'invoice_export_items'].includes(table)
  if (isList) lists.push({ table, url })
  if (changeScope === 'before-update' && init?.method === 'PATCH' && table === 'invoice_export_items') {
    tables[table][0].environment = 'test'
    changeScope = null
  }
  let rows = tables[table]
  for (const [field, filter] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset'].includes(field)) continue
    if (filter.startsWith('eq.')) rows = rows.filter(row => String(row[field]) === filter.slice(3))
    else if (filter.startsWith('in.(')) rows = rows.filter(row => filter.slice(4, -1).split(',').includes(String(row[field])))
    else throw Error(`Unexpected fixture predicate ${field} ${filter}`)
  }
  if (init?.method === 'PATCH') {
    expect(url.searchParams.get('company_id')).toBe(`eq.${companyId}`)
    const patch = JSON.parse(String(init.body)) as Row
    for (const row of rows) {
      writes.push(String(row.id))
      Object.assign(row, patch)
    }
    return Response.json(rows)
  }
  const snapshot = structuredClone(isList ? rows.slice(0, collectionCap) : rows)
  if (changeScope === 'after-list' && isList && table === 'invoice_export_items') {
    for (const row of rows) row.provider = 'nordfin'
    changeScope = null
  }
  const single = new Headers(init?.headers).get('accept') === 'application/vnd.pgrst.object+json'
  return Response.json(single ? snapshot[0] ?? null : snapshot)
}

function run() {
  return approveAndSendReadyInvoicesForMonth({ companyId, billingMonth: month, actorUserId: actorId })
}

beforeEach(() => {
  tables = { invoice_export_items: [], invoice_export_runs: [], customer_invoices: [], pricing_runs: [],
    pricing_preview_lines: [], customers: [], billing_underlays: [],
    companies: [{ id: companyId, invoice_export_target_system: 'file_export', billing_provider_environment: 'production' }] }
  collectionCap = Number.MAX_SAFE_INTEGER
  changeScope = null
  lists.length = 0
  writes.length = 0
  adapter.fetch.mockReset().mockImplementation(db)
  adapter.event.mockReset().mockResolvedValue(undefined)
  adapter.provider.mockReset().mockRejectedValue(Error('No provider calls in this proof'))
})

it('only approves and counts pending items of the selected company, provider and environment', async () => {
  const test = seed(1, { environment: 'test' })
  const nordfin = seed(2, { provider: 'nordfin' })
  const mixed = seed(3, {}, { environment: 'test' })
  const foreign = seed(4, { company_id: anotherCompany })
  const selected = seed(5)
  expect(await run()).toEqual({ approved: 1, failed: 0, sent: 0, errors: [], approveOnly: true })
  expect(writes).toHaveLength(2)
  expect(writes).toContain(selected.id)
  for (const item of [test, nordfin, mixed, foreign]) expect(item.metadata).toEqual({})
  expect(adapter.event).toHaveBeenCalledTimes(1)
  expect(adapter.provider).not.toHaveBeenCalled()
})

it('scopes both collections before a server read limit', async () => {
  collectionCap = 1
  seed(1, { environment: 'test' })
  seed(2, {}, { provider: 'nordfin' })
  const selected = seed(3)
  // Both items share the same otherwise eligible production run.
  selected.export_run_id = String(tables.invoice_export_runs[1].id)
  tables.invoice_export_runs.splice(2)
  expect(await run()).toMatchObject({ approved: 1, failed: 0, approveOnly: true })
  expect(writes).toContain(selected.id)
  expect(lists.map(({ table, url }) => [table, url.searchParams.get('provider'), url.searchParams.get('environment')]))
    .toEqual([['invoice_export_runs', 'eq.file_export', 'eq.production'], ['invoice_export_items', 'eq.file_export', 'eq.production']])
})

it.each(['after-list', 'before-update'] as const)('prevents any approval if the item changes scope %s', async (stage) => {
  seed(1)
  changeScope = stage
  expect(await run()).toMatchObject({ approved: 0, failed: 1, sent: 0, approveOnly: true })
  expect(writes).toEqual([])
  expect(adapter.event).not.toHaveBeenCalled()
})

it('preserves explicit test review with the selected provider and persists one approval', async () => {
  tables.companies[0].billing_provider_environment = 'test'
  seed(1)
  const selected = seed(2, { environment: 'test' })
  expect(await run()).toMatchObject({ approved: 1, failed: 0, sent: 0, approveOnly: true })
  expect(writes).toContain(selected.id)
  expect(adapter.provider).not.toHaveBeenCalled()
})


it('stops an already-approved Capway row that changed provider before the monthly send', async () => {
  Object.assign(tables.companies[0], { invoice_export_target_system: 'capway_aptic', billing_provider_environment: 'test', invoice_export_enabled: true })
  const item = seed(1, { provider: 'capway_aptic', environment: 'test' })
  tables.customer_invoices[0].metadata = item.metadata = { approval: { status: 'approved' } }
  changeScope = 'after-list'
  const result = await run()
  expect(result).toMatchObject({ approved: 0, sent: 0, failed: 1, approveOnly: false })
  expect(writes).toEqual([])
  expect(adapter.event).not.toHaveBeenCalled()
  expect(adapter.provider).not.toHaveBeenCalled()
})
