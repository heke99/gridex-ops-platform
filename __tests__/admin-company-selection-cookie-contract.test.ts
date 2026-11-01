// Real action/GET/Next cookies/API guard/period-lock flow. Only Auth, canonical
// context, membership and billing persistence ports are finite in-memory doubles.
// No browser, database, provider, session token or campaign-PASS claim.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import Cookies from 'nodemailer/lib/fetch/cookies'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import type RenderResult from 'next/dist/server/render-result'
import { NextRequest, NextResponse } from 'next/server'
import { RequestCookies } from 'next/dist/server/web/spec-extension/cookies'
import { appendMutableCookies, MutableRequestCookiesAdapter } from 'next/dist/server/web/spec-extension/adapters/request-cookies'
import { getURLFromRedirectError } from 'next/dist/client/components/redirect'
import { isRedirectError } from 'next/dist/client/components/redirect-error'

const io = vi.hoisted(() => ({
  incoming: null as NextRequest | null,
  outgoing: null as NextResponse | null,
  authenticated: true,
  memberships: [] as string[],
  visibleMemberships: null as string[] | null,
  platform: false,
  contextFailure: false,
  malformed: false,
  deny: false,
  persistenceFailure: false,
  adminCompanies: null as string[] | null,
  deniedAdminCompanies: [] as string[],
  wrongContextUser: false,
  wrongContextCompany: false,
  calls: [] as (string | null)[],
  locks: new Map<string, Record<string, unknown>>(),
}))
const USER = '00000000-0000-4000-8000-000000000001'
const A = '00000000-0000-4000-8000-000000000002'
const B = '00000000-0000-4000-8000-000000000003'
const FOREIGN = '00000000-0000-4000-8000-000000000004'
const ORIGIN = 'https://ops.example.invalid'
const SELECTED = 'gridex_admin_selected_company_id'
const MODE = 'gridex_admin_navigation_mode'
const API = `${ORIGIN}/api/internal/billing/period-locks`

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
vi.mock('next/headers', () => ({
  headers: async () => {
    if (!io.incoming) throw new Error('request port not initialized')
    return io.incoming.headers
  },
  cookies: async () => {
    if (!io.incoming || !io.outgoing) throw new Error('request port not initialized')
    return {
      get: io.incoming.cookies.get.bind(io.incoming.cookies),
      set: io.outgoing.cookies.set.bind(io.outgoing.cookies),
    }
  },
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: io.authenticated ? { id: USER, email: 'synthetic@example.invalid' } : null }, error: null }) },
    rpc: async (name: string, args: { p_selected_company_id: string | null }) => {
      if (name !== 'canonical_authenticated_tenant_context') throw new Error('undeclared RPC')
      const selected = args.p_selected_company_id
      io.calls.push(selected)
      if (io.contextFailure) return { data: null, error: { code: 'CONTROLLED', message: 'context unavailable' } }
      if (io.malformed) return { data: { authorized: true, user_id: USER, roles: ['company_admin'], permissions: ['billing_underlay.export'], selected_company_id: selected }, error: null }
      const allowed = selected === null || io.memberships.includes(selected)
      const resolved = selected ?? (io.platform ? null : io.memberships[0])
      const scopedAdmin = io.adminCompanies === null || (resolved !== null && io.adminCompanies.includes(resolved))
      const adminDenied = resolved !== null && io.deniedAdminCompanies.includes(resolved)
      return { data: {
        authorized: allowed, user_id: io.wrongContextUser ? FOREIGN : USER, user_email: 'synthetic@example.invalid',
        selected_company_id: allowed ? (io.wrongContextCompany ? A : resolved) : null,
        is_platform_admin: io.platform, roles: io.platform ? [] : scopedAdmin ? ['company_admin'] : ['customer'],
        permissions: scopedAdmin && !adminDenied ? ['billing_underlay.read', 'billing_underlay.export'] : [],
        active_permission_keys: ['billing_underlay.read', 'billing_underlay.export'],
        denied_permissions: io.deny || adminDenied ? ['billing_underlay.read', 'billing_underlay.export'] : [],
      }, error: null }
    },
  }),
}))
vi.mock('@/lib/tenant/scope', () => ({
  listOperationalCompaniesForUser: async (user: string) => {
    if (user !== USER) throw new Error('foreign actor')
    return (io.visibleMemberships ?? io.memberships).map(companyId => ({ companyId, companyName: companyId, companySlug: null, orgNumber: null, membershipRole: io.adminCompanies === null ? 'owner' : io.adminCompanies.includes(companyId) ? 'admin' : 'member', status: 'active', companyStatus: 'active' }))
  },
  assertUserCanOperateCompany: async (user: string, company: string | null) => {
    if (user !== USER || !company || !io.memberships.includes(company)) throw new Error('company not operable')
    return company
  },
  assertTenantUserCanReadCompany: async () => { throw new Error('undeclared history read') },
  requireOperationalCompanyId: async () => { throw new Error('undeclared fallback') },
}))
vi.mock('@/lib/billing/invoiceReadiness', () => ({
  getBillingPeriodLock: async ({ companyId }: { companyId: string }) => io.locks.get(companyId) ?? null,
  lockBillingPeriod: async (input: { companyId: string; billingMonth: string; status: string; actorUserId: string }) => {
    if (io.persistenceFailure) throw new Error('controlled persistence unavailable')
    if (!io.memberships.includes(input.companyId) || input.actorUserId !== USER) throw new Error('undeclared persistence target')
    const lock = { company_id: input.companyId, billing_month: input.billingMonth, status: input.status }
    io.locks.set(input.companyId, lock)
    return lock
  },
  unlockBillingPeriod: async () => { throw new Error('undeclared unlock') },
}))

