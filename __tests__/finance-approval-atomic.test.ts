// BILLNEG01.02 / MAIN04.05: real approval service with synthetic DB/RPC ports.
// The RPC mock models its receipt/rollback contract; native SQL invariants have
// separate PostgreSQL regression evidence. These tests are not UI/HTTP/E2E proof.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type Approval = { status: string; approved_by?: string; approved_at?: string; [key: string]: unknown }
type Reply = { data: unknown; error: { code?: string; message: string } | null }
type Options = {
  race?: boolean; staleList?: boolean; mismatch?: boolean; retiredSource?: boolean
  failInvoiceWrite?: boolean; eventFailure?: boolean; rpcFailure?: boolean
  busy?: boolean; malformedReceipt?: boolean
}
type Harness = {
  tables: Record<string, Row[]>; options: Options; writes: Row[]; events: Row[]; calls: Row[]
  from: (table: string) => QueryPort; rpc: (name: string, args: Row) => Promise<Reply>
}
type QueryPort = {
  select: (columns: string) => QueryPort
  eq: (key: string, value: unknown) => QueryPort
  in: (key: string, values: unknown[]) => QueryPort
  order: (...args: unknown[]) => QueryPort
  single: () => QueryPort
  maybeSingle: () => QueryPort
  then: <TResult1 = Reply, TResult2 = never>(onfulfilled?: ((value: Reply) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) => Promise<TResult1 | TResult2>
}
const io = vi.hoisted(() => ({ harness: null as Harness | null }))
const active = () => {
  if (!io.harness) throw new Error('Synthetic harness not initialized')
  return io.harness
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => active().from(table),
  rpc: (name: string, args: Row) => active().rpc(name, args),
} }))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: async () => undefined }))
vi.mock('@/lib/ediel/retention/financeCopyRetention', () => ({ requireInvoiceSourceCopiesAvailable: async () => {
  if (active().options.retiredSource) throw new Error('synthetic source retired')
} }))
vi.mock('@/lib/billing/providers/registry', () => ({
  InvoiceProviderConfigError: class extends Error {},
  loadTenantInvoiceProviderSelection: async () => ({ invoice_export_enabled: false }),
  requireTenantInvoiceProvider: () => ({ provider: 'nordfin' }), isFileProvider: () => true,
}))
vi.mock('@/lib/supabase/tenantQuery', () => ({ tenantUpdate: () => { throw new Error('Unexpected dispatch write') } }))
vi.mock('@/lib/platform/outboundFreeze', () => ({ assertOutboundAllowed: () => { throw new Error('Unexpected dispatch') } }))
vi.mock('@/lib/automation/locks', () => ({ withAutomationLock: () => { throw new Error('Approval must not use a separately released lease') } }))
vi.mock('@/lib/integrations/billing/capway/auth', () => ({ resolveCapwayConnectionConfig: () => { throw new Error('Unexpected provider access') } }))
vi.mock('@/lib/integrations/billing/capway/client', () => ({ CapwayApticClient: class { constructor() { throw new Error('Unexpected provider access') } } }))
vi.mock('@/lib/integrations/billing/capway/payloadBuilder', () => ({ buildCapwayInvoicePayload: vi.fn() }))
vi.mock('@/lib/integrations/billing/capway/purchase', () => ({ buildPurchasePayload: vi.fn() }))
vi.mock('@/lib/integrations/billing/capway/statusMapper', () => ({ shouldRequestPurchaseAfterCreate: vi.fn() }))
vi.mock('@/lib/integrations/billing/exportErrorClassification', () => ({ classifyInvoiceExportError: vi.fn(), computeNextRetryAt: vi.fn(), INVOICE_EXPORT_MAX_ATTEMPTS: 3 }))
vi.mock('@/lib/billing/invoiceReadiness', () => ({ lockBillingPeriodForInvoiceExport: vi.fn() }))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: () => { throw new Error('Approval audit must be committed by the atomic RPC') } }))

import { approveAndSendReadyInvoicesForMonth } from '@/lib/billing/invoiceApprovedDispatch'

