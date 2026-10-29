// MAIN04.02 / BILLNEG01.01: real prepare service and automation lock implementation.
// Database/RPC, pricing, retention and events are finite synthetic ports, not E2E evidence.
import { expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type Result = { data: unknown; error: unknown }
type Ports = {
  from: (table: string) => unknown
  rpc: (name: string, args: Row) => Promise<Result>
  requireSource: () => Promise<void>
  loadLocked: () => Promise<Row | null>
  calculate: () => Promise<Row>
  lockPricing: () => Promise<void>
  emit: (event: Row) => Promise<unknown>
}
const port = vi.hoisted(() => ({ current: null as Ports | null }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => port.current!.from(table),
  rpc: (name: string, args: Row) => port.current!.rpc(name, args),
} }))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: async () => undefined }))
vi.mock('@/lib/ediel/retention/financeCopyRetention', () => ({ requireInvoiceSourceCopiesAvailable: () => port.current!.requireSource() }))
vi.mock('@/lib/pricing/underlayPricingAdapter', () => ({
  loadLockedUnderlayPricingWithCore: () => port.current!.loadLocked(),
  calculateUnderlayPricingWithCore: () => port.current!.calculate(),
}))
vi.mock('@/lib/pricing/engine', () => ({ lockPricingPreview: () => port.current!.lockPricing() }))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: (event: Row) => port.current!.emit(event) }))
// Actual effective-delivery and billing-period helpers execute alongside the service.
// The actual locks.ts module is deliberately NOT mocked: only its RPC boundary is.
import { prepareInvoiceDraftsForReview as candidatePrepare } from '@/lib/billing/invoiceReviewPrepare'

// An optional original port lets this same behaviour suite demonstrate fail-first
// without rewriting the live candidate while other agents use the workspace.
const prepareInvoiceDraftsForReview: typeof candidatePrepare = process.env.FINANCE_PREPARE_BASELINE
  ? (await import(/* @vite-ignore */ process.env.FINANCE_PREPARE_BASELINE)).prepareInvoiceDraftsForReview
  : candidatePrepare

const COMPANY = '11111111-1111-4111-8111-111111111111'

