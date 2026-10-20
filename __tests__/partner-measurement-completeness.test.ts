/* eslint-disable @typescript-eslint/no-explicit-any -- paged PostgREST test port */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { sortRows } from './helpers/postgrestOrFilter'

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({
  rows: [] as Row[], cap: 1000, pages: [] as number[], failOffset: -1, repeat: false,
  timestamps: new WeakMap<Row, Map<string, { raw: string; parsed: number }>>(),
  requestRows: new Map<string, Row[]>(),
}))

function rowTimestamp(row: Row, column: string): number {
  const raw = String(row[column])
  let columns = state.timestamps.get(row)
  const cached = columns?.get(column)
  if (cached?.raw === raw) return cached.parsed
  if (!columns) {
    columns = new Map()
    state.timestamps.set(row, columns)
  }
  const parsed = Date.parse(raw)
  columns.set(column, { raw, parsed })
  return parsed
}
vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: vi.fn(async () => ({ ok: true, client: { id: 'client_synthetic', company_id: 'company_synthetic' } })),
  logIntegrationApiRequest: vi.fn(async () => {}),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    const filters: Array<(row: Row) => boolean> = []
    const filterKeys: unknown[][] = []
    const orders: Array<{ column: string; ascending: boolean }> = []
    let offset = 0, limit = Infinity
    const q: any = {
      select: () => q,
      eq: (k: string, v: unknown) => { filterKeys.push(['eq', k, v]); filters.push(r => r[k] === v); return q },
      in: (k: string, vs: unknown[]) => { filterKeys.push(['in', k, vs]); filters.push(r => vs.includes(r[k])); return q },
      gte: (k: string, v: string) => { filterKeys.push(['gte', k, v]); const boundary = Date.parse(v); filters.push(r => rowTimestamp(r, k) >= boundary); return q },
      lt: (k: string, v: string) => { filterKeys.push(['lt', k, v]); const boundary = Date.parse(v); filters.push(r => rowTimestamp(r, k) < boundary); return q },
      order: (column: string, options: { ascending: boolean }) => { orders.push({ column, ascending: options.ascending }); return q },
      limit: (n: number) => { limit = n; return q },
      range: (from: number, to: number) => { offset = from; limit = to - from + 1; return q },
      async maybeSingle() {
        const customer = { id: 'customer_internal', company_id: 'company_synthetic', customer_reference: 'customer_public' }
        const row = table === 'customers' ? customer : { id: 'site_internal', company_id: 'company_synthetic', customer_id: customer.id, facility_reference: 'site_public', site_type: 'consumption' }
        return { data: filters.every(f => f(row)) ? row : null, error: null }
      },
      then(resolve: (v: unknown) => unknown) {
        state.pages.push(offset)
        if (offset === state.failOffset) return Promise.resolve({ data: null, error: { code: '08006', message: 'synthetic page outage' } }).then(resolve)
        const key = JSON.stringify([table, filterKeys, orders])
        let rows = state.requestRows.get(key)
        if (rows === undefined) {
          rows = sortRows(state.rows.filter(r => filters.every(f => f(r))), orders)
          state.requestRows.set(key, rows)
        }
        const start = state.repeat ? 0 : offset
        return Promise.resolve({ data: rows.slice(start, start + Math.min(limit, state.cap)), error: null }).then(resolve)
      },
    }
    return q
  },
} }))
import { handleSimplePartnerApi } from '@/lib/partner-api/simple'
import { handlePartnerApi } from '@/lib/partner-api/core'