const COMPANY = '67424ca4-ef5d-4d29-98fe-464e04411c35'
const ITEM = '11111111-1111-4111-8111-111111111111'
function approval(row: Row): Approval { return (row.metadata as { approval: Approval }).approval }
function setup(options: Options = {}): Harness {
  const pending = () => ({ approval: { status: 'pending_review' } })
  const tables: Record<string, Row[]> = {
    invoice_export_runs: [{ id: 'run', company_id: COMPANY, billing_month: '2026-09' }],
    invoice_export_items: [{ id: ITEM, company_id: COMPANY, export_run_id: 'run', customer_id: 'customer', billing_underlay_id: 'underlay', pricing_run_id: 'price', customer_contract_id: 'contract', status: 'pending', total_kwh: 24, amount_ex_vat: 33.74, vat_amount: 8.44, amount_inc_vat: 42.18, metadata: pending() }],
    customer_invoices: [{ id: 'invoice', company_id: COMPANY, invoice_export_item_id: ITEM, status: 'draft', total_kwh: 24, amount_inc_vat: 42.18, price_area_code: 'SE3', calculation_snapshot_sha256: 'a'.repeat(64), calculation_snapshot: { frozen: true }, metadata: pending() }],
    pricing_runs: [{ id: 'price', company_id: COMPANY, billing_underlay_id: 'underlay', status: 'locked', locked_at: '2026-10-28T00:00:00Z', total_ex_vat: 33.74, vat_amount: 8.44, total_inc_vat: 42.18 }],
    pricing_preview_lines: [], customers: [{ id: 'customer', company_id: COMPANY }], companies: [{ id: COMPANY }],
    billing_underlays: [{ id: 'underlay', company_id: COMPANY, customer_id: 'customer', customer_contract_id: 'contract', status: 'validated', readiness_status: 'ready', total_kwh: options.mismatch ? 30 : 24, missing_values_count: 0 }],
  }
  const events: Row[] = [], writes: Row[] = [], calls: Row[] = []
  let scans = 0, writeFailed = false
  let unblock: () => void = () => undefined
  const barrier = new Promise<void>(resolve => { unblock = resolve })
  class Query implements QueryPort {
    filters: Array<(row: Row) => boolean> = []
    one = false
    columns = ''
    constructor(readonly table: string) {}
    select(columns: string) { this.columns = columns; return this }
    eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this }
    in(key: string, values: unknown[]) { this.filters.push(row => values.includes(row[key])); return this }
    order() { return this }
    single() { this.one = true; return this }
    maybeSingle() { this.one = true; return this }
    async result(): Promise<Reply> {
      const rows = (tables[this.table] ?? []).filter(row => this.filters.every(filter => filter(row)))
      const data: unknown = structuredClone(this.one ? rows[0] ?? null : rows)
      const monthScan = this.table === 'invoice_export_items' && this.columns === 'id,status,metadata'
      if (options.staleList && monthScan) for (const row of data as Row[]) row.metadata = pending()
      if (options.race && monthScan) {
        if (++scans === 2) unblock()
        await barrier
      }
      return { data, error: this.one && !data ? { message: 'synthetic missing tenant row' } : null }
    }
    then<TResult1 = Reply, TResult2 = never>(onfulfilled?: ((value: Reply) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): Promise<TResult1 | TResult2> {
      return this.result().then(onfulfilled, onrejected)
    }
  }
  const harness: Harness = {
    tables, options, writes, events, calls,
    from: table => new Query(table),
    rpc: async (name, args) => {
      calls.push({ name, ...structuredClone(args) })
      expect(name).toBe('gridex_approve_invoice_review_v1')
      expect(args.p_company_id).toBe(COMPANY)
      expect(args.p_invoice_export_item_id).toBe(ITEM)
      expect(args.p_review).toEqual({ invoice_export_item_id: ITEM, billing_underlay_id: 'underlay', pricing_run_id: 'price', calculation_snapshot_sha256: 'a'.repeat(64), total_kwh: 24, total_inc_vat: 42.18, price_area: 'SE3' })
      expect(args.p_review_hash).toMatch(/^[a-f0-9]{64}$/)
      if (options.rpcFailure) return { data: null, error: { message: 'synthetic approval RPC unavailable' } }
      if (options.busy) return { data: null, error: { code: '55P03', message: 'invoice_review_approval_already_running' } }
      if (options.malformedReceipt) return { data: { newly_approved: 'true' }, error: null }
      const item = tables.invoice_export_items[0], invoice = tables.customer_invoices[0]
      if (approval(item).status === 'approved' || approval(invoice).status === 'approved') {
        if (JSON.stringify(approval(item)) !== JSON.stringify(approval(invoice))) return { data: null, error: { message: 'invoice_approval_mirror_mismatch' } }
        return { data: { newly_approved: false }, error: null }
      }
      if (options.failInvoiceWrite && !writeFailed) { writeFailed = true; return { data: null, error: { message: 'synthetic invoice write failure' } } }
      if (options.eventFailure) return { data: null, error: { message: 'synthetic event insert failure' } }
      const reviewed = args.p_review as Row
      const approved: Approval = { status: 'approved', approved_at: '2026-10-28T00:00:00Z', approved_by: String(args.p_actor_user_id), review_hash: args.p_review_hash, calculation_snapshot_sha256: reviewed.calculation_snapshot_sha256 }
      item.metadata = { approval: structuredClone(approved) }; invoice.metadata = { approval: structuredClone(approved) }
      writes.push({ atomic: true }); events.push({ event_type: 'invoice.approved', actor_user_id: args.p_actor_user_id })
      return { data: { newly_approved: true }, error: null }
    },
  }
  io.harness = harness
  return harness
}
const approve = (actorUserId = 'actor-a') => approveAndSendReadyInvoicesForMonth({ companyId: COMPANY, billingMonth: '2026-09', actorUserId })

