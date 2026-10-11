// ops-api-review: partner invoice status allow-list, Europe/Stockholm date bounds, POA accepted_at validation
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { sortRows } from './helpers/postgrestOrFilter'
import { postgrestOr } from './helpers/postgrestOrFilter'

type Row = Record<string, unknown>
const m = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, inserts: [] as string[] }))
vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: vi.fn(async () => ({ ok: true, client: { id: 'client_synthetic', company_id: 'company_synthetic' } })),
  logIntegrationApiRequest: vi.fn(async () => {}),
}))
vi.mock('@/lib/ediel/retention/invoiceFileRetention', () => ({ requireInvoiceFileCopyAvailable: vi.fn(async () => {}) }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), download: async () => ({ data: new Blob([Buffer.from('%PDF-1.7\n%%EOF')]), error: null }) }) },
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = []
      const orders: Array<{ column: string; ascending: boolean; nullsFirst?: boolean }> = []
      let limit = Infinity
      const cmp = (k: string, f: (a: string, b: string) => boolean) => (v: string) => { filters.push((row) => row[k] !== null && row[k] !== undefined && f(new Date(String(row[k])).toISOString(), new Date(v).toISOString())); return b }
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (k: string, v: unknown) => { filters.push((row) => row[k] === v); return b },
        in: (k: string, vs: unknown[]) => { filters.push((row) => vs.includes(row[k])); return b },
        or: (e: string) => { filters.push(postgrestOr(e)); return b },
        gte: (k: string, v: string) => cmp(k, (a, c) => a >= c)(v),
        gt: (k: string, v: string) => cmp(k, (a, c) => a > c)(v),
        lte: (k: string, v: string) => cmp(k, (a, c) => a <= c)(v),
        lt: (k: string, v: string) => cmp(k, (a, c) => a < c)(v),
        order: (column: string, o?: { ascending?: boolean; nullsFirst?: boolean }) => { orders.push({ column, ascending: o?.ascending ?? true, nullsFirst: o?.nullsFirst }); return b },
        limit: (n: number) => { limit = n; return b },
        insert: () => { m.inserts.push(table); return b },
        single: async () => ({ data: null, error: { message: 'insert reached' } }),
        rows: () => sortRows((m.tables[table] ?? []).filter((row) => filters.every((f) => f(row))), orders).slice(0, limit),
        maybeSingle: async () => ({ data: (b.rows as () => Row[])()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: (b.rows as () => Row[])(), error: null }),
      }
      return b
    },
  },
}))
import { handleSimplePartnerApi } from '@/lib/partner-api/simple'
import { handlePartnerApi } from '@/lib/partner-api/core'

const CONTRACT = 'a0000000-0000-4000-8000-000000000001'
let seq = 0
const id = () => `e0000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
function invoice(ref: string, status: string, issuedAt: string): Row {
  return { id: id(), company_id: 'company_synthetic', customer_id: 'customer_internal', invoice_reference: ref, invoice_number: ref, amount_inc_vat: 1, currency: 'SEK', due_date: '2026-12-01', issued_at: issuedAt, status, customer_contract_id: CONTRACT, contract_id: null }
}
function value(start: string, minutes = 60): Row {
  const s = new Date(start)
  return { company_id: 'company_synthetic', customer_site_id: 'site_internal', period_start: s.toISOString(), period_end: new Date(s.getTime() + minutes * 60_000).toISOString(), resolution: '1h', revision_status: 'current', quantity_kwh: 1, unit: 'kWh', direction: 'consumption', quality_status: null }
}

beforeEach(() => {
  seq = 0
  m.inserts = []
  m.tables = {
    customers: [{ id: 'customer_internal', company_id: 'company_synthetic', customer_reference: 'customer_public', customer_type: 'private' }],
    customer_sites: [{ id: 'site_internal', company_id: 'company_synthetic', customer_id: 'customer_internal', facility_reference: 'site_public', site_type: 'consumption' }],
    customer_contracts: [{ id: CONTRACT, company_id: 'company_synthetic', customer_id: 'customer_internal', customer_site_id: 'site_internal' }],
    customer_invoices: [],
    customer_invoice_documents: [],
    normalized_metering_values: [],
  }
})

const simple = (path: string[], query = '') => handleSimplePartnerApi(new NextRequest(`https://example.invalid/api/partner/v1/${path.join('/')}${query}`), 'GET', path)
const core = (path: string[], query = '') => handlePartnerApi(new NextRequest(`https://example.invalid/api/partner/v1/${path.join('/')}${query}`), 'GET', path)
const sitePath = ['customer', 'customer_public', 'site', 'site_public']

describe('Partner invoices never expose draft or failed invoices', () => {
  beforeEach(() => {
    m.tables.customer_invoices = [
      invoice('inv_issued', 'issued', '2026-10-01T10:00:00Z'),
      invoice('inv_paid', 'paid', '2026-10-02T10:00:00Z'),
      invoice('inv_draft', 'draft', '2026-10-03T10:00:00Z'),
      invoice('inv_failed', 'failed', '2026-10-04T10:00:00Z'),
    ]
    m.tables.customer_invoice_documents = m.tables.customer_invoices.map((row) => ({ id: id(), company_id: 'company_synthetic', invoice_id: row.id, document_type: 'invoice_pdf', file_path: 'x.pdf', public_url: 'https://files.example.invalid/x.pdf', metadata: {}, created_at: '2026-10-05T00:00:00Z' }))
  })

  it('simple: list, detail and PDF', async () => {
    const list = await (await simple([...sitePath, 'invoice']))!.json()
    expect(list.invoices.map((r: Row) => r.entity_id).sort()).toEqual(['inv_issued', 'inv_paid'])
    for (const ref of ['inv_draft', 'inv_failed']) {
      expect((await simple(['invoice', ref]))!.status).toBe(404)
      expect((await simple(['invoice', ref, 'pdf']))!.status).toBe(404)
    }
    expect((await simple(['invoice', 'inv_issued']))!.status).toBe(200)
  })

  it('core: list, detail and PDF', async () => {
    const list = await (await core(['customers', 'customer_public', 'invoices']))!.json()
    expect(list.data.invoices.map((r: Row) => r.invoice_reference).sort()).toEqual(['inv_issued', 'inv_paid'])
    for (const ref of ['inv_draft', 'inv_failed']) {
      expect((await core(['invoices', ref]))!.status).toBe(404)
      expect((await core(['invoices', ref, 'pdf']))!.status).toBe(404)
    }
    expect((await core(['invoices', 'inv_paid']))!.status).toBe(200)
  })
})

