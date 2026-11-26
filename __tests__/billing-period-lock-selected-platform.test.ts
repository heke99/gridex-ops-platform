import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/internal/billing/period-locks/route'
import { ADMIN_SELECTED_COMPANY_COOKIE } from '@/lib/admin/navigationPreferences'

const actor = '00000000-0000-4000-8000-000000000001'
const selected = '00000000-0000-4000-8000-000000000002'
const other = '00000000-0000-4000-8000-000000000003'
const currentLock = '00000000-0000-4000-8000-000000000004'
const origin = 'http://127.0.0.1:1'
const readPermission = 'billing_underlay.read'
const io = vi.hoisted(() => ({
  authenticated: true,
  platform: true,
  requested: null as NextRequest | null,
  companyStatus: 'active' as string | null,
  allowRead: true,
  rejectNextContext: false,
  otherNextContext: false,
  companyAbsent: false,
  lockUnavailable: false,
  contexts: [] as (string | null)[],
  membershipReads: 0,
  legacyRoleReads: 0,
  companyReads: [] as string[],
  lockReads: [] as URL[],
}))

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: async () => io.requested?.cookies }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => {
    const scoped = client('actor')
    return { auth: { getUser: async () => ({ data: { user: io.authenticated ? { id: actor } : null }, error: null }) }, rpc: scoped.rpc.bind(scoped) }
  },
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: client('service') }))

function client(kind: 'actor' | 'service') {
  return createClient('http://127.0.0.1:1', 'synthetic-test-only', {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: (input, init) => transport(kind, new Request(input, init)) },
  })
}

async function transport(kind: 'actor' | 'service', request: Request) {
  const url = new URL(request.url)
  expect(url.origin).toBe(origin)
  if (kind === 'actor' && url.pathname === '/rest/v1/rpc/canonical_authenticated_tenant_context' && request.method === 'POST') {
    const { p_selected_company_id: company } = await request.json()
    io.contexts.push(company)
    const recheck = io.contexts.length === 2
    const permitted = company === selected || company === null && io.platform
    return Response.json({
      authorized: permitted,
      user_id: actor,
      selected_company_id: permitted ? recheck && io.otherNextContext ? other : company : null,
      is_platform_admin: io.platform,
      roles: io.platform ? [] : ['company_admin'],
      permissions: io.platform ? [] : [readPermission],
      active_permission_keys: [readPermission],
      denied_permissions: !io.allowRead || recheck && io.rejectNextContext ? [readPermission] : [],
    })
  }
  if (kind === 'service' && url.pathname === '/rest/v1/rpc/gridex_get_user_roles' && request.method === 'POST') {
    expect(await request.json()).toEqual({ p_user_id: actor })
    io.legacyRoleReads += 1
    return Response.json({ code: 'PGRST202', message: 'Legacy lookup absent in exact schema' }, { status: 404 })
  }
  expect(kind).toBe('service')
  expect(request.method).toBe('GET')
  if (url.pathname === '/rest/v1/company_memberships') {
    io.membershipReads += 1
    expect(url.searchParams.get('user_id')).toBe(`eq.${actor}`)
    expect(url.searchParams.get('status')).toBe('eq.active')
    return Response.json(io.platform ? [] : [{
      company_id: selected, status: 'active', membership_role: 'admin', companies: { id: selected, name: 'Syntetiskt bolag', status: io.companyStatus },
    }])
  }
  if (url.pathname === '/rest/v1/companies') {
    io.companyReads.push(url.searchParams.get('id') ?? '')
    expect(url.searchParams.get('id')).toBe(`eq.${selected}`)
    expect(url.searchParams.get('select')).toBe('id,status')
    return Response.json(io.companyAbsent ? [] : [{ id: selected, status: io.companyStatus }])
  }
  if (url.pathname === '/rest/v1/billing_period_locks') {
    io.lockReads.push(url)
    if (io.lockUnavailable) return Response.json({ code: '08006', message: 'private fixture detail' }, { status: 500 })
    expect(url.searchParams.get('company_id')).toBe(`eq.${selected}`)
    expect(url.searchParams.get('billing_year')).toBe('eq.2026')
    expect(url.searchParams.get('billing_month')).toBe('eq.10')
    return Response.json([{ id: currentLock, company_id: selected, status: 'locked' }])
  }
  throw Error('Undeclared local period lock transport')
}

