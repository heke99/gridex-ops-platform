import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '@/__tests__/helpers/poaMailFakeDb'

type Row = Record<string, unknown>
const CO = '11111111-1111-4111-8111-111111111111'
const CU = '22222222-2222-4222-8222-222222222222'
const SI = '33333333-3333-4333-8333-333333333333'
const SW = '44444444-4444-4444-8444-444444444444'
const MP = '55555555-5555-4555-8555-555555555555'
const CT = '66666666-6666-4666-8666-666666666666'
const io = vi.hoisted(() => ({ db: null as unknown as FakeDb, site: {} as Row, point: {} as Row,
  rpc: vi.fn(), queue: vi.fn(), event: vi.fn(), schedule: vi.fn(), route: vi.fn(),
  beforeWrite: null as null | ((payload: Row) => void) }))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => {
    const query = io.db.client.from(table) as Row
    const update = query.update as (payload: Row) => unknown
    query.update = (payload: Row) => { io.beforeWrite?.(payload); return update(payload) }
    return query
  }, rpc: io.rpc,
} }))
vi.mock('@/lib/operations/db', () => ({
  findCustomerSiteById: async () => structuredClone(io.site),
  listMeteringPointsForSite: async () => [structuredClone(io.point)],
  listPowersOfAttorneyByCustomerId: async () => [{ id: '77777777-7777-4777-8777-777777777777' }],
  findOpenSupplierSwitchRequestForSite: async () => structuredClone(io.db.tables.supplier_switch_requests[0]),
  syncOperationTasksFromReadiness: async () => undefined,
  createSupplierSwitchRequest: async () => { throw new Error('unexpected_new_switch') },
}))
vi.mock('@/lib/operations/readiness', () => ({ evaluateSiteSwitchReadiness: () => ({ isReady: true, issues: [],
  candidateMeteringPointId: '55555555-5555-4555-8555-555555555555', latestPowerOfAttorneyId: '77777777-7777-4777-8777-777777777777' }) }))
vi.mock('@/lib/customers/meteringIdentity', () => ({ getMeteringPointIdentity: (row: Row) => row.meter_point_id }))
vi.mock('@/lib/customers/customerOperationEvents', () => ({ emitCustomerOperationEvent: io.event }))
vi.mock('@/lib/customer-operations/automation', () => ({ enqueueSupplierSwitchAutomation: io.queue }))
vi.mock('@/lib/operations/supplierSwitchScheduler', () => ({ evaluateSupplierSwitchSchedule: io.schedule }))
vi.mock('@/lib/operations/switchLifecycleBlocks', () => ({ findActiveSwitchLifecycleBlock: async () => null }))
vi.mock('@/lib/customer-operations/customerProcessRouteReadiness', () => ({ evaluateCustomerProcessRouteReadiness: io.route }))
vi.mock('@/lib/grid-owners/verification', () => ({ getGridOwnerVerification: async () => ({ verificationStatus: 'verified', canStartSupplierSwitch: true, canUseForProdat: true }) }))
vi.mock('@/lib/legal/authorizationChain', () => ({ verifyAuthorizationScopeCoverage: async () => ({ covered: true, missing: [], healed: false, schemaAvailable: true }) }))
vi.mock('@/lib/ediel/rulebook/canonicalEdielFacade', () => ({ canonicalProdatSubtypeForMessage: (_message: string, subtype: string | null) => subtype === 'LK' || subtype === 'C' ? subtype : 'L' }))

// Real orchestration, unified readiness and manual commercial readiness run;
// only external data, source-proof RPC, legal/route/scheduler and queue ports
// are synthetic. This does not qualify SQL proof or a native/provider send.
import { reconcileSupplierSwitchAfterCustomerDataChange } from '@/lib/customer-operations/supplierSwitchOrchestration'

