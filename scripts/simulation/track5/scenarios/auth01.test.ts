// executionScope: ISOLATED_NATIVE
// masterplan-sim: AUTH01.01-.06
// Spår 5, AUTH01: inloggning och roll-/tenantmatris via appens normala HTTP-ingångar. Inloggning sker med appens
// egen loginAction (server action på /login) och bolagsbyte med /admin/navigation-mode; alla sessionscookies kommer
// från appens Set-Cookie. Orakel: definitionsbeskrivningen per ID (original sha 96518c18…) tillämpad på spårets egna
// syntetiska bolag A/B/C. Stackens Auth har kort verklig livslängd (SIM_AUTH_JWT_EXPIRY/SIM_AUTH_SESSION_TIMEBOX,
// real tid, ingen klockmanipulation). Ingen webbläsare: ISOLATED_NATIVE.
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { psql, psqlRows, requireEnv, SIM_HOME, sim } from '../lib'
import { loginViaUi, rawFetch, type JarSession } from '../lib/auth01-jar'
import { http, receipt } from '../lib/receipts'
import {
  createAuthUser, createCompany, createCustomer, deleteAuthUser, grantAdmin, linkPortalAccount, type T5User,
} from '../lib/t5-world'

const PERMS = ['billing_underlay.read', 'billing_underlay.export']
const LOCKS = '/api/internal/billing/period-locks'
const SELECTED = 'gridex_admin_selected_company_id'
const TIMEBOX_MS = (() => {
  const m = /^(\d+)([smh])$/.exec(process.env.SIM_AUTH_SESSION_TIMEBOX ?? '3m')
  if (!m) throw new Error('SIM_AUTH_SESSION_TIMEBOX ogiltig')
  return Number(m[1]) * { s: 1000, m: 60_000, h: 3_600_000 }[m[2] as 's' | 'm' | 'h']
})()

type LockRow = { company_id: string; billing_year: number; billing_month: number; status: string }
const locksOf = (companyId: string) => psqlRows<LockRow>(
  `select company_id, billing_year, billing_month, status from public.billing_period_locks where company_id='${companyId}' order by billing_year, billing_month`)
/** Hash över bolagets period-lås och audit-rader (före/efter-jämförelse). */
const companyHash = (companyId: string) => psql(`select md5(coalesce(string_agg(x, '|' order by x), '')) from (
    select 'L:'||row_to_json(l)::text x from public.billing_period_locks l where company_id='${companyId}'
    union all select 'P:'||row_to_json(p)::text from public.price_period_locks p where company_id='${companyId}'
    union all select 'R:'||row_to_json(r)::text from public.pricing_runs r where company_id='${companyId}'
    union all select 'A:'||row_to_json(a)::text from public.audit_logs a where company_id='${companyId}') q`)

const lockBody = (month: string, action = 'lock') => JSON.stringify({ billing_month: month, action })
const jsonPost = { method: 'POST', headers: { 'content-type': 'application/json' } }
const pathOf = (res: Response) => new URL(res.headers.get('location') ?? '/', sim.appUrl).pathname

/** Current guard JSON refusal, not a gateway/authentication/technical failure. */
function assertForbidden(status: number, text: string): void {
  expect(status, 'foreign access requires a supported authorization refusal').toBe(403)
  const body = JSON.parse(text) as { error?: unknown }
  expect(Object.keys(body).sort()).toEqual(['error'])
  expect(['Ej behörig', 'Ej behörig för valt bolag', 'Saknar behörighet']).toContain(body.error)
}

function assertOwnLock(text: string, month: string, expected: LockRow, read = false): void {
  const body = JSON.parse(text) as { data?: { billingMonth?: unknown; lock?: Partial<LockRow> | null; isLocked?: unknown } }
  expect(Object.keys(body)).toEqual(['data'])
  expect(body.data).toBeTruthy()
  expect(Object.keys(body.data!).sort()).toEqual(read ? ['billingMonth', 'isLocked', 'lock'] : ['billingMonth', 'lock'])
  expect(body.data!.billingMonth).toBe(month)
  const lock = body.data!.lock
  expect(lock, 'a null/missing lock is not proof of an own-company fallback').toBeTruthy()
  expect({ company_id: lock!.company_id, billing_year: lock!.billing_year, billing_month: lock!.billing_month, status: lock!.status }).toEqual(expected)
  if (read) expect(body.data!.isLocked).toBe(['locked', 'exported', 'closed'].includes(expected.status))
}

