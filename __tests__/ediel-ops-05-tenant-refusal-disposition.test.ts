// masterplan: OPS-05, AT-OPS-05
// Actual guard and classifier; only finite database reads are declared here.
// These probes do not establish native authorization or whole OPS-05 approval.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  membership: null as Record<string, unknown> | null,
  profile: null as Record<string, unknown> | null,
  membershipError: null as Error | null,
  profileError: null as Error | null,
  permissions: new Map<string, boolean>(),
  permissionErrors: new Map<string, Error>(),
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      if (!['company_memberships', 'user_profiles'].includes(table)) {
        throw new Error(`Unexpected declared table: ${table}`)
      }
      const query = {
        select: () => query,
        eq: () => query,
        not: () => query,
        maybeSingle: async () => table === 'company_memberships'
          ? { data: io.membership, error: io.membershipError }
          : { data: io.profile, error: io.profileError },
      }
      return query
    },
    rpc: async (name: string, input: { p_permission: string }) => {
      if (name !== 'gridex_actor_has_company_permission') {
        throw new Error(`Unexpected declared RPC: ${name}`)
      }
      return {
        data: io.permissions.get(input.p_permission) ?? false,
        error: io.permissionErrors.get(input.p_permission) ?? null,
      }
    },
  },
}))

import { assertEdielTenantActor } from '@/lib/ediel/services/authorization'
import { classifyEdielFailure, EdielExecutionFailure } from '@/lib/ediel/core/failureDisposition'

const companyId = '00000000-0000-4000-8000-000000000001'
const actorUserId = '00000000-0000-4000-8000-000000000002'
const permissionAnyOf = ['communication.write', 'ediel_testing.write'] as const
const authorize = () => assertEdielTenantActor({ companyId, actorUserId, permissionAnyOf })

beforeEach(() => {
  io.membership = { company_id: companyId, user_id: actorUserId, status: 'active', is_active: true, accepted_at: '2026-09-30T12:00:00Z' }
  io.profile = { id: actorUserId, user_status: 'active' }
  io.membershipError = null
  io.profileError = null
  io.permissions.clear()
  io.permissionErrors.clear()
})

describe('actual current tenant refusals retain security disposition', () => {
  it.each([
    ['permission denied', 'ediel_tenant_permission_forbidden'],
    ['membership missing', 'ediel_tenant_actor_forbidden'],
    ['profile inactive', 'ediel_tenant_actor_forbidden'],
  ])('quarantines %s through the real guard and classifier', async (defect, message) => {
    if (defect !== 'permission denied') io.permissions.set('communication.write', true)
    if (defect === 'membership missing') io.membership = null
    if (defect === 'profile inactive') io.profile = { id: actorUserId, user_status: 'inactive' }

    const failure: unknown = await authorize().catch(error => error)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(message)
    expect(classifyEdielFailure(failure)).toMatchObject({ kind: 'security_quarantine' })
    expect(failure).toBeInstanceOf(EdielExecutionFailure)
  })

  it.each(['communication.write', 'ediel_testing.write'])('retains the allowed AnyOf %s grant', async permission => {
    io.permissions.set(permission, true)

    await expect(authorize()).resolves.toBeUndefined()
  })

  it.each(['membership', 'profile', 'permission'])('preserves a local %s read failure despite a positive grant', async port => {
    const original = new Error(`Declared ${port} read failure`)
    io.permissions.set('communication.write', true)
    if (port === 'membership') io.membershipError = original
    if (port === 'profile') io.profileError = original
    if (port === 'permission') io.permissionErrors.set('ediel_testing.write', original)

    const failure: unknown = await authorize().catch(error => error)

    expect(failure).toBe(original)
    expect(classifyEdielFailure(failure)).toEqual({ kind: 'internal_failure', code: 'EDIEL_INTERNAL_EXECUTION_FAILURE' })
    expect(failure).not.toBeInstanceOf(EdielExecutionFailure)
  })
})
