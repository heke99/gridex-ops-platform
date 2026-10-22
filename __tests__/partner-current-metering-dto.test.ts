// ops-api-review: F13, F14, F79
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { compileSchema } from './helpers/miniJsonSchema'

type Row = Record<string, unknown>
/** A resolved access window (output of gridex_customer_metering_access_windows_v1, supply-period basis). */
type AccessWindow = { company_id: string; customer_id: string; metering_point_id: string; from: string; to: string | null }
const NORMALIZED_RPC = 'gridex_customer_normalized_metering_values_v1'
const m = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[], limits: [] as number[], company: 'company_synthetic',
  windows: [] as AccessWindow[], rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>, fromTables: [] as string[],
  customer: { id: 'customer_internal', company_id: 'company_synthetic', customer_reference: 'customer_public', customer_type: 'private' },
  site: { id: 'site_internal', company_id: 'company_synthetic', customer_id: 'customer_internal', facility_reference: 'site_public', site_type: 'consumption' },
}))
// Test model of gridex_customer_normalized_metering_values_v1 in
// supabase/migrations/20261022100000_customer_metering_access_windows.sql (FINDINGS F79): argument checks,
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
  requireIntegrationApiAccess: vi.fn(async () => ({ ok: true, client: { id: 'client_synthetic', company_id: m.company } })),
  logIntegrationApiRequest: vi.fn(async () => {}),
}))
vi.mock('@/lib/supabase/service', () => {
  // PostgREST builder: the base rows (table or SETOF function result) are filtered, then limited.
  function builder(table: string, source: () => { data: Row[] | null; error: unknown }) {
    const filters: Array<(row: Row) => boolean> = []
    const orders: Array<{ column: string; ascending: boolean }> = []
    let limit = Infinity
    let offset = 0
    const value = (row: Row, column: string) => { const raw = row[column]; const time = Date.parse(String(raw)); return /^\d{4}-/.test(String(raw)) && Number.isFinite(time) ? time : String(raw) }
    const sorted = (rows: Row[]) => [...rows].sort((a, c) => {
      for (const { column, ascending } of orders) {
        const x = value(a, column), y = value(c, column)
        if (x !== y) return (x < y ? -1 : 1) * (ascending ? 1 : -1)
      }
      return 0
    })
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (k: string, v: unknown) => { filters.push((row) => row[k] === v); return b },
      in: (k: string, values: unknown[]) => { filters.push((row) => values.includes(row[k])); return b },
      gte: (k: string, v: string) => { filters.push((row) => new Date(String(row[k])) >= new Date(v)); return b },
      lte: (k: string, v: string) => { filters.push((row) => String(row[k]) <= v); return b },
      lt: (k: string, v: string) => { filters.push((row) => new Date(String(row[k])) < new Date(v)); return b },
      order: (column: string, options?: { ascending?: boolean }) => { orders.push({ column, ascending: options?.ascending ?? true }); return b },
      limit: (n: number) => { limit = n; m.limits.push(n); return b },
      range: (from: number, to: number) => { offset = from; limit = to - from + 1; return b },
      async maybeSingle() {
        const row = table === 'customers' ? m.customer : m.site
        return { error: null, data: filters.every((f) => f(row)) ? row : null }
      },
      // Filters and the chained order run before the limit, as in the database.
      then: (resolve: (v: unknown) => unknown) => {
        const base = source()
        if (base.error) return resolve({ error: base.error, data: null })
        return resolve({ error: null, data: sorted((base.data ?? []).filter((row) => filters.every((f) => f(row)))).slice(offset, offset + limit) })
      },
    }
    return b
  }
  return {
    supabaseService: {
      from(table: string) {
        m.fromTables.push(table)
        return builder(table, () => ({ data: table === 'normalized_metering_values' ? m.rows : [], error: null }))
      },
      rpc(name: string, args: Row) {
        m.rpcCalls.push({ name, args })
        if (name !== NORMALIZED_RPC) throw new Error(`unexpected rpc ${name}`)
        return builder(`rpc:${name}`, () => access.normalized(args, m.rows, m.windows, [m.customer]))
      },
    },
  }
})
import { handleSimplePartnerApi } from '@/lib/partner-api/simple'
import { partnerOpenApi } from '@/lib/partner-api/openApi'

const schemas = JSON.parse(JSON.stringify(partnerOpenApi.components.schemas).replaceAll('#/components/schemas/', '#/$defs/'))
const validate = compileSchema({ $defs: schemas }, { $ref: '#/$defs/MeasurementResponse' })
// Established supply of the site customer on its metering point, wide enough for every F13/F14 fixture.
const SUPPLY: AccessWindow = { company_id: 'company_synthetic', customer_id: 'customer_internal', metering_point_id: 'mp_internal', from: '2025-01-01T00:00:00.000Z', to: null }

beforeEach(() => { m.rows = []; m.limits = []; m.company = 'company_synthetic'; m.windows = [SUPPLY]; m.rpcCalls = []; m.fromTables = [] })