describe('AUTH01 roll- och tenantmatris', () => {
  let A: string, B: string, C: string
  let adminA: T5User, adminAB: T5User, customerA: T5User
  const users: T5User[] = []

  beforeAll(async () => {
    A = createCompany('Sim T5 AUTH bolag A')
    B = createCompany('Sim T5 AUTH bolag B')
    C = createCompany('Sim T5 AUTH bolag C')
    adminA = await createAuthUser('admin-a'); grantAdmin(adminA.userId, A, PERMS)
    adminAB = await createAuthUser('admin-ab'); grantAdmin(adminAB.userId, A, PERMS); grantAdmin(adminAB.userId, B, PERMS)
    customerA = await createAuthUser('kund-a')
    linkPortalAccount(customerA.userId, customerA.email, A, createCustomer(A, 'AUTH-kund'))
    users.push(adminA, adminAB, customerA)
  }, 120_000)
  afterAll(async () => { for (const u of users) await deleteAuthUser(u.userId) })

  /** Every ordinary app redirect supplies its own scoped cookies; no positive forging. */
  async function selectCompany(id: string, session: JarSession, companyId: string): Promise<Response> {
    let target = `/admin/navigation-mode?${new URLSearchParams({ mode: 'company_view', company_id: companyId, next: '/admin' })}`
    const statuses: number[] = []
    for (let hop = 0; hop < 8; hop++) {
      const response = await session.fetch(target)
      await response.text()
      statuses.push(response.status)
      expect([302, 303, 307, 308], `navigation-mode status ${response.status}`).toContain(response.status)
      const location = response.headers.get('location')
      expect(location, 'navigation-mode must supply a redirect target').toBeTruthy()
      const next = new URL(location!, sim.appUrl)
      expect(next.origin, 'selection redirect must stay on the app origin').toBe(new URL(sim.appUrl).origin)
      if (next.pathname === '/admin/navigation-mode') { target = next.href; continue }
      expect(next.pathname).toBe('/admin')
      const selected = session.cookieValue(SELECTED, LOCKS)
      expect(selected, 'server-selected cookie must be applicable to the API URL').not.toBeNull()
      expect(session.cookieValue(SELECTED, '/admin'), 'admin and API cookie contexts must agree after selection').toBe(selected)
      receipt(id, 'navigation-mode', { statuses, requestedCompany: companyId, selectedCookie: selected })
      return response
    }
    throw new Error('HARNESS_NAVIGATION_REDIRECT_LIMIT')
  }

  it('AUTH01.01 egen läsning och egen handling tillåts och skriver i eget bolag', async () => {
    const s = await loginViaUi(adminA.email, adminA.password)
    receipt('AUTH01.01', 'login', { via: 'loginAction', redirect: s.redirect, sbCookies: s.cookieNames('/admin').filter((k) => k.startsWith('sb-')).length })
    await selectCompany('AUTH01.01', s, A)
    expect(s.cookieValue(SELECTED, LOCKS)).toBe(A)
    const read = await s.fetch(`${LOCKS}?billing_month=2031-01`)
    const readText = await read.text()
    expect(read.status, readText.slice(0, 300)).toBe(200)
    expect(JSON.parse(readText).data.billingMonth).toBe('2031-01')
    const write = await s.fetch(LOCKS, { ...jsonPost, body: lockBody('2031-01') })
    const writeText = await write.text()
    expect(write.status, writeText.slice(0, 300)).toBe(200)
    expect(locksOf(A)).toEqual([{ company_id: A, billing_year: 2031, billing_month: 1, status: 'locked' }])
    receipt('AUTH01.01', 'read+write', { read: http(read.status, readText), write: http(write.status, writeText), rowsA: locksOf(A) })
  })

  it('AUTH01.02 egen kundroll nekas administrativ handling och adminyta', async () => {
    const before = companyHash(A)
    const s = await loginViaUi(customerA.email, customerA.password, '/dashboard')
    receipt('AUTH01.02', 'login', { via: 'loginAction', redirect: s.redirect })
    const write = await s.fetch(LOCKS, { ...jsonPost, body: lockBody('2031-02') })
    const wt = await write.text()
    expect(write.status, wt.slice(0, 300)).toBe(403)
    const read = await s.fetch(`${LOCKS}?billing_month=2031-02`)
    const rt = await read.text()
    expect(read.status).toBe(403)
    expect(locksOf(A).some((l) => l.billing_month === 2)).toBe(false)
    expect(companyHash(A)).toBe(before)
    // Adminytan: följ redirect-kedjan; den ska lämna /admin eller nekas, aldrig ge 200 på en adminsida.
    const chain: { path: string; status: number }[] = []
    let p = '/admin'
    let final: { path: string; status: number } | null = null
    for (let hop = 0; hop < 8; hop++) {
      const res = await s.fetch(p)
      await res.text()
      chain.push({ path: p, status: res.status })
      if (![301, 302, 303, 307, 308].includes(res.status)) { final = { path: p, status: res.status }; break }
      p = pathOf(res)
      if (!p.startsWith('/admin')) { final = { path: p, status: res.status }; break }
    }
    receipt('AUTH01.02', 'deny', { write: http(write.status, wt), read: http(read.status, rt), adminChain: chain, hashUnchanged: true })
    expect(final, `redirect-kedjan tog inte slut: ${JSON.stringify(chain)}`).not.toBeNull()
    expect(final!.path.startsWith('/admin') && final!.status === 200, `adminsida med 200: ${JSON.stringify(chain)}`).toBe(false)
  })

  it('AUTH01.03 annat bolag nekas läsa och ändra: förfalskad bolagscookie och explicit companyId; B oförändrat', async () => {
    const sAB = await loginViaUi(adminAB.email, adminAB.password)
    await selectCompany('AUTH01.03', sAB, B)
    const r = await sAB.fetch(LOCKS, { ...jsonPost, body: lockBody('2031-03') })
    const setupB = await r.text()
    expect(r.status, setupB.slice(0, 300)).toBe(200)
    const lockedB: LockRow = { company_id: B, billing_year: 2031, billing_month: 3, status: 'locked' }
    assertOwnLock(setupB, '2031-03', lockedB)
    const lockB = locksOf(B)
    expect(lockB).toEqual([lockedB])

    // A known, non-null own fixture makes any permitted fallback observable.
    // Failed setup never qualifies a later foreign-access refusal.
    const own = await loginViaUi(adminA.email, adminA.password)
    await selectCompany('AUTH01.03', own, A)
    const seed = await own.fetch(LOCKS, { ...jsonPost, body: lockBody('2031-03') })
    const setupA = await seed.text()
    expect(seed.status, setupA.slice(0, 300)).toBe(200)
    const lockedA: LockRow = { company_id: A, billing_year: 2031, billing_month: 3, status: 'locked' }
    assertOwnLock(setupA, '2031-03', lockedA)
    expect(locksOf(A).filter(row => row.billing_month === 3)).toEqual([lockedA])
    const beforeA = companyHash(A)
    const beforeB = companyHash(B)

    const s = await loginViaUi(adminA.email, adminA.password)
    s.forgeCookieForNegativeTest(`${SELECTED}=${B}; Path=/; HttpOnly; SameSite=Lax`) // Explicit negative only.
    const readB = await s.fetch(`${LOCKS}?billing_month=2031-03`)
    const readBText = await readB.text()
    let readBranch: string
    if (readB.status === 403) { assertForbidden(readB.status, readBText); readBranch = 'denied' }
    else {
      expect(readB.status).toBe(200)
      assertOwnLock(readBText, '2031-03', lockedA, true)
      expect(locksOf(A).filter(row => row.billing_month === 3)).toEqual([lockedA])
      readBranch = 'fallback-own-company'
    }

    const unlockB = await s.fetch(LOCKS, { ...jsonPost, body: lockBody('2031-03', 'unlock') })
    const unlockText = await unlockB.text()
    let unlockBranch: string
    let ownAfter = lockedA
    if (unlockB.status === 403) {
      assertForbidden(unlockB.status, unlockText)
      expect(companyHash(A)).toBe(beforeA)
      unlockBranch = 'denied'
    } else {
      expect(unlockB.status).toBe(200)
      ownAfter = { ...lockedA, status: 'reopened' }
      assertOwnLock(unlockText, '2031-03', ownAfter)
      expect(locksOf(A).filter(row => row.billing_month === 3)).toEqual([ownAfter])
      unlockBranch = 'fallback-own-company'
    }
    const explicit = await s.fetch(`/api/internal/invoice-exports/00000000-0000-4000-8000-000000000000?companyId=${B}`)
    const explicitText = await explicit.text()
    assertForbidden(explicit.status, explicitText)
    receipt('AUTH01.03', 'forged+explicit', { readB: http(readB.status, readBText), readBranch, unlockB: http(unlockB.status, unlockText),
      unlockBranch, explicitCompanyId: http(explicit.status, explicitText) })

    const s2 = await loginViaUi(adminA.email, adminA.password)
    await selectCompany('AUTH01.03', s2, B)
    expect(s2.cookieValue(SELECTED, LOCKS), 'nonmember selection must resolve to the actual own A cookie').toBe(A)
    const viaUi = await s2.fetch(`${LOCKS}?billing_month=2031-03`)
    const viaUiText = await viaUi.text()
    expect(viaUi.status).toBe(200)
    assertOwnLock(viaUiText, '2031-03', ownAfter, true)
    expect(locksOf(A).filter(row => row.billing_month === 3)).toEqual([ownAfter])
    receipt('AUTH01.03', 'navigation-mode to B', { selected: A, read: http(viaUi.status, viaUiText) })
    expect(companyHash(B)).toBe(beforeB)
    expect(locksOf(B)).toEqual(lockB)
  })

  it('AUTH01.04 företagsbyte använder naturlig UI-session; icke-medlemsbolag ger fallback och ingen åtkomst', async () => {
    const s = await loginViaUi(adminAB.email, adminAB.password)
    await selectCompany('AUTH01.04', s, B)
    expect(s.cookieValue(SELECTED, LOCKS)).toBe(B)
    let r = await s.fetch(LOCKS, { ...jsonPost, body: lockBody('2031-04') })
    expect(r.status, (await r.text()).slice(0, 300)).toBe(200)
    expect(locksOf(B).filter((l) => l.billing_month === 4)).toHaveLength(1)
    expect(locksOf(A).filter((l) => l.billing_month === 4)).toHaveLength(0)

    await selectCompany('AUTH01.04', s, A)
    expect(s.cookieValue(SELECTED, LOCKS)).toBe(A)
    r = await s.fetch(LOCKS, { ...jsonPost, body: lockBody('2031-05') })
    expect(r.status, (await r.text()).slice(0, 300)).toBe(200)
    expect(locksOf(A).filter((l) => l.billing_month === 5)).toHaveLength(1)
    expect(locksOf(B).filter((l) => l.billing_month === 5)).toHaveLength(0)

    const beforeC = companyHash(C)
    await selectCompany('AUTH01.04', s, C)
    const fallback = s.cookieValue(SELECTED, LOCKS) ?? null
    expect(fallback, 'icke-medlemsbolag får inte väljas').not.toBe(C)
    expect([A, B]).toContain(fallback)
    r = await s.fetch(LOCKS, { ...jsonPost, body: lockBody('2031-06') })
    const t = await r.text()
    expect(r.status, t.slice(0, 200)).toBe(200)
    // Skrivningen hamnar i fallback-bolaget (ett eget medlemskap), aldrig i C.
    expect(locksOf(fallback!).filter((l) => l.billing_month === 6)).toHaveLength(1)
    expect(locksOf(C)).toEqual([])
    expect(companyHash(C)).toBe(beforeC)
    receipt('AUTH01.04', 'fallback', { fallbackCompanyIsMember: [A, B].includes(fallback!), write: http(r.status, t), rowsC: 0 })
  })

  it('AUTH01.05 utloggad session nekas; gammal cookie godtas inte efter logout', async () => {
    const s = await loginViaUi(adminA.email, adminA.password)
    await selectCompany('AUTH01.05', s, A)
    expect((await s.fetch(`${LOCKS}?billing_month=2031-07`)).status).toBe(200)
    const oldCookie = s.cookieHeader()
    const out = await s.fetch('/logout', { method: 'POST' })
    expect(out.status).toBe(303)
    expect(pathOf(out)).toBe('/login')
    expect(s.cookieNames('/admin').filter((k) => k.startsWith('sb-')), 'logout ska rensa sb-*-cookies').toEqual([])
    const api = await rawFetch(oldCookie, `${LOCKS}?billing_month=2031-07`)
    const apiText = await api.text()
    expect(api.status, apiText.slice(0, 200)).toBe(401)
    const admin = await rawFetch(oldCookie, '/admin')
    expect([302, 303, 307, 308]).toContain(admin.status)
    expect(pathOf(admin)).toBe('/login')
    receipt('AUTH01.05', 'logged-out', { logout: out.status, oldCookieApi: http(api.status, apiText), oldCookieAdmin: { status: admin.status, location: pathOf(admin) } })
  })

  it('AUTH01.05 utgången session nekas efter verklig sessionslivslängd (real tid)', async () => {
    const s = await loginViaUi(adminA.email, adminA.password)
    await selectCompany('AUTH01.05', s, A)
    const start = Date.now()
    const ok = await s.fetch(`${LOCKS}?billing_month=2031-08`)
    expect(ok.status).toBe(200)
    await ok.text()
    const cookie = s.cookieHeader()
    await new Promise((r) => setTimeout(r, TIMEBOX_MS + 20_000))
    const api = await rawFetch(cookie, `${LOCKS}?billing_month=2031-08`)
    const apiText = await api.text()
    const admin = await rawFetch(cookie, '/admin')
    receipt('AUTH01.05', 'expired', { waitedMs: Date.now() - start, timeboxMs: TIMEBOX_MS, jwtExpirySec: Number(process.env.SIM_AUTH_JWT_EXPIRY ?? 0),
      api: http(api.status, apiText), admin: { status: admin.status, location: pathOf(admin) } })
    expect(api.status, apiText.slice(0, 200)).toBe(401)
    expect([302, 303, 307, 308]).toContain(admin.status)
    expect(pathOf(admin)).toBe('/login')
  }, 600_000)

  it('AUTH01.06 service-role-nyckeln exponeras inte i klient eller kvittoutdata', async () => {
    const service = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
    const anon = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    const scan = (dir: string) => {
      let files = 0, bytes = 0, known = 0
      const hits: string[] = []
      const walk = (d: string) => {
        if (!fs.existsSync(d)) return
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name)
          if (e.isDirectory()) { walk(p); continue }
          const body = fs.readFileSync(p, 'latin1')
          files++; bytes += body.length
          if (body.includes('__next') || body.includes('"steps"') || body.includes('scenarioId')) known++
          if (body.includes(service)) hits.push(path.relative(dir, p))
        }
      }
      walk(dir)
      return { files, bytes, known, hits }
    }
    const staticScan = scan(path.join(process.env.RUN_DIR ?? '/root/sim/track5', '.next/static'))
    expect(staticScan.files).toBeGreaterThan(10)
    expect(staticScan.bytes).toBeGreaterThan(1_000_000)
    expect(staticScan.known, 'kontroll: sökningen ser innehåll').toBeGreaterThan(0)
    expect(staticScan.hits).toEqual([])
    // Kvittoutdata: rapporter och kvitton från spårets körningar (bredvid denna körnings rapport) och harnessens rapportkatalog.
    const receiptsDir = path.dirname(process.env.SIM_RECEIPTS ?? path.join(SIM_HOME, 'reports', 'x'))
    const receiptScan = scan(receiptsDir)
    const reportsScan = scan(path.join(SIM_HOME, 'reports'))
    expect(receiptScan.files, 'kvittokatalogen ska innehålla denna körnings kvitton').toBeGreaterThan(0)
    expect(receiptScan.known).toBeGreaterThan(0)
    expect(receiptScan.hits).toEqual([])
    expect(reportsScan.hits).toEqual([])
    expect(anon.length).toBeGreaterThan(20)

    const s = await loginViaUi(adminA.email, adminA.password)
    await selectCompany('AUTH01.06', s, A)
    const responses: { path: string; status: number }[] = []
    for (const p of ['/login', '/admin', `${LOCKS}?billing_month=2031-09`, '/portal', '/api/partner/v1/openapi.json']) {
      const res = p === '/login' ? await fetch(new URL(p, sim.appUrl), { redirect: 'manual' }) : await s.fetch(p)
      const text = await res.text()
      responses.push({ path: p, status: res.status })
      expect(text.includes(service), `service-role i svar från ${p}`).toBe(false)
    }
    receipt('AUTH01.06', 'scan', { static: { files: staticScan.files, hits: staticScan.hits.length },
      receipts: { files: receiptScan.files, hits: receiptScan.hits.length }, reports: { files: reportsScan.files, hits: reportsScan.hits.length }, responses })
  })
})
