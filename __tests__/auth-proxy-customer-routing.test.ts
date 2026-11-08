// Local AUTH01.02 /196: proxy routing component proof, not real Auth/RLS or whole-scenario approval.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const io = vi.hoisted(() => ({
  getUser: vi.fn(), signOut: vi.fn(), sessionRpc: vi.fn(), createClient: vi.fn(),
  memberSelect: vi.fn(), memberEq: vi.fn(), memberLimit: vi.fn(),
  serviceFrom: vi.fn(), serviceRpc: vi.fn(),
  refresh: false,
}))
vi.mock('@supabase/ssr', () => ({ createServerClient: io.createClient }))
vi.mock('@/lib/env/supabasePublic', () => ({
  getSupabasePublicEnv: () => ({ url: 'http://127.0.0.1:1', anonKey: 'synthetic-public-test-port' }),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { from: io.serviceFrom, rpc: io.serviceRpc },
}))

import { proxy } from '@/proxy'

const ACTOR = '11111111-1111-4111-8111-111111111111'
const COMPANY = '22222222-2222-4222-8222-222222222222'
const ORIGIN = 'https://gridex-proxy-fixture.example.invalid'
const request = (path: string) => new NextRequest(new URL(path, ORIGIN))
const destination = (response: Response) => response.headers.get('location')

