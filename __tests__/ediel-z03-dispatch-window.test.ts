import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The SQL and legal/route/provider ports below are declared doubles. Both
// ordinary consumers and the canonical scheduler execute their real code.
const ports = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  queries: [] as { table: string; filters: [string, string, unknown][] }[],
  getRequest: vi.fn(), openRequest: vi.fn(), event: vi.fn(), produce: vi.fn(),
  schedule: vi.fn(), site: vi.fn(), points: vi.fn(), poa: vi.fn(), authorization: vi.fn(), routeReadiness: vi.fn(),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    const query = { table, filters: [] as [string, string, unknown][] }
    ports.queries.push(query)
    let single = false
    let mutation = false
    const result = () => {
      if (mutation) return { data: null, error: null }
      let rows: Record<string, unknown>[] = []
      if (table === 'supplier_switch_requests') {
        rows = ports.rows.filter(row => query.filters.every(([op, key, value]) =>
          op === 'eq' ? row[key] === value : op === 'neq' ? row[key] !== value :
            op === 'in' ? Array.isArray(value) && value.includes(row[key]) : true))
      } else if (table === 'customer_contracts') rows = [{ id: 'contract' }]
      else if (table === 'customer_contract_lifecycle_readiness_v') rows = [{
        customer_contract_id: 'contract', company_id: 'company', customer_id: 'customer',
        customer_site_id: 'site', accepted_document_count: 5, switch_ready: true, blockers: [],
      }]
      return { data: single ? rows[0] ?? null : rows, error: null }
    }
    const builder = {
      select: () => builder,
      eq: (key: string, value: unknown) => { query.filters.push(['eq', key, value]); return builder },
      neq: (key: string, value: unknown) => { query.filters.push(['neq', key, value]); return builder },
      in: (key: string, value: unknown) => { query.filters.push(['in', key, value]); return builder },
      or: () => builder, order: () => builder, limit: () => builder,
      update: () => { mutation = true; return builder },
      maybeSingle: () => { single = true; return builder },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    }
    return builder
  },
}}))
vi.mock('@/lib/operations/db', () => ({
  getSupplierSwitchRequestById: ports.getRequest,
  createSupplierSwitchEvent: ports.event,
  findCustomerSiteById: ports.site,
  listMeteringPointsForSite: ports.points,
  listPowersOfAttorneyByCustomerId: ports.poa,
  findOpenSupplierSwitchRequestForSite: ports.openRequest,
}))
vi.mock('@/lib/masterdata/db', () => ({
  getCustomerSiteById: ports.site, getMeteringPointById: vi.fn(), getGridOwnerById: vi.fn(),
}))
vi.mock('@/lib/cis/db', () => ({ findOpenOutboundBySource: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/ediel/orchestrator', () => ({
  prepareAndQueueEdielZ03: ports.produce, prepareAndQueueEdielZ05: vi.fn(), prepareAndQueueEdielZ09: vi.fn(),
}))
vi.mock('@/lib/operations/supplierSwitchScheduler', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/operations/supplierSwitchScheduler')>()
  return { ...actual, evaluateSupplierSwitchSchedule: ports.schedule }
})
vi.mock('@/lib/operations/switchLifecycleBlocks', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/operations/switchLifecycleBlocks')>(),
  findActiveSwitchLifecycleBlock: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/customer-operations/customerProcessRouteReadiness', () => ({
  evaluateCustomerProcessRouteReadiness: ports.routeReadiness,
}))
vi.mock('@/lib/grid-owners/verification', () => ({
  getGridOwnerVerification: vi.fn().mockResolvedValue({ canStartSupplierSwitch: true }),
}))
vi.mock('@/lib/legal/authorizationChain', () => ({
  verifyAuthorizationScopeCoverage: ports.authorization,
}))

import { ensureInitialSwitchEdielAutomation } from '@/lib/operations/edielAutomation'
import { checkSupplierSwitchReadiness } from '@/lib/customer-operations/switchReadiness'