function harness(options: {
  race?: boolean; appearsAfterLock?: boolean; lockFailure?: boolean; draftFailure?: boolean; sourceRetired?: boolean
} = {}) {
  const underlay: Row = { id: 'underlay', company_id: COMPANY, customer_id: 'customer', customer_contract_id: 'contract',
    underlay_year: 2026, underlay_month: 9, status: 'validated', readiness_status: 'ready', total_kwh: 24,
    contract_price_snapshot_id: 'snapshot', currency: 'SEK', price_area: 'SE3', vat_rate: .25,
    billing_period_start: '2026-09-30', billing_period_end: '2026-10-01' }
  const tables: Record<string, Row[]> = {
    billing_underlays: [underlay],
    customer_contracts: [{ id: 'contract', company_id: COMPANY, customer_id: 'customer', contract_number: 'FINANCE-SYNTHETIC',
      contract_type: 'hourly', contract_price_snapshot_id: 'snapshot', price_area_used: 'SE3', vat_rate: .25 }],
    contract_price_snapshots: [{ id: 'snapshot', company_id: COMPANY, contract_id: 'contract', snapshot_hash: 'signed-synthetic-hash' }],
    customers: [{ id: 'customer', company_id: COMPANY, customer_number: 'FINANCE-SYNTHETIC', full_name: 'Synthetic Customer',
      invoice_email: 'synthetic@localhost.invalid', billing_street: 'Synthetic Street 1', billing_postal_code: '11111', billing_city: 'Synthetic' }],
    invoice_export_items: [], customer_invoices: [], invoice_export_runs: [],
  }
  const calls = { calculate: 0, pricingLock: 0, draft: 0, reservationReads: 0,
    acquisitions: [] as Row[], releases: [] as Row[] }
  const locks = new Map<unknown, unknown>(), events: Row[] = []
  let pricingLocked = false
  let unblock = () => {}
  const barrier = new Promise<void>(resolve => { unblock = resolve })
  const frozenExisting = () => {
    tables.invoice_export_items.push({ id: 'old-item', company_id: COMPANY, billing_underlay_id: 'underlay', status: 'pending',
      metadata: { approval: { status: 'approved', approved_by: 'original-actor', approved_at: '2026-10-28T00:00:00Z' } } })
    tables.customer_invoices.push({ id: 'old-invoice', company_id: COMPANY, invoice_export_item_id: 'old-item',
      status: 'draft', calculation_snapshot_sha256: 'old-calculation', calculation_snapshot: { immutable: true } })
  }
  class Query {
    private filters: Array<(row: Row) => boolean> = []
    private one = false
    constructor(private table: string) {}
    select() { return this }
    eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this }
    neq(key: string, value: unknown) { this.filters.push(row => row[key] !== value); return this }
    in(key: string, values: unknown[]) { this.filters.push(row => values.includes(row[key])); return this }
    order() { return this }
    range() { return this }
    maybeSingle() { this.one = true; return this }
    async result(): Promise<Result> {
      if (!tables[this.table]) throw new Error(`Unexpected table ${this.table}`)
      const rows = tables[this.table].filter(row => this.filters.every(filter => filter(row)))
      const data = structuredClone(this.one ? rows[0] ?? null : rows)
      if (this.table === 'invoice_export_items') {
        calls.reservationReads++
        if (options.race && calls.reservationReads <= 2) {
          if (calls.reservationReads === 2) unblock()
          await barrier
        }
      }
      return { data, error: null }
    }
    then(resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) {
      return this.result().then(resolve, reject)
    }
  }
  const pricing: Row = { locked: true, status: 'success', pricingRunId: 'synthetic-locked-pricing', engine: 'mock',
    lines: [{ amountExVat: 33.74, vatAmount: 8.44 }], intervalEvidence: [{ id: 'synthetic-evidence' }],
    subtotalSekExVat: 33.74, vatSek: 8.44, totalSekIncVat: 42.18 }
  port.current = {
    from: table => new Query(table),
    rpc: async (name, args) => {
      if (name === 'gridex_acquire_automation_lock') {
        calls.acquisitions.push(structuredClone(args))
        if (options.lockFailure) return { data: null, error: new Error('synthetic acquire unavailable') }
        if (locks.has(args.p_lock_key)) return { data: false, error: null }
        locks.set(args.p_lock_key, args.p_lock_token)
        if (options.appearsAfterLock && tables.invoice_export_items.length === 0) frozenExisting()
        return { data: true, error: null }
      }
      if (name === 'gridex_release_automation_lock') {
        calls.releases.push(structuredClone(args))
        expect(locks.get(args.p_lock_key)).toBe(args.p_lock_token)
        locks.delete(args.p_lock_key)
        return { data: true, error: null }
      }
      expect(name).toBe('gridex_create_invoice_review_draft_v1')
      calls.draft++
      if (options.draftFailure) return { data: null, error: new Error('synthetic atomic draft failure') }
      if (tables.invoice_export_items.length > 0) return { data: null, error: { code: 'P0002', message: 'invoice_review_draft_invoice_missing' } }
      const run = args.p_run as Row, items = args.p_items as Row[], invoices = args.p_invoices as Row[], enrichment = args.p_enrichment as Row
      tables.invoice_export_runs.push(structuredClone(run))
      tables.invoice_export_items.push({ ...structuredClone(items[0]), status: 'pending' })
      tables.customer_invoices.push({ ...structuredClone(invoices[0]), calculation_snapshot: structuredClone(enrichment.calculation_snapshot),
        calculation_snapshot_sha256: enrichment.calculation_snapshot_sha256 })
      return { data: { existing: false, run_id: run.id, invoice_id: 'created-invoice' }, error: null }
    },
    requireSource: async () => { if (options.sourceRetired) throw new Error('synthetic source retired') },
    loadLocked: async () => pricingLocked ? structuredClone(pricing) : null,
    calculate: async () => { calls.calculate++; await Promise.resolve(); return structuredClone(pricing) },
    lockPricing: async () => { calls.pricingLock++; pricingLocked = true },
    emit: async event => { events.push(structuredClone(event)) },
  }
  return { prepare: (actorUserId: string) => prepareInvoiceDraftsForReview({ companyId: COMPANY,
    billingMonth: '2026-09', provider: 'nordfin', actorUserId, billingUnderlayId: 'underlay' }), calls, locks, tables, events }
}

