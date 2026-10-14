import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  companyId: 'guard-A' as string | null, platform: false,
  guard: vi.fn(), legacy: vi.fn(), membership: vi.fn(), writable: vi.fn(),
  meters: vi.fn(), underlays: vi.fn(), switches: vi.fn(), exports: vi.fn(),
  points: vi.fn(), switchRequests: vi.fn(), outbounds: vi.fn(), tasks: vi.fn(),
  reads: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
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
    in: () => query, limit: () => query,
    eq(key: string, value: unknown) { read.filters.push([key, value]); return query },
    insert: () => query,
    then(resolve: (result: unknown) => unknown) { return Promise.resolve({ data: rows(), error: null }).then(resolve) },
  }
  return query
}
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  from, auth: { getUser: async () => ({ data: { user: { id: 'operator' } } }) },
}) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from } }))
vi.mock('@/lib/cis/db', () => ({
  bulkQueueMissingMeterValues: io.meters, bulkQueueMissingBillingUnderlays: io.underlays,
  bulkQueueReadySupplierSwitches: io.switches, queueReadyBillingUnderlayExports: io.exports,
  listOutboundRequests: io.outbounds,
}))
vi.mock('@/lib/masterdata/db', () => ({ listMeteringPointsBySiteIds: io.points }))
vi.mock('@/lib/operations/db', () => ({
  listAllSupplierSwitchRequests: io.switchRequests,
  listPowersOfAttorneyByCustomerIds: async () => [], syncOperationTasksFromReadiness: io.tasks,
}))
vi.mock('@/lib/operations/readiness', () => ({ evaluateSiteSwitchReadiness: ({ site }: { site: unknown }) => ({ site }) }))
vi.mock('@/lib/ediel/orchestrator', () => ({}))
vi.mock('@/lib/cis/edielAutomation', () => ({}))

import {
  bulkQueueMissingMeterValuesAction, bulkQueueMissingBillingUnderlaysAction, bulkQueueReadySupplierSwitchesAction,
} from '@/app/admin/cis/actions'
import { bulkQueueReadyBillingExportsAction, runOperationsAutomationSweepAction } from '@/app/admin/operations/control-actions'

function form() { const value = new FormData(); value.set('period_month', '2026-10'); return value }
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
  io.companyId = 'guard-A'; io.platform = false; io.reads = []
  io.guard.mockReset().mockImplementation(async () => ({ userId: 'operator', companyId: io.companyId,
    isPlatformAdmin: io.platform, roles: [], permissions: ['metering.write', 'billing_underlay.write', 'switching.write', 'partner_exports.write'] }))
  io.legacy.mockReset().mockResolvedValue({ companyId: 'legacy-B', companyName: 'Legacy B' })
  io.membership.mockReset().mockImplementation(async (_actor: string, company: string) => company)
  io.writable.mockReset().mockResolvedValue(undefined)
  for (const writer of [io.meters, io.underlays, io.switches, io.exports]) writer.mockReset().mockResolvedValue({
    batchKey: 'batch', createdCount: 0, skippedCount: 0, flaggedCount: 0, blockedCount: 0, candidateCount: 0,
  })
  io.points.mockReset().mockResolvedValue([])
  io.switchRequests.mockReset().mockResolvedValue([])
  io.outbounds.mockReset().mockResolvedValue([])
  io.tasks.mockReset().mockResolvedValue(undefined)
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
