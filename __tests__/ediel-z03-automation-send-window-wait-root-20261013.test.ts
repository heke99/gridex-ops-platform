// Component dependency for AT-Z03L-SUPPLIER / AT-Z03LK-SUPPLIER; no whole-ID tag/credit.
// Real exported worker, capability, preflight, start bridge, canonical scheduler and updateJob.
// SDK/RPC/claim/event persistence and finite Date are DECLARED ports, not native SQL/RLS/provider proof.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

type Row = Record<string, unknown>
type Filter = { column: string; operator: string; value: unknown }
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  queries: [] as Array<{ table: string; operation: string; filters: Filter[]; payload: Row | null; matched: number }>,
  permissions: [] as Row[],
  claims: [] as Array<{ before: number; after: number; token: string }>,
  events: [] as Row[],
  deny: false,
  loseTokenAtScheduledEvent: false,
  failScheduledEvent: false,
  readError: null as string | null,
  unrelatedOutcome: {} as Row,
  send: vi.fn(() => { throw new Error('unexpected original/provider/send port') }),
  successor: vi.fn(() => { throw new Error('unexpected customer application successor') }),
  cookies: vi.fn(() => { throw new Error('unexpected HTTP tenant selection') }),
}))

vi.mock('next/headers', () => ({ cookies: io.cookies }))
vi.mock('@/lib/ediel/orchestrator', () => ({ prepareAndQueueEdielZ03: io.send }))
vi.mock('@/lib/website/customerApplicationWorkflowBridge', () => ({ transitionCorrelatedCustomerApplicationWorkflow: io.successor }))
vi.mock('@/lib/website/customerApplications', () => ({ continueWebsiteCustomerApplication: async () => structuredClone(io.unrelatedOutcome) }))
vi.mock('@/lib/customers/customerOperationEvents', () => ({
  emitCustomerOperationEvent: async (event: Row) => {
    io.events.push(structuredClone(event))
    if (event.eventType === 'supplier_switch.scheduled') {
      if (io.loseTokenAtScheduledEvent) io.tables.customer_operation_jobs[0].lock_token = '00000000-0000-4000-8000-000000000099'
      if (io.failScheduledEvent) throw new Error('declared event persistence failure')
    }
  },
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  from: (table: string) => {
    if (!(table in io.tables)) throw new Error(`undeclared SDK table ${table}`)
    let operation = 'select'
    let payload: Row | null = null
    let take = Infinity
    const filters: Filter[] = []
    const orderings: Array<{ column: string; ascending: boolean }> = []
    const run = () => {
      if (io.readError === table && operation === 'select') throw new Error(`declared ${table} SDK failure`)
      const hit = io.tables[table].filter(row => filters.every(filter => {
        const actual = row[filter.column]
        switch (filter.operator) {
          case 'eq': return actual === filter.value
          case 'neq': return actual !== filter.value
          case 'in': return (filter.value as unknown[]).includes(actual)
          case 'is': return (actual ?? null) === filter.value
          case 'not-is': return (actual ?? null) !== filter.value
          default: throw new Error(`undeclared SDK filter ${filter.operator}`)
        }
      })).sort((a, b) => {
        for (const ordering of orderings) {
          const compared = String(a[ordering.column] ?? '').localeCompare(String(b[ordering.column] ?? ''))
          if (compared) return ordering.ascending ? compared : -compared
        }
        return 0
      }).slice(0, take)
      io.queries.push({ table, operation, filters: structuredClone(filters), payload: structuredClone(payload), matched: hit.length })
      if (operation === 'update') {
        if (!['customer_operation_jobs', 'supplier_switch_requests', 'customer_operation_tasks'].includes(table)) throw new Error(`forbidden business update ${table}`)
        for (const row of hit) Object.assign(row, structuredClone(payload))
      }
      return structuredClone(hit)
    }
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { filters.push({ column, operator: 'eq', value }); return query },
      neq: (column: string, value: unknown) => { filters.push({ column, operator: 'neq', value }); return query },
      in: (column: string, value: unknown[]) => { filters.push({ column, operator: 'in', value }); return query },
      is: (column: string, value: unknown) => { filters.push({ column, operator: 'is', value }); return query },
      not: (column: string, operator: string, value: unknown) => {
        if (operator !== 'is') throw new Error(`undeclared SDK not ${operator}`)
        filters.push({ column, operator: 'not-is', value }); return query
      },
      order: (column: string, options?: { ascending?: boolean }) => { orderings.push({ column, ascending: options?.ascending !== false }); return query },
      limit: (count: number) => { take = count; return query },
      update: (patch: Row) => { operation = 'update'; payload = patch; return query },
      insert: () => { throw new Error(`unexpected insert ${table}`) },
      upsert: () => { throw new Error(`unexpected upsert ${table}`) },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (fulfilled: (value: unknown) => unknown, rejected?: (error: unknown) => unknown) =>
        Promise.resolve().then(() => ({ data: run(), error: null })).then(fulfilled, rejected),
    }
    return query
  },
  rpc: async (name: string, args: Row) => {
    if (name === 'gridex_actor_has_company_permission') {
      io.permissions.push(structuredClone(args))
      if (!['communication.write', 'operations.write'].includes(String(args.p_permission))) throw new Error('undeclared permission')
      return { data: !io.deny, error: null }
    }
    if (name !== 'gridex_claim_customer_operation_jobs') throw new Error(`undeclared RPC ${name}`)
    // Finite declared claim port follows public source's queued/exhausted/increment/token boundary.
    // It executes no SQL, skip-locked concurrency, transaction or tenant RLS.
    const claimed: Row[] = []
    for (const row of io.tables.customer_operation_jobs) {
      if (row.status !== 'queued' || String(row.run_after) > new Date().toISOString()) continue
      const company = io.tables.companies.find(company => company.id === row.company_id)
      if (!company || !['active', 'onboarding'].includes(String(company.status)) || row.lifecycle_blocked_by_tenant === true) continue
      const before = Number(row.attempts)
      if (before >= Number(row.max_attempts)) { row.status = 'failed'; continue }
      if (claimed.length >= Number(args.p_limit)) break
      const token = `00000000-0000-4000-8000-${String(60 + io.claims.length).padStart(12, '0')}`
      Object.assign(row, { status: 'running', attempts: before + 1, locked_at: new Date().toISOString(), locked_by: args.p_worker_id, lock_token: token })
      io.claims.push({ before, after: before + 1, token })
      claimed.push(structuredClone(row))
    }
    return { data: claimed, error: null }
  },
} }))