it('BILLNEG01.01: initial unlocked-pricing race uses one price/create path and gives a clear loser response', async () => {
  const h = harness({ race: true })
  const results = await Promise.all([h.prepare('actor-a'), h.prepare('actor-b')])
  expect(h.calls.calculate).toBe(1)
  expect(h.calls.pricingLock).toBe(1)
  expect(h.calls.draft).toBe(1)
  expect(results.reduce((sum, value) => sum + value.created, 0)).toBe(1)
  expect(results.reduce((sum, value) => sum + value.failed, 0)).toBe(1)
  expect(results.find(value => value.failed)?.errors[0].error).toMatch(/förbereds redan/)
  expect(h.tables.invoice_export_items).toHaveLength(1)
  expect(h.tables.customer_invoices).toHaveLength(1)
  expect(h.events).toHaveLength(1)
  expect(h.locks.size).toBe(0)
})

it('MAIN04.02: rechecks after acquisition and reuses without changing the original snapshot or actor', async () => {
  const h = harness({ appearsAfterLock: true })
  const result = await h.prepare('actor-b')
  expect(result).toMatchObject({ created: 0, alreadyPrepared: 1, failed: 0 })
  expect(h.calls.calculate).toBe(0)
  expect(h.calls.draft).toBe(0)
  expect(h.events).toEqual([])
  expect(h.tables.invoice_export_items[0]).toMatchObject({ metadata: { approval: { approved_by: 'original-actor' } } })
  expect(h.tables.customer_invoices[0]).toMatchObject({ calculation_snapshot_sha256: 'old-calculation', calculation_snapshot: { immutable: true } })
  expect(h.locks.size).toBe(0)
})

it('MAIN04.02: ordinary repeat preserves the entire graph and frozen calculation', async () => {
  const h = harness()
  expect((await h.prepare('actor-a')).created).toBe(1)
  const before = structuredClone(h.tables)
  expect(await h.prepare('actor-b')).toMatchObject({ alreadyPrepared: 1, created: 0, failed: 0 })
  expect(h.tables).toEqual(before)
  expect(h.events).toHaveLength(1)
  expect(h.locks.size).toBe(0)
})

it('fails closed on acquisition failure before pricing or draft writes', async () => {
  const h = harness({ lockFailure: true })
  expect(await h.prepare('actor-a')).toMatchObject({ failed: 1, created: 0 })
  expect(h.calls.calculate).toBe(0)
  expect(h.calls.draft).toBe(0)
  expect(h.events).toEqual([])
})

it('releases the owned lock after atomic draft failure and leaves no canonical reservation', async () => {
  const h = harness({ draftFailure: true })
  expect(await h.prepare('actor-a')).toMatchObject({ failed: 1, created: 0 })
  expect(h.tables.invoice_export_items).toEqual([])
  expect(h.tables.customer_invoices).toEqual([])
  expect(h.events).toEqual([])
  expect(h.locks.size).toBe(0)
  expect(h.calls.releases).toHaveLength(1)
})

it('keeps retired-source protection before pricing and releases the owned lock', async () => {
  const h = harness({ sourceRetired: true })
  expect(await h.prepare('actor-a')).toMatchObject({ failed: 1, created: 0 })
  expect(h.calls.calculate).toBe(0)
  expect(h.calls.draft).toBe(0)
  expect(h.events).toEqual([])
  expect(h.locks.size).toBe(0)
  expect(h.calls.releases).toHaveLength(1)
})
