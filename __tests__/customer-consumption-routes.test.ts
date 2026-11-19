import { writeFileSync } from 'node:fs'
import contract from '@/docs/openapi/customer-consumption-v1.json'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
const state = vi.hoisted(() => ({ result: [] as Array<Record<string, unknown>>, calls: [] as Array<{ table: string; filters: Array<[string, unknown]> }>, authenticated: true, customer: 'customer-a' }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => {
  const call = { table, filters: [] as Array<[string, unknown]> }; state.calls.push(call)
  const methods: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'or', 'gte', 'lte', 'order', 'limit']) methods[method] = (...args: unknown[]) => { call.filters.push([method, args]); return methods }
  methods.then = (resolve: (result: unknown) => unknown) => resolve(state.result.shift() ?? { data: [], count: 0, error: null })
  return methods
} } }))
vi.mock('@/lib/customer-portal/externalApi', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/customer-portal/externalApi')>()
  return { ...actual, requireCustomerPortalApiContext: vi.fn(async () => state.authenticated ? { ok: true, client: { company_id: 'company-a' }, identity: { customer_id: state.customer }, startedAt: 1 } : { ok: false, response: NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 }) }), logCustomerPortalSuccess: vi.fn(), handleCustomerPortalRouteError: ({ error }: { error: { status?: number; code?: string; message?: string } }) => NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status ?? 500 }) }
})
import { GET as customerConsumptionSites } from '@/app/api/v1/customer/consumption/sites/route'
import { GET as customerConsumptionMeteringValues } from '@/app/api/v1/customer/consumption/metering-values/route'
import { requireCustomerPortalApiContext } from '@/lib/customer-portal/externalApi'
const site = { id: '00000000-0000-4000-8000-000000000003', company_id: 'company-a', customer_id: 'customer-a', facility_id: 'FAC-A', created_at: '2026-11-01T00:00:00Z' }
const point = { id: 'point-a', company_id: 'company-a', customer_site_id: site.id }
const period = { id: 'period-a', company_id: 'company-a', customer_id: 'customer-a', metering_point_id: point.id, status: 'active', market_start_at: '2026-10-31T23:00:00Z', actual_start_date: '2026-11-01' }
const value = { id: '00000000-0000-4000-8000-000000000001', company_id: 'company-a', customer_id: 'customer-a', metering_point_id: point.id, period_start: '2026-11-02T00:00:00Z', period_end: '2026-11-02T01:00:00Z', quantity_kwh: 7.5, revision_status: 'current', direction: 'consumption', unit: 'kWh', status: 'stored' }
const ok = (data: unknown[], count = data.length) => ({ data, count, error: null })
const captured: Array<{ path: string; body: unknown }> = []
afterAll(() => { if (process.env.GRIDEX_CONSUMPTION_COMPONENT_CAPTURE) writeFileSync(process.env.GRIDEX_CONSUMPTION_COMPONENT_CAPTURE, JSON.stringify(captured), { mode: 0o600 }) })
function assertPageContract(page: Record<string, unknown>) {
  const schema = contract.components.schemas.Page
  expect(Object.keys(page).filter(key => !(key in schema.properties))).toEqual([])
  for (const key of schema.required) expect(page).toHaveProperty(key)
}
const request = (path: string) => new NextRequest(`https://ops.example/api/v1/customer/consumption/${path}`)
const meterPath = 'metering-values?facility_id=FAC-A&from=2026-11-01T00:00:00Z&to=2026-11-08T00:00:00Z'
beforeEach(() => { state.result = []; state.calls = []; state.authenticated = true; state.customer = 'customer-a'; vi.clearAllMocks() })
describe('customer consumption supplement routes', () => {
  it('returns confirmed windows and only public references, with both read scopes and strict binding', async () => {
    state.result = [ok([site]), ok([point]), ok([period])]
    const response = await customerConsumptionSites(request('sites')); expect(response.status).toBe(200)
    const body = await response.json(); captured.push({ path: '/api/v1/customer/consumption/sites', body }); assertPageContract(body.page.sites); expect(body.data.delivery_access.complete).toBe(true); expect(body.data.delivery_access.windows).toHaveLength(1)
    expect(body.data.delivery_access.windows[0].facility_reference).toBe(body.data.sites[0].facility_reference)
    expect(body.data.delivery_access.windows[0].metering_point_reference).toBe(body.data.metering_points[0].metering_point_reference)
    expect(JSON.stringify(body)).not.toContain('customer-a'); expect(JSON.stringify(body)).not.toContain('company-a')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(requireCustomerPortalApiContext).toHaveBeenCalledWith(expect.anything(), ['customer_sites.read', 'customer_metering.read'], { enforceBinding: true })
    for (const call of state.calls) expect(call.filters).toContainEqual(['eq', ['company_id', 'company-a']])
    expect(state.calls[2].filters).toContainEqual(['eq', ['customer_id', 'customer-a']])
  })
  it('never treats a truncated authority query as complete', async () => {
    state.result = [ok([site]), ok([point], 1001)]
    const response = await customerConsumptionSites(request('sites')); expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('FAC-A'); expect(state.calls).toHaveLength(2)
  })
  it('does not publish another customers meter metadata on a shared site', async () => {
    state.result = [ok([site]), ok([point]), ok([])]
    const body = await (await customerConsumptionSites(request('sites'))).json()
    expect(body.data.metering_points).toEqual([]); expect(body.data.delivery_access.windows).toEqual([])
  })
  it('returns actual revision fields and quantity only inside confirmed supply', async () => {
    state.result = [ok([site]), ok([point]), ok([period]), ok([value])]
    const response = await customerConsumptionMeteringValues(request(meterPath)); expect(response.status).toBe(200)
    const body = await response.json(); captured.push({ path: '/api/v1/customer/consumption/metering-values', body }); assertPageContract(body.page); expect(body.data[0]).toMatchObject({ quantity_kwh: 7.5, revision_status: 'current', direction: 'consumption', unit: 'kWh' })
    expect(state.calls[3].filters).toContainEqual(['eq', ['customer_id', 'customer-a']])
    expect(state.calls[3].filters).toContainEqual(['eq', ['direction', 'consumption']])
  })
  it('drops out-of-supply values without incorrectly marking a scanned page complete', async () => {
    state.result = [ok([site]), ok([point]), ok([{ ...period, actual_start_date: '2026-11-05' }]), ok([value, { ...value, id: '00000000-0000-4000-8000-000000000002' }])]
    const body = await (await customerConsumptionMeteringValues(request(`${meterPath}&limit=1`))).json()
    expect(body.data).toEqual([]); expect(body.page.returned).toBe(0); expect(body.page.has_more).toBe(true); expect(body.page.next_cursor).toBeTypeOf('string')
  })
  it('never returns foreign tenant/customer rows even after a malformed database result', async () => {
    state.result = [ok([site]), ok([point]), ok([period]), ok([{ ...value, customer_id: 'customer-b' }])]
    const response = await customerConsumptionMeteringValues(request(meterPath)); expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('customer-b')
  })
  it.each(['sites?customer_id=customer-b', 'sites?limit=1&limit=2', 'sites?limit=101'])('rejects unsupported selection %s', async path => {
    const response = await customerConsumptionSites(request(path)); expect(response.status).toBe(400); expect(state.calls).toHaveLength(0)
  })
  it('returns private 401 before a database read when the client is unauthenticated', async () => {
    state.authenticated = false
    const response = await customerConsumptionSites(request('sites')); expect(response.status).toBe(401); expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(state.calls).toHaveLength(0)
  })
  it('binds site cursors to the original customer', async () => {
    state.result = [ok([site, { ...site, id: '00000000-0000-4000-8000-000000000002' }]), ok([point]), ok([period])]
    const first = await (await customerConsumptionSites(request('sites?limit=1'))).json()
    expect(first.page.sites.has_more).toBe(true)
    state.customer = 'customer-b'; state.calls = []
    const response = await customerConsumptionSites(request('sites?cursor=' + encodeURIComponent(first.page.sites.next_cursor)))
    expect(response.status).toBe(400); expect(state.calls).toHaveLength(0)
  })
  it('returns 404 for a facility outside the verified customer', async () => {
    state.result = [ok([])]; state.customer = 'customer-b'
    const response = await customerConsumptionMeteringValues(request(meterPath)); expect(response.status).toBe(404)
    expect(state.calls[0].filters).toContainEqual(['eq', ['customer_id', 'customer-b']])
  })
  it('rejects impossible dates and excessive periods before database reads', async () => {
    for (const path of [meterPath.replace('2026-11-01', '2026-02-30'), meterPath.replace('2026-11-08', '2026-12-31')]) {
      expect((await customerConsumptionMeteringValues(request(path))).status).toBe(400)
    }
    expect(state.calls).toHaveLength(0)
  })
  it('fails closed with a sanitized private error on canonical read failure', async () => {
    state.result = [{ error: { message: 'SECRET database tenant details' }, data: null }]
    const response = await customerConsumptionSites(request('sites')); expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(JSON.stringify(await response.json())).not.toContain('SECRET')
  })
})

