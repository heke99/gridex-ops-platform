// Finding 20261029-3f1a8ab1/claude-track5/009: the admin API guard accepted any
// truthy is_platform_admin and let the flag override the customer-only
// exclusion, unlike the page guards. It now applies the same policy: the flag
// counts only as a server-validated boolean and a customer-only identity is
// never an admin.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  user: { id: '', email: 'synthetic-api-admin@example.invalid', app_metadata: {}, user_metadata: {} } as Record<string, unknown>,
  context: {} as Record<string, unknown>,
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: io.user }, error: null }) },
    rpc: async (name: string) => {
      expect(name).toBe('canonical_authenticated_tenant_context')
      return { data: io.context, error: null }
    },
  }),
}))

import { requireAdminApiAccess } from '@/lib/admin/apiGuards'

const USER = '77777777-7777-4777-8777-777777777777'
const PERMISSION = 'integrations.manage'

function context(overrides: Record<string, unknown>) {
  io.context = { authorized: true, user_id: USER, user_email: 'synthetic-api-admin@example.invalid', selected_company_id: null,
    is_platform_admin: false, roles: [], permissions: [], active_permission_keys: [PERMISSION], denied_permissions: [], ...overrides }
}

beforeEach(() => {
  io.user = { id: USER, email: 'synthetic-api-admin@example.invalid', app_metadata: {}, user_metadata: {} }
})

describe('admin API guard and the server-validated is_platform_admin flag', () => {
  it('admits a platform admin whose flag is the boolean true, with all active permissions', async () => {
    context({ is_platform_admin: true })
    const result = await requireAdminApiAccess([PERMISSION])
    expect(result.response).toBeUndefined()
    expect(result.guard).toMatchObject({ userId: USER, isAdmin: true, isPlatformAdmin: true })
  })

  it('denies a non-boolean truthy flag, also when claims or metadata say platform admin', async () => {
    io.user = { ...io.user, app_metadata: { role: 'platform_admin', is_platform_admin: true }, user_metadata: { is_platform_admin: true } }
    for (const flag of ['true', 1, {}, [true]]) {
      context({ is_platform_admin: flag })
      const result = await requireAdminApiAccess([PERMISSION])
      expect(result.guard, JSON.stringify(flag)).toBeUndefined()
      expect(result.response?.status, JSON.stringify(flag)).toBe(403)
    }
  })

  it('does not grant all active permissions for a non-boolean truthy flag', async () => {
    context({ is_platform_admin: 'true', roles: ['company_admin'], permissions: ['customers.read'] })
    const result = await requireAdminApiAccess([PERMISSION])
    expect(result.guard).toBeUndefined()
    expect(result.response?.status).toBe(403)
  })

  it('denies a customer-only identity even with the flag set', async () => {
    context({ is_platform_admin: true, roles: ['customer'] })
    const result = await requireAdminApiAccess([PERMISSION])
    expect(result.guard).toBeUndefined()
    expect(result.response?.status).toBe(403)
  })

  it('denies a platform-like role name when the flag is false and no permission is held', async () => {
    context({ is_platform_admin: false, roles: ['platform_admin'] })
    const result = await requireAdminApiAccess([PERMISSION])
    expect(result.guard).toBeUndefined()
    expect(result.response?.status).toBe(403)
  })

  it('keeps a tenant admin with the permission admitted but not a platform admin', async () => {
    context({ is_platform_admin: false, roles: ['company_admin'], permissions: [PERMISSION] })
    const result = await requireAdminApiAccess([PERMISSION])
    expect(result.guard).toMatchObject({ isAdmin: true, isPlatformAdmin: false })
  })
})
