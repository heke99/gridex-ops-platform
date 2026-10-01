import { beforeEach, expect, it, vi } from 'vitest'

// Keep the actual guards and Next redirect. Only authenticated transport,
// cookie reads and operational memberships are controlled here. The real
// agreement browser fixture grants admin_users only, so SQL returns the
// authoritative platform flag with no projected user_roles or permissions.
const f = vi.hoisted(() => ({
  actor: '11111111-1111-4111-8111-111111111111',
  company: '22222222-2222-4222-8222-222222222222',
  user: true, platform: true, authorized: true, contextActor: '',
  roles: [] as string[], permissions: [] as string[],
  contextError: null as { code: string; message: string } | null,
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: f.company }) }) }))
vi.mock('@/lib/tenant/scope', () => ({ listOperationalCompaniesForUser: async () => [] }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: f.user ? { id: f.actor, email: null } : null }, error: null }) },
  rpc: async () => ({ data: { authorized: f.authorized, reason_code: 'synthetic_current_denial',
    user_id: f.contextActor || f.actor, selected_company_id: f.company, is_platform_admin: f.platform,
    roles: f.roles, permissions: f.permissions }, error: f.contextError }),
}) }))

import { requireAdminAccess, requireAdminActionAccess, requirePlatformAdminAccess,
  requirePlatformAdminActionAccess } from '@/lib/admin/guards'

beforeEach(() => {
  f.user = true; f.platform = true; f.authorized = true; f.contextActor = ''
  f.roles = []; f.permissions = []; f.contextError = null
})

it.each([
  ['admin page', () => requireAdminAccess()],
  ['platform page', () => requirePlatformAdminAccess()],
  ['admin action', () => requireAdminActionAccess(['integrations.write'])],
  ['platform action', () => requirePlatformAdminActionAccess()],
] as const)('the actual %s guard accepts canonical global admin authority with no role or permission projection', async (_, action) => {
  await expect(action()).resolves.toMatchObject({ userId: f.actor, companyId: f.company,
    isAdmin: true, isPlatformAdmin: true, roles: [], permissions: [] })
})
it('canonical global admin authority is retained when a separate customer role is projected', async () => {
  f.roles = ['customer']
  await expect(requirePlatformAdminAccess()).resolves.toMatchObject({ isAdmin: true, isPlatformAdmin: true })
})
it('a platform-named company role does not override a false canonical global flag', async () => {
  f.platform = false; f.roles = ['platform_admin']; f.permissions = ['customers.read']
  await expect(requirePlatformAdminActionAccess()).rejects.toThrow('Endast platform admin')
})
it('revoked canonical authority with no remaining grants redirects away from protected pages', async () => {
  f.platform = false
  await expect(requireAdminAccess()).rejects.toMatchObject({ digest: expect.stringContaining('/login') })
})
it('a customer-only context without canonical global authority cannot enter admin pages', async () => {
  f.platform = false; f.roles = ['customer']; f.permissions = ['customers.read']
  await expect(requireAdminAccess()).rejects.toMatchObject({ digest: expect.stringContaining('/login') })
})
it('an unauthenticated request cannot use a supplied canonical flag', async () => {
  f.user = false
  await expect(requirePlatformAdminAccess()).rejects.toMatchObject({ digest: expect.stringContaining('/login') })
})
it.each(['unauthorized', 'different actor'] as const)('the actual guard rejects a %s context before considering its platform flag', async kind => {
  if (kind === 'unauthorized') f.authorized = false
  else f.contextActor = '33333333-3333-4333-8333-333333333333'
  await expect(requirePlatformAdminAccess()).rejects.toThrow('Behörighetskontrollen nekades')
})
it('a failed canonical read never becomes an admin grant', async () => {
  f.contextError = { code: '57P03', message: 'synthetic_context_unavailable' }
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try { await expect(requirePlatformAdminAccess()).rejects.toThrow('Behörighetskontrollen kunde inte verifieras') }
  finally { log.mockRestore() }
})
