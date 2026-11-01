// Actual POST + actual underlay engine; finite Auth/DB ports only, no service or native proof.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { getEventListeners } from 'node:events'

type Row = Record<string, unknown>
type RpcResult = { data: unknown; error: unknown }
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>, calls: [] as Array<{ name: string; args: Row }>,
  rpc: null as null | (() => Promise<RpcResult>), denied: 0, authError: null as Error | null,
  companyError: null as Error | null, periodError: null as Error | null, identityError: false,
}))
vi.mock('node:crypto', async importOriginal => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return { ...actual, randomUUID: () => { if (io.identityError) throw new Error('identity unavailable'); return actual.randomUUID() } }
})
function builder(table: string) {
  const eqs: Array<[string, unknown]> = []
  const rows = () => (io.tables[table] ?? []).filter(row => eqs.every(([key, value]) => row[key] === value))
  const result = async () => ({ data: rows(), error: null })
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'in', 'not', 'lt', 'lte', 'gt', 'gte', 'or', 'order', 'limit', 'is', 'neq']) chain[method] = () => chain
  chain.eq = (key: string, value: unknown) => { eqs.push([key, value]); return chain }
  chain.range = result
  chain.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null })
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => result().then(resolve, reject)
  return chain
}
vi.mock('@/lib/admin/apiGuards', () => ({
  requireAdminApiAccess: async (permissions: string[]) => {
    expect(permissions).toEqual(['billing_underlay.export'])
    if (io.authError) throw io.authError
    return { guard: { userId: 'private-actor' }, response: io.denied ? new Response('denied', { status: io.denied }) : null }
  },
  requireAdminOperationalCompany: async () => { if (io.companyError) throw io.companyError; return 'private-company' },
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => builder(table),
  rpc: (name: string, args: Row) => {
    io.calls.push({ name, args })
    if (io.rpc) return io.rpc()
    return Promise.resolve({ data: (args.p_commands as unknown[]).map((_, i) => `private-underlay-${i}`), error: null })
  },
} }))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/billing/invoiceReadiness', () => ({
  assertBillingPeriodOpen: async () => { if (io.periodError) throw io.periodError }, getBillingPeriodLock: async () => null,
}))
vi.mock('@/lib/billing/sourceBasis', () => ({
  loadQualifiedBillingValues: async (_company: string, ids: string[]) => new Map(ids.map(id => [id, io.tables.normalized_metering_values.find(row => row.id === id)])),
}))
vi.mock('@/lib/billing/billingGate', () => ({ evaluateBillingGate: () => ({ eligible: true, reasons: [] }) }))
vi.mock('@/lib/billing/consumptionEstimate', () => ({ companyEstimatesMissingConsumption: async () => false }))
vi.mock('@/lib/billing/historyRequest', () => ({ ensureHistoricalMeteringRequest: async () => { throw new Error('unexpected history effect') } }))

import { POST } from '@/app/api/internal/billing/generate-underlay/route'

