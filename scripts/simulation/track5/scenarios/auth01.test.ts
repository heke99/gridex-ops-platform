// executionScope: ISOLATED_NATIVE
// masterplan-sim: AUTH01.01-.06
// Spår 5, AUTH01: inloggning och roll-/tenantmatris via appens normala HTTP-ingångar (riktig GoTrue-session,
// appens Set-Cookie för företagsbyte). Orakel: definitionsbeskrivningen per ID (original sha 96518c18…) tillämpad
// på spårets egna syntetiska bolag A/B/C. Ingen webbläsare: ISOLATED_NATIVE.
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { psql, psqlRows, requireEnv, sim } from '../lib'
import { loginJar, rawFetch, type JarSession } from '../lib/auth01-jar'
import {
  createAuthUser, createCompany, createCustomer, deleteAuthUser, grantAdmin, linkPortalAccount, type T5User,
} from '../lib/t5-world'

const PERMS = ['billing_underlay.read', 'billing_underlay.export']
const LOCKS = '/api/internal/billing/period-locks'
const SELECTED = 'gridex_admin_selected_company_id'

type LockRow = { company_id: string; billing_year: number; billing_month: number; status: string }
const locksOf = (companyId: string) => psqlRows<LockRow>(
  `select company_id, billing_year, billing_month, status from public.billing_period_locks where company_id='${companyId}' order by billing_year, billing_month`)
/** Hash över bolagets period-lås och audit-rader (före/efter-jämförelse). */
const companyHash = (companyId: string) => psql(`select md5(coalesce(string_agg(x, '|' order by x), '')) from (
    select 'L:'||row_to_json(l)::text x from public.billing_period_locks l where company_id='${companyId}'
    union all select 'A:'||id::text from public.audit_logs where company_id='${companyId}') q`)

