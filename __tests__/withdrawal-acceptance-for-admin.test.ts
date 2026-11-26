import { beforeEach, expect, it, vi } from 'vitest'
import { reconcileWithdrawalAcceptanceForAdmin } from '@/lib/email/withdrawalAcceptanceForAdmin'

const io = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminActionAccess: io.guard }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc } }))

const userId = '11000000-0000-4000-8000-000000000001'
const review = {
  companyId: '11000000-0000-4000-8000-000000000002',
  outboxId: '11000000-0000-4000-8000-000000000003',
  acceptanceToken: '11000000-0000-4000-8000-000000000004',
  reviewedAttemptId: '11000000-0000-4000-8000-000000000005',
}

beforeEach(() => {
  io.guard.mockReset().mockResolvedValue({ userId })
  io.rpc.mockReset().mockResolvedValue({ data: 'projected', error: null })
})

it('checks the platform role before touching a valid supplier receipt', async () => {
  io.guard.mockRejectedValue(new Error('Endast platform admin'))
  await expect(reconcileWithdrawalAcceptanceForAdmin(review)).rejects.toThrow('Endast platform admin')
  expect(io.rpc).not.toHaveBeenCalled()
})

it('does not send malformed scope to the service-only RPC', async () => {
  await expect(reconcileWithdrawalAcceptanceForAdmin({ ...review, reviewedAttemptId: 'unknown' })).rejects.toThrow('Det granskade leverantörskvittot saknas')
  expect(io.rpc).not.toHaveBeenCalled()
})

it('passes the exact reviewed attempt, receipt, tenant and server-authorized actor', async () => {
  await expect(reconcileWithdrawalAcceptanceForAdmin(review)).resolves.toBe('projected')
  expect(io.rpc).toHaveBeenCalledExactlyOnceWith('gridex_reconcile_withdrawal_email_acceptance_v1', {
    p_company_id: review.companyId,
    p_outbox_id: review.outboxId,
    p_acceptance_token: review.acceptanceToken,
    p_reviewed_attempt_id: review.reviewedAttemptId,
    p_actor_user_id: userId,
  })
})