import { updateAdminNavigationPreference } from '@/app/admin/navigation-mode/actions'
import { GET as writeNavigation } from '@/app/admin/navigation-mode/route'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { GET as readLock, POST as writeLock } from '@/app/api/internal/billing/period-locks/route'

function request(jar: Cookies, path: string, init: NonNullable<ConstructorParameters<typeof NextRequest>[1]> = {}) {
  const url = new URL(path, ORIGIN).href
  const headers = new Headers(init.headers)
  headers.set('cookie', jar.get(url))
  io.incoming = new NextRequest(url, { ...init, headers })
  io.outgoing = NextResponse.next()
  return io.incoming
}
function absorb(jar: Cookies, response: NextResponse, url: string) {
  for (const header of response.headers.getSetCookie()) jar.set(header, url)
}
function legacyJar(company = A) {
  const jar = new Cookies()
  jar.set(`${SELECTED}=${company}; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=15552000`, `${ORIGIN}/admin`)
  return jar
}
type NavigationHop = { url: string; response: NextResponse }
function finalize(response: NextResponse) {
  const mutable = MutableRequestCookiesAdapter.wrap(new RequestCookies(new Headers()))
  mutable.set('synthetic_auth_refresh', 'synthetic', { path: '/', httpOnly: true })
  const headers = new Headers(response.headers)
  appendMutableCookies(headers, mutable)
  return new NextResponse(response.body, { status: response.status, headers })
}
async function navigateWriter(jar: Cookies, start: string, authRefresh = false) {
  const hops: NavigationHop[] = []
  let url = new URL(start, ORIGIN).href
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await writeNavigation(request(jar, url))
    const response = authRefresh ? finalize(raw) : raw
    hops.push({ url, response })
    absorb(jar, response, url)
    const location = response.headers.get('location')
    if (!location) throw new Error(`selection refused with status ${response.status}`)
    const next = new URL(location, url)
    if (next.origin !== ORIGIN) throw new Error('foreign selection redirect')
    if (next.pathname !== '/admin/navigation-mode') return { response, hops }
    url = next.href
  }
  throw new Error('unbounded selection redirect')
}
async function directSelect(jar: Cookies, company = B, mode = 'company', next = '/admin/billing?tab=locks', authRefresh = false) {
  const params = new URLSearchParams({ mode, company_id: company, next })
  return navigateWriter(jar, `/admin/navigation-mode?${params}`, authRefresh)
}
async function actionSelect(jar: Cookies, company = B, mode = 'company', referer = `${ORIGIN}/admin/billing?tab=locks`) {
  const req = request(jar, '/admin', { headers: { referer } })
  const form = new FormData()
  form.set('mode', mode)
  form.set('company_id', company)
  let target: string | null = null
  try { await updateAdminNavigationPreference(form) } catch (error) {
    if (!isRedirectError(error)) throw error
    target = getURLFromRedirectError(error)
  }
  if (!target || !io.outgoing) throw new Error('missing actual action redirect')
  const actionHeaders = io.outgoing.headers.getSetCookie()
  absorb(jar, io.outgoing, req.url)
  const destination = new URL(target, ORIGIN)
  expect(destination.origin).toBe(ORIGIN)
  expect(destination.pathname).toBe('/admin/navigation-mode')
  const { response, hops } = await navigateWriter(jar, destination.href)
  return { response, destination, actionHeaders, hops }
}
async function postLock(jar: Cookies) {
  return writeLock(request(jar, API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ billing_month: '2026-10', action: 'lock' }) }))
}
beforeEach(() => {
  io.incoming = null; io.outgoing = null; io.authenticated = true
  io.memberships = [A, B]; io.visibleMemberships = null; io.platform = false; io.contextFailure = false
  io.adminCompanies = null; io.deniedAdminCompanies = []; io.wrongContextUser = false; io.wrongContextCompany = false
  io.malformed = false; io.deny = false; io.persistenceFailure = false; io.calls = []; io.locks = new Map()
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('admin company selection transport to the actual internal API', () => {
  it('canonical GET migrates legacy A to root B, so the real guard and handler affect only B', async () => {
    const jar = legacyJar()
    await directSelect(jar)
    // Browser path matching, not a manually injected selected-company value.
    const response = await postLock(jar)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { lock: { company_id: B, status: 'locked' } } })
    expect(jar.get(API)).toBe(`${SELECTED}=${B}`)
    expect(io.calls.slice(-2)).toEqual([B, B])
    expect(io.locks.get(A)).toBeUndefined()
    expect(io.locks.get(B)).toMatchObject({ company_id: B })
    const read = await readLock(request(jar, `${API}?billing_month=2026-10`))
    expect(await read.json()).toMatchObject({ data: { lock: { company_id: B }, isLocked: true } })
    expect(jar.list(`${ORIGIN}/admin`).filter(c => c.name === SELECTED).map(c => c.value)).toEqual([B])
  })
  it('actual action delegates to GET without mutating cookies, and changing back selects A for the API', async () => {
    const jar = legacyJar()
    const first = await actionSelect(jar)
    expect(first.actionHeaders).toEqual([])
    expect(first.destination.searchParams.get('company_id')).toBe(B)
    expect(first.response.headers.get('location')).toBe(`${ORIGIN}/admin/billing?tab=locks`)
    expect((await postLock(jar)).status).toBe(200)
    expect(io.locks.get(B)).toMatchObject({ company_id: B })
    const savedB = io.locks.get(B)
    await actionSelect(jar, A)
    expect((await postLock(jar)).status).toBe(200)
    expect(io.locks.get(A)).toMatchObject({ company_id: A })
    expect(io.locks.get(B)).toEqual(savedB)
  })
  it.each([false, true])('JS action internal RSC probing forces browser navigation instead of losing cookies in a followed redirect (company-scoped admin=%s)', async scoped => {
    io.adminCompanies = scoped ? [B] : null
    const jar = legacyJar(scoped ? B : A)
    request(jar, '/admin', { headers: { referer: `${ORIGIN}/admin/billing?tab=locks` } })
    const form = new FormData()
    form.set('mode', 'company'); form.set('company_id', B)
    let target = ''
    try { await updateAdminNavigationPreference(form) } catch (error) {
      if (!isRedirectError(error)) throw error
      target = getURLFromRedirectError(error)
    }
    expect(new URL(target, ORIGIN).pathname).toBe('/admin/navigation-mode')

    // Exercise the installed Next action handler, exposing only this otherwise
    // private function in an in-memory module copy. All its imports stay real;
    // its one fetch port simulates ordinary redirect following without I/O.
    const require = createRequire(import.meta.url)
    const modulePath = require.resolve('next/dist/server/app-render/action-handler')
    const localRequire = createRequire(modulePath)
    type RequestPort = { headers: Record<string, string> }
    type ResponsePort = { getHeaders: () => Record<string, string>; setHeader: (key: string, value: string) => void }
    type Renderer = (req: RequestPort, res: ResponsePort, host: { value: string }, target: string, type: string, basePath: string, store: object, pathname: string) => Promise<RenderResult>
    const mod = { exports: {} as { controlledRender?: Renderer } }
    const fetched: { rsc: string | null; status: number }[] = []
    runInNewContext(readFileSync(modulePath, 'utf8') + '\nexports.controlledRender = createRedirectRenderResult;', {
      require: localRequire, module: mod, exports: mod.exports, Headers, Request, Response, URL, process, Buffer, console,
      fetch: async (url: URL, init: { headers: Headers; redirect?: string }) => {
        const response = finalize(await writeNavigation(request(jar, String(url), { headers: init.headers })))
        fetched.push({ rsc: init.headers.get('rsc'), status: response.status })
        if (response.status >= 300 && response.status < 400) {
          // Fetch follows the GET's redirect to an admin RSC page. Intermediate
          // Set-Cookie headers do not become browser response headers.
          return new Response('finite-admin-flight', { headers: { 'content-type': 'text/x-component' } })
        }
        return response
      },
    }, { filename: modulePath })
    const req = { headers: { host: 'ops.example.invalid', cookie: jar.get(`${ORIGIN}/admin`) } }
    const { setRequestMeta } = localRequire('next/dist/server/request-meta') as { setRequestMeta: (req: RequestPort, meta: { initURL: string }) => void }
    setRequestMeta(req, { initURL: `${ORIGIN}/admin` })
    const responseHeaders: Record<string, string> = {}
    const res = { getHeaders: () => responseHeaders, setHeader: (key: string, value: string) => { responseHeaders[key] = value } }
    if (!mod.exports.controlledRender) throw new Error('installed Next redirect handler unavailable')
    const rendered = await mod.exports.controlledRender(req, res, { value: 'ops.example.invalid' }, target, 'push', '', {}, '/admin')
    // EMPTY means no Flight data; Next's client performs a normal navigation to
    // x-action-redirect. Only that navigation should apply cookie mutations.
    expect(rendered.isNull).toBe(true)
    expect(fetched).toEqual([{ rsc: '1', status: 204 }])
    expect(responseHeaders['set-cookie']).toBeUndefined()
    expect(jar.get(API)).toBe('')
    await navigateWriter(jar, new URL(target, ORIGIN).href, true)
    expect((await postLock(jar)).status).toBe(200)
    expect(io.locks.get(B)).toMatchObject({ company_id: B })
    expect(io.locks.get(A)).toBeUndefined()
  })
  it('selection survives the actual Next route finalizer when Auth refresh also modifies cookies', async () => {
    const jar = legacyJar()
    const { hops } = await directSelect(jar, B, 'company', '/admin/billing', true)
    expect(hops).toHaveLength(3)
    // Empty values alone are legal cookies. Explicit expired dates must survive
    // Next's finalizer, which drops numeric Max-Age=0 while reparsing.
    for (const hop of hops.slice(0, 2)) {
      const cleared = hop.response.headers.getSetCookie().find(h => h.startsWith(`${SELECTED}=`))!
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970 00:00:00 GMT/i)
    }
    const apiResponse = await postLock(jar)
    expect(apiResponse.status).toBe(200)
    expect(await apiResponse.json()).toMatchObject({ data: { lock: { company_id: B } } })
    expect(io.locks.get(A)).toBeUndefined()
    expect(jar.list(`${ORIGIN}/admin`).filter(c => c.name === SELECTED).map(c => c.value)).toEqual([B])
    expect(jar.list(API).find(c => c.name === 'synthetic_auth_refresh')?.value).toBe('synthetic')
  })
  it('uses one selected-name cookie per response and clears both paths before the root selection', async () => {
    const { response, hops } = await directSelect(legacyJar())
    expect(hops).toHaveLength(3)
    const selected = hops.map(h => h.response.headers.getSetCookie().filter(c => c.startsWith(`${SELECTED}=`)))
    expect(selected.map(h => h.length)).toEqual([1, 1, 1])
    expect(selected[0][0]).toMatch(/Path=\/admin;.*Max-Age=0/i)
    expect(selected[1][0]).toMatch(/Path=\/;.*Max-Age=0/i)
    expect(selected[2][0]).toMatch(/Path=\/;.*Max-Age=15552000.*HttpOnly.*SameSite=lax/i)
    expect(selected.flat().every(h => !/; Domain=/i.test(h))).toBe(true)
    for (const hop of hops) expect(hop.response.headers.get('cache-control')).toBe('no-store, private, max-age=0')
    expect(response.headers.getSetCookie().find(h => h.startsWith(`${MODE}=`))).toMatch(/Path=\/admin/i)
  })
  it('platform clear expires both existing paths while retaining only the admin presentation cookie', async () => {
    const jar = legacyJar()
    jar.set(`${SELECTED}=${B}; Path=/; HttpOnly; SameSite=Lax; Max-Age=15552000`, ORIGIN)
    io.platform = true
    const { hops } = await actionSelect(jar, '', 'platform')
    expect(hops).toHaveLength(3)
    expect(hops.every(h => h.response.headers.getSetCookie().filter(c => c.startsWith(`${SELECTED}=`)).length === 1)).toBe(true)
    expect(jar.get(API)).toBe('')
    expect(jar.get(`${ORIGIN}/admin`)).toBe(`${MODE}=platform`)
    request(jar, API)
    const result = await requireAdminApiAccess(['billing_underlay.read'])
    expect(result.guard).toMatchObject({ isPlatformAdmin: true, companyId: null })
    expect(io.calls.at(-1)).toBeNull()
    expect(io.locks.size).toBe(0)
  })
  it('keeps host-only, HttpOnly, SameSite and 180-day lifetime while mode stays /admin', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T12:00:00Z'))
    const jar = legacyJar()
    const { response } = await directSelect(jar)
    expect(jar.get(`${ORIGIN}/administrator`)).toBe(`${SELECTED}=${B}`)
    expect(jar.get('https://other.example.invalid/api/internal')).toBe('')
    expect(jar.get('https://child.ops.example.invalid/api/internal')).toBe('')
    const selected = response.headers.getSetCookie().find(h => h.startsWith(`${SELECTED}=${B};`))!
    expect(selected).toMatch(/HttpOnly/i); expect(selected).toMatch(/SameSite=lax/i)
    // Preserve the existing non-Secure policy; the cookie is an untrusted selector, not an Auth token.
    expect(selected).not.toMatch(/; Secure(?:;|$)/i)
    expect(jar.get('http://ops.example.invalid/api/internal')).toBe(`${SELECTED}=${B}`)
    vi.advanceTimersByTime(15552001 * 1000)
    expect(jar.get(API)).toBe('')
  })
  it.each([FOREIGN, 'not-a-company', ''])('validates requested selector %j before sending an authorized API target', async company => {
    const jar = legacyJar()
    await actionSelect(jar, company)
    expect(jar.get(API)).toBe(`${SELECTED}=${A}`)
    expect((await postLock(jar)).status).toBe(200)
    expect(io.locks.get(FOREIGN)).toBeUndefined()
    expect(io.locks.get(A)).toMatchObject({ company_id: A })
  })
  it.each(['select', 'clear-root'])('direct/replayed %s cannot complete with stale legacy and root cookies', async phase => {
    const jar = legacyJar()
    jar.set(`${SELECTED}=${B}; Path=/; HttpOnly; Max-Age=15552000`, ORIGIN)
    const params = new URLSearchParams({ mode: 'company', company_id: B, cookie_step: phase })
    let response = await writeNavigation(request(jar, `/admin/navigation-mode?${params}`))
    response = finalize(response)
    absorb(jar, response, `${ORIGIN}/admin/navigation-mode`)
    if (phase === 'clear-root') {
      const target = response.headers.get('location')
      expect(target).not.toBeNull()
      response = await writeNavigation(request(jar, target!))
    }
    expect(response.status).toBe(409)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.getSetCookie().filter(h => h.startsWith(`${SELECTED}=`) || h.startsWith(`${MODE}=`))).toEqual([])
    expect(io.locks.size).toBe(0)
    // A normal restart removes both stale paths, then actually selects B.
    await directSelect(jar, B, 'company', '/admin', true)
    expect(jar.list(`${ORIGIN}/admin`).filter(c => c.name === SELECTED).map(c => c.value)).toEqual([B])
    expect((await postLock(jar)).status).toBe(200)
    expect(io.locks.get(A)).toBeUndefined()
  })
  it('a final phase with no stale incoming selector still revalidates the requested company', async () => {
    const jar = new Cookies()
    const params = new URLSearchParams({ mode: 'company', company_id: FOREIGN, cookie_step: 'select' })
    const response = await writeNavigation(request(jar, `/admin/navigation-mode?${params}`))
    absorb(jar, finalize(response), `${ORIGIN}/admin/navigation-mode`)
    expect((await postLock(jar)).status).toBe(200)
    expect(io.locks.get(A)).toMatchObject({ company_id: A })
    expect(io.locks.get(FOREIGN)).toBeUndefined()
  })
  it.each(['unknown', '', 'SELECT', 'select/../clear-root'])('rejects malformed phase %j without cookies or a redirect', async phase => {
    const params = new URLSearchParams({ mode: 'company', company_id: B, cookie_step: phase })
    const response = await writeNavigation(request(legacyJar(), `/admin/navigation-mode?${params}`))
    expect(response.status).toBe(400)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.getSetCookie()).toEqual([])
  })
  it.each(['', '&cookie_step=clear-root', '&cookie_step=select'])('RSC probes of every valid phase%s return private 204 without selection/nav writes', async phase => {
    const response = await writeNavigation(request(legacyJar(), `/admin/navigation-mode?mode=company&company_id=${B}${phase}`, { headers: { rsc: '1' } }))
    expect(response.status).toBe(204)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.getSetCookie()).toEqual([])
    expect(response.headers.get('cache-control')).toBe('no-store, private, max-age=0')
    expect(response.headers.get('content-type')).not.toBe('text/x-component')
  })
  it('a forged root selector is still refused by the actual canonical-context guard', async () => {
    const jar = new Cookies()
    jar.set(`${SELECTED}=${FOREIGN}; Path=/; HttpOnly`, ORIGIN)
    expect((await postLock(jar)).status).toBe(403)
    expect(io.locks.size).toBe(0)
  })
  it.each([['no session', 401], ['RPC failure', 503], ['malformed context', 503], ['explicit denial', 403]] as const)('refuses %s without persistence', async (failure, status) => {
    const jar = new Cookies()
    jar.set(`${SELECTED}=${B}; Path=/; HttpOnly`, ORIGIN)
    io.authenticated = failure !== 'no session'
    io.contextFailure = failure === 'RPC failure'
    io.malformed = failure === 'malformed context'
    io.deny = failure === 'explicit denial'
    expect((await postLock(jar)).status).toBe(status)
    expect(io.locks.size).toBe(0)
  })
  it('a persistence failure is an actual 500 and never a successful company effect', async () => {
    const jar = new Cookies(); jar.set(`${SELECTED}=${B}; Path=/; HttpOnly`, ORIGIN)
    io.persistenceFailure = true
    expect((await postLock(jar)).status).toBe(500)
    expect(io.locks.size).toBe(0)
  })
  it('writer refuses failed authentication and context before producing cookies', async () => {
    const jar = legacyJar(); io.authenticated = false
    await expect(directSelect(jar)).rejects.toMatchObject({ message: 'NEXT_REDIRECT' })
    expect(io.outgoing?.headers.getSetCookie()).toEqual([])
    io.authenticated = true; io.contextFailure = true
    await expect(directSelect(jar)).rejects.toThrow('Behörighetskontrollen kunde inte verifieras')
    expect(jar.get(API)).toBe('')
  })
  it.each(['https://evil.example.invalid/admin?next=https://evil.example.invalid', 'not a URL', `${ORIGIN}/customer`])('action keeps return navigation on the application origin for referer %j', async referer => {
    const { response, destination } = await actionSelect(legacyJar(), B, 'company', referer)
    expect(destination.origin).toBe(ORIGIN)
    expect(new URL(response.headers.get('location')!).origin).toBe(ORIGIN)
  })
  it.each(['https://evil.example.invalid/admin', '//evil.example.invalid/admin', '/admin/navigation-mode?mode=company', '/admin/../../api/internal/x', '/administrator'])('GET refuses unsafe/recursive return target %j', async next => {
    const { response } = await directSelect(legacyJar(), B, 'company', next)
    expect(response.headers.get('location')).toBe(`${ORIGIN}/admin`)
  })
})


