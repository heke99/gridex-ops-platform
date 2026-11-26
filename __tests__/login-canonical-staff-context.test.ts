import React from 'react'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

type Scope = 'portal' | 'customer member' | 'mixed memberships' | 'staff' | 'platform' | 'unavailable' | 'wrong actor' | 'malformed' | 'inactive'

const fixture = vi.hoisted(() => ({ cookies: new Map<string, string>(), operations: [] as string[], authSequence: 10, accepted: true, scope: 'portal' as Scope, mustChangePassword: false }))
vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [...fixture.cookies].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => { fixture.cookies.set(name, value); fixture.operations.push('session-cookie') },
  }),
}))
const actor = '00000000-0000-4000-8000-000000000001'
const company = '00000000-0000-4000-8000-000000000002'
const customer = '00000000-0000-4000-8000-000000000003'
const caseId = '00000000-0000-4000-8000-000000000004'
const origin = 'http://127.0.0.1:1'
const user = { id: actor, email: 'fixture@example.invalid', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-11-01T00:00:00.000Z' }
const database = Object.freeze({ id: caseId, company_id: company, customer_id: customer, site_id: null, source: 'tenant_support_api', reason_category: 'support',
  support_case: true, title: 'Mitt befintliga ärende', status: 'open', description_visibility: null,
  created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-02T00:00:00.000Z' })
const snapshot = () => JSON.stringify(database)
const token = () => [JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  JSON.stringify({ sub: actor, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }), 'synthetic local fixture only']
  .map(part => Buffer.from(part).toString('base64url')).join('.')

function requireFilter(url: URL, name: string, value: string) {
  expect(url.searchParams.get(name)).toBe(value)
}

async function fixtureTransport(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, init)
  const url = new URL(request.url)
  expect(url.origin).toBe(origin)
  const operation = `${request.method} ${url.pathname}`
  fixture.operations.push(operation)
  switch (operation) {
    case 'POST /auth/v1/token': {
      requireFilter(url, 'grant_type', 'password')
      const body = await request.json()
      expect(body.email).toBe(user.email)
      expect(body.password).toBe('synthetic-fixture-password')
      if (!fixture.accepted) return Response.json({ code: 'invalid_credentials', msg: 'Invalid login credentials' }, { status: 400 })
      fixture.authSequence += 1
      return Response.json({ access_token: token(), token_type: 'bearer', refresh_token: 'synthetic-fixture-refresh', expires_in: 3600, user: { ...user, user_metadata: { must_change_password: fixture.mustChangePassword } } })
    }
    case 'GET /auth/v1/user':
      expect(request.headers.get('authorization')).toMatch(/^Bearer \S+\.\S+\.\S+$/)
      return Response.json(user)
    case 'GET /rest/v1/company_memberships':
      requireFilter(url, 'user_id', `eq.${actor}`)
      return Response.json(fixture.scope === 'staff' ? [{ company_id: company }] : [])
    case 'POST /rest/v1/rpc/gridex_get_user_roles':
      expect(await request.json()).toEqual({ p_user_id: actor })
      return Response.json({ code: 'PGRST202', message: 'Fixture legacy RPC absent' }, { status: 404 })
    case 'POST /rest/v1/rpc/canonical_authenticated_tenant_context': {
      expect(request.headers.get('authorization')).toMatch(/^Bearer \S+\.\S+\.\S+$/)
      expect(await request.json()).toEqual({ p_selected_company_id: null })
      if (fixture.scope === 'unavailable') return Response.json({ code: '08006', message: 'Fixture unavailable' }, { status: 503 })
      if (fixture.scope === 'inactive') return Response.json({ authorized: false, reason_code: 'identity_not_active' })
      const platform = fixture.scope === 'platform'
      const staff = fixture.scope === 'staff'
      const customerMembership = fixture.scope === 'customer member' || fixture.scope === 'mixed memberships'
      const memberships = customerMembership ? [{ company_id: company, role_key: 'customer' }] : []
      if (fixture.scope === 'mixed memberships') {
        memberships.push({ company_id: '00000000-0000-4000-8000-000000000005', role_key: 'operations' })
      }
      return Response.json({
        authorized: true,
        user_id: fixture.scope === 'wrong actor' ? company : actor,
        is_platform_admin: platform,
        selected_company_id: staff || customerMembership ? company : null,
        memberships,
        roles: staff ? ['operations'] : platform ? [] : ['customer'],
        access_invariant_ok: fixture.scope === 'malformed' ? 'false' : staff || platform || customerMembership,
      })
    }
    case 'GET /rest/v1/customer_portal_accounts':
      requireFilter(url, 'user_id', `eq.${actor}`)
      requireFilter(url, 'is_active', 'eq.true')
      return Response.json([{ company_id: company, customer_id: customer, is_active: true, status: 'active', role: 'owner' }])
    case 'GET /rest/v1/customers':
      requireFilter(url, 'id', `in.(${customer})`)
      return Response.json([{ company_id: company, id: customer, customer_number: '42' }])
    case 'GET /rest/v1/companies':
      requireFilter(url, 'id', `eq.${company}`)
      return Response.json({ id: company, name: 'Lokalt provbolag' })
    case 'GET /rest/v1/customer_cases':
      requireFilter(url, 'company_id', `eq.${company}`)
      requireFilter(url, 'customer_id', `in.(${customer})`)
      return Response.json([database])
    case 'POST /rest/v1/rpc/ediel_require_portal_retention_access_v1':
      expect(await request.json()).toEqual({ p_company_id: company, p_customer_id: customer })
      return Response.json(null)
    default: throw Error(`Unexpected synthetic operation ${operation}`)
  }
}

let login: typeof import('@/app/login/actions').loginAction
let renderCases: typeof import('@/app/portal/arenden/page').default
beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', origin)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'synthetic-fixture-anon-key')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-fixture-service-key')
  vi.stubGlobal('fetch', fixtureTransport)
  vi.stubGlobal('React', React)
  login = (await import('@/app/login/actions')).loginAction
  renderCases = (await import('@/app/portal/arenden/page')).default
})
afterAll(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  fixture.operations.length = 0
  fixture.cookies.clear()
  fixture.authSequence = 10
  fixture.accepted = true
  fixture.scope = 'portal'
  fixture.mustChangePassword = false
})