describe('consumption through a source-confirmed move-in', () => {
  const newSite = {
    ...site,
    id: '00000000-0000-4000-8000-000000000007',
    facility_id: 'FAC-B',
    created_at: '2026-11-10T00:00:00Z',
  }
  const newPoint = { ...point, id: 'point-b', customer_site_id: newSite.id }
  const pending = {
    ...period,
    id: 'period-b',
    metering_point_id: newPoint.id,
    status: 'confirmed_by_grid_owner',
    actual_start_date: null,
    market_start_at: '2026-11-30T23:00:00Z',
  }
  const active = { ...pending, status: 'active', actual_start_date: '2026-12-01' }
  const newMeterPath = 'metering-values?facility_id=FAC-B&from=2026-11-30T22:00:00Z&to=2026-12-02T00:00:00Z'
  const atStart = {
    ...value,
    id: '00000000-0000-4000-8000-000000000008',
    metering_point_id: newPoint.id,
    period_start: '2026-11-30T23:00:00Z',
    period_end: '2026-11-30T23:15:00Z',
  }
  const beforeStart = {
    ...atStart,
    id: '00000000-0000-4000-8000-000000000009',
    period_start: '2026-11-30T22:45:00Z',
    period_end: '2026-11-30T23:00:00Z',
  }

  it('keeps the earlier supply discoverable while the new site awaits activation', async () => {
    for (const newPeriod of [{ ...pending, status: 'planned' }, pending]) {
      state.result = [ok([newSite, site]), ok([newPoint, point]), ok([newPeriod, period])]
      const response = await customerConsumptionSites(request('sites'))
      expect(response.status).toBe(200)
      const body = await response.json()
      assertPageContract(body.page.sites)
      expect(body.data.sites.map((entry: { facility_id: string }) => entry.facility_id)).toEqual(['FAC-B', 'FAC-A'])
      const oldReference = body.data.sites[1].facility_reference
      expect(body.data.metering_points).toHaveLength(1)
      expect(body.data.metering_points[0].facility_reference).toBe(oldReference)
      expect(body.data.delivery_access.complete).toBe(true)
      expect(body.data.delivery_access.windows).toEqual([
        expect.objectContaining({ facility_reference: oldReference, from: '2026-10-31T23:00:00.000Z' }),
      ])
    }

    state.result = [ok([site]), ok([point]), ok([period]), ok([value])]
    const priorHistory = await customerConsumptionMeteringValues(request(meterPath))
    expect(priorHistory.status).toBe(200)
    expect((await priorHistory.json()).data).toEqual([expect.objectContaining({ quantity_kwh: 7.5 })])

    state.result = [ok([newSite, site]), ok([newPoint, point]), ok([active, period])]
    const activated = await customerConsumptionSites(request('sites'))
    expect(activated.status).toBe(200)
    const body = await activated.json()
    expect(body.data.metering_points).toHaveLength(2)
    expect(body.data.delivery_access.windows).toHaveLength(2)
    expect(body.data.delivery_access.windows).toContainEqual(expect.objectContaining({
      facility_reference: body.data.sites[0].facility_reference,
      from: '2026-11-30T23:00:00.000Z',
    }))
  })

  it('keeps an empty new site readable and grants only values inside an activated period', async () => {
    const stages = [
      { supply: { ...pending, status: 'planned' }, values: [], returned: 0 },
      { supply: pending, values: [], returned: 0 },
      { supply: pending, values: [atStart, beforeStart], returned: 0 },
      { supply: active, values: [atStart, beforeStart], returned: 1 },
    ]
    for (const { supply, values, returned } of stages) {
      state.result = [ok([newSite]), ok([newPoint]), ok([supply]), ok(values)]
      const response = await customerConsumptionMeteringValues(request(newMeterPath))
      expect(response.status).toBe(200)
      const body = await response.json()
      assertPageContract(body.page)
      expect(body.page.returned).toBe(returned)
      expect(body.data).toEqual(returned ? [expect.objectContaining({ period_start: atStart.period_start })] : [])
    }
  })

  it.each([
    { ...pending, market_start_at: null },
    { ...pending, market_start_at: '2026-02-30T23:00:00Z' },
    { ...pending, status: 'active' },
    { ...pending, metering_point_id: 'unbound-point' },
    { ...pending, customer_id: 'unexpected-customer' },
  ])('holds the response when the period authority is actually incomplete', async (invalid) => {
    state.result = [ok([newSite, site]), ok([newPoint, point]), ok([invalid, period])]
    const response = await customerConsumptionSites(request('sites'))
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toMatchObject({ error: { code: 'consumption_unavailable' } })
  })
})

it('registers the independent consumption surface with its exact ordinary read scopes', async () => {
  const { publicRouteContract } = await import('@/lib/api/publicRouteRegistry')
  for (const path of ['/api/v1/customer/consumption/sites', '/api/v1/customer/consumption/metering-values']) {
    expect(publicRouteContract('GET', path)?.scopes).toEqual(['customer_sites.read', 'customer_metering.read'])
    expect(publicRouteContract('GET', path)?.rateLimitClass).toBe('read')
  }
  expect(publicRouteContract('GET', '/api/v1/openapi/customer-consumption-v1.json')?.scopes).toEqual([])
})