const correlation = '10000000-0000-4000-8000-000000000001'
const correlation2 = '10000000-0000-4000-8000-000000000002'
let lines: unknown[][] = []
type Event = { schema: string; event: string; correlationId: string | null; attemptId: string; bootId: string; pid: number; sequence: number; engineState: string; status: number | null; abortWhilePending: boolean }
function events(): Event[] {
  return lines.flatMap(args => {
    if (args.length !== 1 || typeof args[0] !== 'string') return []
    try { const value = JSON.parse(args[0]); return value.schema === 'billing_underlay_operation_v1' ? [value] : [] } catch { return [] }
  })
}
function request(id: string | null = correlation, controller = new AbortController(), body = JSON.stringify({ billing_month: '2026-09' })) {
  return new Request('http://unit.invalid/api/internal/billing/generate-underlay', {
    method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json', ...(id === null ? {} : { 'x-request-id': id }) }, body,
  })
}
function deferred() {
  let resolve!: (v: RpcResult) => void, reject!: (e: Error) => void
  const promise = new Promise<RpcResult>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function pending(req = request()) {
  const rpc = deferred(); io.rpc = () => rpc.promise
  let done = false
  const response = POST(req).finally(() => { done = true })
  await vi.waitFor(() => expect(io.calls.length).toBe(1))
  expect(io.calls[0].name).toBe('gridex_store_billing_underlay_batch')
  expect(io.calls[0].args.p_company_id).toBe('private-company')
  expect(io.calls[0].args.p_actor_user_id).toBe('private-actor')
  return { rpc, response, done: () => done }
}
const success = { data: ['private-underlay-0'], error: null }
async function successful(req = request()) {
  const response = await POST(req)
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.data.billingMonth).toBe('2026-09')
  expect(body.data.results[0].underlayId).toBe('private-underlay-0')
  expect(io.calls.length).toBe(1)
  return response
}
beforeEach(() => {
  lines = []; io.calls = []; io.rpc = null; io.denied = 0; io.authError = null; io.companyError = null; io.periodError = null; io.identityError = false
  vi.spyOn(console, 'info').mockImplementation((...args) => { lines.push(args) })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected network request'))
  io.tables = {
    normalized_metering_values: [{ id: 'value', company_id: 'private-company', customer_id: 'customer', metering_point_id: 'point', supply_period_id: 'supply', site_id: 'site', customer_site_id: 'site', period_start: '2026-08-31T22:00:00.000Z', period_end: '2026-09-30T22:00:00.000Z', quantity_kwh: '612.5', unit: 'kWh', direction: 'consumption', revision_status: 'current', billing_status: 'billable', billing_gate_status: 'eligible', billing_gate_snapshot: { status: 'eligible' }, price_area: 'SE3', metadata: {} }],
    customer_supply_periods: [{ id: 'supply', company_id: 'private-company', customer_id: 'customer', metering_point_id: 'point', contract_id: 'contract', site_id: 'site', customer_site_id: 'site', status: 'active', start_date: '2026-09-01', end_date: null }],
    customer_contracts: [{ id: 'contract', company_id: 'private-company', customer_id: 'customer', metering_point_id: 'point', status: 'active', starts_at: '2026-09-01', energy_direction: 'consumption', price_plan_id: 'plan' }],
    contract_price_snapshots: [{ id: 'snapshot', company_id: 'private-company', contract_id: 'contract', price_plan_version_id: 'version', valid_from: '2026-09-01', valid_to: null, pricing_model: 'spot', snapshot_schema_version: 'gridex_contract_pricing_v7_signed_receipt', snapshot_json: { snapshot_schema: 'gridex_contract_pricing_v7_signed_receipt', pricing_model: 'spot', price_area: 'SE3', energy_direction: 'consumption', markup_ore_per_kwh: 4.9, interval_resolution: 'monthly', vat_rate: 25 } }],
    billing_underlays: [], billing_underlay_items: [],
  }
})
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.restoreAllMocks() })

