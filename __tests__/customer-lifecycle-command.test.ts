import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: fixture.rpc } }))

import { closeCustomerLifecycle } from '@/lib/customer-operations/lifecycleCommand'

const companyId = '11111111-1111-4111-8111-111111111111'
const customerId = '22222222-2222-4222-8222-222222222222'
const base = {
  companyId, customerId,
  actor: { kind: 'ops' as const, userId: '33333333-3333-4333-8333-333333333333',
    sessionId: '44444444-4444-4444-8444-444444444444' },
  expectedRevision: 4, idempotencyKey: 'lifecycle-repeatable-command',
  mode: 'move_out' as const, moveOutDate: '2026-09-30', reason: 'Customer confirmed move', createFollowUpTask: true,
}

describe('OPS customer lifecycle service command boundary', () => {
  beforeEach(() => fixture.rpc.mockReset())

  it('sends the actual OPS session and explicit saved lifecycle revision to one atomic RPC', async () => {
    fixture.rpc.mockResolvedValueOnce({ data: { companyId, customerId, revision: 5, changed: true, replayed: false,
      affectedSiteCount: 2, affectedMeteringPointCount: 3, affectedContractCount: 1, followUpTaskCount: 2 }, error: null })
    expect(await closeCustomerLifecycle(base)).toMatchObject({ revision: 5, changed: true, replayed: false })
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('gridex_close_customer_lifecycle_v1', { p_command: {
      companyId, customerId, actorUserId: base.actor.userId, sessionId: base.actor.sessionId,
      expectedRevision: 4, idempotencyKey: base.idempotencyKey,
      mode: 'move_out', moveOutDate: '2026-09-30', reason: base.reason, createFollowUpTask: true,
    } })
  })

  it.each([
    { mode: 'unknown' }, { moveOutDate: '2026-02-30' }, { moveOutDate: '' },
    { expectedRevision: -1 }, { idempotencyKey: 'invalid key' },
    { actor: { ...base.actor, verified: true } },
    { actor: { ...base.actor, sessionId: undefined } },
  ])('rejects malformed or forged private commands without inventing defaults', async (patch) => {
    await expect(closeCustomerLifecycle({ ...base, ...patch } as never)).rejects.toMatchObject({ code: 'invalid_lifecycle_command', status: 422 })
    expect(fixture.rpc).not.toHaveBeenCalled()
  })

  it.each(['lifecycle_revision_conflict', 'lifecycle_idempotency_conflict', 'lifecycle_state_conflict', 'lifecycle_resource_conflict'])('maps %s to a retained-draft conflict', async (code) => {
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: code } })
    await expect(closeCustomerLifecycle(base)).rejects.toMatchObject({ code, status: 409 })
    expect(fixture.rpc).toHaveBeenCalledTimes(1)
  })

  it.each(['lifecycle_service_required', 'lifecycle_actor_forbidden', 'lifecycle_customer_unavailable', 'lifecycle_tenant_unavailable'])
    ('denies %s without retrying a legacy writer', async (code) => {
      fixture.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: code } })
      await expect(closeCustomerLifecycle(base)).rejects.toMatchObject({ code, status: 403 })
      expect(fixture.rpc).toHaveBeenCalledTimes(1)
    })

  it('fails closed on missing migration and malformed or foreign persisted results', async () => {
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'missing gridex_close_customer_lifecycle_v1(p_command)' } })
    await expect(closeCustomerLifecycle(base)).rejects.toMatchObject({ code: 'platform_schema_not_ready', status: 503 })
    for (const result of [
      { companyId: customerId, customerId, revision: 5, changed: true, replayed: true },
      { companyId, customerId, revision: -1, changed: true, replayed: false },
      { companyId, customerId, revision: 5, changed: true, replayed: 'true' },
    ]) {
      fixture.rpc.mockResolvedValueOnce({ data: result, error: null })
      await expect(closeCustomerLifecycle(base)).rejects.toMatchObject({ code: 'lifecycle_result_invalid', status: 503 })
    }
  })
})