beforeEach(() => { io.harness = null })
describe('atomic invoice approval service contract (synthetic RPC boundary)', () => {
  it('counts one new approval for two stale scans and preserves the winning actor on both mirrors', async () => {
    const h = setup({ race: true })
    const results = await Promise.all([approve('actor-a'), approve('actor-b')])
    expect(results.reduce((sum, row) => sum + row.approved, 0)).toBe(1)
    expect(h.events).toHaveLength(1)
    expect(approval(h.tables.invoice_export_items[0])).toEqual(approval(h.tables.customer_invoices[0]))
    expect(approval(h.tables.invoice_export_items[0]).approved_by).toBe('actor-a')
  })
  it('does not write, change financial snapshots or emit on ordinary repeat', async () => {
    const h = setup()
    expect((await approve()).approved).toBe(1)
    const before = structuredClone(h.tables), count = h.writes.length
    expect((await approve('actor-b')).approved).toBe(0)
    expect(h.tables).toEqual(before); expect(h.writes).toHaveLength(count); expect(h.events).toHaveLength(1)
  })
  it('rechecks stale list entries and retains the original approval actor and time', async () => {
    const h = setup({ staleList: true })
    await approve()
    const before = structuredClone(h.tables)
    expect(await approve('actor-b')).toMatchObject({ approved: 0, failed: 0 })
    expect(h.tables).toEqual(before); expect(h.events).toHaveLength(1); expect(h.calls).toHaveLength(2)
  })
  it('preserves the retired-source gate before the atomic RPC', async () => {
    const h = setup({ retiredSource: true })
    expect(await approve()).toMatchObject({ approved: 0, failed: 1 })
    expect(h.calls).toHaveLength(0); expect(h.writes).toHaveLength(0); expect(h.events).toHaveLength(0)
  })
  it('preserves readiness and quantity checks before the atomic RPC', async () => {
    const h = setup({ mismatch: true })
    expect(await approve()).toMatchObject({ approved: 0, failed: 1 })
    expect(h.calls).toHaveLength(0); expect(h.writes).toHaveLength(0); expect(h.events).toHaveLength(0)
  })
  it('fails closed when the approval RPC is unavailable', async () => {
    const h = setup({ rpcFailure: true })
    expect(await approve()).toMatchObject({ approved: 0, failed: 1 })
    expect(h.writes).toHaveLength(0); expect(h.events).toHaveLength(0)
  })
  it('allows ordinary retry after a rolled-back second write', async () => {
    const h = setup({ failInvoiceWrite: true })
    expect(await approve()).toMatchObject({ approved: 0, failed: 1 })
    expect(approval(h.tables.invoice_export_items[0]).status).toBe('pending_review')
    expect(approval(h.tables.customer_invoices[0]).status).toBe('pending_review')
    expect(await approve()).toMatchObject({ approved: 1, failed: 0 })
    expect(approval(h.tables.invoice_export_items[0])).toEqual(approval(h.tables.customer_invoices[0])); expect(h.events).toHaveLength(1)
  })
  it('does not report success or commit mocked metadata when event storage fails', async () => {
    const h = setup({ eventFailure: true })
    expect(await approve()).toMatchObject({ approved: 0, failed: 1 })
    expect(approval(h.tables.invoice_export_items[0]).status).toBe('pending_review')
    expect(approval(h.tables.customer_invoices[0]).status).toBe('pending_review')
  })
  it('reports historical partial approvals instead of silently skipping the mirror', async () => {
    const h = setup()
    h.tables.invoice_export_items[0].metadata = { approval: { status: 'approved', approved_by: 'old-actor' } }
    const result = await approve('new-actor')
    expect(result).toMatchObject({ approved: 0, failed: 1 })
    expect(result.errors[0].error).toMatch(/mirror_mismatch/); expect(h.events).toHaveLength(0)
  })
  it('gives a clear loser message for PostgreSQL NOWAIT conflicts', async () => {
    const h = setup({ busy: true })
    const result = await approve()
    expect(result).toMatchObject({ approved: 0, failed: 1 })
    expect(result.errors[0].error).toMatch(/annan körning godkänner redan fakturan/)
    expect(result.errors[0].errorCode).toBe('invoice_approval_busy')
    expect(h.writes).toHaveLength(0); expect(h.events).toHaveLength(0)
  })
  it('requires a boolean authoritative receipt before counting an approval', async () => {
    const h = setup({ malformedReceipt: true })
    const result = await approve()
    expect(result).toMatchObject({ approved: 0, failed: 1 })
    expect(result.errors[0].error).toMatch(/giltig godkännandekvittens/)
    expect(h.writes).toHaveLength(0)
  })
})
