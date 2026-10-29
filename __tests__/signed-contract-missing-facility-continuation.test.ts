// Executes the real worker branch with intake/SDK ports; not native, mail delivery
// or genuine signing evidence. Claimed-job authority has its own real-port suite.
import { beforeEach, expect, it, vi } from 'vitest'
import type { JobRow } from '@/lib/customer-operations/automation.part-1'
const h = vi.hoisted(() => ({ authorize: vi.fn(), site: vi.fn(), points: vi.fn(), resume: vi.fn(),
  createSwitch: vi.fn(), dispatch: vi.fn(), event: vi.fn(), stale: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
vi.mock('@/lib/operations/businessActions/supplierSwitchWorkerAuthority', () => ({ authorizeSupplierSwitchWorkerJob: h.authorize }))
vi.mock('@/lib/operations/businessActions/startSupplierSwitch', () => ({ startSupplierSwitchForWorker: h.dispatch }))
vi.mock('@/lib/customer-operations/customerIntakeOrchestrator', () => ({ resumeCustomerIntake: h.resume }))
vi.mock('@/lib/grid-owners/verification', () => ({ getGridOwnerVerification: async () => ({ canStartSupplierSwitch: true }) }))
vi.mock('@/lib/customers/customerOperationEvents', () => ({ emitCustomerOperationEvent: h.event }))
vi.mock('@/lib/website/customerApplicationWorkflowBridge', () => ({ transitionCorrelatedCustomerApplicationWorkflow: vi.fn() }))
vi.mock('@/lib/operations/db', () => ({ findCustomerSiteById: h.site, listMeteringPointsForSite: h.points,
  listPowersOfAttorneyByCustomerId: async () => [], syncOperationTasksFromReadiness: vi.fn(),
  findOpenSupplierSwitchRequestForSite: vi.fn(), createSupplierSwitchRequest: h.createSwitch }))
vi.mock('@/lib/operations/readiness', () => ({ evaluateSiteSwitchReadiness: () => ({
  isReady: false, candidateMeteringPointId: null, issues: [{ title: 'Anläggningsuppgifter saknas' }],
}) }))
vi.mock('@/lib/customer-operations/automation.part-2', () => ({ normalizeVerifiedMeteringPointIdentity: async (x: { point: unknown }) => x.point }))
vi.mock('@/lib/customer-operations/automation.part-1', () => ({
  clean: (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : null,
  record: (v: unknown) => v && typeof v === 'object' && !Array.isArray(v) ? v : {},
  staleSnapshotReason: h.stale,
}))
import { processJob, processSupplierSwitch } from '@/lib/customer-operations/automation.part-3'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const job: JobRow = { id: id(1), company_id: id(2), customer_id: id(3), customer_site_id: id(4),
  metering_point_id: null, job_type: 'start_supplier_switch', status: 'running', priority: 25,
  idempotency_key: `contract-signed:${id(8)}`, payload: { trigger: 'contract_signed', contract_id: id(8) },
  result: {}, attempts: 1, max_attempts: 5, run_after: '2026-10-28T00:00:00Z',
  locked_at: '2026-10-28T00:00:00Z', locked_by: 'synthetic-worker', lock_token: id(6),
  last_error: null, created_by: id(7), operation_id: id(9) }
const decision = () => ({ state: 'facility_lookup_waiting_response', nextAction: 'wait_for_grid_owner',
  customerMessage: 'Vi inväntar nätägarens svar.', adminMessage: 'Begäran köad.', blockers: [], warnings: [],
  references: { customerId: id(3), siteId: id(4), contractId: id(8), meteringPointId: null,
    gridOwnerInformationRequestId: id(10), supplierSwitchRequestId: null, communicationRouteId: null, edielRouteProfileId: null } })
beforeEach(() => {
  vi.clearAllMocks()
  h.authorize.mockResolvedValue({ actorUserId: id(7), companyId: id(2) })
  h.site.mockResolvedValue({ id: id(4), company_id: id(2), customer_id: id(3), facility_id: null, grid_owner_id: id(11) })
  h.points.mockResolvedValue([])
  h.resume.mockResolvedValue(decision())
  h.stale.mockResolvedValue(null)
})
it('continues the exact signed-contract worker to facility intake, then waits without creating or sending a switch', async () => {
  const outcome = await processJob(job)
  expect(h.authorize).toHaveBeenCalledWith(job, {})
  expect(h.resume).toHaveBeenCalledExactlyOnceWith({ companyId: id(2), customerId: id(3), siteId: id(4), contractId: id(8), actorUserId: id(7) })
  expect(outcome).toMatchObject({ status: 'waiting_response', result: {
    redirect: 'manual_facility_information_request', grid_owner_information_request_id: id(10),
    reason_code: 'facility_or_metering_point_missing', intake_state: 'facility_lookup_waiting_response',
  } })
  expect(h.createSwitch).not.toHaveBeenCalled(); expect(h.dispatch).not.toHaveBeenCalled()
})
it.each(['missing_poa', 'recipient_unverified', 'contract_not_ready'])('retains intake %s as manual review without claiming an information request or a switch', async code => {
  h.resume.mockResolvedValue({ ...decision(), state: 'needs_admin_review', nextAction: 'review_blocker',
    blockers: [{ code, message: 'Granskning krävs.' }], references: { ...decision().references, gridOwnerInformationRequestId: null } })
  const outcome = await processSupplierSwitch(job)
  expect(outcome).toMatchObject({ status: 'needs_review', result: {
    grid_owner_information_request_id: null, blockers: [{ code }],
  } })
  expect(h.createSwitch).not.toHaveBeenCalled(); expect(h.dispatch).not.toHaveBeenCalled()
})
it('does not invoke intake after a claimed-job authority refusal', async () => {
  h.authorize.mockRejectedValue(new Error('supplier_switch_worker_scope_forbidden'))
  await expect(processSupplierSwitch(job)).rejects.toThrow('scope_forbidden')
  expect(h.resume).not.toHaveBeenCalled(); expect(h.event).not.toHaveBeenCalled()
})
it.each(['company_id', 'customer_id'])('does not route a foreign-site %s through intake', async field => {
  h.site.mockResolvedValue({ id: id(4), company_id: id(2), customer_id: id(3), [field]: id(20) })
  expect(await processSupplierSwitch(job)).toMatchObject({ status: 'failed', result: { reason: 'site_not_found_or_wrong_tenant' } })
  expect(h.resume).not.toHaveBeenCalled(); expect(h.createSwitch).not.toHaveBeenCalled()
})