async function measurements() {
  const path = ['customer', 'customer_public', 'site', 'site_public', 'measurement']
  const r = await handleSimplePartnerApi(new NextRequest(`https://example.invalid/api/partner/v1/${path.join('/')}?from_date=2026-01-01&to_date=2026-01-01`), 'GET', path)
  expect(r!.status).toBe(200)
  return r!.json()
}
let readingSequence = 0
function reading(hour: number, status: string, quantityKwh: number, unit = 'kWh', direction = 'consumption', extra: Row = {}): Row {
  const start = new Date(Date.UTC(2026, 0, 1, hour)).toISOString()
  const end = new Date(Date.UTC(2026, 0, 1, hour + 1)).toISOString()
  return { id: `e0000000-0000-4000-8000-${String(++readingSequence).padStart(12, '0')}`, company_id: 'company_synthetic', customer_id: 'customer_internal', customer_site_id: 'site_internal', metering_point_id: 'mp_internal', period_start: start, period_end: end, resolution: '1h', revision_status: status, quantity_kwh: quantityKwh, unit, direction, ...extra }
}

describe('F13 Partner measurements return only the current revision', () => {
  it('a corrected interval appears once with the current value', async () => {
    m.rows = [reading(0, 'replaced', 10), reading(0, 'current', 12), reading(1, 'void', 5), reading(2, 'superseded', 7), reading(2, 'current', 8)]
    const body = await measurements()
    expect(body.measurements.map((x: { value: number }) => x.value)).toEqual([12, 8])
    expect(validate(body)).toBe(true)
  })

  it('historical revisions are filtered before the row limit (cannot crowd out current rows)', async () => {
    m.rows = [...Array.from({ length: 40_000 }, () => reading(0, 'replaced', 1)), reading(0, 'current', 2)]
    const body = await measurements()
    expect(body.measurements).toEqual([expect.objectContaining({ value: 2 })])
  })

  it('other tenant rows are never returned', async () => {
    m.rows = [reading(0, 'current', 1, 'kWh', 'consumption', { company_id: 'company_other' }), reading(1, 'current', 2)]
    expect((await measurements()).measurements.map((x: { value: number }) => x.value)).toEqual([2])
  })
})

describe('F14 Partner measurement unit and direction', () => {
  it('value is always the canonical kWh quantity, labelled kWh, for Wh/kWh/MWh sources (no double conversion)', async () => {
    // quantity_kwh is already normalized at ingest (e.g. 500 Wh -> 0.5, 2 MWh -> 2000).
    m.rows = [reading(0, 'current', 0.5, 'Wh'), reading(1, 'current', 1.25, 'kWh'), reading(2, 'current', 2000, 'MWh')]
    const body = await measurements()
    expect(body.measurements.map((x: Row) => [x.value, x.unit])).toEqual([[0.5, 'kWh'], [1.25, 'kWh'], [2000, 'kWh']])
    expect(validate(body)).toBe(true)
  })

  it('directions match the published vocabulary; net series are explicitly excluded from the gross V1 response', async () => {
    m.rows = [reading(0, 'current', 1, 'kWh', 'consumption'), reading(0, 'current', 2, 'kWh', 'production'), reading(0, 'current', 3, 'kWh', 'net_consumption'), reading(0, 'current', 4, 'kWh', 'net_production')]
    const body = await measurements()
    expect(body.measurements.map((x: Row) => [x.type, x.value])).toEqual([['CONSUMPTION', 1], ['PRODUCTION', 2]])
    expect(validate(body)).toBe(true)
    expect(JSON.stringify(partnerOpenApi.paths['/customer/{customer_id}/site/{site_id}/measurement'])).toMatch(/net/i)
  })
})

describe('F79 Partner measurements return only values inside the site customer\'s access windows', () => {
  it('values of the same customer and site before the supply start or after its end, and the previous occupant\'s values, are not returned', async () => {
    // Supply 2026-01-01 01:00Z .. 03:00Z (exclusive) for the site customer; the previous occupant had the point before.
    m.windows = [
      { ...SUPPLY, from: '2026-01-01T01:00:00.000Z', to: '2026-01-01T03:00:00.000Z' },
      { ...SUPPLY, customer_id: 'customer_previous', from: '2025-01-01T00:00:00.000Z', to: '2026-01-01T01:00:00.000Z' },
    ]
    m.rows = [
      reading(0, 'current', 10), // same customer and site, before the supply start
      reading(1, 'current', 11),
      reading(2, 'current', 12),
      reading(3, 'current', 13), // same customer and site, after the supply end
      reading(0, 'current', 99, 'kWh', 'consumption', { customer_id: 'customer_previous' }), // previous occupant, same site
    ]
    const body = await measurements()
    expect(body.measurements.map((x: Row) => x.value)).toEqual([11, 12])
    expect(validate(body)).toBe(true)
  })

  it('the access function receives the site customer and site as scope with the Stockholm day bounds; the table is never read directly', async () => {
    m.rows = [reading(1, 'current', 1)]
    expect((await measurements()).measurements.map((x: Row) => x.value)).toEqual([1])
    expect(m.fromTables).not.toContain('normalized_metering_values')
    expect(m.rpcCalls.length).toBeGreaterThanOrEqual(1)
    for (const call of m.rpcCalls) {
      expect(call).toEqual({ name: NORMALIZED_RPC, args: expect.objectContaining({
        p_company_id: 'company_synthetic', p_customer_ids: ['customer_internal'], p_customer_site_id: 'site_internal',
        p_period_start_from: '2025-12-31T23:00:00.000Z', p_period_start_before: '2026-01-01T23:00:00.000Z',
        p_facility_id: null, p_before_period_start: null, p_before_id: null, p_limit: null,
      }) })
    }
  })

  it('without any access window the site customer gets an empty, valid response', async () => {
    m.windows = []
    m.rows = [reading(0, 'current', 1), reading(1, 'current', 2)]
    const body = await measurements()
    expect(body.measurements).toEqual([])
    expect(validate(body)).toBe(true)
  })
})
