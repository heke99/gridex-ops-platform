import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))

const io = vi.hoisted(() => ({
  companyId: 'guard-A' as string | null, platform: false,
  guard: vi.fn(), legacy: vi.fn(), membership: vi.fn(), writable: vi.fn(),
  meters: vi.fn(), underlays: vi.fn(), switches: vi.fn(), exports: vi.fn(),
  points: vi.fn(), switchRequests: vi.fn(), outbounds: vi.fn(), tasks: vi.fn(),
  legacyStatus: vi.fn(), legacyRetry: vi.fn(), legacyRoute: vi.fn(), route: vi.fn(),
  oldSwitchLookup: vi.fn(), oldSwitchCreate: vi.fn(),
  switchById: vi.fn(), prepareSwitch: vi.fn(), switchEvent: vi.fn(), syncCustomer: vi.fn(),
  reads: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
  audit: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminActionAccess: io.guard, requirePlatformAdminActionAccess: io.guard,
  isPlatformAdminContext: () => io.platform,
}))
vi.mock('@/lib/tenant/scope', () => ({
  getOperationalCompanyScope: io.legacy, assertUserCanOperateCompany: io.membership,
  TenantCompanyRequiredError: class extends Error {},
}))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: io.writable }))
function from(table: string) {
  const read = { table, filters: [] as Array<[string, unknown]> }
  io.reads.push(read)
  const rows = () => (table === 'customer_sites' ? [
    { id: 'site-A', company_id: 'guard-A', customer_id: 'customer-A' },
    { id: 'site-B', company_id: 'legacy-B', customer_id: 'customer-B' },
  ] : []).filter(row => read.filters.every(([key, value]) => row[key as keyof typeof row] === value))
  const query = {
    select: () => query, order: () => query, gte: () => query, lte: () => query,
    in: () => query, or: () => query, limit: () => query,
    eq(key: string, value: unknown) { read.filters.push([key, value]); return query },
    insert(value: unknown) { if (table === 'audit_logs') io.audit(value); return query },
    then(resolve: (result: unknown) => unknown) { return Promise.resolve({ data: rows(), error: null }).then(resolve) },
  }
  return query
}
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  from, auth: { getUser: async () => ({ data: { user: { id: 'operator' } } }) },
}) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from } }))
vi.mock('@/lib/cis/db', () => ({
  bulkQueueMissingBillingUnderlays: io.underlays,
  bulkQueueReadySupplierSwitches: io.switches, queueReadyBillingUnderlayExports: io.exports,
  listOutboundRequests: io.outbounds,
  resolveLegacyOutboundRoute: io.route,
  updateOutboundRequestStatus: io.legacyStatus, resetOutboundRequestForRetry: io.legacyRetry,
  refreshOutboundRequestRouteResolution: io.legacyRoute,
  findOpenOutboundBySource: io.oldSwitchLookup, createOutboundRequest: io.oldSwitchCreate,
}))
vi.mock('@/lib/cis/bulkMeteringCoverage', async (load) => {
  const actual = await load<typeof import('@/lib/cis/bulkMeteringCoverage')>()
  return {
    ...actual,
    queueStaffBulkMeteringRequests: (input: Parameters<typeof actual.queueStaffBulkMeteringRequests>[0]) =>
      io.meters({ ...input, sites: input.selection.sites }),
  }
})
vi.mock('@/lib/masterdata/db', () => ({ listMeteringPointsBySiteIds: io.points }))
vi.mock('@/lib/operations/db', () => ({
  listAllSupplierSwitchRequests: io.switchRequests,
  getSupplierSwitchRequestById: io.switchById,
  createSupplierSwitchEvent: io.switchEvent, syncCustomerOperationsForCustomer: io.syncCustomer,
  listPowersOfAttorneyByCustomerIds: async () => [], syncOperationTasksFromReadiness: io.tasks,
}))
vi.mock('@/lib/operations/readiness', () => ({ evaluateSiteSwitchReadiness: ({ site }: { site: unknown }) => ({ site }) }))
vi.mock('@/lib/ediel/orchestrator', () => ({ prepareAndQueueEdielZ03: io.prepareSwitch }))
vi.mock('@/lib/cis/edielAutomation', () => ({}))

import {
  bulkQueueMissingMeterValuesAction, bulkQueueMissingBillingUnderlaysAction, bulkQueueReadySupplierSwitchesAction, queueSupplierSwitchOutboundAction,
} from '@/app/admin/cis/actions'
import { bulkQueueReadyBillingExportsAction, runOperationsAutomationSweepAction } from '@/app/admin/operations/control-actions'