function readLock(company: string | null = selected, month = '2026-10') {
  const request = new NextRequest(`${origin}/api/internal/billing/period-locks?billing_month=${month}&company_id=${other}`)
  if (company) request.cookies.set(ADMIN_SELECTED_COMPANY_COOKIE, company)
  io.requested = request
  return GET(request)
}

beforeEach(() => {
  Object.assign(io, {
    authenticated: true, platform: true, requested: null, companyStatus: 'active', allowRead: true, rejectNextContext: false,
    otherNextContext: false, companyAbsent: false, lockUnavailable: false, contexts: [], membershipReads: 0, legacyRoleReads: 0,
    companyReads: [], lockReads: [],
  })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

it.each(['active', 'onboarding'])('reads the selected %s company for an authorized platform actor without a membership', async status => {
  io.companyStatus = status
  const response = await readLock()
  expect(response.status, `canonical=${io.contexts.length}, legacyRoles=${io.legacyRoleReads}, memberships=${io.membershipReads}, lockReads=${io.lockReads.length}`).toBe(200)
  expect(await response.json()).toEqual({ data: { billingMonth: '2026-10', isLocked: true, lock: { id: currentLock, company_id: selected, status: 'locked' } } })
  expect(io.contexts).toEqual([selected, selected])
  expect(io.companyReads).toEqual([`eq.${selected}`])
  expect(io.membershipReads).toBe(0)
  expect(io.legacyRoleReads).toBe(0)
  expect(io.lockReads).toHaveLength(1)
})

it('retains the normal tenant membership read and same selected company', async () => {
  io.platform = false
  expect((await readLock()).status).toBe(200)
  expect(io.contexts).toEqual([selected, selected])
  expect(io.membershipReads).toBe(1)
  expect(io.lockReads).toHaveLength(1)
})

it('preserves the missing company and ineligible tenant denies before billing data', async () => {
  expect((await readLock(null)).status).toBe(500)
  io.platform = false
  expect((await readLock(other)).status).toBe(403)
  expect(io.lockReads).toEqual([])
})

it('preserves unauthenticated and permission-denied responses', async () => {
  io.authenticated = false
  expect((await readLock()).status).toBe(401)
  io.authenticated = true
  io.allowRead = false
  expect((await readLock()).status).toBe(403)
  expect(io.lockReads).toEqual([])
})

it.each(['paused', 'suspended', 'closed', null])('retains the strict operational lifecycle check for %s', async status => {
  io.companyStatus = status
  expect((await readLock()).status).toBe(500)
  expect(io.lockReads).toEqual([])
})

it.each(['rejectNextContext', 'otherNextContext', 'companyAbsent'] as const)('keeps a changed or missing scope held before business lookup (%s)', async flag => {
  io[flag] = true
  expect((await readLock()).status).toBe(500)
  expect(io.lockReads).toEqual([])
})

it('preserves invalid month handling before business lookup', async () => {
  expect((await readLock(selected, '2026-13')).status).toBe(400)
  expect(io.lockReads).toEqual([])
})

it('keeps actual database failures generic and traceable', async () => {
  io.lockUnavailable = true
  const result = await readLock()
  expect(result.status).toBe(500)
  const body = await result.json()
  expect(body).toMatchObject({ code: 'billing_period_lock_read_failed', trace_id: expect.any(String) })
  expect(JSON.stringify(body)).not.toContain('private fixture detail')
  expect(io.lockReads).toHaveLength(1)
})
