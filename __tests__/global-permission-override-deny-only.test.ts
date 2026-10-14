// Real server action and canonical command builder; finite transport only.
// Native global-deny constraint rollout is verified separately from these checks.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  commands: [] as Array<Record<string, unknown>>,
  reads: [] as Array<{ table: string; id: string; filters?: Record<string, unknown> }>,
  rows: {} as Record<string, Array<Record<string, unknown>>>,
  authorize: vi.fn(),
  revalidate: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: io.revalidate }))
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminActionAccess: io.authorize }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'synthetic-platform-actor' } }, error: null }) } }) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  auth: { admin: { getUserById: async (userId: string) => ({ data: { user: { id: userId } }, error: null }) } },
  rpc: async (name: string, args: { p_command: Record<string, unknown> }) => {
    if (name !== 'canonical_manage_platform_user_access') throw new Error('Unexpected native command')
    io.commands.push(args.p_command)
    return { data: { changed: true, action: args.p_command.action, target_user_id: args.p_command.target_user_id }, error: null }
  },
  from: (table: string) => {
    if (!(table in io.rows)) throw new Error('Unexpected database read')
    const filters: Record<string, unknown> = {}
    const run = async (single = false) => {
      io.reads.push({ table, id: String(filters.id ?? ''), ...(table === 'permissions' ? {} : { filters: { ...filters } }) })
      const rows = io.rows[table].filter(row => Object.entries(filters).every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : (row[key] ?? null) === value))
      return { data: single ? rows[0] ?? null : rows, error: null }
    }
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters[key] = value; return query },
      is: (key: string, value: unknown) => { filters[key] = value; return query },
      in: (key: string, value: unknown[]) => { filters[key] = value; return query },
      maybeSingle: () => run(true),
      then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => run().then(resolve, reject),
    }
    return query
  },
} }))

import { addUserPermissionOverrideAction, updateUserPermissionOverridesAction } from '@/app/admin/users/[id]/actions'
import { setUserPermissionOverridesAction } from '@/app/admin/users/actions'
import { runCanonicalPlatformAccessCommand } from '@/lib/admin/platformUserAccess'
import { getAdminUserById } from '@/lib/rbac/getAdminUserById'

function form(effect: string | null) {
  const data = new FormData()
  data.set('userId', 'synthetic-target-user')
  data.set('permissionId', 'synthetic-permission-id')
  if (effect !== null) data.set('effect', effect)
  data.set('reason', 'Synthetic administrative restriction')
  return data
}

beforeEach(() => {
  io.commands = []; io.reads = []
  io.rows = {
    permissions: [{ id: 'synthetic-permission-id', key: 'invoices.read', name: 'Invoices' }, { id: 'synthetic-other-permission', key: 'customers.write', name: 'Customers' }],
    user_roles: [], user_permission_overrides: [],
  }
  io.authorize.mockReset().mockResolvedValue(undefined)
  io.revalidate.mockReset()
})

