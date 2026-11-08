// Actual T5 helper and registered AUTH callbacks, finite Auth/HTTP/DB/fixture ports.
// These component controls do not execute a native scenario or award campaign PASS.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseCookieHeader, serializeCookieHeader } from '@supabase/ssr'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(import.meta.dirname, '..')
const TRACK = path.join(ROOT, 'scripts/simulation/track5')
const APP = 'https://ops.example.invalid'
const SELECTED = 'gridex_admin_selected_company_id'
const LOCKS = '/api/internal/billing/period-locks'
const sha = (value: string) => createHash('sha256').update(value).digest('hex')

type Session = {
  fetch: (target: string, init?: RequestInit) => Promise<Response>
  cookieHeader: (target?: string) => string
  cookieValue: (name: string, target?: string) => string | null
  cookieNames: (target?: string) => string[]
  forgeCookieForNegativeTest: (rawSetCookie: string) => void
}
type JarModule = {
  loginViaUi: (email: string, password: string, next?: string) => Promise<Session>
  loginJar: (email: string, password: string) => Promise<Session>
  rawFetch: (header: string, target: string, init?: RequestInit) => Promise<Response>
}
function actualModule(file: string, ports: Record<string, unknown>): Record<string, unknown> {
  const source = fs.readFileSync(file, 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const loaded = { exports: {} }
  const load = (name: string) => {
    if (Object.hasOwn(ports, name)) return ports[name]
    if (name.startsWith('node:') || name === 'nodemailer/lib/fetch/cookies') return require(name)
    throw new Error(`undeclared component import ${name}`)
  }
  new Function('require', 'exports', 'module', code)(load, loaded.exports, loaded)
  return loaded.exports
}
function jarModule(app = APP, sdk?: (cookies: { getAll: () => unknown; setAll: (cookies: unknown[]) => void }) => void): JarModule {
  return actualModule(path.join(TRACK, 'lib/auth01-jar.ts'), {
    './env': { sim: { appUrl: app, apiUrl: 'https://auth.example.invalid', anonKey: 'synthetic-unit-anon-key' } },
    './server-action': { callServerAction: async (session: Session, options: { args: FormData[] }) => {
      const email = String(options.args[0].get('email'))
      const response = await session.fetch('/login', { method: 'POST', headers: { 'x-unit-user': email } })
      return { httpStatus: response.status, redirect: '/admin', threw: false }
    } },
    '@supabase/ssr': { parseCookieHeader, serializeCookieHeader, createServerClient: (_url: string, _key: string, options: { cookies: { getAll: () => unknown; setAll: (cookies: unknown[]) => void } }) => ({
      auth: { signInWithPassword: async () => {
        sdk?.(options.cookies)
        return { data: { user: { id: 'synthetic-user' } }, error: null }
      } },
    }) },
  }) as unknown as JarModule
}
function cookiesResponse(raw: string[], status = 200, location?: string) {
  const headers = new Headers()
  for (const cookie of raw) headers.append('set-cookie', cookie)
  if (location) headers.set('location', location)
  return new Response(null, { status, headers })
}
function transport(raw: string[], app = APP) {
  const requests: { url: string; headers: Headers; redirect?: RequestRedirect }[] = []
  vi.stubGlobal('fetch', async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), app)
    requests.push({ url: url.href, headers: new Headers(init.headers), redirect: init.redirect })
    if (url.pathname === '/login') return cookiesResponse(['sb-unit-auth-token=synthetic; Path=/; HttpOnly'], 303, '/admin')
    if (url.pathname === '/set') return cookiesResponse(raw)
    return Response.json({ ok: true })
  })
  return { requests, async session() { return jarModule(app).loginViaUi('synthetic@example.invalid', 'synthetic-password') } }
}
const sent = (requests: { headers: Headers }[]) => requests.at(-1)?.headers.get('cookie') ?? ''
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('actual T5 same-origin cookie transport', () => {
  it('does not send a server Path=/admin selector to the API', async () => {
    const port = transport([`${SELECTED}=B; Path=/admin; HttpOnly`])
    const session = await port.session()
    await session.fetch('/set'); await session.fetch(LOCKS)
    expect(sent(port.requests)).not.toContain(SELECTED)
    await session.fetch('/admin/billing')
    expect(sent(port.requests)).toContain(`${SELECTED}=B`)
    await session.fetch('/administrator')
    expect(sent(port.requests)).not.toContain(SELECTED)
  })
  it('preserves root/admin identities and deletes only the expired path even when flags differ', async () => {
    const port = transport(['choice=root; Path=/; HttpOnly', 'choice=admin; Path=/admin; HttpOnly'])
    const session = await port.session(); await session.fetch('/set')
    session.forgeCookieForNegativeTest('choice=; Path=/admin; Max-Age=0')
    await session.fetch('/admin')
    expect(sent(port.requests)).toContain('choice=root')
    expect(sent(port.requests)).not.toContain('choice=admin')
  })
  it('sorts longer paths first regardless of creation order', async () => {
    const port = transport(['choice=root; Path=/', 'choice=admin; Path=/admin'])
    const session = await port.session(); await session.fetch('/set'); await session.fetch('/admin/x')
    expect(sent(port.requests).split('; ').filter(pair => pair.startsWith('choice='))).toEqual(['choice=admin', 'choice=root'])
  })
  it('treats Secure as a send restriction, not a second cookie identity', async () => {
    const port = transport(['choice=old; Path=/; Secure; HttpOnly', 'choice=new; Path=/'])
    const session = await port.session(); await session.fetch('/set'); await session.fetch('/admin')
    expect(sent(port.requests).split('; ').filter(pair => pair.startsWith('choice='))).toEqual(['choice=new'])
    const insecure = transport(['secure=secret; Path=/; Secure'], 'http://ops.example.invalid')
    const httpSession = await insecure.session(); await httpSession.fetch('/set'); await httpSession.fetch('/admin')
    expect(sent(insecure.requests)).not.toContain('secure=')
  })
  it.each(['foreign.example.invalid', 'example.invalid'])('refuses unsupported Domain=%s instead of coercing it into app scope', async domain => {
    const port = transport([`choice=foreign; Domain=${domain}; Path=/`])
    const session = await port.session()
    await expect(session.fetch('/set')).rejects.toThrow()
  })
  it('normalizes exact-host Domain spelling for replacement and deletion', async () => {
    const port = transport(['choice=old; Path=/; HttpOnly', 'choice=new; Domain=.ops.example.invalid; Path=/'])
    const session = await port.session(); await session.fetch('/set')
    session.forgeCookieForNegativeTest('choice=; Domain=ops.example.invalid; Path=/; Max-Age=0')
    await session.fetch('/admin')
    expect(sent(port.requests)).not.toContain('choice=')
  })
  it('preserves case-sensitive and attribute-keyword cookie names and valid empty values', async () => {
    const port = transport(['MiXeD=upper; Path=/', 'mixed=lower; Path=/', 'Path=named; Path=/', 'empty=; Path=/'])
    const session = await port.session(); await session.fetch('/set'); await session.fetch('/admin')
    const header = sent(port.requests)
    for (const pair of ['MiXeD=upper', 'mixed=lower', 'Path=named', 'empty=']) expect(header).toContain(pair)
  })
  it.each(['age=alive; Max-Age=60; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/', 'age=alive; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=60; Path=/'])('gives valid Max-Age precedence independent of attribute order: %s', async raw => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2031-01-01T00:00:00Z'))
    const port = transport([raw]); const session = await port.session(); await session.fetch('/set'); await session.fetch('/admin')
    expect(sent(port.requests)).toContain('age=alive')
    vi.advanceTimersByTime(60_000); await session.fetch('/admin')
    expect(sent(port.requests)).not.toContain('age=')
  })
  it('refuses a valid but unrepresentable Max-Age instead of falling back to an expired date', async () => {
    const port = transport(['age=alive; Max-Age=999999999999999999999999; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/'])
    const session = await port.session()
    await expect(session.fetch('/set')).rejects.toThrow('HARNESS_COOKIE_UNSUPPORTED_EXPIRY')
  })
  it('refuses an unsupported partitioned cookie and preserves ambiguous name evidence', async () => {
    const port = transport(['choice=root; Path=/', 'choice=admin; Path=/admin'])
    const session = await port.session(); await session.fetch('/set')
    expect(() => session.cookieValue('choice', '/admin')).toThrow('HARNESS_COOKIE_AMBIGUOUS_NAME')
    expect(() => session.forgeCookieForNegativeTest('partition=value; Path=/; Partitioned')).toThrow('HARNESS_COOKIE_UNSUPPORTED_PARTITION')
  })
  it('raw frozen-cookie requests also refuse foreign origins before transport', () => {
    const port = transport([]); const helper = jarModule()
    expect(() => helper.rawFetch('sb-unit=synthetic', 'https://foreign.example.invalid/admin')).toThrow('HARNESS_COOKIE_UNSUPPORTED_ORIGIN')
    expect(port.requests).toHaveLength(0)
  })
  it('does not invent expiry for session cookies or treat invalid Max-Age as deletion', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2031-01-01T00:00:00Z'))
    const port = transport(['session=alive; Path=/', 'invalid=alive; Max-Age=oops; Path=/'])
    const session = await port.session(); await session.fetch('/set')
    vi.advanceTimersByTime(31 * 60_000); await session.fetch('/admin')
    expect(sent(port.requests)).toContain('session=alive')
    expect(sent(port.requests)).toContain('invalid=alive')
  })
  it.each(['default=ok', 'default=ok; Path=not-absolute'])('uses the response URL default directory for %s', async cookie => {
    const requests: string[] = []
    vi.stubGlobal('fetch', async (_url: string | URL, init: RequestInit = {}) => {
      requests.push(new Headers(init.headers).get('cookie') ?? '')
      if (String(_url).includes('/login')) return cookiesResponse(['sb-unit=synthetic; Path=/'], 303)
      return cookiesResponse([cookie])
    })
    const session = await jarModule().loginViaUi('synthetic', 'synthetic')
    await session.fetch('/nested/set')
    await session.fetch('/outside')
    expect(requests.at(-1)).not.toContain('default=')
    await session.fetch('/nested/read')
    expect(requests.at(-1)).toContain('default=ok')
  })
  it.each(['https://foreign.example.invalid/admin', '//foreign.example.invalid/admin', 'https://user:pass@ops.example.invalid/admin', 'file:///admin'])('refuses unsafe target %s before sending any cookie', async target => {
    const port = transport([]); const session = await port.session(); const count = port.requests.length
    await expect(session.fetch(target)).rejects.toThrow()
    expect(port.requests).toHaveLength(count)
  })
  it('always uses manual redirects and refuses caller Cookie overrides in natural requests', async () => {
    const port = transport([]); const session = await port.session()
    await session.fetch('/admin', { redirect: 'follow', headers: new Headers({ 'x-control': 'preserved' }) })
    expect(port.requests.at(-1)?.redirect).toBe('manual')
    expect(port.requests.at(-1)?.headers.get('x-control')).toBe('preserved')
    await expect(session.fetch('/admin', { headers: [['Cookie', 'forged=positive']] })).rejects.toThrow()
  })
  it('roundtrips structured SSR chunks/options through actual installed serializer/parser without losing expired chunks', async () => {
    let inspect: (() => unknown) | undefined
    vi.stubGlobal('fetch', async () => Response.json({ ok: true }))
    const sdk = jarModule(APP, cookies => {
      cookies.setAll([
        { name: 'sb-unit.0', value: 'first=percent%å', options: { path: '/', httpOnly: true } },
        { name: 'sb-unit.1', value: 'second', options: { path: '/', httpOnly: true } },
        { name: 'sb-unit.1', value: '', options: { path: '/', maxAge: 0 } },
      ])
      inspect = cookies.getAll
    })
    const session = await sdk.loginJar('synthetic', 'synthetic')
    expect(inspect?.()).toEqual([{ name: 'sb-unit.0', value: 'first=percent%å' }])
    expect(session.cookieHeader(LOCKS)).toBe('sb-unit.0=first%3Dpercent%25%C3%A5')
    expect(session.cookieNames()).toEqual(['sb-unit.0'])
  })
})

