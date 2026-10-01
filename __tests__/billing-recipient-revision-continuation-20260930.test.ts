import { beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  company: 'ed140000-0000-4000-8000-000000000001', customer: 'ed140000-0000-4000-8000-000000000008',
  actor: 'ed140000-0000-4000-8000-000000000003', session: 'ed140000-0000-4000-8000-000000000005',
  contract: 'ed140000-0000-4000-8000-000000000009', guard: vi.fn(), rpc: vi.fn(), refresh: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: fixture.refresh }))
vi.mock('next/navigation', () => ({ unstable_rethrow: (error: unknown) => {
  if (error instanceof Error && error.message === 'NEXT_REDIRECT') throw error
} }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: fixture.guard }))
vi.mock('@/lib/tenant/scope', () => ({ assertUserCanOperateCompany: async () => undefined }))
vi.mock('@/lib/customer-operations/supportSession', () => ({ currentSupportSession: async () => ({ kind: 'ops', userId: fixture.actor, sessionId: fixture.session }) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: fixture.rpc } }))

import { saveCustomerBillingProfileAction, saveCustomerContractBillingOverrideAction } from '@/app/admin/customers/[id]/billing-profile-actions'

const input = () => ({ companyId: fixture.company, customerId: fixture.customer,
  expectedRevision: 3, idempotencyKey: 'billing-saved-revision-continuation', changes: { email: 'saved-current@example.invalid' } })
const save = [
  { name: 'customer default', action: () => saveCustomerBillingProfileAction(input()) },
  { name: 'explicit contract override', action: () => saveCustomerContractBillingOverrideAction({ ...input(),
    contractId: fixture.contract, expectedOverrideRevision: 2, inheritFields: [] }) },
]
beforeEach(() => {
  fixture.guard.mockReset().mockResolvedValue({ userId: fixture.actor, companyId: fixture.company, isPlatformAdmin: false })
  fixture.refresh.mockReset()
  fixture.rpc.mockReset().mockResolvedValue({ data: { companyId: fixture.company, customerId: fixture.customer,
    revision: 4, changed: true, replayed: false, affectedContractIds: [fixture.contract], contractOverrideRevision: 3,
    completionReference: 'synthetic-confirmed-completion' }, error: null })
})

it.each(save)('actual $name action preserves confirmed saved revision when refresh fails', async ({ action }) => {
  fixture.refresh.mockImplementation(() => { throw new Error('synthetic-cache-refresh-failure') })
  expect(await action()).toMatchObject({ status: 'success', revision: 4, changed: true,
    completionReference: 'synthetic-confirmed-completion', message: expect.stringMatching(/ladda|läs/i),
    notice: expect.stringMatching(/ladda|läs/i) })
  expect(fixture.rpc).toHaveBeenCalledTimes(1)
})

it.each(save)('actual $name action preserves framework control flow from refresh', async ({ action }) => {
  fixture.refresh.mockImplementation(() => { throw new Error('NEXT_REDIRECT') })
  await expect(action()).rejects.toThrow('NEXT_REDIRECT')
  expect(fixture.rpc).toHaveBeenCalledTimes(1)
})

it.each(save)('actual $name action returns stale-revision conflict without claiming a saved result', async ({ action }) => {
  fixture.rpc.mockResolvedValue({ data: null, error: { message: 'billing_profile_revision_conflict' } })
  expect(await action()).toMatchObject({ status: 'error', code: 'billing_profile_revision_conflict' })
  expect(fixture.refresh).not.toHaveBeenCalled()
})

it.each(save)('actual $name action denies changed selected company before RPC', async ({ action }) => {
  fixture.guard.mockResolvedValue({ userId: fixture.actor, companyId: 'ed140000-0000-4000-8000-000000000002', isPlatformAdmin: false })
  expect(await action()).toMatchObject({ status: 'error', code: 'tenant_context_changed' })
  expect(fixture.rpc).not.toHaveBeenCalled()
})