beforeEach(() => { state.rows = []; state.cap = 1000; state.pages = []; state.failOffset = -1; state.repeat = false; state.timestamps = new WeakMap(); state.requestRows = new Map(); vi.spyOn(console, 'error').mockImplementation(() => {}) })
function reading(i: number, extra: Row = {}): Row & { id: string; period_start: string } {
  return { id: `e0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, company_id: 'company_synthetic', customer_site_id: 'site_internal', period_start: new Date(Date.UTC(2026, 0, 1) + Math.floor(i / 2) * 900000).toISOString(), period_end: new Date(Date.UTC(2026, 0, 1) + (Math.floor(i / 2) + 1) * 900000).toISOString(), resolution: '15m', revision_status: 'current', quantity_kwh: i + 1, direction: i % 2 ? 'production' : 'consumption', unit: 'kWh', ...extra }
}
async function read(legacy = false) {
  state.requestRows = new Map()
  const path = legacy ? ['sites', 'site_public', 'measurements'] : ['customer', 'customer_public', 'site', 'site_public', 'measurement']
  const request = new NextRequest(`https://example.invalid/api/partner/v1/${path.join('/')}?from_date=2026-01-01&to_date=2026-12-31&resolution=15m`)
  return (legacy ? handlePartnerApi(request, 'GET', path) : handleSimplePartnerApi(request, 'GET', path))
}
describe('Partner measurements return the complete supported range', () => {
  it.each([false, true])('reads 1100 rows across the backend cap (legacy=%s)', async legacy => {
    state.rows = Array.from({ length: 1100 }, (_, i) => reading(i))
    const r = (await read(legacy))!
    expect(r.status).toBe(200)
    const body = await r.json(), measurements = legacy ? body.data.measurements : body.measurements
    expect(measurements).toHaveLength(1100)
    expect(measurements.at(-1).value).toBe(1100)
    expect(state.pages).toEqual([0, 1000, 1100])
    expect(measurements[0]).not.toHaveProperty('id')
  })
  it('continues after short pages when the backend cap is smaller than the requested page', async () => {
    state.cap = 137
    state.rows = Array.from({ length: 300 }, (_, i) => reading(i))
    const r = (await read())!
    expect(r.status).toBe(200)
    expect((await r.json()).measurements).toHaveLength(300)
    expect(state.pages).toEqual([0, 137, 274, 300])
  })
  it('includes more than the old 40000 cap without changing the public DTO', async () => {
    state.rows = Array.from({ length: 41000 }, (_, i) => reading(i))
    const r = (await read())!
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(Object.keys(body)).toEqual(['site_id', 'measurements'])
    expect(body.measurements).toHaveLength(41000)
    expect(body.measurements.at(-1).value).toBe(41000)
  })
  it('filters foreign tenants, sites, historical revisions and net series before paging', async () => {
    state.cap = 1
    state.rows = [reading(0, { company_id: 'foreign' }), reading(1, { customer_site_id: 'foreign' }), reading(2, { revision_status: 'replaced' }), reading(3, { direction: 'net_consumption' }), reading(4), reading(5)]
    const r = (await read())!
    expect(r.status).toBe(200)
    expect((await r.json()).measurements.map((r: Row) => r.value)).toEqual([5, 6])
  })
  it.each([false, true])('keeps the Swedish date range inclusive at its start and exclusive at its end (legacy=%s)', async legacy => {
    state.cap = 1
    state.rows = [
      reading(0, { period_start: '2025-12-31T22:45:00.000Z', period_end: '2025-12-31T23:00:00.000Z' }),
      reading(1, { period_start: '2025-12-31T23:00:00.000Z', period_end: '2025-12-31T23:15:00.000Z' }),
      reading(2, { period_start: '2026-12-31T22:45:00.000Z', period_end: '2026-12-31T23:00:00.000Z' }),
      reading(3, { period_start: '2026-12-31T23:00:00.000Z', period_end: '2026-12-31T23:15:00.000Z' }),
      reading(4, { period_start: 'invalid-timestamp' }),
    ]
    const response = (await read(legacy))!
    expect(response.status).toBe(200)
    const body = await response.json()
    expect((legacy ? body.data.measurements : body.measurements).map((row: Row) => row.value)).toEqual([2, 3])
    expect(state.pages).toEqual([0, 1, 2])
  })
  it('rechecks date scope when a source timestamp changes without replacing the row or array', async () => {
    const row = reading(0)
    state.rows = [row]
    const first = (await read())!
    expect(first.status).toBe(200)
    expect((await first.json()).measurements).toHaveLength(1)
    row.period_start = '2027-01-01T00:00:00.000Z'
    const outside = (await read())!
    expect(outside.status).toBe(200)
    expect((await outside.json()).measurements).toEqual([])
    row.period_start = '2026-01-02T00:00:00.000Z'
    const returned = (await read())!
    expect(returned.status).toBe(200)
    expect((await returned.json()).measurements.map((row: Row) => row.value)).toEqual([1])
  })
  it('fails the whole response when a later page fails instead of returning partial data', async () => {
    state.rows = Array.from({ length: 1100 }, (_, i) => reading(i)); state.failOffset = 1000
    const r = (await read())!
    expect(r.status).toBe(503)
    const body = await r.json()
    expect(body.error.code).toBe('measurement_read_incomplete')
    expect(body).not.toHaveProperty('measurements')
  })
  it('rejects a backend that repeats a page without progress', async () => {
    state.rows = [reading(0), reading(1)]; state.cap = 1; state.repeat = true
    const r = (await read())!
    expect(r.status).toBe(503)
    expect((await r.json()).error.code).toBe('measurement_read_incomplete')
    expect(state.pages).toHaveLength(2)
  })
})

describe('Partner measurement paging safety bounds', () => {
  it('fails honestly when the finite row safety bound is exceeded', async () => {
    const { readCompletePartnerMeasurements } = await import('@/lib/partner-api/measurementRead')
    await expect(readCompletePartnerMeasurements(async (offset, size) => ({
      data: Array.from({ length: Math.min(size, 150001 - offset) }, (_, index) => reading(offset + index)), error: null,
    }))).rejects.toMatchObject({ status: 503, code: 'measurement_read_incomplete' })
  })
  it('bounds the number of pages even when a backend returns only one row per page', async () => {
    const { readCompletePartnerMeasurements } = await import('@/lib/partner-api/measurementRead')
    let calls = 0
    await expect(readCompletePartnerMeasurements(async offset => { calls += 1; return { data: [reading(offset)], error: null } })).rejects.toMatchObject({ status: 503, code: 'measurement_read_incomplete' })
    expect(calls).toBe(2000)
  })
})