describe('original underlay operation observation without business interference', () => {
  it('observes actual pending abort and only the actual final RPC completion permits a terminal', async () => {
    const controller = new AbortController(), req = request(correlation, controller)
    const run = await pending(req)
    expect(getEventListeners(req.signal, 'abort')).toHaveLength(1)
    const add = vi.spyOn(req.signal, 'addEventListener'), remove = vi.spyOn(req.signal, 'removeEventListener')
    // The listener was installed before reaching the final RPC; inspect its eventual removal.
    controller.abort()
    expect(run.done()).toBe(false)
    expect(events().map(e => e.event)).toEqual(['started', 'client_disconnected'])
    expect(events()[1].abortWhilePending).toBe(true)
    expect(events().every(e => e.engineState === 'pending')).toBe(true)
    run.rpc.resolve(success)
    expect((await run.response).status).toBe(200)
    expect(events().map(e => e.event)).toEqual(['started', 'client_disconnected', 'terminal'])
    expect(events().map(e => e.sequence)).toEqual([1, 2, 3])
    expect(events()[2]).toMatchObject({ engineState: 'fulfilled', status: 200, correlationId: correlation })
    expect(new Set(events().map(e => e.attemptId)).size).toBe(1)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(getEventListeners(req.signal, 'abort')).toHaveLength(0)
    expect(add).not.toHaveBeenCalled()
    expect(io.calls.length).toBe(1)
  })
  it('does not infer terminal from time or a still empty controlled graph', async () => {
    const run = await pending(); await new Promise(resolve => setTimeout(resolve, 15))
    expect(io.tables.billing_underlays).toEqual([])
    expect(events().map(e => e.event)).toEqual(['started'])
    expect(run.done()).toBe(false)
    run.rpc.resolve(success); await run.response
  })
  it.each(['promise', 'returned', 'count'] as const)('keeps %s RPC failure at500 and never labels engine fulfilled', async kind => {
    const run = await pending()
    if (kind === 'promise') run.rpc.reject(new Error('remote timeout private-value'))
    else run.rpc.resolve(kind === 'returned' ? { data: null, error: new Error('remote error') } : { data: [], error: null })
    const response = await run.response
    expect(response.status).toBe(500)
    expect((await response.json()).code).toBe('billing_underlay_generate_failed')
    expect(events().at(-1)).toMatchObject({ event: 'terminal', engineState: 'rejected', status: 500 })
  })
  it('records response construction failure after fulfilled engine as500', async () => {
    const json = NextResponse.json.bind(NextResponse)
    vi.spyOn(NextResponse, 'json').mockImplementationOnce(() => { throw new Error('response failure') }).mockImplementation(json)
    expect((await POST(request())).status).toBe(500)
    expect(events().at(-1)).toMatchObject({ engineState: 'fulfilled', status: 500 })
  })
  it.each([401, 403])('preserves denied%d with no engine', async status => {
    io.denied = status; const response = await POST(request()); expect(response.status).toBe(status); expect(await response.text()).toBe('denied')
    expect(io.calls).toEqual([]); expect(events().at(-1)).toMatchObject({ engineState: 'not_entered', status })
  })
  it.each(['{}', '{invalid'])('preserves invalid month400 for %s', async body => {
    const response = await POST(request(correlation, undefined, body)); expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'billing_month måste anges som YYYY-MM.' }); expect(io.calls).toEqual([])
  })
  it('preserves billingMonth alias and ignores diagnostic metadata in engine args', async () => {
    await successful(request(correlation, undefined, JSON.stringify({ billingMonth: '2026-09', extra: 'do-not-log' })))
    expect(Object.keys(io.calls[0].args).sort()).toEqual(['p_actor_user_id', 'p_commands', 'p_company_id'])
  })
  it('preserves period lock409', async () => {
    io.periodError = new Error('Fakturaperioden 2026-09 är locked')
    const response = await POST(request()); expect(response.status).toBe(409); expect(io.calls).toEqual([])
    expect(events().at(-1)).toMatchObject({ engineState: 'rejected', status: 409 })
  })
  it('preserves company failure500 and auth throw identity', async () => {
    io.companyError = new Error('company refusal'); expect((await POST(request())).status).toBe(500)
    io.companyError = null; io.authError = new Error('auth throw')
    await expect(POST(request())).rejects.toBe(io.authError)
    expect(events().at(-1)).toMatchObject({ engineState: 'not_entered', status: null })
  })
  it.each([null, 'bad', 'secret-value'.repeat(800)])('malformed/absent correlation never changes successful business response (%s)', async id => {
    await successful(request(id)); expect(events().every(e => e.correlationId === null)).toBe(true)
    expect(JSON.stringify(events())).not.toContain('secret-value')
  })
  it('keeps two concurrent requests and their original attempts distinct', async () => {
    const gates = [deferred(), deferred()]; io.rpc = () => gates[io.calls.length - 1].promise
    const one = POST(request(correlation)), two = POST(request(correlation2))
    await vi.waitFor(() => expect(io.calls.length).toBe(2))
    gates[1].resolve(success); await two; gates[0].resolve(success); await one
    for (const id of [correlation, correlation2]) {
      const own = events().filter(e => e.correlationId === id)
      expect(own.map(e => e.event)).toEqual(['started', 'terminal']); expect(new Set(own.map(e => e.attemptId)).size).toBe(1)
    }
    expect(new Set(events().map(e => e.attemptId)).size).toBe(2)
  })
  it('duplicate caller correlation is never a reused server attempt', async () => {
    await successful(); await POST(request())
    expect(new Set(events().map(e => e.attemptId)).size).toBe(2)
  })
  it('abort before engine or after completion never claims abort while pending', async () => {
    const controller = new AbortController(), req = request(correlation, controller); controller.abort()
    // A consumed body lets the real handler retain its ordinary valid-body behavior.
    vi.spyOn(req, 'json').mockResolvedValue({ billing_month: '2026-09' })
    await successful(req)
    expect(events().some(e => e.abortWhilePending)).toBe(false)
    const late = new AbortController(); await POST(request(correlation2, late)); const count = events().length; late.abort()
    expect(events().length).toBe(count)
  })
  it('identity initialization failure does not break module or business availability', async () => {
    io.identityError = true; vi.resetModules()
    const reloaded = await import('@/app/api/internal/billing/generate-underlay/route')
    expect((await reloaded.POST(request())).status).toBe(200)
    expect(io.calls).toHaveLength(1); expect(events()).toEqual([])
  })
  it('emitter and signal listener failures cannot change business success', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => { throw new Error('sink failure') })
    const req = request(); vi.spyOn(req.signal, 'addEventListener').mockImplementation(() => { throw new Error('listener failure') })
    await successful(req)
  })
  it('correlation/header and signal getter failures cannot change business success', async () => {
    const req = request(); vi.spyOn(req.headers, 'get').mockImplementation(() => { throw new Error('header failure') })
    await successful(req)
    io.calls = []; const other = request(); Object.defineProperty(other, 'signal', { get() { throw new Error('signal failure') } })
    await successful(other)
  })
  it('removes the listener on rejection and ignores remove failure', async () => {
    const req = request(); const remove = vi.spyOn(req.signal, 'removeEventListener').mockImplementation(() => { throw new Error('cleanup failure') })
    const run = await pending(req); run.rpc.reject(new Error('RPC failure')); expect((await run.response).status).toBe(500)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(getEventListeners(req.signal, 'abort')).toHaveLength(0)
  })
  it('cleans a native listener even if registration throws after installing it', async () => {
    const req = request(), add = req.signal.addEventListener.bind(req.signal)
    vi.spyOn(req.signal, 'addEventListener').mockImplementation((...args) => { add(...args); throw new Error('late registration failure') })
    const run = await pending(req)
    expect(getEventListeners(req.signal, 'abort')).toHaveLength(1)
    run.rpc.resolve(success); expect((await run.response).status).toBe(200)
    expect(getEventListeners(req.signal, 'abort')).toHaveLength(0)
  })
  it('a throwing sink during the actual abort callback cannot interrupt the engine', async () => {
    const controller = new AbortController(), req = request(correlation, controller), run = await pending(req)
    vi.spyOn(console, 'info').mockImplementation(() => { throw new Error('abort sink failure') })
    expect(() => controller.abort()).not.toThrow()
    expect(run.done()).toBe(false)
    run.rpc.resolve(success); expect((await run.response).status).toBe(200)
    expect(getEventListeners(req.signal, 'abort')).toHaveLength(0)
  })
  it('strict event allowlist never serializes private input, result or error fields', async () => {
    await successful()
    const expected = ['schema', 'route', 'method', 'correlationId', 'attemptId', 'bootId', 'pid', 'event', 'sequence', 'elapsedMs', 'engineState', 'status', 'abortWhilePending', 'thrown'].sort()
    for (const event of events()) { expect(Object.keys(event).sort()).toEqual(expected); expect(Number.isInteger(event.pid)).toBe(true) }
    const serialized = JSON.stringify(events())
    for (const value of ['private-company', 'private-actor', 'private-underlay', 'quantity_kwh', '612.5', 'billing_month', 'cookie', 'token']) expect(serialized).not.toContain(value)
  })
})
