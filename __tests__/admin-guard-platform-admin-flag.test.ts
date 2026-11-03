// Finding 20261029-3f1a8ab1/claude-track5/008: a platform admin granted only
// through admin_users has is_platform_admin=true but no user_roles rows, so the
// admin guard refused every platform action. Only the server-validated context
// flag admits it; role names, JWT claims and user metadata never do.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  user: { id: '', email: 'synthetic-admin@example.invalid', app_metadata: {}, user_metadata: {} } as Record<string, unknown>,
  context: {} as Record<string, unknown>,
  memberships: [] as Array<{ companyId: string; companyStatus: string }>,
}))
vi.mock('react', () => ({ cache: <T>(fn: T) => fn }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw Error(`redirect:${path}`) } }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: io.user }, error: null }) },
    rpc: async (name: string) => {
      expect(name).toBe('canonical_authenticated_tenant_context')
      return { data: io.context, error: null }
    },
  }),
}))
vi.mock('@/lib/tenant/scope', () => ({
  listOperationalCompaniesForUser: async () => io.memberships,
  getOperationalCompanyScope: async () => ({ companyId: io.memberships[0]?.companyId ?? null }),
}))

import { requireAdminAccess, requirePlatformAdminAccess, requirePlatformAdminActionAccess } from '@/lib/admin/guards'

const USER = '55555555-5555-4555-8555-555555555555'
const COMPANY = '66666666-6666-4666-8666-666666666666'
const DENIED = 'Endast platform admin kan utföra den här åtgärden.'

function context(overrides: Record<string, unknown>) {
  io.context = { authorized: true, user_id: USER, user_email: 'synthetic-admin@example.invalid', selected_company_id: null,
    is_platform_admin: false, roles: [], permissions: [], ...overrides }
}

beforeEach(() => {
  io.user = { id: USER, email: 'synthetic-admin@example.invalid', app_metadata: {}, user_metadata: {} }
  io.memberships = []
})

describe('platform admin guard and the server-validated is_platform_admin flag', () => {
  it('admits an admin_users-only platform admin with no roles or permissions', async () => {
    context({ is_platform_admin: true })
    const action = await requirePlatformAdminActionAccess()
    expect(action).toMatchObject({ userId: USER, isAdmin: true, isPlatformAdmin: true, roles: [], permissions: [] })
    await expect(requirePlatformAdminAccess()).resolves.toMatchObject({ isPlatformAdmin: true })
  })

  it('denies an ordinary user', async () => {
    context({ is_platform_admin: false })
    await expect(requirePlatformAdminActionAccess()).rejects.toThrow(DENIED)
    await expect(requireAdminAccess()).rejects.toThrow('redirect:/login')
  })

  it('does not make a tenant admin a platform admin', async () => {
    context({ is_platform_admin: false, selected_company_id: COMPANY, roles: ['company_admin'], permissions: ['customers.read', 'users.manage'] })
    io.memberships = [{ companyId: COMPANY, companyStatus: 'active' }]
    await expect(requirePlatformAdminActionAccess()).rejects.toThrow(DENIED)
    await expect(requirePlatformAdminAccess()).rejects.toThrow('redirect:/admin/company-settings')
    await expect(requireAdminAccess()).resolves.toMatchObject({ isAdmin: true, isPlatformAdmin: false, companyId: COMPANY })
  })

  it('denies a platform-like role name when the flag is false', async () => {
    for (const role of ['platform_admin', 'super_admin', 'Platform Admin']) {
      context({ is_platform_admin: false, roles: [role] })
      await expect(requirePlatformAdminActionAccess(), role).rejects.toThrow(DENIED)
    }
  })

  it('ignores JWT claims, user metadata and a non-boolean flag', async () => {
    io.user = { ...io.user, app_metadata: { role: 'platform_admin', is_platform_admin: true }, user_metadata: { is_platform_admin: true } }
    for (const flag of [false, undefined, 'true', 1]) {
      context({ is_platform_admin: flag })
      await expect(requirePlatformAdminActionAccess(), String(flag)).rejects.toThrow(DENIED)
    }
  })

  it('still refuses a customer-only identity even with the flag set', async () => {
    context({ is_platform_admin: true, roles: ['customer'] })
    await expect(requirePlatformAdminActionAccess()).rejects.toThrow(DENIED)
  })
})
