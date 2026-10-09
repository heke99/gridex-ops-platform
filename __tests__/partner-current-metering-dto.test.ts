// ops-api-review: F13, F14
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import Ajv from 'ajv'

type Row = Record<string, unknown>
const m = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], limits: [] as number[], company: 'company_synthetic' }))
vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: vi.fn(async () => ({ ok: true, client: { id: 'client_synthetic', company_id: m.company } })),
  logIntegrationApiRequest: vi.fn(async () => {}),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = []
      let limit = Infinity
      const customer = { id: 'customer_internal', company_id: 'company_synthetic', customer_reference: 'customer_public', customer_type: 'private' }
      const site = { id: 'site_internal', company_id: 'company_synthetic', customer_id: 'customer_internal', facility_reference: 'site_public', site_type: 'consumption' }
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (k: string, v: unknown) => { filters.push((row) => row[k] === v); return b },
        in: (k: string, values: unknown[]) => { filters.push((row) => values.includes(row[k])); return b },
        gte: (k: string, v: string) => { filters.push((row) => String(row[k]) >= v); return b },
        lte: (k: string, v: string) => { filters.push((row) => String(row[k]) <= v); return b },
        order: () => b,
        limit: (n: number) => { limit = n; m.limits.push(n); return b },
        async maybeSingle() {
          const row = table === 'customers' ? customer : site
          return { error: null, data: filters.every((f) => f(row)) ? row : null }
        },
        // Filters run before the limit, as in the database.
        then: (resolve: (v: unknown) => unknown) => resolve({ error: null, data: m.rows.filter((row) => filters.every((f) => f(row))).slice(0, limit) }),
      }
      return b
    },
  },
}))
import { handleSimplePartnerApi } from '@/lib/partner-api/simple'
import { partnerOpenApi } from '@/lib/partner-api/openApi'

const schemas = JSON.parse(JSON.stringify(partnerOpenApi.components.schemas).replaceAll('#/components/schemas/', '#/definitions/'))
const validate = new Ajv({ allErrors: true, strict: false }).compile({ definitions: schemas, $ref: '#/definitions/MeasurementResponse' })

beforeEach(() => { m.rows = []; m.limits = []; m.company = 'company_synthetic' })

async function measurements() {
  const path = ['customer', 'customer_public', 'site', 'site_public', 'measurement']
  const r = await handleSimplePartnerApi(new NextRequest(`https://example.invalid/api/partner/v1/${path.join('/')}?from_date=2026-01-01&to_date=2026-01-01`), 'GET', path)
  expect(r!.status).toBe(200)
  return r!.json()
}
function reading(hour: number, status: string, quantityKwh: number, unit = 'kWh', direction = 'consumption', extra: Row = {}): Row {
  const start = new Date(Date.UTC(2026, 0, 1, hour)).toISOString()
  return { company_id: 'company_synthetic', customer_site_id: 'site_internal', period_start: start, resolution: '1h', revision_status: status, quantity_kwh: quantityKwh, unit, direction, ...extra }
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
