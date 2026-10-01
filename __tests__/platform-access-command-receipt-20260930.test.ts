import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: mocks.rpc } }))

import { runCanonicalPlatformAccessCommand } from '@/lib/admin/platformUserAccess'

const command = {
  actorUserId: '31317dcf-11c3-45c0-af25-61f900119a73',
  targetUserId: 'f7026c4e-e5c7-48be-a0ac-20ce5c9ec052',
  action: 'set_primary_role' as const,
  roleId: '2133179e-63a8-48de-981a-b1c2459e2f5a',
  idempotencyKey: 'synthetic-platform-receipt',
}

describe('canonical platform-access completion receipt', () => {
  beforeEach(() => { mocks.rpc.mockReset() })

  it.each([
    {},
    [],
    { changed: true, action: command.action, target_user_id: 'another-user' },
    { changed: true, action: 'disable_platform_access', target_user_id: command.targetUserId },
    { changed: 'true', action: command.action, target_user_id: command.targetUserId },
    { changed: true, action: command.action },
  ].map(receipt => ({ receipt })))('rejects a response that cannot prove completion of the requested target/action: $receipt', async ({ receipt }) => {
    mocks.rpc.mockResolvedValue({ data: receipt, error: null })
    await expect(runCanonicalPlatformAccessCommand(command)).rejects.toThrow('Canonical')
  })

  it.each([true, false])('accepts both a persisted change and a verified no-op (%s)', async changed => {
    const receipt = { changed, action: command.action, target_user_id: command.targetUserId, state: { roles: [] } }
    mocks.rpc.mockResolvedValue({ data: receipt, error: null })
    await expect(runCanonicalPlatformAccessCommand(command)).resolves.toEqual(receipt)
    expect(mocks.rpc).toHaveBeenCalledWith('canonical_manage_platform_user_access', {
      p_command: expect.objectContaining({ actor_user_id: command.actorUserId, target_user_id: command.targetUserId,
        action: command.action, idempotency_key: command.idempotencyKey }),
    })
  })

  it('compares canonical UUID text when the supplied UUID uses upper-case letters', async () => {
    const receipt = { changed: true, action: command.action, target_user_id: command.targetUserId }
    mocks.rpc.mockResolvedValue({ data: receipt, error: null })
    await expect(runCanonicalPlatformAccessCommand({ ...command, actorUserId: command.actorUserId.toUpperCase(),
      targetUserId: command.targetUserId.toUpperCase() })).resolves.toEqual(receipt)
    expect(mocks.rpc).toHaveBeenCalledWith('canonical_manage_platform_user_access', {
      p_command: expect.objectContaining({ actor_user_id: command.actorUserId, target_user_id: command.targetUserId }),
    })
  })
})
