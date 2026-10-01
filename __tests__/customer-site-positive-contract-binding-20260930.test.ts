import { beforeEach, expect, it, vi } from 'vitest'
import type { JobRow } from '@/lib/customer-operations/automation.part-1'

const f = vi.hoisted(() => ({
  company: '11111111-1111-4111-8111-111111111111', customer: '22222222-2222-4222-8222-222222222222',
  site: '33333333-3333-4333-8333-333333333333', point: '44444444-4444-4444-8444-444444444444',
  job: '55555555-5555-4555-8555-555555555555', request: '66666666-6666-4666-8666-666666666666',
  actor: '77777777-7777-4777-8777-777777777777', contract: '88888888-8888-4888-8888-888888888888',
  create: vi.fn(), start: vi.fn(), exact: vi.fn(), event: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
vi.mock('@/lib/operations/db', () => ({
  findCustomerSiteById: vi.fn(async () => ({ id: f.site, company_id: f.company, customer_id: f.customer,
    facility_id: '735999000000000001', grid_owner_id: f.actor, move_in_date: '2026-10-30' })),
  listMeteringPointsForSite: vi.fn(async () => [{ id: f.point, company_id: f.company, customer_id: f.customer,
    site_id: f.site, meter_point_id: '735999000000000001', grid_owner_id: f.actor }]),
  listPowersOfAttorneyByCustomerId: vi.fn(async () => []), syncOperationTasksFromReadiness: vi.fn(),
  findOpenSupplierSwitchRequestForSite: vi.fn(async () => null), createSupplierSwitchRequest: f.create,
}))
vi.mock('@/lib/operations/readiness', () => ({ evaluateSiteSwitchReadiness: vi.fn(() => ({
  isReady: true, issues: [], candidateMeteringPointId: f.point,
})) }))
vi.mock('@/lib/customer-operations/switchReadiness', () => ({ checkSupplierSwitchReadiness: f.exact }))
vi.mock('@/lib/grid-owners/verification', () => ({ getGridOwnerVerification: vi.fn(async () => ({ canStartSupplierSwitch: true })) }))
vi.mock('@/lib/operations/businessActions/startSupplierSwitch', () => ({ startSupplierSwitch: f.start }))
vi.mock('@/lib/customers/customerOperationEvents', () => ({ emitCustomerOperationEvent: f.event }))
vi.mock('@/lib/website/customerApplicationWorkflowBridge', () => ({ transitionCorrelatedCustomerApplicationWorkflow: vi.fn() }))
vi.mock('@/lib/customer-operations/automation.part-2', () => ({
  normalizeVerifiedMeteringPointIdentity: vi.fn(async ({ point }: { point: Record<string, unknown> }) => point),
  linkOperationResources: vi.fn(), persistSupplierSwitchBlockerMetadata: vi.fn(), classifySupplierSwitchDispatch: vi.fn(),
  processCustomerDataRequest: vi.fn(), processInboundResponse: vi.fn(),
}))
import { processSupplierSwitch } from '@/lib/customer-operations/automation.part-3'

beforeEach(() => {
  vi.clearAllMocks()
  f.exact.mockResolvedValue({ ready: true, blockers: [], readinessSnapshot: { contract_id: f.contract },
    candidateMeteringPoint: { id: f.point } })
  f.create.mockResolvedValue({ id: f.request })
  f.start.mockResolvedValue({ ok: true })
  f.event.mockResolvedValue(undefined)
})
const job = () => ({ id: f.job, company_id: f.company, customer_id: f.customer, customer_site_id: f.site,
  metering_point_id: f.point, operation_id: f.job, created_by: f.actor, payload: { source: 'z02_market_verified' }, attempts: 1,
  job_type: 'start_supplier_switch', status: 'running', priority: 100, idempotency_key: `supplier-switch:${f.customer}:${f.site}`,
  result: null, max_attempts: 5, run_after: '2026-09-30T00:00:00Z', locked_at: null, locked_by: null, last_error: null }) satisfies JobRow

it('new generic Z02 continuation binds the exact signed readiness contract into its durable switch request', async () => {
  await expect(processSupplierSwitch(job())).resolves.toMatchObject({ status: 'completed' })
  expect(f.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ contractId: f.contract,
    companyId: f.company, site: expect.objectContaining({ id: f.site }), meteringPoint: expect.objectContaining({ id: f.point }) }))
  expect(f.exact).toHaveBeenCalledWith(expect.objectContaining({ companyId: f.company, customerId: f.customer, siteId: f.site }))
  expect(f.start).toHaveBeenCalledTimes(1)
})

it('missing exact agreement evidence holds generic continuation before a request or dispatch is created', async () => {
  f.exact.mockResolvedValue({ ready: false, blockers: [{ code: 'signed_pdf_not_archived_or_hash_mismatch', message: 'PDF evidence missing' }],
    readinessSnapshot: { contract_id: f.contract } })
  await expect(processSupplierSwitch(job())).resolves.toMatchObject({ status: 'needs_review' })
  expect(f.create).not.toHaveBeenCalled()
  expect(f.start).not.toHaveBeenCalled()
  expect(f.event).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'supplier_switch.blocked' }))
})
