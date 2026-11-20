// simulation: SITE01.01, SITE01.04, SITE01.05
// Controlled component checks of the actual prepare entrypoint. Database,
// pricing and effect ports are finite; no native/Auth/concurrency acceptance.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type DraftCall = {
  p_company_id: string
  p_run: Row & { legacy_items: Row[] }
  p_items: Row[]
  p_invoices: Row[]
  p_enrichment: Row & { calculation_snapshot: Row }
}
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  writes: [] as DraftCall[],
  events: [] as Row[],
  sources: [] as Row[],
  sourceError: null as Error | null,
}))

vi.mock('@/lib/ediel/retention/financeCopyRetention', () => ({
  requireInvoiceSourceCopiesAvailable: async (input: Row) => {
    io.sources.push(input)
    if (io.sourceError) throw io.sourceError
  },
}))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: async () => undefined }))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: async (input: Row) => { io.events.push(input) } }))
vi.mock('@/lib/pricing/engine', () => ({ lockPricingPreview: async () => { throw new Error('Unexpected pricing write') } }))
vi.mock('@/lib/pricing/underlayPricingAdapter', () => ({
  calculateUnderlayPricingWithCore: async () => { throw new Error('Unexpected calculation') },
  loadLockedUnderlayPricingWithCore: async (input: Row) => ({
    locked: true, status: 'success', pricingRunId: `pricing-${input.billingUnderlayId}`,
    engine: 'synthetic finite pricing port', lines: [], intervalEvidence: [],
    subtotalSekExVat: input.billingUnderlayId === 'underlay-a' ? 100 : 200,
    vatSek: input.billingUnderlayId === 'underlay-a' ? 25 : 50,
    totalSekIncVat: input.billingUnderlayId === 'underlay-a' ? 125 : 250,
  }),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    if (!(table in io.tables)) throw new Error(`Undeclared table ${table}`)
    const filters: Array<(row: Row) => boolean> = []
    let single = false, start = 0, end = Infinity
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query },
      neq: (key: string, value: unknown) => { filters.push(row => row[key] !== value); return query },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query },
      order: () => query,
      range: (from: number, to: number) => { start = from; end = to; return query },
      maybeSingle: () => { single = true; return query },
      then(resolve: (value: { data: Row | Row[] | null; error: null }) => unknown, reject?: (error: unknown) => unknown) {
        const rows = io.tables[table].filter(row => filters.every(filter => filter(row))).slice(start, end + 1)
        if (single && rows.length > 1) throw new Error('Ambiguous finite observation')
        return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve, reject)
      },
    }
    return query
  },
  async rpc(name: string, args: DraftCall) {
    if (name !== 'gridex_create_invoice_review_draft_v1') throw new Error(`Undeclared RPC ${name}`)
    io.writes.push(structuredClone(args))
    io.tables.invoice_export_items.push(...args.p_items.map(row => ({ ...row, status: 'pending' })))
    return { data: {}, error: null }
  },
} }))

import { prepareInvoiceDraftsForReview } from '@/lib/billing/invoiceReviewPrepare'

const COMPANY = 'synthetic-tenant-a'
const CUSTOMER = 'synthetic-customer'
const prepare = () => prepareInvoiceDraftsForReview({
  companyId: COMPANY, billingMonth: '2026-09', provider: 'file_export', environment: 'test',
})

beforeEach(() => {
  io.writes = []; io.events = []; io.sources = []; io.sourceError = null
  io.tables = {
    billing_underlays: ['a', 'b'].map(key => ({
      id: `underlay-${key}`, company_id: COMPANY, customer_id: CUSTOMER,
      site_id: `site-${key}`, metering_point_id: `point-${key}`, contract_id: `contract-${key}`,
      contract_price_snapshot_id: `snapshot-${key}`, underlay_year: 2026, underlay_month: 9,
      status: 'validated', readiness_status: 'ready', total_kwh: key === 'a' ? '10' : '20',
      price_area: key === 'a' ? 'SE3' : 'SE4', currency: 'SEK',
      billing_period_start: '2026-09-01', billing_period_end: '2026-09-30',
    })),
    invoice_export_items: [],
    customer_contracts: ['a', 'b'].map(key => ({
      id: `contract-${key}`, company_id: COMPANY, customer_id: CUSTOMER, consolidated_invoice: true,
      invoice_email: 'synthetic@example.invalid', billing_street: 'Synthetic street 1',
      billing_postal_code: '11122', billing_city: 'Teststad',
    })),
    contract_price_snapshots: ['a', 'b'].map(key => ({
      id: `snapshot-${key}`, company_id: COMPANY, contract_id: `contract-${key}`,
    })),
    customers: [{
      id: CUSTOMER, company_id: COMPANY, customer_number: 'SYNTHETIC-1',
      full_name: 'Synthetic customer', invoice_email: 'synthetic@example.invalid',
    }],
  }
})

