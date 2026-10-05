import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ actor: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', target: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', company: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', permissions: [] as string[], effects: [] as string[], nativeError: null as unknown, from: vi.fn(), updateAuth: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({ isPlatformAdminContext: () => false, requireCompanyScopedActionAccess: async () => ({ userId: state.actor, permissions: state.permissions, roles: ['company_admin'], isPlatformAdmin: false }) }))
vi.mock('@/lib/tenant/roleChangeGuard', () => ({ assertCompanyRoleChangeAllowed: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/tenant/governance', () => ({ getCompanyById: vi.fn(), logTenantGovernanceEvent: vi.fn().mockResolvedValue(undefined), requireCompanyOperationalForWrites: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: async () => { state.effects.push('native-role-command'); return { data: state.nativeError ? null : { user_id: state.target, role_key: 'customer_service_agent', membership_role: 'support', status: 'active' }, error: state.nativeError } },
  from: state.from,
  auth: { admin: { getUserById: async () => ({ data: { user: { id: state.target, email: 'staff@example.invalid', user_metadata: { full_name: 'Staff' } } }, error: null }), updateUserById: state.updateAuth } },
} }))
import { updateCompanyResponsibleUserAction } from '@/app/admin/company-settings/actions'
import { getRoleProfilePermissions } from '@/lib/admin/accessModel'

function form() {
  const data = new FormData()
  data.set('company_id', state.company); data.set('user_id', state.target); data.set('email', 'staff@example.invalid'); data.set('full_name', 'Staff'); data.set('role_key', 'customer_service_agent')
  return data
}
beforeEach(() => {
  vi.clearAllMocks(); state.effects = []; state.nativeError = null; state.permissions = getRoleProfilePermissions('company_admin')
  state.updateAuth.mockImplementation(async () => { state.effects.push('auth-profile-update'); return { data: { user: { id: state.target } }, error: null } })
  state.from.mockImplementation(table => {
    if (table === 'company_memberships') {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: 'membership', company_id: state.company, user_id: state.target }, error: null }) }
      return query
    }
    if (table === 'user_profiles') return { upsert: async () => { state.effects.push('database-profile-update'); return { data: null, error: null } } }
    throw new Error(`Unexpected table ${table}`)
  })
})

describe('OPS responsible user staff governance adapter', () => {
  it('rejects ceiling escalation before any Auth/profile side effect', async () => {
    state.permissions = ['users.write']
    const result = await updateCompanyResponsibleUserAction({ ok: false, message: '' }, form())
    expect(result.ok).toBe(false)
    expect(state.effects).toEqual([])
    expect(state.from).not.toHaveBeenCalled()
  })
  it('commits the same atomic role command before editing Auth/profile metadata', async () => {
    const result = await updateCompanyResponsibleUserAction({ ok: false, message: '' }, form())
    expect(result.ok).toBe(true)
    expect(state.effects).toEqual(['native-role-command', 'auth-profile-update', 'database-profile-update'])
  })
  it('does not edit Auth/profile after native role authorization becomes invalid', async () => {
    state.nativeError = { code: '42501', message: 'staff_permission_denied' }
    const result = await updateCompanyResponsibleUserAction({ ok: false, message: '' }, form())
    expect(result.ok).toBe(false)
    expect(state.effects).toEqual(['native-role-command'])
  })
})