import { processCustomerOperationJobs, processSupplierSwitch } from '@/lib/customer-operations/automation.part-3'
import { classifySupplierSwitchDispatch } from '@/lib/customer-operations/automation.part-2'
import type { JobRow } from '@/lib/customer-operations/automation.part-1'
import * as scheduler from '@/lib/operations/supplierSwitchScheduler'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const opening = '2026-10-31T23:00:00.000Z'
const now = '2026-10-13T12:00:00.000Z'
let job: JobRow
let scheduleSpy: MockInstance<typeof scheduler.evaluateSupplierSwitchSchedule>

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(now))
  io.queries = []; io.permissions = []; io.claims = []; io.events = []
  io.deny = false; io.loseTokenAtScheduledEvent = false; io.failScheduledEvent = false; io.readError = null
  io.unrelatedOutcome = { status: 'queued', runAfter: opening, result: { reason: 'supplier_switch_send_window_not_open', send_not_before: opening } }
  job = { id: id(1), company_id: id(2), customer_id: id(3), customer_site_id: id(4), metering_point_id: id(5),
    job_type: 'start_supplier_switch', status: 'running', priority: 1, idempotency_key: 'own-window-wait', payload: {}, result: {},
    request_snapshot: { site_id: id(4), address_hash: 'declared-own-site-address-v1' },
    attempts: 1, max_attempts: 3, run_after: now, locked_at: now,
    locked_by: 'own-worker', lock_token: id(6), last_error: null, created_by: id(7), operation_id: id(8) }
  const company = { id: id(2), status: 'active', is_active: true }
  io.tables = {
    customer_operation_jobs: [structuredClone(job)], companies: [company, { id: id(20), status: 'active', is_active: true }],
    company_memberships: [{ company_id: id(20), user_id: id(7), status: 'active', is_active: true, accepted_at: now },
      { company_id: id(2), user_id: id(7), status: 'active', is_active: true, accepted_at: now }],
    user_profiles: [{ id: id(7), user_status: 'active' }], customers: [{ id: id(3), company_id: id(2), status: 'active' }],
    customer_sites: [{ id: id(4), company_id: id(2), customer_id: id(3), facility_id: '735123456789012345', site_name: 'Own site',
      move_in_date: '2028-01-01', grid_owner_id: id(9), grid_area_code: 'TES', price_area_code: 'SE3', current_supplier_unknown: true,
      address_hash: 'declared-own-site-address-v1' }],
    metering_points: [{ id: id(5), company_id: id(2), customer_id: id(3), site_id: id(4), status: 'active',
      meter_point_id: '735123456789012345', ediel_metering_point_id: '735123456789012345', grid_owner_id: id(9), grid_area_code: 'TES', price_area_code: 'SE3' }],
    powers_of_attorney: [{ id: id(10), company_id: id(2), customer_id: id(3), site_id: id(4), scope: 'supplier_switch', status: 'signed', signed_at: now, created_at: now }],
    gridex_verified_grid_owners_v: [{ grid_owner_id: id(9), verification_status: 'verified', verified_for_customer_flow: true, can_start_supplier_switch: true }],
    supplier_switch_requests: [{ id: id(11), company_id: id(2), customer_id: id(3), site_id: id(4), customer_site_id: id(4), metering_point_id: id(5),
      status: 'draft', request_type: 'switch', prodat_variant: 'L', requested_start_date: '2028-01-01', created_at: now, metadata: {} }],
    customer_operation_tasks: [], ediel_messages: [],
    contracts: [{ id: id(12), company_id: id(2), customer_id: id(3), status: 'signed' }],
    supply_periods: [{ id: id(13), company_id: id(2), customer_id: id(3), status: 'planned', start_date: '2028-01-01' }],
  }
  scheduleSpy = vi.spyOn(scheduler, 'evaluateSupplierSwitchSchedule')
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

