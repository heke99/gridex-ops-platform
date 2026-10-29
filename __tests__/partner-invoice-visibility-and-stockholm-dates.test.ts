// ops-api-review: partner invoice status allow-list, Europe/Stockholm date bounds, POA accepted_at validation
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { sortRows } from './helpers/postgrestOrFilter'
import { postgrestOr } from './helpers/postgrestOrFilter'

type Row = Record<string, unknown>
/** A resolved access window (output of gridex_customer_metering_access_windows_v1, supply-period basis). */
type AccessWindow = { company_id: string; customer_id: string; metering_point_id: string; from: string; to: string | null }
const NORMALIZED_RPC = 'gridex_customer_normalized_metering_values_v1'
const m = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>, inserts: [] as string[],
  windows: [] as AccessWindow[], rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>, fromTables: [] as string[],
}))
// Test model of gridex_customer_normalized_metering_values_v1 in
// supabase/migrations/20261022100500_customer_metering_access_windows.sql (FINDINGS F79): argument checks,
// company, customer, optional site/facility/range/keyset filters, then the access window of the same customer
// and metering point (whole interval inside), ordered period_start DESC, id DESC and cut at p_limit.
const access = vi.hoisted(() => {
  type R = Record<string, unknown>
  type W = { company_id: string; customer_id: string; metering_point_id: string; from: string; to: string | null }
  const t = (value: unknown) => Date.parse(String(value))
  const fail = (code: string, message: string) => ({ data: null, error: { code, message } })
  return {
    normalized(args: R, rows: R[], windows: W[], customers: R[]): { data: R[] | null; error: unknown } {
      const limit = args.p_limit as number | null | undefined
      if (limit != null && (limit < 1 || limit > 5000)) return fail('22023', 'customer_metering_limit_invalid')
      if ((args.p_before_period_start == null) !== (args.p_before_id == null)) return fail('22023', 'customer_metering_cursor_invalid')
      const ids = args.p_customer_ids as unknown[] | null
      if (args.p_company_id == null || !Array.isArray(ids) || ids.length === 0 || ids.length > 50 || ids.some((id) => id == null)) return fail('22023', 'customer_metering_scope_invalid')
      if (ids.some((id) => !customers.some((c) => c.id === id && c.company_id === args.p_company_id))) return fail('42501', 'customer_metering_customer_scope_invalid')
      const own = windows.filter((w) => w.company_id === args.p_company_id && ids.includes(w.customer_id))
      const { p_period_start_from: from, p_period_start_before: before, p_period_end_to: endTo, p_before_period_start: cursor } = args
      const data = rows.filter((v) => v.company_id === args.p_company_id && ids.includes(v.customer_id)
        && (args.p_customer_site_id == null || v.customer_site_id === args.p_customer_site_id)
        && (args.p_facility_id == null || v.facility_id === args.p_facility_id)
        && (from == null || t(v.period_start) >= t(from))
        && (before == null || t(v.period_start) < t(before))
        && (endTo == null || t(v.period_end) <= t(endTo))
        && (cursor == null || t(v.period_start) < t(cursor) || (t(v.period_start) === t(cursor) && String(v.id) < String(args.p_before_id)))
        && v.period_start != null
        && own.some((w) => w.customer_id === v.customer_id && w.metering_point_id === v.metering_point_id && t(v.period_start) >= t(w.from)
          && (w.to == null || (t(v.period_start) < t(w.to) && t(v.period_end ?? v.period_start) <= t(w.to)))))
        .sort((a, b) => t(b.period_start) - t(a.period_start) || (String(a.id) < String(b.id) ? 1 : String(a.id) > String(b.id) ? -1 : 0))
      return { data: limit == null ? data : data.slice(0, limit), error: null }
    },
  }
})
vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: vi.fn(async () => ({ ok: true, client: { id: 'client_synthetic', company_id: 'company_synthetic' } })),
  logIntegrationApiRequest: vi.fn(async () => {}),
}))
vi.mock('@/lib/ediel/retention/invoiceFileRetention', () => ({ requireInvoiceFileCopyAvailable: vi.fn(async () => {}) }))
vi.mock('@/lib/supabase/service', () => {
  // PostgREST builder: the base rows (table or SETOF function result) are filtered, ordered, then paged.
  function builder(table: string, source: () => { data: Row[] | null; error: unknown }) {
    const filters: Array<(row: Row) => boolean> = []
    const orders: Array<{ column: string; ascending: boolean; nullsFirst?: boolean }> = []
    let limit = Infinity
    let offset = 0
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
      range: (from: number, to: number) => { offset = from; limit = to - from + 1; return b },
      insert: () => { m.inserts.push(table); return b },
      single: async () => ({ data: null, error: { message: 'insert reached' } }),
      rows: () => sortRows((source().data ?? []).filter((row) => filters.every((f) => f(row))), orders).slice(offset, offset + limit),
      maybeSingle: async () => ({ data: (b.rows as () => Row[])()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => {
        const base = source()
        return resolve(base.error ? { data: null, error: base.error } : { data: (b.rows as () => Row[])(), error: null })
      },
    }
    return b
  }
  return {
    supabaseService: {
      storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), download: async () => ({ data: new Blob([Buffer.from('%PDF-1.7\n%%EOF')]), error: null }) }) },
      from(table: string) {
        m.fromTables.push(table)
        return builder(table, () => ({ data: m.tables[table] ?? [], error: null }))
      },
      rpc(name: string, args: Row) {
        m.rpcCalls.push({ name, args })
        if (name !== NORMALIZED_RPC) throw new Error(`unexpected rpc ${name}`)
        return builder(`rpc:${name}`, () => access.normalized(args, m.tables.normalized_metering_values ?? [], m.windows, m.tables.customers ?? []))
      },
    },
  }
})
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
  return { id: id(), company_id: 'company_synthetic', customer_id: 'customer_internal', customer_site_id: 'site_internal', metering_point_id: 'mp_internal', period_start: s.toISOString(), period_end: new Date(s.getTime() + minutes * 60_000).toISOString(), resolution: '1h', revision_status: 'current', quantity_kwh: 1, unit: 'kWh', direction: 'consumption', quality_status: null }
}