function form() {
  const value = new FormData()
  value.set('period_month', '2026-10')
  value.set('ediel_environment', 'test')
  return value
}
const cis = [
  ['missing meter values', () => bulkQueueMissingMeterValuesAction(form()), io.meters],
  ['missing billing underlays', () => bulkQueueMissingBillingUnderlaysAction(form()), io.underlays],
  ['ready supplier switches', () => bulkQueueReadySupplierSwitchesAction(), io.switches],
] as const
const control = [
  ['operations sweep', () => runOperationsAutomationSweepAction()],
  ['ready billing exports', () => bulkQueueReadyBillingExportsAction(form())],
] as const
beforeEach(() => {
  io.companyId = 'guard-A'; io.platform = false; io.reads = []; io.audit.mockClear()
  io.guard.mockReset().mockImplementation(async () => ({ userId: 'operator', companyId: io.companyId,
    isPlatformAdmin: io.platform, roles: [], permissions: ['metering.write', 'billing_underlay.write', 'switching.write', 'partner_exports.write'] }))
  io.legacy.mockReset().mockResolvedValue({ companyId: 'legacy-B', companyName: 'Legacy B' })
  io.membership.mockReset().mockImplementation(async (_actor: string, company: string) => company)
  io.writable.mockReset().mockResolvedValue(undefined)
  io.switchById.mockReset().mockResolvedValue({ id: 'switch-A', company_id: 'guard-A', customer_id: 'customer-A' })
  io.prepareSwitch.mockReset().mockResolvedValue({ id: 'message-A', communication_route_id: 'test-route' })
  io.switchEvent.mockReset().mockResolvedValue(undefined)
  io.syncCustomer.mockReset().mockResolvedValue(undefined)
  for (const writer of [io.meters, io.underlays, io.switches, io.exports]) writer.mockReset().mockResolvedValue({
    batchKey: 'batch', createdCount: 0, skippedCount: 0, flaggedCount: 0, blockedCount: 0, candidateCount: 0,
  })
  io.points.mockReset().mockResolvedValue([])
  io.switchRequests.mockReset().mockResolvedValue([])
  io.outbounds.mockReset().mockResolvedValue([])
  io.tasks.mockReset().mockResolvedValue(undefined)
  io.legacyStatus.mockReset().mockImplementation(async ({ status, outboundRequestId }) =>
    ({ id: outboundRequestId, status, request_type: 'billing_underlay', channel_type: 'file_export' }))
  io.legacyRetry.mockReset().mockResolvedValue({ status: 'queued', channel_type: 'file_export' })
  io.legacyRoute.mockReset().mockResolvedValue({ status: 'queued', channel_type: 'email_manual' })
  io.route.mockReset().mockImplementation(async ({ request }) => ({
    status: 'resolved', request: { ...request, channel_type: 'email_manual' }, requeued: false,
  }))
  io.oldSwitchLookup.mockReset().mockResolvedValue(null)
  io.oldSwitchCreate.mockReset().mockResolvedValue({ id: 'new-duplicate', status: 'queued' })
})

function staffSwitchForm() {
  const data = new FormData()
  data.set('request_id', 'switch-A')
  return data
}

it('prepares a selected-company switch and records the exact actor and company', async () => {
  await queueSupplierSwitchOutboundAction(staffSwitchForm())
  expect(io.guard).toHaveBeenCalledExactlyOnceWith(['switching.write'])
  expect(io.membership).toHaveBeenCalledExactlyOnceWith('operator', 'guard-A')
  expect(io.prepareSwitch).toHaveBeenCalledExactlyOnceWith({
    actorUserId: 'operator', switchRequestId: 'switch-A', communicationRouteId: null,
  })
  expect(io.switchEvent).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({
    switchRequestId: 'switch-A', eventType: 'ediel_prepared', eventStatus: 'queued',
  }))
  expect(io.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    company_id: 'guard-A', actor_user_id: 'operator', entity_id: 'message-A',
    action: 'supplier_switch_ediel_prepared',
  }))
})

it('keeps regular lifecycle validation for the actual platform target company', async () => {
  io.platform = true
  io.switchById.mockResolvedValue({ id: 'switch-A', company_id: 'actual-target', customer_id: 'customer-A' })
  await queueSupplierSwitchOutboundAction(staffSwitchForm())
  expect(io.membership).toHaveBeenCalledExactlyOnceWith('operator', 'actual-target')
  expect(io.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ company_id: 'actual-target' }))
})

it('requires the saved switch target to belong to the canonical tenant before preparing a message', async () => {
  io.switchById.mockResolvedValue({ id: 'switch-A', company_id: 'another-membership', customer_id: 'customer-A' })
  await expect(queueSupplierSwitchOutboundAction(staffSwitchForm())).rejects.toThrow('Switch request hittades inte')
  expect(io.membership).not.toHaveBeenCalled()
  expect(io.prepareSwitch).not.toHaveBeenCalled()
  expect(io.audit).not.toHaveBeenCalled()
})