const request = () => io.tables.supplier_switch_requests[0]
const persistedJob = () => io.tables.customer_operation_jobs[0]
const businessSnapshot = () => structuredClone({
  request: request(), contracts: io.tables.contracts, periods: io.tables.supply_periods,
  site: io.tables.customer_sites, points: io.tables.metering_points,
})
function expectNoDispatch() {
  expect(io.send).not.toHaveBeenCalled()
  expect(io.successor).not.toHaveBeenCalled()
  expect(io.cookies).not.toHaveBeenCalled()
  expect(io.queries.some(query => query.operation === 'update' && ['contracts', 'supply_periods', 'customers', 'ediel_messages'].includes(query.table))).toBe(false)
  expect(io.events.some(event => event.eventType === 'supplier_switch.requested')).toBe(false)
}
async function actualSchedule() {
  expect(scheduleSpy).toHaveBeenCalledTimes(1)
  return await scheduleSpy.mock.results[0].value
}
function queuedSeed(attempts = 2) {
  Object.assign(persistedJob(), { status: 'queued', attempts, locked_at: null, locked_by: null, lock_token: null })
}

describe('real full worker wait classification', () => {
  it.each(['L', 'LK'] as const)('automatically schedules genuine canonical %s too-early work', async subtype => {
    Object.assign(request(), { request_type: subtype === 'LK' ? 'move_in' : 'switch', prodat_variant: subtype })
    const before = businessSnapshot()
    const outcome = await processSupplierSwitch(job)
    const emitted = await actualSchedule()
    expect(emitted).toMatchObject({ ok: false, window: { reason: 'too_early', transactionSubtype: subtype, sendNotBefore: opening },
      blockers: [{ code: 'supplier_switch_send_window_too_early' }] })
    expect(emitted.blockers).toHaveLength(1) // independently proves all earlier real guards passed.
    expect(io.permissions.map(permission => permission.p_permission)).toEqual(['communication.write', 'operations.write', 'communication.write', 'operations.write'])
    expect(io.permissions.every(permission => permission.p_company_id === id(2) && permission.p_actor_user_id === id(7))).toBe(true)
    expectNoDispatch()
    expect(businessSnapshot()).toEqual({ ...before, request: { ...before.request, operation_id: id(8) } })
    expect(outcome).toMatchObject({ status: 'queued', runAfter: opening, result: {
      reason: 'supplier_switch_send_window_not_open', reason_code: 'supplier_switch_send_window_not_open', send_not_before: opening,
      blockers: [{ code: 'supplier_switch_send_window_too_early', source: 'scheduler' }],
    } })
    expect(io.events).toEqual([expect.objectContaining({ eventType: 'supplier_switch.scheduled', companyId: id(2), actorUserId: id(7),
      status: 'waiting_response', severity: 'info', actionRequired: false, payload: expect.objectContaining({ send_not_before: opening }) })])
  })

  it.each([
    ['L', '2026-10-26', 'supplier_switch_send_window_expired'],
    ['LK', '2026-10-12', 'supplier_switch_send_window_expired'],
    ['L', null, 'supplier_switch_send_window_missing_start_date'],
    ['L', '2028-02-30', 'supplier_switch_send_window_invalid_start_date'],
  ])('retains real %s refusal for start %s', async (subtype, start, code) => {
    Object.assign(request(), { request_type: subtype === 'LK' ? 'move_in' : 'switch', prodat_variant: subtype, requested_start_date: start })
    const outcome = await processSupplierSwitch(job)
    expect((await actualSchedule()).blockers).toEqual([expect.objectContaining({ code })])
    expect(outcome).toMatchObject({ status: 'needs_review', result: { reason: code } })
    expect(io.events).toEqual([expect.objectContaining({ eventType: 'supplier_switch.blocked', actionRequired: true })])
    expectNoDispatch()
  })

  it.each(['duplicate', 'negative-ack', 'ack-read-error'])('does not wait automatically when actual scheduler also reports %s', async scenario => {
    if (scenario === 'duplicate') io.tables.supplier_switch_requests.push({ ...structuredClone(request()), id: id(15), status: 'sent', created_at: '2026-01-01T00:00:00Z' })
    if (scenario === 'negative-ack') request().rejection_reason_code = 'negative'
    if (scenario === 'ack-read-error') { request().outbound_z03_message_id = id(16); io.readError = 'ediel_messages' }
    const outcome = await processSupplierSwitch(job)
    expect((await actualSchedule()).blockers).toHaveLength(2)
    expect(outcome.status).toBe('needs_review')
    expect(io.events.some(event => event.eventType === 'supplier_switch.scheduled')).toBe(false)
    expectNoDispatch()
  })

  it.each(['revoked', 'inactive-actor', 'denied', 'wrong-company', 'lost-token'])('refuses actual current worker authority %s before scheduler or effects', async mutation => {
    if (mutation === 'revoked') io.tables.company_memberships[1].status = 'revoked'
    if (mutation === 'inactive-actor') io.tables.user_profiles[0].user_status = 'inactive'
    if (mutation === 'denied') io.deny = true
    if (mutation === 'wrong-company') job.company_id = id(20)
    if (mutation === 'lost-token') persistedJob().lock_token = id(60)
    await expect(processSupplierSwitch(job)).rejects.toThrow(/forbidden/)
    expect(scheduleSpy).not.toHaveBeenCalled()
    expect(io.queries.filter(query => query.operation !== 'select')).toEqual([])
    expect(io.events).toEqual([])
    expectNoDispatch()
  })
})