function current() { return io.db.tables.supplier_switch_requests[0] }
function dateWrites() {
  return io.db.writes.filter(write => write.table === 'supplier_switch_requests'
    && (write.payload as Row).requested_start_date === '2027-04-01')
}
function seed(managed = false, date = '2027-03-01') {
  io.site = { id: SI, company_id: CO, customer_id: CU, facility_id: '735999000000000001', grid_owner_id: 'synthetic-owner',
    current_supplier_id: '88888888-8888-4888-8888-888888888888', current_supplier_unknown: false,
    current_supplier_response_status: 'free_to_switch', current_supplier_termination_fee: 0,
    metadata: { manual_supplier_terms: { version: 1, companyId: CO, customerId: CU, siteId: SI,
      inboundId: '99999999-9999-4999-8999-999999999999', requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      sourceHash: 'a'.repeat(64), receivedAt: '2026-10-19T10:00:00Z',
      terms: { earliestStartDate: '2027-04-01', effectiveStartDate: '2027-04-01', terminationFee: '0 kr' } } } }
  io.point = { id: MP, company_id: CO, customer_id: CU, site_id: SI, meter_point_id: '735999000000000001', grid_owner_id: 'synthetic-owner', price_area_code: 'SE3' }
  io.db = createFakeDb({ supplier_switch_requests: [{ id: SW, company_id: CO, customer_id: CU, site_id: SI, customer_site_id: SI,
    metering_point_id: MP, requested_start_date: date, status: managed ? 'manual_followup_required' : 'queued', request_type: 'switch',
    prodat_variant: 'L', prodat_reason: 'Z22', lifecycle_blocked: managed, lifecycle_block_source: managed ? 'current_supplier_response_pending' : null,
    lifecycle_block_id: null, paused_at: managed ? '2026-10-18T12:00:00Z' : null, paused_by: null, pause_reason: managed ? 'Pending supplier' : null,
    submitted_at: null, completed_at: null, outbound_z03_message_id: null, updated_at: '2026-10-18T12:00:00Z',
    metadata: { contract_id: CT, supplier_switch_blockers: managed ? [{ code: 'current_supplier_response_pending' }] : [] }, validation_snapshot: {} }],
    customer_contract_lifecycle_readiness_v: [{ customer_contract_id: CT, company_id: CO, customer_id: CU, customer_site_id: SI,
      accepted_document_count: 5, blockers: [], switch_ready: true }],
  })
}
function reconcile() {
  return reconcileSupplierSwitchAfterCustomerDataChange({ companyId: CO, customerId: CU, siteId: SI, source: 'manual_supplier_information_received' })
}

beforeEach(() => {
  vi.clearAllMocks(); io.beforeWrite = null; seed()
  io.rpc.mockImplementation(async (name: string) => {
    if (name === 'gridex_manual_supplier_start_floor_v1') return { data: '2027-04-01', error: null }
    if (name === 'gridex_manual_supplier_terms_verified_v1') return { data: true, error: null }
    throw new Error('undeclared_proof_rpc')
  })
  io.schedule.mockResolvedValue({ ok: true, window: null, blockers: [] })
  io.route.mockResolvedValue({ ready: true, blockers: [], warnings: [] })
  io.queue.mockResolvedValue({ id: 'synthetic-job', duplicate: false })
  io.event.mockResolvedValue(undefined)
})

