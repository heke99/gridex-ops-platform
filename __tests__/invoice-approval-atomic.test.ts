// BILLNEG01.02: application regressions over the actual exported approval function.
// This adapter controls transaction outcomes and read interleavings. It does
// not verify installed PostgreSQL locking, rollback, or native actor authority.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type QueryResult = { data: unknown; error: Row | null }
type UpdateOperation = { table: string; patch: Row }
type RpcOperation = { name: string; arguments: Row }
type ApprovalResult = Awaited<ReturnType<typeof approveAndSendReadyInvoicesForMonth>>
type Mode = 'normal' | 'concurrent' | 'stale-list' | 'mirror-error' | 'drift' | 'rpc-error'
type ReceiptTransform = (receipt: Row) => unknown

interface Query extends PromiseLike<QueryResult> {
  select(): Query
  eq(key: string, value: unknown): Query
  in(key: string, values: unknown[]): Query
  order(): Query
  update(patch: Row): Query
  single(): Query
  maybeSingle(): Query
}

const fixture = vi.hoisted(() => {
  const clone = <T,>(value: T): T => structuredClone(value)
  const record = (value: unknown): Row => value !== null && typeof value === 'object'
    && !Array.isArray(value) ? value as Row : {}
  const company = 'company'
  const itemId = 'item'
  const underlayId = 'underlay'
  const customer = 'customer'
  const contract = 'contract'
  const run = 'run'
  const pricing = 'pricing'
  const tables: Record<string, Row[]> = {
    invoice_export_runs: [{ id: run, company_id: company, billing_month: '2026-09' }],
    invoice_export_items: [{
      id: itemId,
      company_id: company,
      export_run_id: run,
      pricing_run_id: pricing,
      customer_id: customer,
      billing_underlay_id: underlayId,
      customer_contract_id: contract,
      status: 'pending',
      total_kwh: 100,
      amount_ex_vat: 100,
      vat_amount: 25,
      amount_inc_vat: 125,
      metadata: { approval: { status: 'pending_review' } },
    }],
    customer_invoices: [{
      id: 'invoice',
      company_id: company,
      invoice_export_item_id: itemId,
      status: 'draft',
      total_kwh: 100,
      amount_inc_vat: 125,
      price_area_code: 'SE3',
      calculation_snapshot_sha256: 'hash',
      metadata: { approval: { status: 'pending_review' } },
    }],
    pricing_runs: [{
      id: pricing,
      company_id: company,
      billing_underlay_id: underlayId,
      status: 'locked',
      locked_at: '2026-10-01',
      total_kwh: 100,
      total_ex_vat: 100,
      vat_amount: 25,
      total_inc_vat: 125,
    }],
    billing_underlays: [{
      id: underlayId,
      company_id: company,
      customer_id: customer,
      customer_contract_id: contract,
      status: 'validated',
      readiness_status: 'ready',
      total_kwh: 100,
      price_area: 'SE3',
    }],
    customers: [{ id: customer, company_id: company }],
    companies: [{ id: company }],
    pricing_preview_lines: [],
  }
  const original = clone(tables)
  const updates: UpdateOperation[] = []
  const rpcCalls: RpcOperation[] = []
  let mode: Mode = 'normal'
  let heldList = false
  let copyCount = 0
  let openCopies: () => void = () => {}
  let copiesReady = new Promise<void>((resolve) => { openCopies = resolve })
  let runOther: (() => Promise<void>) | undefined
  let transformReceipt: ReceiptTransform | undefined

  function approvalFor(table: string): Row {
    return record(record(tables[table][0].metadata).approval)
  }

  function reset() {
    for (const table of Object.keys(tables)) tables[table] = clone(original[table])
    updates.length = 0
    rpcCalls.length = 0
    mode = 'normal'
    heldList = false
    copyCount = 0
    runOther = undefined
    transformReceipt = undefined
    copiesReady = new Promise<void>((resolve) => { openCopies = resolve })
  }

  function configure(nextMode: Mode, other?: () => Promise<void>) {
    mode = nextMode
    runOther = other
  }

  function from(table: string): Query {
    const filters: Array<(row: Row) => boolean> = []
    let patch: Row | undefined
    let single = false
    const execute = async (): Promise<QueryResult> => {
      const found = tables[table].filter((row) => filters.every((filter) => filter(row)))
      if (patch && table === 'customer_invoices' && mode === 'mirror-error') {
        return { data: null, error: { code: '57014', message: 'synthetic mirror failure' } }
      }
      if (patch) {
        for (const row of found) Object.assign(row, clone(patch))
        updates.push({ table, patch: clone(patch) })
      }
      const data = clone(single ? (found[0] ?? null) : found)
      if (table === 'invoice_export_items' && !single && !patch
        && mode === 'stale-list' && !heldList) {
        heldList = true
        // Hold the original list snapshot while another complete invocation
        // approves the invoice, then let the stale caller read current context.
        await runOther?.()
      }
      return { data, error: null }
    }
    const query: Query = {
      select: () => query,
      eq: (key, value) => { filters.push((row) => row[key] === value); return query },
      in: (key, values) => { filters.push((row) => values.includes(row[key])); return query },
      order: () => query,
      update: (value) => { patch = value; return query },
      single: () => { single = true; return query },
      maybeSingle: () => { single = true; return query },
      then: (fulfilled, rejected) => Promise.resolve().then(execute).then(fulfilled, rejected),
    }
    return query
  }

  async function sourceCopies() {
    if (mode === 'concurrent' && ++copyCount <= 2) {
      if (copyCount === 2) openCopies()
      await copiesReady
    }
    if (mode === 'drift') tables.billing_underlays[0].total_kwh = 101
  }

  async function rpc(name: string, arguments_: Row): Promise<QueryResult> {
    rpcCalls.push({ name, arguments: clone(arguments_) })
    if (name !== 'gridex_approve_invoice_export_item_v1') throw Error(`unexpected RPC ${name}`)
    const item = tables.invoice_export_items[0]
    const invoice = tables.customer_invoices[0]
    const storedApproval = approvalFor('invoice_export_items')
    const eventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const approval: Row = {
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: arguments_.p_actor_user_id,
      review_hash: arguments_.p_review_hash,
      calculation_snapshot_sha256: invoice.calculation_snapshot_sha256,
    }
    if (transformReceipt) {
      return {
        data: transformReceipt({ approved_now: true, approval, event_id: eventId }),
        error: null,
      }
    }
    if (storedApproval.status === 'approved'
      && approvalFor('customer_invoices').status === 'approved') {
      return {
        data: { approved_now: false, approval: clone(storedApproval), event_id: eventId },
        error: null,
      }
    }
    if (mode === 'mirror-error' || mode === 'rpc-error') {
      return { data: null, error: { code: '57014', message: 'synthetic atomic transition failure' } }
    }
    const current = {
      item,
      invoice,
      underlay: tables.billing_underlays[0],
      pricing_run: tables.pricing_runs[0],
    }
    if (JSON.stringify(arguments_.p_expected_context) !== JSON.stringify(current)) {
      return { data: null, error: { code: '40001', message: 'approval_context_changed' } }
    }
    // This is a controlled successful transaction outcome, not SQL emulation.
    item.metadata = { ...record(item.metadata), approval: clone(approval) }
    invoice.metadata = { ...record(invoice.metadata), approval: clone(approval) }
    updates.push(
      { table: 'invoice_export_items', patch: { metadata: clone(item.metadata) } },
      { table: 'customer_invoices', patch: { metadata: clone(invoice.metadata) } },
    )
    return { data: { approved_now: true, approval, event_id: eventId }, error: null }
  }

  return {
    from, rpc, tables, updates, rpcCalls, sourceCopies, reset, configure, approvalFor,
    setReceiptTransform: (transform: ReceiptTransform) => { transformReceipt = transform },
  }
})

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { from: fixture.from, rpc: fixture.rpc },
}))
vi.mock('@/lib/ediel/retention/financeCopyRetention', () => ({
  requireInvoiceSourceCopiesAvailable: fixture.sourceCopies,
}))
vi.mock('@/lib/billing/providers/registry', () => ({
  InvoiceProviderConfigError: class extends Error {},
  isFileProvider: () => true,
  loadTenantInvoiceProviderSelection: async () => ({ provider: 'file_export' }),
  requireTenantInvoiceProvider: (selection: unknown) => selection,
}))
vi.mock('@/lib/supabase/tenantQuery', () => ({ tenantUpdate: vi.fn() }))
vi.mock('@/lib/platform/outboundFreeze', () => ({ assertOutboundAllowed: vi.fn() }))
vi.mock('@/lib/automation/locks', () => ({
  withAutomationLock: vi.fn(() => { throw Error('unexpected send lock path') }),
}))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: vi.fn() }))
vi.mock('@/lib/integrations/billing/capway/auth', () => ({ resolveCapwayConnectionConfig: vi.fn() }))
vi.mock('@/lib/integrations/billing/capway/client', () => ({ CapwayApticClient: class {} }))
vi.mock('@/lib/integrations/billing/capway/payloadBuilder', () => ({ buildCapwayInvoicePayload: vi.fn() }))
vi.mock('@/lib/integrations/billing/capway/purchase', () => ({ buildPurchasePayload: vi.fn() }))
vi.mock('@/lib/integrations/billing/capway/statusMapper', () => ({ shouldRequestPurchaseAfterCreate: vi.fn() }))
vi.mock('@/lib/integrations/billing/exportErrorClassification', () => ({
  classifyInvoiceExportError: vi.fn(),
  computeNextRetryAt: vi.fn(),
  INVOICE_EXPORT_MAX_ATTEMPTS: 3,
}))
vi.mock('@/lib/billing/invoiceReadiness', () => ({ lockBillingPeriodForInvoiceExport: vi.fn() }))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: vi.fn(async () => ({ id: 'event' })) }))