type Row = { company_id: string; billing_year: number; billing_month: number; status: string }
type Stimulus = {
  read?: 'denied' | 'fallback' | 'pretty-foreign' | 'foreign-unlocked' | 'wrong-month' | 'wrong-year' | 'wrong-isLocked' | 'malformed' | 'null' | '503' | '401' | 'unrelated-403'
  unlock?: 'denied' | 'fallback' | 'null' | '500'
  naturalStatus?: number
  naturalNull?: boolean
  explicitStatus?: number
  hiddenForeignMutation?: boolean | 'pricing' | 'audit'
  threeHops?: boolean
  oldAdminPath?: boolean
  staleLegacyCookie?: boolean
}
async function runAuth(prefix: string, stimulus: Stimulus = {}) {
  const rows: Record<string, Row[]> = { A: [], B: [], C: [] }
  const prices: Record<string, string> = {}; const runs: Record<string, string> = {}; const audits: Record<string, string[]> = { A: [], B: [], C: [] }
  let beforeAll: (() => Promise<void>) | undefined
  const cases = new Map<string, () => Promise<void>>()
  let foreignProbeReached = false; let normalAfterForeign = false
  const json = (data: unknown, status = 200, pretty = false) => new Response(JSON.stringify(data, null, pretty ? 2 : undefined), { status, headers: { 'content-type': 'application/json' } })
  const denial = () => json({ error: 'Ej behörig' }, 403)
  const lock = (company: string, month: string) => rows[company].find(row => row.billing_month === Number(month.slice(5))) ?? null
  const body = (company: string, month: string) => ({ data: { billingMonth: month, lock: lock(company, month), isLocked: lock(company, month)?.status === 'locked' } })
  vi.stubGlobal('fetch', async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), APP); const headers = new Headers(init.headers)
    const cookies = new Map(parseCookieHeader(headers.get('cookie') ?? '').map(cookie => [cookie.name, cookie.value]))
    if (url.pathname === '/login') return cookiesResponse([`sb-unit-auth-token=${headers.get('x-unit-user')}; Path=/; HttpOnly`, ...(stimulus.staleLegacyCookie ? [`${SELECTED}=A; Path=/admin; HttpOnly`] : [])], 303, '/admin')
    const user = cookies.get('sb-unit-auth-token')
    const members = user === 'admin-ab' ? ['A', 'B'] : ['A']
    if (url.pathname === '/admin/navigation-mode') {
      const wanted = url.searchParams.get('company_id') ?? 'A'
      const selected = members.includes(wanted) ? wanted : 'A'
      if (foreignProbeReached && user === 'admin-a') normalAfterForeign = true
      const phase = url.searchParams.get('cookie_step')
      if (stimulus.threeHops && phase !== 'select') {
        const next = new URL(url); next.searchParams.set('cookie_step', phase ? 'select' : 'clear-root')
        return cookiesResponse([`${SELECTED}=; Path=${phase ? '/' : '/admin'}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly`], 307, next.href)
      }
      return cookiesResponse([`${SELECTED}=${selected}; Path=${stimulus.oldAdminPath ? '/admin' : '/'}; HttpOnly`], 307, '/admin')
    }
    if (url.pathname.startsWith('/api/internal/invoice-exports')) return stimulus.explicitStatus ? json({ error: 'unavailable' }, stimulus.explicitStatus) : denial()
    if (url.pathname !== LOCKS) throw new Error(`undeclared HTTP ${url.pathname}`)
    const selected = cookies.get(SELECTED) ?? 'A'
    const foreign = user === 'admin-a' && selected === 'B'
    const month = init.method === 'POST' ? String(JSON.parse(String(init.body)).billing_month) : url.searchParams.get('billing_month') ?? ''
    if (foreign) {
      foreignProbeReached = true
      if (init.method !== 'POST') {
        if (stimulus.read === 'pretty-foreign') return json(body('B', month), 200, true)
        if (stimulus.read === 'foreign-unlocked') return json({ data: { billingMonth: month, lock: { ...lock('B', month), status: 'reopened' }, isLocked: false } })
        if (stimulus.read === 'wrong-month') return json({ data: { billingMonth: '2031-04', lock: lock('A', month), isLocked: true } })
        if (stimulus.read === 'wrong-year') return json({ data: { billingMonth: month, lock: { ...lock('A', month), billing_year: 2030 }, isLocked: true } })
        if (stimulus.read === 'wrong-isLocked') return json({ data: { billingMonth: month, lock: lock('A', month), isLocked: false } })
        if (stimulus.read === 'malformed') return new Response('not JSON', { status: 200 })
        if (stimulus.read === 'fallback') return json(body('A', month), 200, true)
        if (stimulus.read === 'null') return json({ data: { billingMonth: month, lock: null, isLocked: false } })
        if (stimulus.read === '503' || stimulus.read === '401') return json({ error: 'unavailable' }, Number(stimulus.read))
        if (stimulus.read === 'unrelated-403') return json({ error: 'generic gateway refused' }, 403)
        return denial()
      }
      if (stimulus.hiddenForeignMutation === 'pricing') runs.B = 'tampered'
      else if (stimulus.hiddenForeignMutation === 'audit') audits.B.push('tampered')
      else if (stimulus.hiddenForeignMutation) prices.B = 'tampered'
      if (stimulus.unlock === 'null') return json({ data: { billingMonth: month, lock: null } })
      if (stimulus.unlock === '500') return json({ error: 'unavailable' }, 500)
      if (stimulus.unlock !== 'fallback') return denial()
      const own = lock('A', month)
      if (!own) throw new Error('own fallback fixture absent')
      own.status = 'reopened'; prices.A = 'unlocked'
      return json({ data: { billingMonth: month, lock: own } })
    }
    if (init.method === 'POST') {
      if (!members.includes(selected)) throw new Error('undeclared legitimate target')
      const entry: Row = { company_id: selected, billing_year: Number(month.slice(0, 4)), billing_month: Number(month.slice(5)), status: 'locked' }
      rows[selected] = [...rows[selected].filter(row => row.billing_month !== entry.billing_month), entry]
      prices[selected] = 'locked'
      return json({ data: { billingMonth: month, lock: entry } })
    }
    if (normalAfterForeign && stimulus.naturalNull) return json({ data: { billingMonth: month, lock: null, isLocked: false } })
    if (normalAfterForeign && stimulus.naturalStatus) return json({ error: 'unavailable' }, stimulus.naturalStatus)
    return json(body(selected, month))
  })
  const jars = jarModule()
  const scenario = actualModule(path.join(TRACK, 'scenarios/auth01.test.ts'), {
    vitest: { describe: (_name: string, callback: () => void) => callback(), beforeAll: (callback: () => Promise<void>) => { beforeAll = callback }, afterAll: () => {}, it: (name: string, callback: () => Promise<void>) => cases.set(name, callback), expect },
    '../lib': { SIM_HOME: '/synthetic-unused', sim: { appUrl: APP }, requireEnv: () => { throw new Error('undeclared secret/env access') },
      psqlRows: (sql: string) => {
        const company = /company_id\s*=\s*'([^']+)'/.exec(sql)?.[1]
        if (!company || !rows[company]) throw new Error('undeclared DB read')
        return rows[company].map(row => ({ ...row }))
      },
      psql: (sql: string) => {
        const company = /company_id\s*=\s*'([^']+)'/.exec(sql)?.[1]
        if (!company || !rows[company]) throw new Error('undeclared DB hash')
        return sha(JSON.stringify({ locks: rows[company], audits: audits[company], ...(sql.includes('price_period_locks') ? { price: prices[company] } : {}), ...(sql.includes('pricing_runs') ? { runs: runs[company] } : {}) }))
      } },
    '../lib/auth01-jar': jars,
    '../lib/receipts': { receipt: () => {}, http: (status: number, text: string) => ({ status, bodySha256: sha(text) }) },
    '../lib/t5-world': { createCompany: (name: string) => name.endsWith(' A') ? 'A' : name.endsWith(' B') ? 'B' : 'C', createAuthUser: async (label: string) => ({ userId: label, email: label, password: 'synthetic-password' }), grantAdmin: () => {}, createCustomer: () => 'synthetic-customer', linkPortalAccount: () => {}, deleteAuthUser: async () => {} },
  })
  void scenario
  if (!beforeAll) throw new Error('actual beforeAll not registered')
  await beforeAll()
  const match = [...cases].find(([name]) => name.startsWith(prefix))
  if (!match) throw new Error(`actual callback ${prefix} absent`)
  return { run: match[1], rows, prices, foreignReached: () => foreignProbeReached }
}

