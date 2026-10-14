import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  companyId: 'guard-A' as string | null, platform: false, deny: false,
  legacy: vi.fn(), writes: [] as Array<{ companyId: string; actorUserId: string }>,
}))
class Navigation extends Error {}
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Navigation(url) },
  unstable_rethrow: (error: unknown) => { if (error instanceof Navigation) throw error },
}))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminActionAccess: async () => {
    if (io.deny) throw new Error('Permission denied')
    return { userId: 'operator', roles: [], permissions: ['cases.write'], isPlatformAdmin: io.platform, companyId: io.companyId }
  },
  isPlatformAdminContext: (admin: { isPlatformAdmin?: boolean }) => admin.isPlatformAdmin === true,
}))
vi.mock('@/lib/tenant/scope', () => ({
  getOperationalCompanyScope: io.legacy,
  TenantCompanyRequiredError: class extends Error {},
}))
const result = (input: { companyId: string; actorUserId: string }) => {
  io.writes.push(input)
  return { requestsCreated: 0, casesCreated: 0, blockersFound: 0, periodsChecked: [], gapsCreated: 0, outboundRequestsCreated: 0, queuesScanned: 0 }
}
vi.mock('@/lib/operations/batch2bAutomation', () => ({
  runBatch2BAutomation: async (input: { companyId: string; actorUserId: string }) => result(input),
  createBillingBlockerCasesForCompany: async (input: { companyId: string; actorUserId: string }) => result(input),
}))
vi.mock('@/lib/operations/batch2cAutomation', () => ({
  runBatch2CPeriodMotor: async (input: { companyId: string; actorUserId: string }) => result(input),
  createCasesForBatch2CQueues: async (input: { companyId: string; actorUserId: string }) => result(input),
}))
import {
  runBatch2BAutomationAction, runBatch2CPeriodMotorAction,
  createBillingBlockerCasesAction, createBatch2CQueueCasesAction,
} from '@/app/admin/operations/automation/actions'

const actions = [
  ['automation', runBatch2BAutomationAction],
  ['period motor', () => runBatch2CPeriodMotorAction(new FormData())],
  ['billing blockers', createBillingBlockerCasesAction],
  ['queue cases', createBatch2CQueueCasesAction],
] as const
beforeEach(() => {
  io.companyId = 'guard-A'; io.platform = false; io.deny = false; io.writes = []
  io.legacy.mockReset().mockResolvedValue({ companyId: 'legacy-B', companyName: 'Legacybolag B' })
})
it.each(actions)('%s writes to the company whose permissions were checked', async (_name, action) => {
  await expect(action()).rejects.toThrow('status=success')
  expect(io.writes).toHaveLength(1)
  expect(io.writes[0]).toMatchObject({ companyId: 'guard-A', actorUserId: 'operator' })
  expect(io.legacy).not.toHaveBeenCalled()
})
it.each(actions)('%s refuses a missing canonical tenant without a mutation', async (_name, action) => {
  io.companyId = null
  await expect(action()).rejects.toThrow('status=error')
  expect(io.writes).toEqual([]); expect(io.legacy).not.toHaveBeenCalled()
})
it.each(actions)('%s does not depend on a second membership selection', async (_name, action) => {
  io.legacy.mockRejectedValue(new Error('Legacy selection failed'))
  await expect(action()).rejects.toThrow('status=success')
  expect(io.writes[0]).toMatchObject({ companyId: 'guard-A' })
  expect(io.legacy).not.toHaveBeenCalled()
})
it.each(actions)('%s still refuses permission denial before a mutation', async (_name, action) => {
  io.deny = true
  await expect(action()).rejects.toThrow('status=error')
  expect(io.writes).toEqual([]); expect(io.legacy).not.toHaveBeenCalled()
})
it('preserves a platform operator selected company', async () => {
  io.platform = true
  await expect(runBatch2BAutomationAction()).rejects.toThrow('status=success')
  expect(io.writes[0]).toMatchObject({ companyId: 'guard-A' })
})
it('requires a selected company for a platform automation run', async () => {
  io.platform = true; io.companyId = null
  await expect(runBatch2BAutomationAction()).rejects.toThrow('status=error')
  expect(io.writes).toEqual([])
})