describe('finite actual classifier compatibility and fail-closed controls', () => {
  it.each([
    { codes: ['supplier_switch_send_window_not_open'] },
    { codes: ['supplier_switch_send_window_too_early'] },
    { codes: ['supplier_switch_send_window_not_open', 'supplier_switch_send_window_too_early'] },
  ])('recognizes only timing codes $codes while retaining fields', ({ codes }) => {
    const classification = classifySupplierSwitchDispatch({ schedule: { window: { sendNotBefore: opening }, blockers: codes.map(code => ({ code, message: code })) } })
    expect(classification).toMatchObject({ scheduleWindowOnly: true, routeBlocked: false, sendNotBefore: opening, primary: null })
    expect(classification.blockers.map(blocker => blocker.code)).toEqual(codes)
  })
  it.each(['supplier_switch_send_window_expired', 'supplier_switch_send_window_missing_start_date', 'supplier_switch_send_window_invalid_start_date',
    'supplier_switch_send_window_unknown', 'unknown', 'communication_permission_denied', 'customer_archived', 'route_profile_missing'])('refuses mixed timing + %s', code => {
    const classification = classifySupplierSwitchDispatch({ schedule: { blockers: [{ code: 'supplier_switch_send_window_too_early' }, { code }] } })
    expect(classification.scheduleWindowOnly).toBe(false)
    if (code === 'route_profile_missing') expect(classification).toMatchObject({ routeBlocked: true, primary: { blocker_code: code } })
  })
  it('retains nonempty every-blocker and route-source guards', () => {
    expect(classifySupplierSwitchDispatch({}).scheduleWindowOnly).toBe(false)
    const mixed = classifySupplierSwitchDispatch({ preflight: { issues: [{ code: 'scope_forbidden', blocking: true }] },
      schedule: { blockers: [{ code: 'supplier_switch_send_window_too_early' }] } })
    expect(mixed.scheduleWindowOnly).toBe(false)
    const route = classifySupplierSwitchDispatch({ readiness: { blockers: [{ code: 'supplier_switch_send_window_too_early', source: 'route_readiness' }] } })
    expect(route.routeBlocked).toBe(true)
  })
})