describe('Partner invoice dates are Europe/Stockholm calendar dates', () => {
  beforeEach(() => {
    m.tables.customer_invoices = [
      invoice('late_evening_utc', 'issued', '2026-09-30T22:30:00Z'), // 2026-10-01 00:30 in Stockholm
      invoice('before_midnight', 'issued', '2026-09-30T21:30:00Z'), // 2026-09-30 23:30 in Stockholm
    ]
  })

  it('simple: invoice_date and from/to filters use Stockholm days', async () => {
    const all = await (await simple([...sitePath, 'invoice']))!.json()
    expect(Object.fromEntries(all.invoices.map((r: Row) => [r.entity_id, r.invoice_date]))).toEqual({ late_evening_utc: '2026-10-01', before_midnight: '2026-09-30' })
    const oct1 = await (await simple([...sitePath, 'invoice'], '?from_date=2026-10-01&to_date=2026-10-01'))!.json()
    expect(oct1.invoices.map((r: Row) => r.entity_id)).toEqual(['late_evening_utc'])
    const sep30 = await (await simple([...sitePath, 'invoice'], '?from_date=2026-09-30&to_date=2026-09-30'))!.json()
    expect(sep30.invoices.map((r: Row) => r.entity_id)).toEqual(['before_midnight'])
  })

  it('core: from/to filters use Stockholm days', async () => {
    const oct1 = await (await core(['customers', 'customer_public', 'invoices'], '?from_date=2026-10-01&to_date=2026-10-01'))!.json()
    expect(oct1.data.invoices.map((r: Row) => r.invoice_reference)).toEqual(['late_evening_utc'])
    const sep30 = await (await core(['customers', 'customer_public', 'invoices'], '?from_date=2026-09-30&to_date=2026-09-30'))!.json()
    expect(sep30.data.invoices.map((r: Row) => r.invoice_reference)).toEqual(['before_midnight'])
  })
})

describe('Partner measurements use half-open Europe/Stockholm day bounds', () => {
  // 2026-10-25 is the 25-hour DST day in Stockholm: 2026-10-24T22:00Z .. 2026-10-25T23:00Z.
  beforeEach(() => {
    const start = Date.parse('2026-10-24T22:00:00Z')
    m.tables.normalized_metering_values = [
      value('2026-10-24T21:00:00Z'), // previous local day
      ...Array.from({ length: 25 }, (_, i) => value(new Date(start + i * 3_600_000).toISOString())),
      value('2026-10-25T23:00:00Z'), // next local day
    ]
  })

  it('simple: a 25-hour DST day returns all 25 intervals and nothing from neighbouring days', async () => {
    const body = await (await simple([...sitePath, 'measurement'], '?from_date=2026-10-25&to_date=2026-10-25'))!.json()
    expect(body.measurements).toHaveLength(25)
    expect(body.measurements[0].timestamp).toBe('2026-10-24T22:00:00.000Z')
    expect(body.measurements.at(-1).timestamp).toBe('2026-10-25T22:00:00.000Z')
  })

  it('core: includes the last interval (period_end = next local midnight) and honours DST', async () => {
    const response = await core(['sites', 'site_public', 'measurements'], '?from_date=2026-10-25&to_date=2026-10-25')
    expect(response!.status).toBe(200)
    const body = await response!.json()
    expect(body.data.measurements).toHaveLength(25)
    expect(body.data.measurements.at(-1).period_end).toBe('2026-10-25T23:00:00.000Z')
  })
})

describe('Partner POA accepted_at validation', () => {
  async function post(acceptedAt: unknown) {
    const body = { customer_reference: 'customer_public', site_reference: 'site_public', accepted: true, accepted_at: acceptedAt, signer_name: 'Test Person', evidence_reference: 'ev-1', poa_type: 'web', transaction_type: 'switch' }
    return handlePartnerApi(new NextRequest('https://example.invalid/api/partner/v1/powers-of-attorney', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'poa-key-0001-abcdefgh' }, body: JSON.stringify(body) }), 'POST', ['powers-of-attorney'])
  }

  it.each(['not-a-date', '2026-13-45T00:00:00Z', '2026-10-01', '2026-10-01T10:00:00'])('malformed %s gives 422, not 500, and writes nothing', async (raw) => {
    const response = await post(raw)
    expect(response!.status).toBe(422)
    expect(JSON.stringify(await response!.json())).toContain('accepted_at_invalid')
    expect(m.inserts).toEqual([])
  })

  it('a future accepted_at gives 422', async () => {
    const response = await post(new Date(Date.now() + 86_400_000).toISOString())
    expect(response!.status).toBe(422)
    expect(m.inserts).toEqual([])
  })
})