describe('company-scoped admin continuity through selection cleanup', () => {
  async function hop(jar: Cookies, url: string, rsc = false) {
    const response = finalize(await writeNavigation(request(jar, url, { headers: rsc ? { rsc: '1' } : {} })))
    absorb(jar, response, new URL(url, ORIGIN).href)
    return response
  }
  async function start(jar: Cookies, company = B, mode = 'company') {
    const url = `/admin/navigation-mode?${new URLSearchParams({ mode, company_id: company, next: '/admin/billing?tab=locks' })}`
    const response = await hop(jar, url)
    expect(response.status).toBe(307)
    const next = response.headers.get('location')
    if (!next) throw new Error('missing continuation')
    return next
  }
  function deliberateCookies(response: NextResponse) {
    return response.headers.getSetCookie().filter(h => h.startsWith(`${SELECTED}=`) || h.startsWith(`${MODE}=`))
  }
  beforeEach(() => { io.adminCompanies = [B] })

  it('retains B admin authorization when default A is customer-only, with real finalization and exact B API effect', async () => {
    const jar = legacyJar(B)
    const { response, hops } = await directSelect(jar, B, 'company', '/admin/billing?tab=locks', true)
    expect(hops).toHaveLength(3)
    expect(hops.slice(1).map(h => new URL(h.url).searchParams.get('admin_company_id'))).toEqual([B, B])
    expect(io.calls).toEqual([B, B, B])
    expect(response.headers.get('location')).toBe(`${ORIGIN}/admin/billing?tab=locks`)
    expect((await postLock(jar)).status).toBe(200)
    expect(io.locks.get(B)).toMatchObject({ company_id: B })
    expect(io.locks.get(A)).toBeUndefined()
    expect(jar.list(`${ORIGIN}/admin`).filter(c => c.name === SELECTED).map(c => c.value)).toEqual([B])
  })
  it('revalidates the B authorizing context for RSC probes and ordinary responses at every hop', async () => {
    const jar = legacyJar(B)
    let url = `/admin/navigation-mode?mode=company&company_id=${B}`
    for (let index = 0; index < 3; index++) {
      const probe = await hop(jar, url, true)
      expect(probe.status).toBe(204)
      expect(probe.headers.get('location')).toBeNull()
      expect(deliberateCookies(probe)).toEqual([])
      const ordinary = await hop(jar, url)
      expect(ordinary.status).toBe(307)
      url = ordinary.headers.get('location')!
    }
    expect(io.calls).toEqual([B, B, B, B, B, B])
    expect((await postLock(jar)).status).toBe(200)
    expect(io.locks.get(A)).toBeUndefined()
  })
  it('can select a different member A without borrowing B admin permissions for A API effects', async () => {
    const jar = legacyJar(B)
    const { hops } = await directSelect(jar, A, 'company', '/admin', true)
    expect(hops).toHaveLength(3)
    expect(io.calls).toEqual([B, B, B])
    expect(jar.list(API).find(c => c.name === SELECTED)?.value).toBe(A)
    expect((await postLock(jar)).status).toBe(403)
    expect(io.locks.size).toBe(0)
  })
  it('retains the existing nonplatform platform-mode clear admission from B', async () => {
    const jar = legacyJar(B)
    const { hops } = await directSelect(jar, '', 'platform', '/admin', true)
    expect(hops).toHaveLength(3)
    expect(io.calls).toEqual([B, B, B])
    expect(jar.list(`${ORIGIN}/admin`).filter(c => c.name === SELECTED)).toEqual([])
    expect((await postLock(jar)).status).toBe(403) // Default A remains customer-only.
    expect(io.locks.size).toBe(0)
  })
  it('keeps platform clear available to a genuine platform admin with no operational memberships', async () => {
    io.platform = true; io.memberships = []
    const jar = new Cookies()
    await directSelect(jar, '', 'platform', '/admin', true)
    expect(jar.list(`${ORIGIN}/admin`).filter(c => c.name === SELECTED)).toEqual([])
    expect(jar.list(`${ORIGIN}/admin`).find(c => c.name === MODE)?.value).toBe('platform')
  })
  it.each([1, 2])('refuses a revoked B membership before cleanup continuation %s writes cookies', async stage => {
    const jar = legacyJar(B)
    let url = await start(jar)
    if (stage === 2) { const result = await hop(jar, url); url = result.headers.get('location')! }
    io.memberships = [A]
    const response = await hop(jar, url)
    expect(response.status).toBe(403)
    expect(deliberateCookies(response)).toEqual([])
    expect(response.headers.get('location')).toBeNull()
    expect(io.locks.size).toBe(0)
  })
  it('preserves the nonplatform operational-membership gate even when canonical admin context remains valid', async () => {
    const jar = legacyJar(B)
    const url = await start(jar)
    io.visibleMemberships = []
    const response = await hop(jar, url)
    expect(response.status).toBe(403)
    expect(deliberateCookies(response)).toEqual([])
    expect(response.headers.get('location')).toBeNull()
  })
  it.each(['lost admin role', 'effective DENY', 'lost session', 'wrong actor', 'RPC failure', 'wrong exact company'] as const)('refuses %s between hops rather than trusting continuation data', async failure => {
    const jar = legacyJar(B)
    const url = await start(jar)
    if (failure === 'lost admin role') io.adminCompanies = []
    if (failure === 'effective DENY') io.deniedAdminCompanies = [B]
    if (failure === 'lost session') io.authenticated = false
    if (failure === 'wrong actor') io.wrongContextUser = true
    if (failure === 'RPC failure') io.contextFailure = true
    if (failure === 'wrong exact company') io.wrongContextCompany = true
    const response = await hop(jar, url)
    expect(response.status).toBe(failure === 'lost session' ? 401 : failure === 'RPC failure' ? 503 : 403)
    expect(deliberateCookies(response)).toEqual([])
    expect(response.headers.get('location')).toBeNull()
    expect(io.locks.size).toBe(0)
  })
  it.each([false, true])('refuses a foreign authorizing-context query, including RSC=%s', async rsc => {
    const jar = legacyJar(B)
    const url = new URL(await start(jar))
    url.searchParams.set('admin_company_id', FOREIGN)
    const response = await hop(jar, url.href, rsc)
    expect(response.status).toBe(403)
    expect(deliberateCookies(response)).toEqual([])
    expect(response.headers.get('location')).toBeNull()
  })
  it('does not treat a desired target change to foreign as authorization or propagate foreign selection', async () => {
    const jar = legacyJar(B)
    const url = new URL(await start(jar))
    url.searchParams.set('company_id', FOREIGN)
    const next = await hop(jar, url.href)
    expect(next.status).toBe(307)
    const final = await hop(jar, next.headers.get('location')!)
    expect(final.status).toBe(307)
    expect(jar.list(API).find(c => c.name === SELECTED)?.value).toBe(A) // Existing first-membership fallback.
    expect((await postLock(jar)).status).toBe(403)
    expect(io.locks.size).toBe(0)
  })
  it('keeps ordinary initial entry on the unchanged ambient page-guard policy', async () => {
    const jar = new Cookies() // A customer context, despite an untrusted B admin-company query.
    await expect(writeNavigation(request(jar, `/admin/navigation-mode?mode=company&company_id=${B}&admin_company_id=${B}`))).rejects.toMatchObject({ message: 'NEXT_REDIRECT' })
    expect(io.outgoing?.headers.getSetCookie()).toEqual([])
  })
})
