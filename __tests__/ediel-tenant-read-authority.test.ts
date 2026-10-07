// Bounded actor READ boundary: declared SDK replies, not native RBAC or source authority.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  membership: null as Row | null,
  profile: null as Row | null,
  membershipError: null as unknown,
  profileError: null as unknown,
  grants: new Map<string, unknown>(),
  permissionErrors: new Map<string, unknown>(),
  queries: [] as Array<{ table: string; filters: unknown[][] }>,
  rpc: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => {
    if (!['company_memberships', 'user_profiles'].includes(table)) throw new Error('Unexpected READ table')
    const observation = { table, filters: [] as unknown[][] }
    io.queries.push(observation)
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { observation.filters.push(['eq', key, value]); return query },
      not: (key: string, operator: string, value: unknown) => { observation.filters.push(['not', key, operator, value]); return query },
      maybeSingle: async () => ({
        data: table === 'company_memberships' ? io.membership : io.profile,
        error: table === 'company_memberships' ? io.membershipError : io.profileError,
      }),
    }
    return query
  },
  rpc: io.rpc,
} }))

import { assertEdielTenantActor } from '@/lib/ediel/services/authorization'

const company = '00000000-0000-4000-8000-000000000001'
const actor = '00000000-0000-4000-8000-000000000002'
const other = '00000000-0000-4000-8000-000000000003'
const scope = { companyId: company, actorUserId: actor }
const readAny = () => assertEdielTenantActor({ ...scope, permissionAnyOf: ['ediel.read', 'communication.read'] })
const communicationRead = () => assertEdielTenantActor({ ...scope, permission: 'communication.read' })

beforeEach(() => {
  io.membership = { company_id: company, user_id: actor, status: 'active', is_active: true, accepted_at: '2026-09-30T12:00:00Z' }
  io.profile = { id: actor, user_status: 'active' }
  io.membershipError = null
  io.profileError = null
  io.grants.clear()
  io.permissionErrors.clear()
  io.queries = []
  io.rpc.mockReset().mockImplementation(async (name: string, args: { p_permission: string }) => {
    if (name !== 'gridex_actor_has_company_permission') throw new Error('Unexpected READ RPC')
    return { data: io.grants.get(args.p_permission) ?? false, error: io.permissionErrors.get(args.p_permission) ?? null }
  })
})

function expectOwnReadBindings(permissions: string[]) {
  expect(io.queries).toHaveLength(2)
  expect(io.queries.find(query => query.table === 'company_memberships')?.filters).toEqual(expect.arrayContaining([
    ['eq', 'company_id', company], ['eq', 'user_id', actor], ['eq', 'status', 'active'],
    ['eq', 'is_active', true], ['not', 'accepted_at', 'is', null],
  ]))
  expect(io.queries.find(query => query.table === 'user_profiles')?.filters).toEqual(expect.arrayContaining([
    ['eq', 'id', actor], ['eq', 'user_status', 'active'],
  ]))
  expect(io.rpc).toHaveBeenCalledTimes(permissions.length)
  for (const permission of permissions) expect(io.rpc).toHaveBeenCalledWith('gridex_actor_has_company_permission', {
    p_actor_user_id: actor, p_company_id: company, p_permission: permission,
  })
}