describe('T1 actual two-site preparation through finite ports', () => {
  it('documents separate drafts despite the consolidation flag and preserves site/contract/area identity', async () => {
    expect(await prepare()).toMatchObject({ created: 2, failed: 0, underlays: 2 })
    expect(io.writes).toHaveLength(2)
    expect(io.writes.map(call => call.p_items.length)).toEqual([1, 1])
    expect(io.writes.map(call => call.p_invoices.length)).toEqual([1, 1])
    const legacy = io.writes.map(call => call.p_run.legacy_items[0])
    expect(legacy.map(row => row.consolidated_invoice_group_key)).toEqual([`customer:${CUSTOMER}`, `customer:${CUSTOMER}`])
    expect(legacy.map(row => row.site_id).sort()).toEqual(['site-a', 'site-b'])
    const snapshots = io.writes.map(call => call.p_enrichment.calculation_snapshot)
      .sort((a, b) => String(a.price_area).localeCompare(String(b.price_area)))
    expect(snapshots.map(row => [row.billing_underlay_id, row.customer_contract_id, row.price_area, row.total_sek_inc_vat]))
      .toEqual([['underlay-a', 'contract-a', 'SE3', 125], ['underlay-b', 'contract-b', 'SE4', 250]])
    expect(io.sources).toHaveLength(2)
    expect(io.events).toHaveLength(2)
  })

  it('does not submit drafts or events again after observing non-cancelled reservations', async () => {
    await prepare()
    expect(await prepare()).toMatchObject({ created: 0, alreadyPrepared: 2, candidates: 0 })
    expect(io.writes).toHaveLength(2)
    expect(io.events).toHaveLength(2)
  })

  it('excludes a foreign tenant underlay before source checks and draft writes', async () => {
    io.tables.billing_underlays.push({ ...io.tables.billing_underlays[0], id: 'foreign-underlay', company_id: 'foreign-tenant' })
    expect(await prepare()).toMatchObject({ underlays: 2, created: 2 })
    expect(io.sources.map(row => row.underlayId).sort()).toEqual(['underlay-a', 'underlay-b'])
    expect(io.writes.every(call => call.p_company_id === COMPANY)).toBe(true)
  })

  it('refuses a contract only available in a foreign tenant while preserving the other site', async () => {
    io.tables.customer_contracts[1].company_id = 'foreign-tenant'
    const result = await prepare()
    expect(result).toMatchObject({ created: 1, failed: 1 })
    expect(result.errors[0].billingUnderlayId).toBe('underlay-b')
    expect(io.writes).toHaveLength(1)
    expect(io.writes[0].p_items[0].billing_underlay_id).toBe('underlay-a')
  })

  it('does not submit drafts or events when source retention refuses both underlays', async () => {
    io.sourceError = new Error('synthetic source copy unavailable')
    const result = await prepare()
    expect(result).toMatchObject({ created: 0, failed: 2 })
    expect(result.errors.map(row => row.error)).toEqual([io.sourceError.message, io.sourceError.message])
    expect(io.writes).toHaveLength(0)
    expect(io.events).toHaveLength(0)
  })

  it('refuses a snapshot bound to the other site contract before its draft is submitted', async () => {
    io.tables.contract_price_snapshots[1].contract_id = 'contract-a'
    const result = await prepare()
    expect(result).toMatchObject({ created: 1, failed: 1 })
    expect(result.errors[0].billingUnderlayId).toBe('underlay-b')
    expect(io.writes.map(call => call.p_items[0].billing_underlay_id)).toEqual(['underlay-a'])
  })
})
