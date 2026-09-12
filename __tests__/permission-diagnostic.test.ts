import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { isValidElement, type ReactNode } from 'react'
import { getAdminUserById } from '@/lib/rbac/getAdminUserById'
import AdminUserDetailPage from '@/app/admin/users/[id]/page'

const actor = '00000000-0000-4000-8000-000000000015'
const target = '00000000-0000-4000-8000-000000000012'
const io = vi.hoisted(() => ({
  rpc: vi.fn(), auth: vi.fn(), from: vi.fn(), context: vi.fn(),
  calls: [] as string[], platform: true,
}))

// Only transport, request/Next runtime and server-only marker are substituted.
// The page, loader, canonical guard, role/catalog transforms and actions are real imports.
vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`) },
  notFound: () => { throw new Error('not-found') },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: '00000000-0000-4000-8000-000000000015' } }, error: null }) },
    rpc: io.context,
  }),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { rpc: io.rpc, auth: { admin: { getUserById: io.auth } }, from: io.from },
}))

function response(permissions: string[] = ['billing.write']) {
  return { target_user_id: target, scope: 'shared_active_companies', permissions, evaluated_at: '2026-09-12T12:00:00+00:00' }
}

function visibleText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(visibleText).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return visibleText(node.props.children)
  return ''
}

beforeEach(() => {
  vi.clearAllMocks()
  // Supports the repository's JSX transform without changing production imports.
  vi.stubGlobal('React', React)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  io.calls = []
  io.platform = true
  io.context.mockImplementation(async () => {
    io.calls.push('context')
    return { data: { authorized: true, user_id: actor, is_platform_admin: io.platform, roles: ['super_admin'], permissions: ['admin.access'] }, error: null }
  })
  io.rpc.mockImplementation(async () => { io.calls.push('diagnostic'); return { data: response(), error: null } })
  io.auth.mockImplementation(async (id: string) => {
    io.calls.push('target-auth')
    return { data: { user: { id, email: 'synthetic@example.invalid' } }, error: null }
  })
  io.from.mockImplementation((table: string) => {
    io.calls.push(`table:${table}`)
    const query = {
      select: () => query, eq: () => query, in: () => query, order: () => query,
      then: <TResult1 = unknown, TResult2 = never>(
        resolve?: ((value: { data: never[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
        reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
    }
    return query
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const malformed = [
  { name: 'null', data: null }, { name: 'array', data: [] },
  { name: 'wrong target', data: { ...response(), target_user_id: actor } },
  { name: 'wrong scope', data: { ...response(), scope: 'company' } },
  { name: 'missing permissions', data: { ...response(), permissions: undefined } },
  { name: 'nonstring key', data: { ...response(), permissions: [42] } },
  { name: 'null key', data: { ...response(), permissions: [null] } },
  { name: 'empty key', data: { ...response(), permissions: [''] } },
  { name: 'blank key', data: { ...response(), permissions: ['  '] } },
  { name: 'duplicate key', data: { ...response(), permissions: ['a', 'a'] } },
  { name: 'missing evaluation time', data: { ...response(), evaluated_at: undefined } },
  { name: 'invalid evaluation time', data: { ...response(), evaluated_at: 'invalid' } },
  { name: 'ambiguous evaluation time', data: { ...response(), evaluated_at: '2026-09-12' } },
]

describe('actor-bound canonical diagnostic loader', () => {
  it.each([{ permissions: ['billing.write'] }, { permissions: [] }])('returns the canonical set $permissions after actor admission', async ({ permissions }) => {
    io.rpc.mockImplementation(async () => { io.calls.push('diagnostic'); return { data: response(permissions), error: null } })
    const user = await getAdminUserById(actor, target)
    expect(user?.effectivePermissions).toEqual(permissions)
    expect(io.rpc).toHaveBeenCalledWith('canonical_get_platform_user_permission_diagnostic', { p_actor_user_id: actor, p_target_user_id: target })
    expect(io.calls.slice(0, 2)).toEqual(['diagnostic', 'target-auth'])
    expect(io.auth).toHaveBeenCalledWith(target)
  })

  it.each(malformed)('rejects $name before privileged target reads', async ({ data }) => {
    io.rpc.mockResolvedValue({ data, error: null })
    await expect(getAdminUserById(actor, target)).rejects.toThrow('Behörighetsdiagnostiken är inte tillgänglig.')
    expect(io.auth).not.toHaveBeenCalled()
    expect(io.from).not.toHaveBeenCalled()
  })

  it.each(['42501', 'P0002', '22012'])('fails closed for canonical error %s with bounded logging', async code => {
    io.rpc.mockResolvedValue({ data: response([]), error: { code, message: 'private'.repeat(100), details: 'private details' } })
    await expect(getAdminUserById(actor, target)).rejects.toThrow('Behörighetsdiagnostiken är inte tillgänglig.')
    expect(io.auth).not.toHaveBeenCalled()
    expect(io.from).not.toHaveBeenCalled()
    expect(JSON.stringify(vi.mocked(console.error).mock.calls).length).toBeLessThan(300)
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private details')
  })

  it('converts transport rejection to the same unavailable outcome', async () => {
    io.rpc.mockRejectedValue(new Error('transport failed'))
    await expect(getAdminUserById(actor, target)).rejects.toThrow('Behörighetsdiagnostiken är inte tillgänglig.')
    expect(io.auth).not.toHaveBeenCalled()
  })

  it('preserves downstream target-detail errors after successful admission', async () => {
    io.auth.mockResolvedValue({ data: { user: null }, error: new Error('auth detail failed') })
    await expect(getAdminUserById(actor, target)).rejects.toThrow('auth detail failed')
    expect(io.from).not.toHaveBeenCalled()
  })
})

describe('platform page uses the real guard and real diagnostic loader', () => {
  it.each([{ permissions: [] }, { permissions: ['billing.write'] }])('renders a successful shared count for $permissions', async ({ permissions }) => {
    io.rpc.mockImplementation(async () => { io.calls.push('diagnostic'); return { data: response(permissions), error: null } })
    const page = await AdminUserDetailPage({ params: Promise.resolve({ id: target }) })
    const text = visibleText(page)
    expect(text).toContain(`Behörigheter via minst en aktiv bolagskoppling eller plattformsbehörighet: ${permissions.length}`)
    expect(io.rpc).toHaveBeenCalledWith('canonical_get_platform_user_permission_diagnostic', { p_actor_user_id: actor, p_target_user_id: target })
    expect(io.calls.indexOf('context')).toBeLessThan(io.calls.indexOf('diagnostic'))
    expect(io.calls.indexOf('diagnostic')).toBeLessThan(io.calls.indexOf('target-auth'))
  })

  it.each(malformed)('does not render zero for $name', async ({ data }) => {
    io.rpc.mockResolvedValue({ data, error: null })
    await expect(AdminUserDetailPage({ params: Promise.resolve({ id: target }) })).rejects.toThrow('Behörighetsdiagnostiken är inte tillgänglig.')
    expect(io.auth).not.toHaveBeenCalled()
  })

  it('propagates a canonical failure instead of rendering a permission count', async () => {
    io.rpc.mockResolvedValue({ data: response([]), error: { code: '42501', message: 'denied' } })
    await expect(AdminUserDetailPage({ params: Promise.resolve({ id: target }) })).rejects.toThrow('Behörighetsdiagnostiken är inte tillgänglig.')
    expect(io.auth).not.toHaveBeenCalled()
  })

  it('does not infer platform admission from a platform-looking role name', async () => {
    io.platform = false
    await expect(AdminUserDetailPage({ params: Promise.resolve({ id: target }) })).rejects.toThrow('redirect:/login')
    expect(io.rpc).not.toHaveBeenCalled()
    expect(io.auth).not.toHaveBeenCalled()
  })

  it('retains the real page admission failure before calling the diagnostic', async () => {
    io.context.mockResolvedValue({ data: { authorized: false, user_id: actor }, error: null })
    await expect(AdminUserDetailPage({ params: Promise.resolve({ id: target }) })).rejects.toThrow(/Behörighetskontrollen nekades/)
    expect(io.rpc).not.toHaveBeenCalled()
    expect(io.auth).not.toHaveBeenCalled()
    expect(io.from).not.toHaveBeenCalled()
  })
})