// Established supply of the site customer on its metering point, wide enough for every date fixture below.
const SUPPLY: AccessWindow = { company_id: 'company_synthetic', customer_id: 'customer_internal', metering_point_id: 'mp_internal', from: '2026-01-01T00:00:00.000Z', to: null }

beforeEach(() => {
  seq = 0
  m.inserts = []
  m.windows = [SUPPLY]
  m.rpcCalls = []
  m.fromTables = []
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

describe('F79 Partner measurements are limited to the site customer\'s access windows', () => {
  // Same 25-hour DST day; the site customer's supply starts at 2026-10-25T05:00Z (07:00 local), the previous
  // occupant's supply on the same point ended then. Both readers must return only the customer's own part.
  const supplyStart = '2026-10-25T05:00:00.000Z'
  beforeEach(() => {
    const start = Date.parse('2026-10-24T22:00:00Z')
    m.windows = [
      { ...SUPPLY, from: supplyStart },
      { ...SUPPLY, customer_id: 'customer_previous', from: '2026-01-01T00:00:00.000Z', to: supplyStart },
    ]
    m.tables.customers.push({ id: 'customer_previous', company_id: 'company_synthetic', customer_reference: 'customer_previous_public', customer_type: 'private' })
    m.tables.normalized_metering_values = [
      ...Array.from({ length: 25 }, (_, i) => value(new Date(start + i * 3_600_000).toISOString())),
      { ...value('2026-10-25T01:00:00Z'), customer_id: 'customer_previous', quantity_kwh: 99 }, // previous occupant, same site and point
    ]
  })
  const scope = {
    p_company_id: 'company_synthetic', p_customer_ids: ['customer_internal'], p_customer_site_id: 'site_internal',
    p_period_start_from: '2026-10-24T22:00:00.000Z', p_period_start_before: '2026-10-25T23:00:00.000Z',
  }

  it('simple: values of the same customer and site before the supply start are not returned; the RPC is scoped to the site customer and site', async () => {
    const body = await (await simple([...sitePath, 'measurement'], '?from_date=2026-10-25&to_date=2026-10-25'))!.json()
    expect(body.measurements).toHaveLength(18)
    expect(body.measurements[0].timestamp).toBe(supplyStart)
    expect(body.measurements.at(-1).timestamp).toBe('2026-10-25T22:00:00.000Z')
    expect(body.measurements.map((row: Row) => row.value)).not.toContain(99)
    expect(m.fromTables).not.toContain('normalized_metering_values')
    expect(m.rpcCalls.length).toBeGreaterThanOrEqual(1)
    for (const call of m.rpcCalls) expect(call).toEqual({ name: NORMALIZED_RPC, args: expect.objectContaining(scope) })
  })

  it('core: values of the same customer and site before the supply start are not returned; the RPC is scoped to the site customer and site', async () => {
    const response = await core(['sites', 'site_public', 'measurements'], '?from_date=2026-10-25&to_date=2026-10-25')
    expect(response!.status).toBe(200)
    const body = await response!.json()
    expect(body.data.measurements).toHaveLength(18)
    expect(body.data.measurements[0].timestamp).toBe(supplyStart)
    expect(body.data.measurements.at(-1).period_end).toBe('2026-10-25T23:00:00.000Z')
    expect(body.data.measurements.map((row: Row) => row.value)).not.toContain(99)
    expect(m.fromTables).not.toContain('normalized_metering_values')
    expect(m.rpcCalls.length).toBeGreaterThanOrEqual(1)
    for (const call of m.rpcCalls) expect(call).toEqual({ name: NORMALIZED_RPC, args: expect.objectContaining(scope) })
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