function credentials(next?: string) {
  const form = new FormData()
  form.set('email', ' Fixture@Example.Invalid ')
  form.set('password', 'synthetic-fixture-password')
  if (next) form.set('next', next)
  return form
}

it('lands the legitimate customer in the portal when the canonical staff context is absent', async () => {
  const businessBefore = snapshot()
  const authBefore = fixture.authSequence
  await expect(login(credentials())).rejects.toMatchObject({ digest: 'NEXT_REDIRECT;replace;/portal;307;' })
  expect(fixture.authSequence).toBe(authBefore + 1)
  expect(fixture.cookies.size).toBeGreaterThan(0)
  expect(fixture.operations.filter(x => x !== 'session-cookie')).toEqual([
    'POST /auth/v1/token', 'POST /rest/v1/rpc/canonical_authenticated_tenant_context',
  ])
  expect(fixture.operations.indexOf('session-cookie')).toBeGreaterThan(0)
  const authAfter = fixture.authSequence
  const baseline = snapshot()
  expect(baseline).toEqual(businessBefore)

  const html = renderToStaticMarkup(await renderCases())
  expect(html).toContain('Mitt befintliga ärende')
  expect(html).toContain(`/portal/arenden/${caseId}`)
  expect(fixture.operations).toContain('GET /auth/v1/user')
  expect(fixture.operations).toContain('POST /rest/v1/rpc/ediel_require_portal_retention_access_v1')
  expect(fixture.operations.indexOf('GET /rest/v1/customer_cases')).toBeGreaterThan(fixture.operations.indexOf('GET /auth/v1/user'))
  expect(fixture.authSequence).toBe(authAfter)
  expect(snapshot()).toBe(baseline)
})

it('keeps an ordinary failed login outside business baseline and case reads', async () => {
  fixture.accepted = false
  const before = snapshot()
  await expect(login(credentials())).rejects.toMatchObject({ digest: expect.stringContaining('/login?error=') })
  expect(fixture.cookies.size).toBe(0)
  expect(fixture.authSequence).toBe(10)
  expect(fixture.operations).toEqual(['POST /auth/v1/token'])
  expect(snapshot()).toBe(before)
})


it.each(['staff', 'platform', 'mixed memberships'] as const)('retains dashboard for a legitimate %s actor', async scope => {
  fixture.scope = scope
  await expect(login(credentials())).rejects.toMatchObject({ digest: 'NEXT_REDIRECT;replace;/dashboard;307;' })
  expect(fixture.cookies.size).toBeGreaterThan(0)
})

it('lands a customer-only company member in the portal', async () => {
  fixture.scope = 'customer member'
  await expect(login(credentials())).rejects.toMatchObject({ digest: 'NEXT_REDIRECT;replace;/portal;307;' })
  expect(fixture.cookies.size).toBeGreaterThan(0)
})

it.each(['unavailable', 'wrong actor', 'malformed', 'inactive'] as const)('preserves the existing guarded fallback for %s context', async scope => {
  fixture.scope = scope
  await expect(login(credentials())).rejects.toMatchObject({ digest: 'NEXT_REDIRECT;replace;/dashboard;307;' })
  expect(fixture.cookies.size).toBeGreaterThan(0)
})

it('preserves the explicit portal deep link without consulting a staff context', async () => {
  await expect(login(credentials('/portal/arenden?view=history'))).rejects.toMatchObject({ digest: 'NEXT_REDIRECT;replace;/portal/arenden?view=history;307;' })
  expect(fixture.operations.filter(x => x !== 'session-cookie')).toEqual(['POST /auth/v1/token'])
})

it('preserves the password-change step and uses the resolved portal destination', async () => {
  fixture.mustChangePassword = true
  await expect(login(credentials())).rejects.toMatchObject({ digest: 'NEXT_REDIRECT;replace;/login/update-password?next=%2Fportal;307;' })
})