it('stops a selected-company switch before the producer if its lifecycle guard refuses', async () => {
  io.membership.mockRejectedValue(new Error('not_operational'))
  await expect(queueSupplierSwitchOutboundAction(staffSwitchForm())).rejects.toThrow('not_operational')
  expect(io.prepareSwitch).not.toHaveBeenCalled()
  expect(io.audit).not.toHaveBeenCalled()
})

it.each(cis)('%s queues only canonical-company sites and retains membership/lifecycle validation', async (_name, action, writer) => {
  await action()
  expect(io.membership).toHaveBeenCalledExactlyOnceWith('operator', 'guard-A')
  expect(writer).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'operator', sites: [expect.objectContaining({ id: 'site-A', company_id: 'guard-A' })] }))
  expect(io.legacy).not.toHaveBeenCalled()
})

it.each(cis)('%s preserves a selected platform company', async (_name, action, writer) => {
  io.platform = true
  await action()
  expect(io.membership).toHaveBeenCalledExactlyOnceWith('operator', 'guard-A')
  expect(writer).toHaveBeenCalledWith(expect.objectContaining({ sites: [expect.objectContaining({ company_id: 'guard-A' })] }))
})

it.each(cis)('%s retains the existing global platform mode when no company is selected', async (_name, action, writer) => {
  io.platform = true; io.companyId = null
  await action()
  expect(io.membership).not.toHaveBeenCalled()
  expect(writer).toHaveBeenCalledWith(expect.objectContaining({ sites: [expect.objectContaining({ company_id: 'guard-A' }), expect.objectContaining({ company_id: 'legacy-B' })] }))
  expect(io.reads.find(value => value.table === 'customer_sites')?.filters).toEqual([])
  expect(io.legacy).not.toHaveBeenCalled()
})

it.each(cis)('%s refuses a missing tenant company before queueing or reading sites', async (_name, action, writer) => {
  io.companyId = null
  await expect(action()).rejects.toThrow()
  expect(writer).not.toHaveBeenCalled()
  expect(io.reads).toEqual([])
  expect(io.legacy).not.toHaveBeenCalled()
})

it.each(control)('%s uses the guard company for lifecycle checks and every tenant read', async (_name, action) => {
  await action()
  expect(io.writable).toHaveBeenCalledExactlyOnceWith('guard-A')
  for (const read of io.reads.filter(value => value.table !== 'audit_logs')) expect(read.filters).toContainEqual(['company_id', 'guard-A'])
  expect(io.legacy).not.toHaveBeenCalled()
})

it.each(['billing_underlay.write', 'partner_exports.write'])('uses %s alone for the exact selected-month billing queue and its audit', async permission => {
  io.guard.mockImplementation(async (requirements: string[]) => {
    if (!requirements.includes(permission)) throw new Error('permission_denied')
    return { userId: 'operator', companyId: 'guard-A', isPlatformAdmin: false, roles: [], permissions: [permission] }
  })
  await bulkQueueReadyBillingExportsAction(form())
  expect(io.guard).toHaveBeenCalledExactlyOnceWith(['billing_underlay.write', 'partner_exports.write'])
  expect(io.reads.find(row => row.table === 'billing_underlays')?.filters).toEqual([
    ['company_id', 'guard-A'], ['underlay_year', 2026], ['underlay_month', 10],
  ])
  expect(io.exports).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    actorUserId: 'operator', batchKey: 'billing-export:guard-A:2026-10',
  }))
  expect(io.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    actor_user_id: 'operator', company_id: 'guard-A', entity_id: '2026-10',
    action: 'bulk_queue_ready_billing_exports', metadata: expect.objectContaining({ companyId: 'guard-A' }),
  }))
})

it.each(['', '2026-00', '2026-13', '2026-1', '1999-10', '2201-10'])('rejects the invalid billing month %j before any tenant read or queue', async month => {
  const data = form()
  data.set('period_month', month)
  await expect(bulkQueueReadyBillingExportsAction(data)).rejects.toThrow()
  expect(io.writable).not.toHaveBeenCalled()
  expect(io.exports).not.toHaveBeenCalled()
  expect(io.audit).not.toHaveBeenCalled()
  expect(io.reads).toEqual([])
})

it.each(control)('%s preserves the selected platform company', async (_name, action) => {
  io.platform = true
  await action()
  expect(io.writable).toHaveBeenCalledExactlyOnceWith('guard-A')
  expect(io.legacy).not.toHaveBeenCalled()
})

it.each(control)('%s keeps its existing platform selected-company requirement', async (_name, action) => {
  io.platform = true; io.companyId = null
  await expect(action()).rejects.toThrow()
  expect(io.writable).not.toHaveBeenCalled()
  expect(io.exports).not.toHaveBeenCalled()
  expect(io.reads).toEqual([])
})