const NOW = new Date('2026-10-06T12:00:00Z')
const scope = { companyId: 'company', customerId: 'customer', siteId: 'site', switchRequestId: 'switch' }
function row(subtype: 'L' | 'LK', date: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'switch', company_id: 'company', customer_id: 'customer', site_id: 'site',
    metering_point_id: 'point', grid_owner_id: 'grid', status: 'draft',
    request_type: subtype === 'LK' ? 'move_in' : 'switch', prodat_variant: subtype,
    requested_start_date: date, validation_snapshot: {}, rejection_reason_code: null,
    lifecycle_blocked: false, outbound_z03_message_id: null, ...overrides,
  }
}
beforeEach(async () => {
  vi.clearAllMocks()
  vi.useFakeTimers(); vi.setSystemTime(NOW)
  ports.rows = []; ports.queries = []
  const actual = await vi.importActual<typeof import('@/lib/operations/supplierSwitchScheduler')>('@/lib/operations/supplierSwitchScheduler')
  ports.schedule.mockImplementation(actual.evaluateSupplierSwitchSchedule)
  ports.getRequest.mockImplementation(async (_db, id) => ports.rows.find(r => r.id === id) ?? null)
  ports.openRequest.mockResolvedValue(null)
  ports.authorization.mockResolvedValue({ covered: true, missing: [], schemaAvailable: true })
  ports.routeReadiness.mockResolvedValue({ ready: true, blockers: [], warnings: [] })
  ports.site.mockResolvedValue({ id: 'site', company_id: 'company', customer_id: 'customer',
    grid_owner_id: 'grid', grid_area_code: 'STH', price_area_code: 'SE3',
    current_supplier_name: 'Original supplier', move_in_date: '2026-10-06' })
  ports.points.mockResolvedValue([{ id: 'point', site_id: 'site', status: 'active',
    meter_point_id: '735999000000000001', grid_owner_id: 'grid', grid_area_code: 'STH', price_area_code: 'SE3' }])
  ports.poa.mockResolvedValue([{ id: 'poa', customer_id: 'customer', site_id: 'site',
    scope: 'supplier_switch', status: 'signed', signed_at: '2026-09-01T12:00:00Z',
    valid_from: '2026-09-01', valid_to: null }])
  ports.produce.mockResolvedValue({ id: 'original', message_code: 'Z03', outbound_request_id: 'outbound' })
})
afterEach(() => vi.useRealTimers())