describe('actual registered AUTH oracle', () => {
  it('refuses the frozen pretty-foreign/null-unlock/503 false-green stimulus', async () => {
    const scenario = await runAuth('AUTH01.03 ', { read: 'pretty-foreign', unlock: 'null', naturalStatus: 503 })
    await expect(scenario.run()).rejects.toThrow()
    expect(scenario.foreignReached()).toBe(true)
  })
  it.each([
    { read: 'pretty-foreign' }, { read: 'foreign-unlocked' }, { read: 'wrong-month' }, { read: 'wrong-year' }, { read: 'wrong-isLocked' }, { read: 'malformed' }, { read: 'null' }, { read: '503' }, { read: '401' }, { read: 'unrelated-403' },
    { unlock: 'null' }, { unlock: '500' }, { naturalStatus: 503 }, { naturalNull: true }, { explicitStatus: 500 }, { hiddenForeignMutation: true }, { hiddenForeignMutation: 'pricing' }, { hiddenForeignMutation: 'audit' },
  ] satisfies Stimulus[])('refuses a concrete foreign oracle failure with successful fixture setup: %j', async stimulus => {
    const scenario = await runAuth('AUTH01.03 ', stimulus)
    await expect(scenario.run()).rejects.toThrow()
    expect(scenario.foreignReached()).toBe(true)
  })
  it.each([{ read: 'denied', unlock: 'denied' }, { read: 'fallback', unlock: 'fallback' }] satisfies Stimulus[])('accepts only a semantic denial or proven own fallback: %j', async stimulus => {
    const scenario = await runAuth('AUTH01.03 ', stimulus)
    await expect(scenario.run()).resolves.toBeUndefined()
    expect(scenario.foreignReached()).toBe(true)
    expect(scenario.rows.B).toEqual([{ company_id: 'B', billing_year: 2031, billing_month: 3, status: 'locked' }])
  })
  it('follows all3 actual server cookie responses for natural B→A and member fallback effects', async () => {
    const scenario = await runAuth('AUTH01.04 ', { threeHops: true })
    await expect(scenario.run()).resolves.toBeUndefined()
    expect(scenario.rows.B.some(row => row.billing_month === 4)).toBe(true)
    expect(scenario.rows.A.some(row => row.billing_month === 5)).toBe(true)
    expect(scenario.rows.C).toEqual([])
  })
  it('refuses a server flow leaving a legacy admin selector alongside the new API selector', async () => {
    const scenario = await runAuth('AUTH01.04 ', { staleLegacyCookie: true })
    await expect(scenario.run()).rejects.toThrow()
  })
  it('never qualifies old Path=/admin-only selection by forging a root cookie', async () => {
    const scenario = await runAuth('AUTH01.04 ', { oldAdminPath: true })
    await expect(scenario.run()).rejects.toThrow()
  })
})
