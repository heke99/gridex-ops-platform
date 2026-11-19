import { beforeEach, expect, it, vi } from 'vitest'
import { evaluateAndRunNextCustomerStep } from '@/lib/customer-operations/customerProcessNextStepEngine'

const io = vi.hoisted(() => ({
  from: vi.fn(),
  site: vi.fn(),
  meteringPoints: vi.fn(),
  existing: vi.fn(),
  sync: vi.fn(),
  schedule: vi.fn(),
  getSwitch: vi.fn(),
  switchEvent: vi.fn(),
  prepare: vi.fn(),
  findOutbound: vi.fn(),
  event: vi.fn(),
  readiness: vi.fn(),
  snapshot: vi.fn(),
  request: vi.fn(),
  route: vi.fn(),
  z01: vi.fn(),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from } }))
vi.mock('@/lib/operations/db', () => ({
  findCustomerSiteById: io.site,
  listMeteringPointsForSite: io.meteringPoints,
  findOpenSupplierSwitchRequestForSite: io.existing,
  getSupplierSwitchRequestById: io.getSwitch,
  createSupplierSwitchEvent: io.switchEvent,
  syncOperationTasksFromReadiness: io.sync,
  listPowersOfAttorneyByCustomerId: vi.fn(),
}))
vi.mock('@/lib/operations/readiness', () => ({ evaluateSiteSwitchReadiness: vi.fn() }))
vi.mock('@/lib/operations/supplierSwitchScheduler', () => ({ evaluateSupplierSwitchSchedule: io.schedule }))
vi.mock('@/lib/cis/db', () => ({ findOpenOutboundBySource: io.findOutbound }))
vi.mock('@/lib/masterdata/db', () => ({
  getCustomerSiteById: vi.fn(),
  getGridOwnerById: vi.fn(),
  getMeteringPointById: vi.fn(),
}))
vi.mock('@/lib/ediel/orchestrator', () => ({ prepareAndQueueEdielZ03: io.prepare }))
vi.mock('@/lib/customer-operations/z01Finalizer', () => ({ finalizeStuckZ01GridOwnerDataRequest: io.z01 }))
vi.mock('@/lib/customer-operations/customerProcessEvents', () => ({ emitCustomerProcessEvent: io.event }))
vi.mock('@/lib/customer-operations/customerProcessRouteReadiness', () => ({ evaluateCustomerProcessRouteReadiness: io.route }))
vi.mock('@/lib/customer-operations/switchReadiness', () => ({
  checkSupplierSwitchReadiness: io.readiness,
  persistSwitchReadinessSnapshot: io.snapshot,
}))
vi.mock('@/lib/customer-operations/supplierSwitchOrchestration', () => ({
  ensureSupplierSwitchRequestForReadySite: io.request,
}))

const actor = '11111111-1111-4111-8111-111111111111'
const command = {
  companyId: 'company-a',
  customerId: 'customer-a',
  siteId: 'site-a',
  trigger: 'facility_data_received',
  source: 'ediel_inbound',
  skipZ01Finalization: true,
  actorUserId: actor,
} as const
const site = {
  id: 'site-a',
  company_id: 'company-a',
  customer_id: 'customer-a',
  facility_id: 'facility-a',
  grid_owner_id: 'owner-a',
}
const blockers = [
  { code: 'supplier_switch_send_window_too_early', message: 'Handbokens sändfönster öppnar 2026-12-01.' },
  { code: 'unresolved_negative_ack', message: 'Det finns en olöst negativ kvittens/avvisning.' },
]

beforeEach(() => {
  vi.resetAllMocks()
  const query = {
    update: () => query,
    eq: () => query,
    then: (resolve: (result: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve),
  }
  io.from.mockReturnValue(query)
  io.site.mockResolvedValue(site)
  io.meteringPoints.mockResolvedValue([{ id: 'point-a', meter_point_id: '735999260731000007' }])
  io.existing.mockResolvedValue(null)
  io.getSwitch.mockResolvedValue({
    id: 'switch-a', company_id: 'company-a', customer_id: 'customer-a', site_id: 'site-a',
    metering_point_id: 'point-a', grid_owner_id: 'owner-a',
  })
  io.findOutbound.mockResolvedValue(null)
  io.readiness.mockResolvedValue({
    ready: true, siteReadiness: { candidateMeteringPointId: 'point-a' }, readinessSnapshot: {}, blockers: [],
  })
  io.route.mockResolvedValue({ ready: false, blockers: [] })
  io.snapshot.mockResolvedValue(undefined)
  io.request.mockResolvedValue({ ok: true, request: { id: 'switch-a' }, blockers: [] })
})

it('preserves the created switch identity and each blocker when the dispatch owner stops Z03', async () => {
  io.schedule.mockResolvedValue({ ok: false, blockers })
  const next = await evaluateAndRunNextCustomerStep(command)

  expect(io.event).toHaveBeenCalledWith(expect.objectContaining({
    eventType: 'supplier_switch.blocked', payload: { supplier_switch_request_id: 'switch-a', blockers },
  }))
  expect(io.event).not.toHaveBeenCalledWith(expect.objectContaining({ eventType: 'supplier_switch.requested' }))
  expect(io.findOutbound).not.toHaveBeenCalled()
  expect(io.prepare).not.toHaveBeenCalled()
  expect(next).toEqual({
    decision: 'blocked', actionTaken: 'supplier_switch_dispatch_blocked', blockers, supplierSwitchRequestId: 'switch-a',
  })
})

it('keeps the prepared result after the dispatch owner accepts Z03', async () => {
  io.schedule.mockResolvedValue({ ok: true, blockers: [] })
  io.prepare.mockResolvedValue({ id: 'ediel-z03-a', message_code: 'Z03', outbound_request_id: 'outbound-a' })

  expect(await evaluateAndRunNextCustomerStep(command)).toEqual({
    decision: 'prepare_supplier_switch', actionTaken: 'supplier_switch_requested', blockers: [], supplierSwitchRequestId: 'switch-a',
  })
  expect(io.prepare).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: actor, switchRequestId: 'switch-a' }))
})

it.each([{ company_id: 'company-b' }, { customer_id: 'customer-b' }])('rejects a foreign site before preparation when %j', async mismatch => {
  io.site.mockResolvedValue({ ...site, ...mismatch })

  expect(await evaluateAndRunNextCustomerStep(command)).toMatchObject({
    decision: 'manual_review', blockers: [expect.objectContaining({ code: 'site_not_found' })],
  })
  expect(io.request).not.toHaveBeenCalled()
  expect(io.schedule).not.toHaveBeenCalled()
  expect(io.prepare).not.toHaveBeenCalled()
})

it('requires a valid actor before reading the site', async () => {
  await expect(evaluateAndRunNextCustomerStep({ ...command, actorUserId: 'invalid-user-id' })).rejects.toThrow()
  expect(io.site).not.toHaveBeenCalled()
  expect(io.prepare).not.toHaveBeenCalled()
})

it('returns the existing-request action without another submission', async () => {
  io.existing.mockResolvedValue({ id: 'switch-existing', status: 'queued' })

  expect(await evaluateAndRunNextCustomerStep(command)).toMatchObject({
    decision: 'prepare_supplier_switch', actionTaken: 'supplier_switch_already_open', supplierSwitchRequestId: 'switch-existing',
  })
  expect(io.request).not.toHaveBeenCalled()
  expect(io.schedule).not.toHaveBeenCalled()
  expect(io.prepare).not.toHaveBeenCalled()
})