describe('persisted Z03 dispatch subtype through the real scheduler', () => {
  it.each([['L', '2026-10-20'], ['LK', '2026-10-06']] as const)(
    'positive control: actual scheduler accepts declared %s %s', async (subtype, date) => {
      ports.rows = [row(subtype, date)]
      const result = await ports.schedule({ ...scope, requestedStartDate: date,
        transactionSubtype: subtype, requestType: subtype === 'LK' ? 'move_in' : 'switch',
        meteringPointId: 'point', now: NOW })
      expect(result.ok).toBe(true)
      expect(result.window).toMatchObject({ transactionSubtype: subtype, windowOpen: true })
    })
  it.each([
    ['L', '2026-10-20', true], ['L', '2026-10-19', false],
    ['LK', '2026-10-06', true], ['LK', '2026-10-05', false],
    ['L', '2027-12-06', true], ['L', '2027-12-07', false],
    ['LK', '2027-12-06', true], ['LK', '2027-12-07', false],
  ] as const)('%s %s readiness is lawful=%s', async (subtype, date, lawful) => {
    ports.rows = [row(subtype, date)]
    const result = await checkSupplierSwitchReadiness({ ...scope, now: NOW })
    expect(result.readinessSnapshot.schedule).toMatchObject({ ok: lawful, window: {
      transactionSubtype: subtype, requestedStartDate: date, windowOpen: lawful,
    } })
    expect(result.ready).toBe(lawful)
    const call = ports.schedule.mock.calls[0]?.[0]
    expect(call).toMatchObject({ requestedStartDate: date, transactionSubtype: subtype,
      requestType: subtype === 'LK' ? 'move_in' : 'switch', status: 'draft' })
  })

  it.each([['L', '2026-10-20', true], ['L', '2026-10-19', false],
    ['LK', '2026-10-06', true], ['LK', '2026-10-05', false]] as const)(
    '%s %s ordinary automation preserves both gates lawful=%s', async (subtype, date, lawful) => {
      ports.rows = [row(subtype, date)]
      const result = await ensureInitialSwitchEdielAutomation({ actorUserId: 'actor', switchRequestId: 'switch' })
      expect(result.blocked).toBe(!lawful)
      expect(ports.schedule).toHaveBeenCalledTimes(2)
      for (const [call] of ports.schedule.mock.calls) {
        expect(call).toMatchObject({ transactionSubtype: subtype, requestedStartDate: date })
      }
      expect(ports.produce).toHaveBeenCalledTimes(lawful ? 1 : 0)
    })

  it('uses exact persisted date even when caller proposes a lawful different date', async () => {
    ports.rows = [row('LK', '2026-10-05')]
    const result = await checkSupplierSwitchReadiness({ ...scope, requestedStartDate: '2026-10-06', now: NOW })
    expect(result.ready).toBe(false)
    expect(result.blockers.map(b => b.code)).toContain('supplier_switch_send_window_expired')
    expect(ports.schedule.mock.calls[0][0].requestedStartDate).toBe('2026-10-05')
  })

  it('passes the same explicit environment through both ordinary gates and the producer', async () => {
    ports.rows = [row('LK', '2026-10-06')]
    const input = { actorUserId: 'actor', switchRequestId: 'switch', environment: 'test' as const }
    await ensureInitialSwitchEdielAutomation(input)
    expect(ports.schedule).toHaveBeenCalledTimes(2)
    for (const [call] of ports.schedule.mock.calls) expect(call.environment).toBe('test')
    expect(ports.routeReadiness).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company', customerId: 'customer', siteId: 'site', environment: 'test',
    }))
    expect(ports.produce).toHaveBeenCalledWith(expect.objectContaining({ environment: 'test', switchRequestId: 'switch' }))
  })

  it('preserves cancellation precedence over the persisted LK original', async () => {
    ports.rows = [row('LK', '2026-10-20', { status: 'cancellation_requested' })]
    const result = await checkSupplierSwitchReadiness({ ...scope, now: NOW })
    expect(result.readinessSnapshot.schedule).toMatchObject({ ok: true, window: { transactionSubtype: 'C' } })
    expect(ports.schedule.mock.calls[0][0]).toMatchObject({ status: 'cancellation_requested', requestType: 'move_in', transactionSubtype: 'LK' })
  })

  it.each([{ prodat_variant: null, prodat_reason: 'Z23', request_type: 'switch' },
    { prodat_variant: null, prodat_reason: null, request_type: 'move_in' }])(
    'uses the persisted reason or legacy request type when no variant is stored: %j', async overrides => {
      ports.rows = [row('LK', '2026-10-06', overrides)]
      const result = await checkSupplierSwitchReadiness({ ...scope, now: NOW })
      expect(result.ready).toBe(true)
      expect(result.readinessSnapshot.schedule).toMatchObject({ window: { transactionSubtype: 'LK', windowOpen: true } })
    })

  it.each(['id', 'company_id', 'customer_id', 'site_id'])(
    'refuses a persisted request with a different %s, without borrowing another open LK', async key => {
      ports.rows = [row('LK', '2026-10-06', { [key]: 'other' })]
      ports.openRequest.mockResolvedValue(row('LK', '2026-10-06', { id: 'other-open' }))
      const result = await checkSupplierSwitchReadiness({ ...scope, now: NOW })
      expect(result.ready).toBe(false)
      expect(result.blockers.map(b => b.code)).toContain('supplier_switch_request_missing_or_out_of_scope')
      expect(ports.schedule).not.toHaveBeenCalled()
      expect(ports.authorization).not.toHaveBeenCalled()
      expect(ports.produce).not.toHaveBeenCalled()
    })

  it('fails closed on a missing exact request and does not run its scheduler', async () => {
    const result = await checkSupplierSwitchReadiness({ ...scope, now: NOW })
    expect(result.ready).toBe(false)
    expect(result.blockers.map(b => b.code)).toContain('supplier_switch_request_missing_or_out_of_scope')
    expect(ports.schedule).not.toHaveBeenCalled()
    expect(ports.authorization).not.toHaveBeenCalled()
  })

  it('filters the exact request by all four durable identity columns', async () => {
    ports.rows = [row('LK', '2026-10-06')]
    await checkSupplierSwitchReadiness({ ...scope, now: NOW })
    expect(ports.queries.filter(q => q.table === 'supplier_switch_requests')).toEqual(expect.arrayContaining([
      expect.objectContaining({ filters: expect.arrayContaining([
        ['eq', 'id', 'switch'], ['eq', 'company_id', 'company'],
        ['eq', 'customer_id', 'customer'], ['eq', 'site_id', 'site'],
      ]) }),
    ]))
  })
})