describe('global permission overrides accept only deny', () => {
  it.each(['allow', 'unexpected', '', null])('rejects %s before a permission lookup or database command', async effect => {
    await expect(addUserPermissionOverrideAction(form(effect))).rejects.toThrow('Globala permission overrides kan endast neka behörighet')
    expect(io.authorize).toHaveBeenCalledOnce()
    expect(io.reads).toEqual([])
    expect(io.commands).toEqual([])
    expect(io.revalidate).not.toHaveBeenCalled()
  })

  it('submits a deny through the real canonical platform command without changing its scope', async () => {
    await addUserPermissionOverrideAction(form('deny'))
    expect(io.authorize).toHaveBeenCalledOnce()
    expect(io.reads).toEqual([{ table: 'permissions', id: 'synthetic-permission-id' }])
    expect(io.commands).toHaveLength(1)
    expect(io.commands[0]).toMatchObject({ actor_user_id: 'synthetic-platform-actor', target_user_id: 'synthetic-target-user', action: 'upsert_override', permission_key: 'invoices.read', effect: 'deny', reason: 'Synthetic administrative restriction' })
    expect(io.commands[0]).not.toHaveProperty('company_id')
    expect(io.revalidate).toHaveBeenCalledWith('/admin/users/synthetic-target-user')
  })

  it('retains authorization before parsing or issuing a canonical command', async () => {
    io.authorize.mockRejectedValueOnce(new Error('Platform access denied'))
    await expect(addUserPermissionOverrideAction(form('deny'))).rejects.toThrow('Platform access denied')
    expect(io.commands).toEqual([])
    expect(io.reads).toEqual([])
  })

  it('rejects a global allow replacement from the detail action before issuing a command', async () => {
    const data = new FormData()
    data.set('user_id', 'synthetic-target-user')
    data.set('allow_permissions', 'invoices.read')
    data.set('deny_permissions', 'customers.write')
    const result = await updateUserPermissionOverridesAction({ ok: false, message: '' }, data)
    expect(result).toMatchObject({ ok: false })
    expect(result.message).toContain('Globala permission overrides kan endast neka behörighet')
    expect(io.commands).toEqual([])
    expect(io.reads).toEqual([])
  })

  it('rejects a global allow replacement from the users action before any permission lookup', async () => {
    const data = new FormData()
    data.set('user_id', 'synthetic-target-user')
    data.set('allow_permissions', 'invoices.read')
    const result = await setUserPermissionOverridesAction({ ok: false, message: '' }, data)
    expect(result).toMatchObject({ ok: false })
    expect(result.message).toContain('Globala permission overrides kan endast neka behörighet')
    expect(io.commands).toEqual([])
    expect(io.reads).toEqual([])
  })

  it.each(['allow', null, undefined] as const)('rejects direct upsert command effect %s before RPC transport', async effect => {
    await expect(runCanonicalPlatformAccessCommand({ actorUserId: 'synthetic-platform-actor', targetUserId: 'synthetic-target-user', action: 'upsert_override', permissionKey: 'invoices.read', effect })).rejects.toMatchObject({ code: '22023' })
    expect(io.commands).toEqual([])
  })

  it('rejects a direct global allow replacement before RPC transport', async () => {
    await expect(runCanonicalPlatformAccessCommand({ actorUserId: 'synthetic-platform-actor', targetUserId: 'synthetic-target-user', action: 'replace_overrides', allowPermissions: ['invoices.read'] })).rejects.toMatchObject({ code: '22023' })
    expect(io.commands).toEqual([])
  })

  it('preserves a deny-only replacement through the detail action', async () => {
    const data = new FormData()
    data.set('user_id', 'synthetic-target-user')
    data.set('allow_permissions', '')
    data.set('deny_permissions', 'customers.write')
    const result = await updateUserPermissionOverridesAction({ ok: false, message: '' }, data)
    expect(result.ok).toBe(true)
    expect(io.commands[0]).toMatchObject({ action: 'replace_overrides', allow_permissions: [], deny_permissions: ['customers.write'] })
  })

  it('keeps role commands outside the global permission-command validation', async () => {
    await runCanonicalPlatformAccessCommand({ actorUserId: 'synthetic-platform-actor', targetUserId: 'synthetic-target-user', action: 'add_role', roleId: 'synthetic-role' })
    expect(io.commands[0]).toMatchObject({ action: 'add_role', role_id: 'synthetic-role' })
  })

  it('limits the global user detail read to global roles and overrides without altering scoped rows', async () => {
    io.rows.user_roles = [
      { id: 'global-role', user_id: 'synthetic-target-user', company_id: null, is_active: true, role_id: 'synthetic-platform-role' },
      { id: 'company-role', user_id: 'synthetic-target-user', company_id: 'synthetic-company', is_active: true, role_id: 'synthetic-company-role' },
    ]
    io.rows.user_permission_overrides = [
      { id: 'global-override', user_id: 'synthetic-target-user', company_id: null, is_active: true, permission_key: 'customers.write', effect: 'deny' },
      { id: 'company-override', user_id: 'synthetic-target-user', company_id: 'synthetic-company', is_active: true, permission_key: 'invoices.read', effect: 'allow' },
    ]
    const user = await getAdminUserById('synthetic-target-user')
    expect(user?.roles.map(row => row.id)).toEqual(['global-role'])
    expect(user?.overrides.map(row => row.id)).toEqual(['global-override'])
    for (const table of ['user_roles', 'user_permission_overrides']) {
      expect(io.reads.find(read => read.table === table)?.filters).toEqual({ user_id: 'synthetic-target-user', is_active: true, company_id: null })
      expect(io.rows[table]).toHaveLength(2)
    }
  })
})