describe('actual outer worker and unchanged owned-token updateJob CAS', () => {
  it('preserves a last technical attempt across a successful deliberate wait and a second due claim', async () => {
    queuedSeed(2)
    const before = businessSnapshot()
    expect(await processCustomerOperationJobs({ workerId: 'own-worker', limit: 1 })).toMatchObject({ claimed: 1, needsReview: 0, failed: 0, errors: [] })
    expect((await actualSchedule()).window).toMatchObject({ reason: 'too_early', sendNotBefore: opening })
    expect.soft(persistedJob()).toMatchObject({ status: 'queued', attempts: 2, run_after: opening, lock_token: null, locked_by: null, locked_at: null, completed_at: null })
    const finalization = io.queries.find(query => query.table === 'customer_operation_jobs' && query.operation === 'update')!
    expect(finalization.filters).toEqual([{ column: 'id', operator: 'eq', value: job.id }, { column: 'lock_token', operator: 'eq', value: io.claims[0].token }])
    expect.soft(finalization.payload).toMatchObject({ attempts: 2, status: 'queued', run_after: opening, lock_token: null })
    expect(finalization.matched).toBe(1)
    expect(businessSnapshot()).toEqual({ ...before, request: { ...before.request, operation_id: id(8) } })
    vi.setSystemTime(new Date(opening))
    // A genuine later finite SDK error consumes the remaining technical attempt.
    io.readError = 'customer_sites'
    const resumed = await processCustomerOperationJobs({ workerId: 'own-worker', limit: 1 })
    expect.soft(resumed).toMatchObject({ claimed: 1, failed: 1 })
    expect.soft(resumed.errors).toHaveLength(1)
    expect.soft(io.claims.map(claim => [claim.before, claim.after])).toEqual([[2, 3], [2, 3]])
    expect.soft(persistedJob()).toMatchObject({ status: 'failed', attempts: 3, last_error: 'declared customer_sites SDK failure' })
    expectNoDispatch()
  })

  it.each([0, 1, 2])('refunds only current successful claim and retains %i prior technical debits', async attempts => {
    queuedSeed(attempts)
    await processCustomerOperationJobs({ workerId: 'own-worker', limit: 1 })
    expect(persistedJob()).toMatchObject({ status: 'queued', attempts, run_after: opening })
    expect(io.claims).toEqual([{ before: attempts, after: attempts + 1, token: id(60) }])
    expectNoDispatch()
  })

  it('does not refund an event-call rejection after the wait decision', async () => {
    queuedSeed(1); io.failScheduledEvent = true
    const outcome = await processCustomerOperationJobs({ workerId: 'own-worker', limit: 1 })
    expect(outcome.errors).toEqual([`${job.id}: declared event persistence failure`])
    expect(persistedJob()).toMatchObject({ status: 'queued', attempts: 2, last_error: 'declared event persistence failure' })
    const write = io.queries.find(query => query.table === 'customer_operation_jobs' && query.operation === 'update')!
    expect(write.payload).not.toHaveProperty('attempts')
    expectNoDispatch()
  })

  it.each(['expired', 'mixed', 'authority'])('does not refund actual %s refusal', async scenario => {
    queuedSeed(1)
    if (scenario === 'expired') request().requested_start_date = '2026-10-26'
    if (scenario === 'mixed') request().rejection_reason_code = 'negative'
    if (scenario === 'authority') io.deny = true
    await processCustomerOperationJobs({ workerId: 'own-worker', limit: 1 })
    expect(persistedJob().attempts).toBe(2)
    expect(io.queries.filter(query => query.table === 'customer_operation_jobs' && query.operation === 'update').every(query => !('attempts' in query.payload!))).toBe(true)
    expect(io.events.some(event => event.eventType === 'supplier_switch.scheduled')).toBe(false)
    expectNoDispatch()
  })

  it('cannot spoof private successful-wait provenance through an unrelated queued result', async () => {
    queuedSeed(1)
    Object.assign(persistedJob(), { job_type: 'customer_application_continuation', payload: { application_id: id(30) } })
    await processCustomerOperationJobs({ workerId: 'own-worker', limit: 1 })
    expect(persistedJob()).toMatchObject({ status: 'queued', attempts: 2, run_after: opening })
    const write = io.queries.find(query => query.table === 'customer_operation_jobs' && query.operation === 'update')!
    expect(write.payload).not.toHaveProperty('attempts')
    expect(scheduleSpy).not.toHaveBeenCalled()
    expectNoDispatch()
  })

  it.each(['missing', 'changed'])('preserves the actual %s operation-snapshot refusal without refund', async scenario => {
    queuedSeed(1)
    if (scenario === 'missing') persistedJob().request_snapshot = null
    if (scenario === 'changed') io.tables.customer_sites[0].address_hash = 'declared-changed-address'
    await processCustomerOperationJobs({ workerId: 'own-worker', limit: 1 })
    expect(persistedJob()).toMatchObject({ status: 'needs_review', attempts: 2, result: { stale_reason: scenario === 'missing'
      ? 'operation_snapshot_missing' : 'site_address_changed_after_operation_started' } })
    expect(scheduleSpy).not.toHaveBeenCalled()
    expect(io.events.some(event => event.eventType === 'supplier_switch.scheduled')).toBe(false)
    expectNoDispatch()
  })

  it('does not refund or clear another worker token when the successful-wait CAS loses ownership', async () => {
    queuedSeed(1); io.loseTokenAtScheduledEvent = true
    await expect(processCustomerOperationJobs({ workerId: 'own-worker', limit: 1 })).rejects.toThrow('customer_operation_job_lock_lost')
    expect(persistedJob()).toMatchObject({ status: 'running', attempts: 2, lock_token: id(99), locked_by: 'own-worker' })
    const writes = io.queries.filter(query => query.table === 'customer_operation_jobs' && query.operation === 'update')
    expect(writes).toHaveLength(2)
    expect(writes.every(query => query.matched === 0 && query.filters.some(filter => filter.column === 'lock_token' && filter.value === id(60)))).toBe(true)
    expectNoDispatch()
  })
})