describe('actual current tenant actor READ boundary', () => {
  // Removing the finite ediel.read limb must fail these calls; no private source is minted.
  it('admits an active accepted own actor with only ediel.read', async () => {
    io.grants.set('ediel.read', true)
    await expect(assertEdielTenantActor({ ...scope, permission: 'ediel.read' })).resolves.toBeUndefined()
    expectOwnReadBindings(['ediel.read'])
  })

  it.each(['ediel.read', 'communication.read'])('admits either existing READ grant: %s', async permission => {
    io.grants.set(permission, true)
    await expect(readAny()).resolves.toBeUndefined()
    expectOwnReadBindings(['ediel.read', 'communication.read'])
  })

  it('refuses both READ grants being absent despite write grants', async () => {
    for (const permission of ['communication.write', 'ediel_testing.write', 'ediel.send']) io.grants.set(permission, true)
    await expect(readAny()).rejects.toThrow('ediel_tenant_permission_forbidden')
    expectOwnReadBindings(['ediel.read', 'communication.read'])
  })

  // An unscoped positive permission result cannot replace qualified current actor facts.
  it.each([
    ['missing', null],
    ['foreign company', { company_id: other, user_id: actor, status: 'active', is_active: true, accepted_at: '2026-09-30T12:00:00Z' }],
    ['wrong actor', { company_id: company, user_id: other, status: 'active', is_active: true, accepted_at: '2026-09-30T12:00:00Z' }],
    ['revoked', { company_id: company, user_id: actor, status: 'revoked', is_active: true, accepted_at: '2026-09-30T12:00:00Z' }],
    ['inactive', { company_id: company, user_id: actor, status: 'active', is_active: false, accepted_at: '2026-09-30T12:00:00Z' }],
    ['unaccepted', { company_id: company, user_id: actor, status: 'active', is_active: true, accepted_at: null }],
  ] as const)('refuses %s membership despite a positive READ permission', async (_name, membership) => {
    io.membership = membership
    io.grants.set('communication.read', true)
    await expect(communicationRead()).rejects.toThrow('ediel_tenant_actor_forbidden')
    expectOwnReadBindings(['communication.read'])
  })

  it.each([
    ['missing', null], ['wrong actor', { id: other, user_status: 'active' }],
    ['inactive', { id: actor, user_status: 'inactive' }],
  ] as const)('refuses %s profile despite a positive READ permission', async (_name, profile) => {
    io.profile = profile
    io.grants.set('communication.read', true)
    await expect(communicationRead()).rejects.toThrow('ediel_tenant_actor_forbidden')
  })

  it.each([1, 'true', {}, null])('requires a literal true permission reply, refusing %j', async reply => {
    io.grants.set('communication.read', reply)
    await expect(communicationRead()).rejects.toThrow('ediel_tenant_permission_forbidden')
  })

  it.each([
    { companyId: '', actorUserId: actor }, { companyId: 'foreign-not-a-uuid', actorUserId: actor },
    { companyId: company, actorUserId: '' }, { companyId: company, actorUserId: 'not-a-uuid' },
  ])('rejects malformed actor scope before any protected reads: %j', async identity => {
    await expect(assertEdielTenantActor({ ...identity, permission: 'communication.read' })).rejects.toThrow('ediel_tenant_actor_required')
    expect(io.queries).toEqual([])
    expect(io.rpc).not.toHaveBeenCalled()
  })

  it.each([
    { permission: 'made_up.read' }, { permission: null },
    { permissionAnyOf: [] }, { permissionAnyOf: ['communication.read', 'made_up.read'] },
  ])('rejects malformed permission requests before protected reads: %j', async permissions => {
    const input = { ...scope, ...permissions } as Parameters<typeof assertEdielTenantActor>[0]
    await expect(assertEdielTenantActor(input)).rejects.toThrow('ediel_tenant_permission_required')
    expect(io.queries).toEqual([])
    expect(io.rpc).not.toHaveBeenCalled()
  })

  // Removing error propagation would let an unrelated successful grant hide unavailable authority.
  it.each(['membership', 'profile'])('propagates %s schema failure despite positive READ', async source => {
    const failure = { code: '42P01', message: 'Declared protected relation unavailable' }
    if (source === 'membership') io.membershipError = failure
    else io.profileError = failure
    io.grants.set('communication.read', true)
    await expect(communicationRead()).rejects.toBe(failure)
  })

  it.each(['ediel.read', 'communication.read'])('propagates the %s failure beside another successful READ grant', async permission => {
    const failure = new Error('Declared permission network failure')
    io.grants.set('ediel.read', true)
    io.grants.set('communication.read', true)
    io.permissionErrors.set(permission, failure)
    await expect(readAny()).rejects.toBe(failure)
    expectOwnReadBindings(['ediel.read', 'communication.read'])
  })

  it('propagates a rejected permission transport promise', async () => {
    const failure = new Error('Declared unavailable permission transport')
    io.rpc.mockRejectedValueOnce(failure)
    await expect(communicationRead()).rejects.toBe(failure)
  })
})