import { approveAndSendReadyInvoicesForMonth } from '@/lib/billing/invoiceApprovedDispatch'

const approve = (actorUserId = 'actor-A') => approveAndSendReadyInvoicesForMonth({
  companyId: 'company', billingMonth: '2026-09', actorUserId,
})
const itemUpdates = () => fixture.updates.filter((operation) => operation.table === 'invoice_export_items')

beforeEach(() => fixture.reset())

describe('BILLNEG01.02 atomic invoice approval', () => {
  it('mirror failure leaves both approval copies unchanged', async () => {
    fixture.configure('mirror-error')
    const result = await approve()
    expect(result).toMatchObject({ approved: 0, failed: 1 })
    expect(fixture.approvalFor('invoice_export_items')).toEqual({ status: 'pending_review' })
    expect(fixture.approvalFor('customer_invoices')).toEqual({ status: 'pending_review' })
    expect(fixture.updates).toHaveLength(0)
  })

  it('stale outer list does not count an inner already-approved replay as a second winner', async () => {
    let other: ApprovalResult | undefined
    fixture.configure('stale-list', async () => { other = await approve('actor-B') })
    const stale = await approve()
    expect(itemUpdates()).toHaveLength(1)
    expect(other).toMatchObject({ approved: 1, failed: 0 })
    expect(stale).toMatchObject({ approved: 0, failed: 0 })
  })

  it('concurrent approvals report one winner and persist one approval', async () => {
    fixture.configure('concurrent')
    const results = await Promise.all(['actor-A', 'actor-B'].map(approve))
    expect(results.every((result) => result.failed === 0)).toBe(true)
    expect(results.reduce((total, result) => total + result.approved, 0)).toBe(1)
    expect(itemUpdates()).toHaveLength(1)
    expect(fixture.approvalFor('invoice_export_items')).toEqual(fixture.approvalFor('customer_invoices'))
  })

  it('sequential replay preserves approval and does not count another winner', async () => {
    const first = await approve()
    const original = structuredClone(fixture.approvalFor('invoice_export_items'))
    const second = await approve('actor-B')
    expect(first).toMatchObject({ approved: 1, failed: 0 })
    expect(second).toMatchObject({ approved: 0, failed: 0 })
    expect(fixture.approvalFor('invoice_export_items')).toEqual(original)
    expect(itemUpdates()).toHaveLength(1)
  })

  it('context drift between readiness read and transition is rejected without approval', async () => {
    fixture.configure('drift')
    expect(await approve()).toMatchObject({ approved: 0, failed: 1 })
    expect(fixture.approvalFor('invoice_export_items')).toEqual({ status: 'pending_review' })
    expect(fixture.approvalFor('customer_invoices')).toEqual({ status: 'pending_review' })
  })

  it('missing RPC receipt fields cannot count as successful approval', async () => {
    fixture.setReceiptTransform(() => ({ approved_now: true }))
    expect(await approve()).toMatchObject({ approved: 0, failed: 1 })
    expect(fixture.updates).toHaveLength(0)
  })

  const malformedReceipts: Array<[string, ReceiptTransform]> = [
    ['null receipt', () => null],
    ['non-boolean winner flag', (receipt) => ({ ...receipt, approved_now: 'true' })],
    ['invalid approval status', (receipt) => ({
      ...receipt, approval: { ...(receipt.approval as Row), status: 'pending_review' },
    })],
    ['wrong review hash', (receipt) => ({
      ...receipt, approval: { ...(receipt.approval as Row), review_hash: 'different' },
    })],
    ['wrong calculation snapshot', (receipt) => ({
      ...receipt, approval: { ...(receipt.approval as Row), calculation_snapshot_sha256: 'different' },
    })],
    ['missing reviewer', (receipt) => ({
      ...receipt, approval: { ...(receipt.approval as Row), approved_by: '' },
    })],
    ['wrong winning reviewer', (receipt) => ({
      ...receipt, approval: { ...(receipt.approval as Row), approved_by: 'actor-B' },
    })],
    ['invalid approval time', (receipt) => ({
      ...receipt, approval: { ...(receipt.approval as Row), approved_at: 'not-a-date' },
    })],
    ['invalid event identity', (receipt) => ({ ...receipt, event_id: 'not-a-uuid' })],
  ]

  it.each(malformedReceipts)('rejects a malformed RPC receipt: %s', async (_description, transform) => {
    fixture.setReceiptTransform(transform)
    expect(await approve()).toMatchObject({ approved: 0, failed: 1 })
    expect(fixture.updates).toHaveLength(0)
  })

  it('an RPC error is reported without a claimed approval or writes', async () => {
    fixture.configure('rpc-error')
    expect(await approve()).toMatchObject({ approved: 0, failed: 1 })
    expect(fixture.rpcCalls).toHaveLength(1)
    expect(fixture.updates).toHaveLength(0)
  })

  it('existing readiness checks reject missing source coverage before the approval RPC', async () => {
    fixture.tables.billing_underlays[0].missing_values_count = 1
    expect(await approve()).toMatchObject({ approved: 0, failed: 1 })
    expect(fixture.rpcCalls).toHaveLength(0)
    expect(fixture.updates).toHaveLength(0)
  })
})
