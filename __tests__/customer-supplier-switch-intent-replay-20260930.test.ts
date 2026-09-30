import { beforeEach, expect, it, vi } from 'vitest'
import type { JobRow } from '@/lib/customer-operations/automation.part-1'

const f = vi.hoisted(() => ({
  company: '11111111-1111-4111-8111-111111111111', customer: '22222222-2222-4222-8222-222222222222',
  site: '33333333-3333-4333-8333-333333333333', point: '44444444-4444-4444-8444-444444444444',
  job: '55555555-5555-4555-8555-555555555555', request: '66666666-6666-4666-8666-666666666666',
  actor: '77777777-7777-4777-8777-777777777777', operation: '88888888-8888-4888-8888-888888888888',
  rpc: vi.fn(), start: vi.fn(), receipts: new Map<string, string>(), persisted: [] as Record<string, unknown>[],
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: f.rpc } }))
vi.mock('@/lib/operations/db', () => ({
  findCustomerSiteById: vi.fn(async () => ({ id: f.site, company_id: f.company, customer_id: f.customer, facility_id: '735999000000000001', grid_owner_id: f.actor })),
  listMeteringPointsForSite: vi.fn(async () => [{ id: f.point, company_id: f.company, customer_id: f.customer, site_id: f.site, meter_point_id: '735999000000000002', grid_owner_id: f.actor }]),
  listPowersOfAttorneyByCustomerId: vi.fn(async () => []), syncOperationTasksFromReadiness: vi.fn(),
  findOpenSupplierSwitchRequestForSite: vi.fn(async () => ({ id: f.request })), createSupplierSwitchRequest: vi.fn(),
}))
vi.mock('@/lib/operations/readiness', () => ({ evaluateSiteSwitchReadiness: vi.fn(() => ({ isReady: true, issues: [], candidateMeteringPointId: f.point })) }))
vi.mock('@/lib/grid-owners/verification', () => ({ getGridOwnerVerification: vi.fn(async () => ({ canStartSupplierSwitch: true })) }))
vi.mock('@/lib/operations/businessActions/startSupplierSwitch', () => ({ startSupplierSwitch: f.start }))
vi.mock('@/lib/website/customerApplicationWorkflowBridge', () => ({ transitionCorrelatedCustomerApplicationWorkflow: vi.fn() }))
vi.mock('@/lib/customer-operations/automation.part-2', () => ({
  normalizeVerifiedMeteringPointIdentity: vi.fn(async ({ point }: { point: Record<string, unknown> }) => point), linkOperationResources: vi.fn(),
  persistSupplierSwitchBlockerMetadata: vi.fn(), classifySupplierSwitchDispatch: vi.fn(),
  processCustomerDataRequest: vi.fn(), processInboundResponse: vi.fn(),
}))
import { processSupplierSwitch } from '@/lib/customer-operations/automation.part-3'

beforeEach(() => {
  f.receipts.clear(); f.persisted = []
  f.start.mockReset().mockResolvedValueOnce({ ok: true, duplicate: false }).mockResolvedValue({ ok: true, duplicate: true })
  // Only the outer persistence boundary is controlled. Real producer and
  // emitter execute; exact PostgreSQL/native cases separately prove the RPC.
  f.rpc.mockReset().mockImplementation(async (_name: string, { p_event }: { p_event: Record<string, unknown> }) => {
    const key = String(p_event.idempotency_key), request = JSON.stringify(p_event)
    const prior = f.receipts.get(key)
    if (prior && prior !== request) return { data: null, error: { code: '23505', message: 'lifecycle_event_idempotency_conflict' } }
    if (!prior) { f.receipts.set(key, request); f.persisted.push(p_event) }
    return { data: { operationEventId: 'one-timeline', domainEventId: 'one-domain', notificationJobId: 'one-intent' }, error: null }
  })
})

it('actual producer retries identical approved intent while duplicate stays a worker diagnostic', async () => {
  const job = { id: f.job, company_id: f.company, customer_id: f.customer, customer_site_id: f.site,
    metering_point_id: f.point, operation_id: f.operation, created_by: f.actor, payload: {}, attempts: 1 } as JobRow
  await expect(processSupplierSwitch(job)).resolves.toMatchObject({ status: 'completed', result: { supplier_switch_request_id: f.request, duplicate: false } })
  await expect(processSupplierSwitch(job)).resolves.toMatchObject({ status: 'completed', result: { supplier_switch_request_id: f.request, duplicate: true } })
  expect(f.rpc).toHaveBeenCalledTimes(2)
  expect(f.persisted).toHaveLength(1)
  expect(f.persisted[0].payload).toEqual({ supplier_switch_request_id: f.request, operation_id: f.operation })
  expect(f.rpc.mock.calls[1][1]).toEqual(f.rpc.mock.calls[0][1])
})
