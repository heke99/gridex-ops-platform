import { writeFileSync } from 'node:fs'
import contract from '@/docs/openapi/customer-consumption-v1.json'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
const state = vi.hoisted(() => ({ result: [] as Array<Record<string, unknown>>, calls: [] as Array<{ table: string; filters: Array<[string, unknown]> }>, authenticated: true, customer: 'customer-a', supportsAbort: false, principal: null as string | null, revision: null as string | null, onRead: undefined as ((table: string) => void) | undefined }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => {
  const call = { table, filters: [] as Array<[string, unknown]> }; state.calls.push(call)
  const methods: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'or', 'gte', 'lte', 'order', 'limit']) methods[method] = (...args: unknown[]) => { call.filters.push([method, args]); return methods }
  if (state.supportsAbort) methods.abortSignal = (signal: AbortSignal) => { call.filters.push(['abortSignal', signal]); return methods }
  methods.maybeSingle = () => ({
    ...methods,
    then: (resolve: (result: unknown) => unknown) => resolve({ data: state.revision ? { revision: state.revision } : null, error: null }),
  })
  methods.then = (resolve: (result: unknown) => unknown) => {
    state.onRead?.(table)
    return resolve(state.result.shift() ?? { data: [], count: 0, error: null })
  }
  return methods
}, rpc: (name: string, params: Record<string, unknown>) => {
  const call = { table: name, filters: [['rpc', params]] as Array<[string, unknown]> }; state.calls.push(call)
  const methods: Record<string, unknown> = {}
  if (state.supportsAbort) methods.abortSignal = (signal: AbortSignal) => { call.filters.push(['abortSignal', signal]); return methods }
  methods.then = (resolve: (result: unknown) => unknown) => {
    state.onRead?.(name)
    return resolve(state.result.shift() ?? { data: null, error: { code: 'PGRST202' } })
  }
  return methods
} } }))
vi.mock('@/lib/customer-portal/externalApi', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/customer-portal/externalApi')>()
  return { ...actual, requireCustomerPortalApiContext: vi.fn(async () => state.authenticated ? { ok: true, client: { company_id: 'company-a', id: 'integration-client' }, identity: { customer_id: state.customer, auth_user_id: state.principal }, startedAt: 1 } : { ok: false, response: NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 }) }), logCustomerPortalSuccess: vi.fn(), handleCustomerPortalRouteError: ({ error }: { error: { status?: number; code?: string; message?: string } }) => NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status ?? 500 }) }
})
import { customerConsumptionSites, customerConsumptionMeteringValues } from '@/lib/customer-portal/consumptionRoutes'
import { requireCustomerPortalApiContext } from '@/lib/customer-portal/externalApi'
const site = { id: '00000000-0000-4000-8000-000000000003', company_id: 'company-a', customer_id: 'customer-a', facility_id: 'FAC-A', created_at: '2026-11-01T00:00:00Z' }
const point = { id: 'point-a', company_id: 'company-a', customer_site_id: site.id }
const period = { id: 'period-a', company_id: 'company-a', customer_id: 'customer-a', metering_point_id: point.id, status: 'active', market_start_at: '2026-10-31T23:00:00Z', actual_start_date: '2026-11-01' }
const value = { id: '00000000-0000-4000-8000-000000000001', company_id: 'company-a', customer_id: 'customer-a', metering_point_id: point.id, period_start: '2026-11-02T00:00:00Z', period_end: '2026-11-02T01:00:00Z', quantity_kwh: 7.5, revision_status: 'current', direction: 'consumption', unit: 'kWh', status: 'stored' }
const ok = (data: unknown[], count = data.length) => ({ data, count, error: null })
const snapshotRpc = 'gridex_portal_consumption_authority_v1'
const authority = (points: unknown[], periods: unknown[], pointCount = points.length) => ({
  data: { points, periods, point_count: pointCount, period_count: periods.length }, error: null,
})
const captured: Array<{ path: string; body: unknown }> = []
afterAll(() => { if (process.env.GRIDEX_CONSUMPTION_COMPONENT_CAPTURE) writeFileSync(process.env.GRIDEX_CONSUMPTION_COMPONENT_CAPTURE, JSON.stringify(captured), { mode: 0o600 }) })
function assertPageContract(page: Record<string, unknown>) {
  const schema = contract.components.schemas.Page
  expect(Object.keys(page).filter(key => !(key in schema.properties))).toEqual([])
  for (const key of schema.required) expect(page).toHaveProperty(key)
}
const request = (path: string, signal?: AbortSignal) => new NextRequest(`https://ops.example/api/v1/customer/consumption/${path}`, { signal })
const meterPath = 'metering-values?facility_id=FAC-A&from=2026-11-01T00:00:00Z&to=2026-11-08T00:00:00Z'
beforeEach(() => { state.result = []; state.calls = []; state.authenticated = true; state.customer = 'customer-a'; state.supportsAbort = false; state.principal = null; state.revision = null; state.onRead = undefined; vi.clearAllMocks() })
describe('customer consumption supplement routes', () => {
  it('returns confirmed windows and only public references, with both read scopes and strict binding', async () => {
    state.result = [ok([site]), authority([point], [period])]
    const response = await customerConsumptionSites(request('sites')); expect(response.status).toBe(200)
    const body = await response.json(); captured.push({ path: '/api/v1/customer/consumption/sites', body }); assertPageContract(body.page.sites); expect(body.data.delivery_access.complete).toBe(true); expect(body.data.delivery_access.windows).toHaveLength(1)
    expect(body.data.delivery_access.windows[0].facility_reference).toBe(body.data.sites[0].facility_reference)
    expect(body.data.delivery_access.windows[0].metering_point_reference).toBe(body.data.metering_points[0].metering_point_reference)
    expect(JSON.stringify(body)).not.toContain('customer-a'); expect(JSON.stringify(body)).not.toContain('company-a')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(requireCustomerPortalApiContext).toHaveBeenCalledWith(expect.anything(), ['customer_sites.read', 'customer_metering.read'], { enforceBinding: true })
    expect(state.calls[0].filters).toContainEqual(['eq', ['company_id', 'company-a']])
    expect(state.calls[0].filters).toContainEqual(['eq', ['customer_id', 'customer-a']])
    expect(state.calls[1]).toEqual({ table: snapshotRpc, filters: [['rpc', { p_company_id: 'company-a', p_customer_id: 'customer-a', p_site_ids: [site.id] }]] })
  })
  it.each([
    [true, '2024-07-31T22:30:00.000Z'],
    [false, '2024-07-31T22:00:00.000Z'],
  ] as const)('asks for the exact pending market end on the same scope (verified=%s)', async (verified, cutoff) => {
    const pending = {
      ...period, status: 'ending', actual_start_date: '2024-07-01', actual_end_date: null,
      market_start_at: '2024-06-30T22:00:00Z', end_date: '2024-07-31',
      market_end_at: '2024-07-31T22:30:00Z', market_state_version: 2,
    }
    state.result = [ok([site]), authority([point], [pending]), ok(verified ? [{
      period_id: period.id, market_state_version: 2, effective_end_at: pending.market_end_at,
    }] : [])]
    const response = await customerConsumptionSites(request('sites'))
    expect(response.status).toBe(200)
    expect((await response.json()).data.delivery_access.windows[0].to).toBe(cutoff)
    expect(state.calls[2]).toEqual({ table: 'gridex_portal_verified_supply_ends_v1', filters: [[
      'rpc', { p_company_id: 'company-a', p_customer_id: 'customer-a', p_period_ids: [period.id] },
    ]] })
  })
  it.each([true, false])('stops after an aborted authority read (driver signal support: %s)', async supportsAbort => {
    state.supportsAbort = supportsAbort
    const controller = new AbortController()
    const incoming = request(meterPath, controller.signal)
    state.result = [ok([site]), authority([point], [period]), ok([value])]
    state.onRead = table => { if (table === snapshotRpc) controller.abort() }
    const response = await customerConsumptionMeteringValues(incoming)
    expect(response.status).toBe(499)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(state.calls.map(call => call.table)).toEqual(['customer_sites', snapshotRpc])
    for (const call of state.calls) {
      expect(call.filters.filter(([method]) => method === 'abortSignal')).toEqual(supportsAbort ? [['abortSignal', incoming.signal]] : [])
    }
  })
  it('does not authenticate or query an already aborted request', async () => {
    const response = await customerConsumptionSites(request('sites', AbortSignal.abort()))
    expect(response.status).toBe(499)
    expect(requireCustomerPortalApiContext).not.toHaveBeenCalled()
    expect(state.calls).toHaveLength(0)
  })
  it('reuses only a fresh page with the same binding, authority and metering revision', async () => {
    let now = Date.now()
    using clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    state.principal = 'auth-a'
    state.revision = '00000000-0000-4000-8000-000000000051'
    const read = async (supplyPeriod = period, quantity = 7.5) => {
      state.calls = []
      state.result = [ok([site]), authority([point], [supplyPeriod]), ok([{ ...value, quantity_kwh: quantity }])]
      const response = await customerConsumptionMeteringValues(request(meterPath))
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      const body = await response.json()
      return { body, queried: state.calls.some(call => call.table === 'normalized_metering_values') }
    }
    expect((await read()).queried).toBe(true)
    const repeat = await read()
    expect(repeat.queried).toBe(false)
    expect(repeat.body.data[0].quantity_kwh).toBe(7.5)
    expect(state.calls.map(call => call.table)).toEqual(['customer_sites', snapshotRpc, 'customer_consumption_cache_revisions'])

    state.principal = 'auth-b'
    expect((await read()).queried).toBe(true)
    const narrower = { ...period, actual_start_date: '2026-11-05' }
    const changedRights = await read(narrower)
    expect(changedRights.queried).toBe(true)
    expect(changedRights.body.data).toEqual([])

    state.revision = '00000000-0000-4000-8000-000000000052'
    const revised = await read(period, 8)
    expect(revised.queried).toBe(true)
    expect(revised.body.data[0].quantity_kwh).toBe(8)

    now += 15_001
    expect((await read(period, 8)).queried).toBe(true)
    state.revision = null
    expect((await read()).queried).toBe(true)
  })
  it('never treats a truncated authority query as complete', async () => {
    state.result = [ok([site]), authority([point], [], 1001)]
    const response = await customerConsumptionSites(request('sites')); expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('FAC-A'); expect(state.calls).toHaveLength(2)
  })
  it('does not publish another customers meter metadata on a shared site', async () => {
    state.result = [ok([site]), authority([point], [])]
    const body = await (await customerConsumptionSites(request('sites'))).json()
    expect(body.data.metering_points).toEqual([]); expect(body.data.delivery_access.windows).toEqual([])
  })
  it('returns actual revision fields and quantity only inside confirmed supply', async () => {
    state.result = [ok([site]), authority([point], [period]), ok([value])]
    const response = await customerConsumptionMeteringValues(request(meterPath)); expect(response.status).toBe(200)
    const body = await response.json(); captured.push({ path: '/api/v1/customer/consumption/metering-values', body }); assertPageContract(body.page); expect(body.data[0]).toMatchObject({ quantity_kwh: 7.5, revision_status: 'current', direction: 'consumption', unit: 'kWh' })
    const values = state.calls.find(call => call.table === 'normalized_metering_values')
    expect(values?.filters).toContainEqual(['eq', ['company_id', 'company-a']])
    expect(values?.filters).toContainEqual(['eq', ['customer_id', 'customer-a']])
    expect(values?.filters).toContainEqual(['eq', ['direction', 'consumption']])
  })
  it('drops out-of-supply values without incorrectly marking a scanned page complete', async () => {
    state.result = [ok([site]), authority([point], [{ ...period, actual_start_date: '2026-11-05' }]), ok([value, { ...value, id: '00000000-0000-4000-8000-000000000002' }])]
    const body = await (await customerConsumptionMeteringValues(request(`${meterPath}&limit=1`))).json()
    expect(body.data).toEqual([]); expect(body.page.returned).toBe(0); expect(body.page.has_more).toBe(true); expect(body.page.next_cursor).toBeTypeOf('string')
  })
  it('never returns foreign tenant/customer rows even after a malformed database result', async () => {
    state.result = [ok([site]), authority([point], [period]), ok([{ ...value, customer_id: 'customer-b' }])]
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
    state.result = [ok([site, { ...site, id: '00000000-0000-4000-8000-000000000002' }]), authority([point], [period])]
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

it('registers the independent consumption surface with its exact ordinary read scopes', async () => {
  const { publicRouteContract } = await import('@/lib/api/publicRouteRegistry')
  for (const path of ['/api/v1/customer/consumption/sites', '/api/v1/customer/consumption/metering-values']) {
    expect(publicRouteContract('GET', path)?.scopes).toEqual(['customer_sites.read', 'customer_metering.read'])
    expect(publicRouteContract('GET', path)?.rateLimitClass).toBe('read')
  }
  expect(publicRouteContract('GET', '/api/v1/openapi/customer-consumption-v1.json')?.scopes).toEqual([])
})