describe('existing canonical switch date after verified commercial reply', () => {
  it.each([false, true])('raises an earlier %s-managed pending date, reruns canonical gates, and queues the durable floor', async managed => {
    seed(managed)
    const result = await reconcile()
    expect(current()).toMatchObject({ requested_start_date: '2027-04-01', status: 'queued', lifecycle_blocked: false })
    expect(result).toMatchObject({ requestedStartDate: '2027-04-01', blockers: [], jobId: 'synthetic-job' })
    expect(io.schedule).toHaveBeenCalledWith(expect.objectContaining({ requestedStartDate: '2027-04-01' }))
    expect(io.route).toHaveBeenCalled()
    expect(io.queue).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ payloadContext: expect.objectContaining({ requested_start_date: '2027-04-01' }) }))
  })

  it('keeps a later planned date', async () => {
    seed(true, '2027-05-01')
    await reconcile()
    expect(current().requested_start_date).toBe('2027-05-01')
    expect(dateWrites()).toHaveLength(0)
    expect(io.queue).toHaveBeenCalledOnce()
  })

  it('recovers the same orchestrator\'s prior too-early commercial hold with the exact new proof', async () => {
    seed(true)
    Object.assign(current(), { lifecycle_block_source: 'supplier_commercial_start_too_early',
      metadata: { contract_id: CT, pending_review_reason: 'supplier_commercial_start_too_early',
        supplier_switch_blockers: [{ code: 'supplier_commercial_start_too_early' }] } })
    const result = await reconcile()
    expect(current()).toMatchObject({ requested_start_date: '2027-04-01', status: 'queued', lifecycle_blocked: false })
    expect(result.blockers).toEqual([])
    expect(io.queue).toHaveBeenCalledOnce()
  })

  it('recovers the canonical manual-readiness waiting_response hold after a verified clear reply', async () => {
    seed(true)
    Object.assign(current(), { lifecycle_block_source: 'current_supplier_waiting_response',
      metadata: { contract_id: CT, pending_review_reason: 'current_supplier_waiting_response',
        supplier_switch_blockers: [{ code: 'current_supplier_waiting_response' }] } })
    const result = await reconcile()
    expect(current()).toMatchObject({ requested_start_date: '2027-04-01', status: 'queued', lifecycle_blocked: false })
    expect(result.blockers).toEqual([])
    expect(io.queue).toHaveBeenCalledOnce()
  })

  it('does not reinterpret a generic commercial review hold as a managed date hold', async () => {
    seed(true)
    Object.assign(current(), { lifecycle_block_source: 'manual_review',
      metadata: { contract_id: CT, supplier_switch_blockers: [{ code: 'manual_review' }] } })
    await reconcile()
    expect(current()).toMatchObject({ requested_start_date: '2027-03-01', lifecycle_blocked: true, lifecycle_block_source: 'manual_review' })
    expect(io.queue).not.toHaveBeenCalled()
  })

  it('does not rewrite a prepared sealed original', async () => {
    Object.assign(current(), { status: 'prepared', outbound_z03_message_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })
    const result = await reconcile()
    expect(current().requested_start_date).toBe('2027-03-01')
    expect(result.blockedBeforeDispatch).toBe(true)
    expect(io.queue).not.toHaveBeenCalled()
  })

  it.each([{ submitted_at: '2026-10-19T10:00:00Z' }, { completed_at: '2026-10-19T10:00:00Z' },
    { request_type: 'move_in', prodat_variant: 'LK', prodat_reason: 'Z23' },
    { prodat_variant: 'C', prodat_reason: 'Z24', status: 'cancellation_requested' }])('preserves dates for excluded state %j', async fields => {
    Object.assign(current(), fields)
    await reconcile()
    expect(current().requested_start_date).toBe('2027-03-01')
    expect(dateWrites()).toHaveLength(0)
  })

  it('preserves a separate lifecycle hold', async () => {
    seed(true)
    Object.assign(current(), { lifecycle_block_source: 'credit_check_failed', pause_reason: 'Credit hold' })
    await reconcile()
    expect(current()).toMatchObject({ requested_start_date: '2027-03-01', lifecycle_blocked: true, lifecycle_block_source: 'credit_check_failed', pause_reason: 'Credit hold' })
    expect(io.queue).not.toHaveBeenCalled()
  })

  it.each([{ current_supplier_unknown: true }, { current_supplier_response_status: 'waiting_response' }])('requires a known supplier and complete clear reply %j', async fields => {
    Object.assign(io.site, fields)
    await reconcile()
    expect(current().requested_start_date).toBe('2027-03-01')
    expect(io.queue).not.toHaveBeenCalled()
  })

  it('requires the current exact source proof', async () => {
    io.rpc.mockImplementation(async (name: string) => ({ data: name === 'gridex_manual_supplier_start_floor_v1' ? '2027-04-01' : false, error: null }))
    await reconcile()
    expect(current().requested_start_date).toBe('2027-03-01')
    expect(io.queue).not.toHaveBeenCalled()
  })

  it('rechecks current proof in canonical readiness after the monotonic correction', async () => {
    let verifiedReads = 0
    io.rpc.mockImplementation(async (name: string) => ({ data: name === 'gridex_manual_supplier_start_floor_v1'
      ? '2027-04-01' : ++verifiedReads === 1, error: null }))
    const result = await reconcile()
    expect(current().requested_start_date).toBe('2027-04-01')
    expect(result.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'supplier_commercial_source_unverified' })]))
    expect(verifiedReads).toBe(2)
    expect(io.queue).not.toHaveBeenCalled()
  })

  it('reruns route gates after repairing the date and retains their actual blocker', async () => {
    io.route.mockResolvedValue({ ready: false, blockers: [{ code: 'route_missing', message: 'Missing route' }], warnings: [] })
    const result = await reconcile()
    expect(current().requested_start_date).toBe('2027-04-01')
    expect(result.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'route_missing' })]))
    expect(io.queue).not.toHaveBeenCalled()
  })

  it.each([{ requested_start_date: '2027-05-01' }, { outbound_z03_message_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    { company_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, { customer_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    { customer_site_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }])('fails closed if the exact row changes before date CAS %j', async fields => {
    io.beforeWrite = () => { io.beforeWrite = null; Object.assign(current(), fields) }
    await expect(reconcile()).rejects.toThrow('supplier_switch_reconcile_changed')
    expect(current()).toMatchObject(fields)
    expect(io.queue).not.toHaveBeenCalled()
  })

  it('does not restore a stale earlier date if another writer advances it after normalization', async () => {
    let writes = 0
    io.beforeWrite = () => { if (++writes === 2) Object.assign(current(), { requested_start_date: '2027-05-01' }) }
    await expect(reconcile()).rejects.toThrow('supplier_switch_reconcile_changed')
    expect(current().requested_start_date).toBe('2027-05-01')
    expect(io.queue).not.toHaveBeenCalled()
  })
})