const lockBody = (month: string) => JSON.stringify({ billing_month: month, action: 'lock' })
const jsonPost = { method: 'POST', headers: { 'content-type': 'application/json' } }

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

  /** Inloggad admin som valt bolag via appens navigation-mode (Set-Cookie från appen). */
  async function selectCompany(s: JarSession, companyId: string): Promise<Response> {
    const res = await s.fetch(`/admin/navigation-mode?mode=company_view&company_id=${companyId}&next=/admin`)
    expect([302, 303, 307, 308], `navigation-mode status ${res.status}`).toContain(res.status)
    return res
  }

  it('AUTH01.01 egen läsning och egen handling tillåts och skriver i eget bolag', async () => {
    const s = await loginJar(adminA.email, adminA.password)
    await selectCompany(s, A)
    expect(s.jar.get(SELECTED)).toBe(A)
    const read = await s.fetch(`${LOCKS}?billing_month=2031-01`)
    const readText = await read.text()
    expect(read.status, readText.slice(0, 300)).toBe(200)
    expect(JSON.parse(readText).data.billingMonth).toBe('2031-01')

    const write = await s.fetch(LOCKS, { ...jsonPost, body: lockBody('2031-01') })
    const writeText = await write.text()
    expect(write.status, writeText.slice(0, 300)).toBe(200)
    expect(locksOf(A)).toEqual([{ company_id: A, billing_year: 2031, billing_month: 1, status: 'locked' }])
  })

  it('AUTH01.02 egen kundroll nekas adminhandling och adminyta', async () => {
    const before = companyHash(A)
    const s = await loginJar(customerA.email, customerA.password)
    const write = await s.fetch(LOCKS, { ...jsonPost, body: lockBody('2031-02') })
    expect(write.status, (await write.text()).slice(0, 300)).toBe(403)
    const read = await s.fetch(`${LOCKS}?billing_month=2031-02`)
    expect(read.status).toBe(403)
    expect(locksOf(A).some((l) => l.billing_month === 2)).toBe(false)
    expect(companyHash(A)).toBe(before)

    // Adminytan: följ högst fem redirects; kundrollen får aldrig landa på en adminsida med 200.
    let p = '/admin'
    for (let hop = 0; hop < 5; hop++) {
      const res = await s.fetch(p)
      await res.text()
      if (![301, 302, 303, 307, 308].includes(res.status)) {
        expect(p.startsWith('/admin') && res.status === 200 ? `200 på adminsidan ${p}` : 'nekad', `slutstatus ${res.status} på ${p}`).toBe('nekad')
        break
      }
      p = new URL(res.headers.get('location') ?? '/', sim.appUrl).pathname
      if (!p.startsWith('/admin')) break
    }
  })

  it('AUTH01.03 annat bolag nekas, både förfalskad bolagscookie och explicit companyId; B oförändrat', async () => {
    const lockB = await (async () => {
      const s = await loginJar(adminAB.email, adminAB.password)
      await selectCompany(s, B)
      const r = await s.fetch(LOCKS, { ...jsonPost, body: lockBody('2031-03') })
      expect(r.status, (await r.text()).slice(0, 300)).toBe(200)
      return locksOf(B)
    })()
    expect(lockB).toEqual([{ company_id: B, billing_year: 2031, billing_month: 3, status: 'locked' }])
    const before = companyHash(B)

    const s = await loginJar(adminA.email, adminA.password)
    // Förfalskad cookie: B fastän användaren bara är medlem i A.
    s.jar.set(SELECTED, B)
    const unlockB = await s.fetch(LOCKS, { ...jsonPost, body: JSON.stringify({ billing_month: '2031-03', action: 'unlock' }) })
    const t1 = await unlockB.text()
    if (unlockB.status === 200) {
      // Om appen föll tillbaka till A får inget ha hänt i B.
      expect(JSON.parse(t1).data?.lock?.company_id ?? A, 'unlock träffade B').not.toBe(B)
    } else {
      expect([403, 400, 404, 409], t1.slice(0, 300)).toContain(unlockB.status)
    }
    const read = await s.fetch(`/api/internal/invoice-exports/00000000-0000-4000-8000-000000000000?companyId=${B}`)
    expect(read.status, (await read.text()).slice(0, 300)).toBe(403)
    expect(companyHash(B)).toBe(before)
    expect(locksOf(B)).toEqual(lockB)
  })

  it('AUTH01.04 företagsbyte via UI-session styr scope; icke-medlemsbolag ger fallback och ingen åtkomst', async () => {
    const s = await loginJar(adminAB.email, adminAB.password)
    await selectCompany(s, B)
    expect(s.jar.get(SELECTED)).toBe(B)
    let r = await s.fetch(LOCKS, { ...jsonPost, body: lockBody('2031-04') })
    expect(r.status, (await r.text()).slice(0, 300)).toBe(200)
    expect(locksOf(B).filter((l) => l.billing_month === 4)).toHaveLength(1)
    expect(locksOf(A).filter((l) => l.billing_month === 4)).toHaveLength(0)

    await selectCompany(s, A)
    expect(s.jar.get(SELECTED)).toBe(A)
    r = await s.fetch(LOCKS, { ...jsonPost, body: lockBody('2031-05') })
    expect(r.status, (await r.text()).slice(0, 300)).toBe(200)
    expect(locksOf(A).filter((l) => l.billing_month === 5)).toHaveLength(1)
    expect(locksOf(B).filter((l) => l.billing_month === 5)).toHaveLength(0)

    const beforeC = companyHash(C)
    await selectCompany(s, C)
    expect(s.jar.get(SELECTED), 'icke-medlemsbolag får inte väljas').not.toBe(C)
    r = await s.fetch(LOCKS, { ...jsonPost, body: lockBody('2031-06') })
    await r.text()
    expect(locksOf(C)).toEqual([])
    expect(companyHash(C)).toBe(beforeC)
  })

  it('AUTH01.05 utloggad session nekas; gammal cookie godtas inte efter logout', async () => {
    const s = await loginJar(adminA.email, adminA.password)
    await selectCompany(s, A)
    expect((await s.fetch(`${LOCKS}?billing_month=2031-07`)).status).toBe(200)
    const oldCookie = s.cookieHeader()
    const sbBefore = [...s.jar.keys()].filter((k) => k.startsWith('sb-'))
    expect(sbBefore.length).toBeGreaterThan(0)

    const out = await s.fetch('/logout', { method: 'POST' })
    expect(out.status).toBe(303)
    expect(new URL(out.headers.get('location') ?? '', sim.appUrl).pathname).toBe('/login')
    const sbAfter = [...s.jar.keys()].filter((k) => k.startsWith('sb-'))
    expect(sbAfter, 'logout ska rensa sb-*-cookies').toEqual([])

    const replayApi = await rawFetch(oldCookie, `${LOCKS}?billing_month=2031-07`)
    expect(replayApi.status, `gammal session mot API: ${(await replayApi.text()).slice(0, 200)}`).toBe(401)
    const replayAdmin = await rawFetch(oldCookie, '/admin')
    expect([302, 303, 307, 308]).toContain(replayAdmin.status)
    expect(new URL(replayAdmin.headers.get('location') ?? '', sim.appUrl).pathname).toBe('/login')
  })

  it('AUTH01.06 service-role-nyckeln exponeras inte i klientresurser eller svar', async () => {
    const service = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
    const anon = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    const staticDir = path.join(process.env.RUN_DIR ?? '/root/sim/track5', '.next/static')
    let files = 0, anonHits = 0
    const serviceHits: string[] = []
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) { walk(p); continue }
        const body = fs.readFileSync(p, 'latin1')
        files++
        if (body.includes(anon)) anonHits++
        if (body.includes(service) || body.includes('SUPABASE_SERVICE_ROLE_KEY')) serviceHits.push(path.relative(staticDir, p))
      }
    }
    walk(staticDir)
    expect(files).toBeGreaterThan(10)
    expect(anonHits, 'sökningens kontroll: anon-nyckeln ska finnas i klientbundlen').toBeGreaterThan(0)
    expect(serviceHits).toEqual([])

    const s = await loginJar(adminA.email, adminA.password)
    await selectCompany(s, A)
    for (const p of ['/login', '/admin', `${LOCKS}?billing_month=2031-08`, '/portal']) {
      const res = p === '/login' ? await fetch(new URL(p, sim.appUrl), { redirect: 'manual' }) : await s.fetch(p)
      const text = await res.text()
      expect(text.includes(service), `service-role i svar från ${p}`).toBe(false)
    }
  })
})