beforeEach(() => {
  vi.clearAllMocks()
  io.refresh = false
  io.getUser.mockResolvedValue({ data: { user: { id: ACTOR, user_metadata: {} } }, error: null })
  io.signOut.mockResolvedValue({ error: null })
  io.sessionRpc.mockImplementation(async (name: string) => {
    if (name === 'gridex_is_current_session_allowed') return { data: true, error: null }
    if (name === 'gridex_get_user_roles') return { data: [], error: null }
    throw new Error('unexpected_session_rpc')
  })
  io.serviceRpc.mockImplementation(async (name: string) => {
    if (name !== 'gridex_get_user_roles') throw new Error('unexpected_service_rpc')
    return { data: [], error: null }
  })
  const query = { select: io.memberSelect, eq: io.memberEq, limit: io.memberLimit }
  io.memberSelect.mockReturnValue(query)
  io.memberEq.mockReturnValue(query)
  io.memberLimit.mockResolvedValue({ data: [], error: null })
  io.serviceFrom.mockImplementation((table: string) => {
    if (table !== 'company_memberships') throw new Error('forbidden_database_table')
    return query
  })
  io.createClient.mockImplementation((_url: string, _key: string, options: {
    cookies: { setAll: (cookies: Array<{ name: string; value: string; options: { httpOnly: boolean } }>) => void }
  }) => {
    if (io.refresh) options.cookies.setAll([{ name: 'synthetic-refresh', value: 'renewed', options: { httpOnly: true } }])
    return { auth: { getUser: io.getUser, signOut: io.signOut }, rpc: io.sessionRpc }
  })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

describe('authenticated customer proxy routing at the real entry', () => {
  it.each(['/admin/users', '/admin/company-settings', '/admin/customers', '/dashboard'])(
    'returns a staffless customer from %s to the portal after session checks', async path => {
      const response = await proxy(request(path))
      expect(destination(response)).toBe(ORIGIN + '/portal')
      expect(io.sessionRpc).toHaveBeenCalledWith('gridex_is_current_session_allowed')
      expect(io.memberEq).toHaveBeenCalledWith('user_id', ACTOR)
      expect(io.serviceRpc).toHaveBeenCalledWith('gridex_get_user_roles', { p_user_id: ACTOR })
    },
  )

  it.each(['/login', '/login?next=%2Fdashboard', '/login?next=https%3A%2F%2Foutside.example.invalid'])(
    'uses the existing persona decision for default/sanitized login %s', async path => {
      expect(destination(await proxy(request(path)))).toBe(ORIGIN + '/portal')
      expect(io.memberEq).toHaveBeenCalledWith('user_id', ACTOR)
    },
  )

  it('preserves an explicit safe portal deep link', async () => {
    expect(destination(await proxy(request('/login?next=%2Fportal%2Fstatus')))).toBe(ORIGIN + '/portal/status')
  })

  it('preserves an explicit admin next but denies it on its own protected request', async () => {
    expect(destination(await proxy(request('/login?next=%2Fadmin%2Fusers')))).toBe(ORIGIN + '/admin/users')
    expect(destination(await proxy(request('/admin/users')))).toBe(ORIGIN + '/portal')
  })

  it('does not grant staff routing from user-controlled metadata', async () => {
    io.getUser.mockResolvedValue({ data: { user: { id: ACTOR, user_metadata: { role: 'super_admin', company_id: COMPANY } } }, error: null })
    expect(destination(await proxy(request('/admin/users')))).toBe(ORIGIN + '/portal')
  })

  it('retains refreshed session cookies on the customer redirect', async () => {
    io.refresh = true
    const response = await proxy(request('/login'))
    expect(destination(response)).toBe(ORIGIN + '/portal')
    expect(response.cookies.get('synthetic-refresh')?.value).toBe('renewed')
  })
})

describe('existing staff and failure boundaries remain authoritative', () => {
  it('retains the nonplatform staff refusal for platform pages', async () => {
    io.memberLimit.mockResolvedValue({ data: [{ company_id: COMPANY }], error: null })
    expect(destination(await proxy(request('/admin/users')))).toBe(ORIGIN + '/admin/company-settings')
  })

  it('retains staff dashboard access and default landing', async () => {
    io.memberLimit.mockResolvedValue({ data: [{ company_id: COMPANY }], error: null })
    expect(destination(await proxy(request('/dashboard')))).toBeNull()
    expect(destination(await proxy(request('/login')))).toBe(ORIGIN + '/dashboard')
  })

  it('retains verified platform-role access without tenant membership', async () => {
    io.serviceRpc.mockResolvedValue({ data: ['platform_admin'], error: null })
    io.sessionRpc.mockImplementation(async (name: string) => ({ data: name === 'gridex_get_user_roles' ? ['platform_admin'] : true, error: null }))
    expect(destination(await proxy(request('/admin/users')))).toBeNull()
  })

  it('keeps the portal and self-claim available without a staff lookup', async () => {
    expect(destination(await proxy(request('/portal/koppla-kund?bolag=synthetic')))).toBeNull()
    expect(io.serviceFrom).not.toHaveBeenCalled()
  })

  it('keeps anonymous public login and protected-path login redirect', async () => {
    io.getUser.mockResolvedValue({ data: { user: null }, error: null })
    expect(destination(await proxy(request('/login')))).toBeNull()
    const target = new URL(destination(await proxy(request('/admin/users?view=synthetic')))!)
    expect(target.pathname).toBe('/login')
    expect(target.searchParams.get('next')).toBe('/admin/users?view=synthetic')
    expect(io.serviceFrom).not.toHaveBeenCalled()
  })

  it('checks required password continuation before customer routing', async () => {
    io.getUser.mockResolvedValue({ data: { user: { id: ACTOR, user_metadata: { must_change_password: true } } }, error: null })
    const target = new URL(destination(await proxy(request('/admin/users')))!)
    expect(target.pathname).toBe('/login/update-password')
    expect(target.searchParams.get('next')).toBe('/admin/users')
    expect(io.serviceFrom).not.toHaveBeenCalled()
  })

  it('signs out a disabled session before any persona lookup', async () => {
    io.sessionRpc.mockResolvedValue({ data: false, error: null })
    const target = new URL(destination(await proxy(request('/admin/users')))!)
    expect(target.pathname).toBe('/login')
    expect(target.searchParams.get('reason')).toBe('account_disabled')
    expect(io.signOut).toHaveBeenCalledTimes(1)
    expect(io.serviceFrom).not.toHaveBeenCalled()
  })

  it('holds protected requests on session infrastructure failure', async () => {
    io.sessionRpc.mockResolvedValue({ data: null, error: { code: 'synthetic_session_error' } })
    const response = await proxy(request('/dashboard'))
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('retry-after')).toBe('15')
    expect(io.serviceFrom).not.toHaveBeenCalled()
  })

  it('retains platform-role infrastructure failure without granting access', async () => {
    io.memberLimit.mockResolvedValue({ data: [{ company_id: COMPANY }], error: null })
    io.sessionRpc.mockImplementation(async (name: string) => name === 'gridex_get_user_roles'
      ? { data: null, error: { code: 'synthetic_roles_error' } } : { data: true, error: null })
    expect((await proxy(request('/admin/users'))).status).toBe(503)
  })

  it('keeps public login renderable but protected routes closed on provider outage', async () => {
    io.getUser.mockRejectedValue(new Error('synthetic_provider_error'))
    expect((await proxy(request('/login'))).status).toBe(200)
    expect((await proxy(request('/dashboard'))).status).toBe(503)
    expect(io.serviceFrom).not.toHaveBeenCalled()
  })

  it('preserves the existing persona helper staff fallback on lookup error', async () => {
    io.memberLimit.mockResolvedValue({ data: null, error: { code: 'synthetic_membership_error' } })
    expect(destination(await proxy(request('/login')))).toBe(ORIGIN + '/dashboard')
  })
})