it.each(control)('%s refuses a missing canonical tenant before any read or write', async (_name, action) => {
  io.companyId = null
  await expect(action()).rejects.toThrow()
  expect(io.writable).not.toHaveBeenCalled()
  expect(io.reads).toEqual([])
})

it.each([...cis.map(([name, action]) => [name, action] as const), ...control])('%s still stops at its action permission gate', async (_name, action) => {
  io.guard.mockRejectedValue(new Error('permission_denied'))
  await expect(action()).rejects.toThrow('permission_denied')
  expect(io.membership).not.toHaveBeenCalled()
  expect(io.writable).not.toHaveBeenCalled()
  expect(io.reads).toEqual([])
})

it('keeps the selected CIS company membership/lifecycle refusal before any queue', async () => {
  io.membership.mockRejectedValue(new Error('company_not_operational'))
  await expect(bulkQueueMissingMeterValuesAction(form())).rejects.toThrow('company_not_operational')
  expect(io.membership).toHaveBeenCalledWith('operator', 'guard-A')
  expect(io.meters).not.toHaveBeenCalled()
  expect(io.reads).toEqual([])
})

it('keeps the control company lifecycle refusal before its data reads', async () => {
  io.writable.mockRejectedValue(new Error('company_paused'))
  await expect(runOperationsAutomationSweepAction()).rejects.toThrow('company_paused')
  expect(io.writable).toHaveBeenCalledWith('guard-A')
  expect(io.reads).toEqual([])
})

it('requires both ordinary bulk and communication rights and an explicit Ediel environment', async () => {
  const input = form()
  input.delete('ediel_environment')
  await expect(bulkQueueMissingMeterValuesAction(input)).rejects.toThrow('Välj Ediel-miljö')
  expect(io.guard).toHaveBeenCalledWith({ allOf: ['metering.write', 'communication.write'] })
  expect(io.reads).toEqual([])
  expect(io.meters).not.toHaveBeenCalled()
})


it('keeps all resolved channels at their current evidence-backed state in the sweep', async () => {
  const channels = ['ediel_partner', 'partner_api', 'file_export', 'email_manual']
  const rows = channels.flatMap((channel_type, channelIndex) =>
    ['queued', 'prepared', 'sent', 'failed'].map(status => ({
      id: `${channel_type}-${status}`, company_id: 'guard-A', channel_type, status,
      request_type: ['ediel_ack', 'partner_export', 'billing_underlay', 'meter_values'][channelIndex],
      attempts_count: status === 'failed' ? 1 : 0,
      sent_at: status === 'failed' ? '2026-11-01T12:00:00Z' : null,
      external_reference: 'durable-original',
    })),
  )
  io.outbounds.mockResolvedValue(rows)
  await runOperationsAutomationSweepAction()
  expect(io.outbounds).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'guard-A' }))
  for (const unsafe of [io.legacyStatus, io.legacyRetry, io.legacyRoute, io.oldSwitchCreate, io.route]) {
    expect(unsafe).not.toHaveBeenCalled()
  }
})

it('only forwards scoped unresolved rows to the guarded route owner and continues after a hold', async () => {
  const unresolved = { company_id: 'guard-A', channel_type: 'unresolved', request_type: 'supplier_switch',
    status: 'failed', attempts_count: 0 }
  const held = { ...unresolved, id: 'already-observed' }
  const eligible = { ...unresolved, id: 'unsent' }
  io.outbounds.mockResolvedValue([held, eligible,
    { ...unresolved, id: 'foreign', company_id: 'legacy-B' },
    { ...unresolved, id: 'already-sent', status: 'sent' },
    { ...unresolved, id: 'cancelled', status: 'cancelled' },
  ])
  io.route.mockResolvedValueOnce({ status: 'held', reason: 'transport_history', request: held })
  io.route.mockResolvedValueOnce({ status: 'resolved', request: { ...eligible, channel_type: 'ediel_partner' }, requeued: true })
  await runOperationsAutomationSweepAction()
  expect(io.route.mock.calls).toEqual([
    [{ actorUserId: 'operator', request: held, mode: 'bulk' }],
    [{ actorUserId: 'operator', request: eligible, mode: 'bulk' }],
  ])
  for (const unsafe of [io.legacyStatus, io.legacyRoute, io.legacyRetry]) expect(unsafe).not.toHaveBeenCalled()
})

it('leaves submitted and queued switches to the source-qualified outbound gateway', async () => {
  io.switchRequests.mockResolvedValue(['queued', 'submitted'].map(status => ({
    id: `existing-${status}`, customer_id: 'customer-A', company_id: 'guard-A', status,
  })))
  await runOperationsAutomationSweepAction()
  expect(io.oldSwitchLookup).not.toHaveBeenCalled()
  expect(io.oldSwitchCreate).not.toHaveBeenCalled()
  expect(io.tasks).toHaveBeenCalledOnce()
})
