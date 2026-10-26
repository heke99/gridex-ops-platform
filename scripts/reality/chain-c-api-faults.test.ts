// Reality C: the tenant website API under real-world conditions — latency, database round trips per
// checkout, idempotent retries, another tenant's key, the per-client rate limit and third-party outages
// (spot prices, postal geocoder, Lantmäteriet). Runs against the world of scripts/reality/up.sh.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { appRequest, configurePlatformMailbox, configureTenant, LIVE, sql, type LiveTenant } from '../helpers/live-chain-fixture'
import { goLiveOnWebsite, WEBSITE_ORIGIN } from '../helpers/reality/tenantWebsite'
import { detectStuckStates } from '../helpers/reality/stuckDetector'
import { prepareMarketData } from '../helpers/reality/world'
import { clockSettings, wallClockWait } from '../helpers/reality/clock'
import { applyAsWebsiteCustomer, type SimulatedPerson, type SimulatedSite, type WebsiteApplicationResult } from './simulators/websiteCustomer'
import { gs1 } from '../helpers/live-chain-wire'

const WORLD = 'http://127.0.0.1:3901'
const report: Record<string, unknown> = { scenario: 'C website API under real-world conditions', startedAt: new Date().toISOString(), clock: clockSettings() }
const RUN = Date.now().toString(36)
let tenantA: LiveTenant, tenantB: LiveTenant
let keyA = '', keyB = ''
const applicationsA: string[] = []

function personnummer(birth: string, serial: string) {
  const nine = birth.slice(2) + serial
  const sum = [...nine].reduce((total, digit, i) => { const v = Number(digit) * (i % 2 === 0 ? 2 : 1); return total + (v > 9 ? v - 9 : v) }, 0)
  return `${birth}${serial}${(10 - (sum % 10)) % 10}`
}
const person = (n: number): SimulatedPerson => ({ firstName: `Kund${n}`, lastName: 'E2E-Reality', personalNumber: personnummer(`1985${String(1 + (n % 12)).padStart(2, '0')}15`, String(100 + n)),
  email: `e2e-c-${n}-${RUN}@example.invalid`, phone: '0701234567', address: { street: 'Kungsgatan 1', postalCode: '441 30', city: 'Alingsås' } })
const site = (): SimulatedSite => ({ facilityId: gs1(`735999${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`), priceArea: 'SE3', annualConsumptionKwh: 12_000 })
const percentile = (values: number[], p: number) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0 }
const fault = (service: string, mode: string, extra: Record<string, number> = {}) => fetch(`${WORLD}/__sim/fault`, { method: 'POST', body: JSON.stringify({ service, mode, ...extra }) })
/** Database round trips: requests the API gateway logged in a time window (no crons run in this scenario). */
function gatewayRequestsSince(since: Date) {
  const lines = execFileSync('docker', ['logs', '--since', since.toISOString(), 'supabase_kong_gridex-ops-platform'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 200_000_000 })
  const paths = lines.split('\n').map(line => /"(GET|POST|PATCH|DELETE|HEAD) (\/[a-z0-9/_]+)/.exec(line)).filter(Boolean).map(m => `${m![1]} ${m![2]}`)
  const counts = new Map<string, number>()
  for (const path of paths) counts.set(path, (counts.get(path) ?? 0) + 1)
  return { total: paths.length, top: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12) }
}
async function portalAccount(p: SimulatedPerson) {
  const account = await supabaseService.auth.admin.createUser({ email: p.email, password: `Reality-${p.personalNumber}`, email_confirm: true })
  if (account.error || !account.data.user) throw Error(`portal_account_failed:${account.error?.message}`)
  return account.data.user.id
}
const apply = async (apiKey: string, n: number, extra: { idempotencyKey?: string; portalUserId?: string; p?: SimulatedPerson; s?: SimulatedSite } = {}) => {
  const p = extra.p ?? person(n)
  return applyAsWebsiteCustomer({ baseUrl: LIVE.appUrl, apiKey, origin: WEBSITE_ORIGIN, person: p, site: extra.s ?? site(), portalUserId: extra.portalUserId ?? await portalAccount(p), idempotencyKey: extra.idempotencyKey })
}
const save = () => writeFileSync(process.env.GRIDEX_REALITY_REPORT ?? '/tmp/reality-c-report.json', JSON.stringify(report, null, 2))

describe.sequential('reality C — website API under real-world conditions', () => {
  afterAll(async () => {
    for (const service of ['spot', 'papapi', 'lantmateriet', 'resend']) await fault(service, 'ok')
    report.finishedAt = new Date().toISOString()
    save()
  })

  it('C0 two suppliers go live on their websites', async () => {
    expect(configurePlatformMailbox()).toBe(1)
    report.marketData = await prepareMarketData()
    expect(report.marketData).toMatchObject({ geodataVerified: true })
    tenantA = await configureTenant(supabaseService as never)
    tenantB = await configureTenant(supabaseService as never)
    keyA = (await goLiveOnWebsite(tenantA, tenantA.adminUserId)).credential?.token ?? ''
    keyB = (await goLiveOnWebsite(tenantB, tenantB.adminUserId)).credential?.token ?? ''
    expect(keyA && keyB).toBeTruthy()
    await fetch(`${WORLD}/__sim/geocode`, { method: 'POST', body: JSON.stringify({ postal_code: '441 30', latitude: 57.9303, longitude: 12.534 }) })
  })

  it('C1 latency and database round trips of a full website checkout', async () => {
    const runs: WebsiteApplicationResult[] = []
    const roundTrips: number[] = []
    let top: Array<[string, number]> = []
    for (let n = 1; n <= 6; n++) {
      const p = person(n)
      const portalUserId = await portalAccount(p)
      const since = new Date()
      const result = await apply(keyA, n, { p, portalUserId })
      await new Promise(resolve => setTimeout(resolve, 1_500))
      const gateway = gatewayRequestsSince(since)
      roundTrips.push(gateway.total); top = gateway.top
      runs.push(result)
      if (result.applicationNumber) applicationsA.push(result.applicationNumber)
    }
    const byStep = new Map<string, number[]>()
    for (const run of runs) for (const request of run.requests) byStep.set(`${request.method} ${request.path.split('?')[0]}`, [...(byStep.get(`${request.method} ${request.path.split('?')[0]}`) ?? []), request.ms])
    report.checkoutLatency = Object.fromEntries([...byStep].map(([step, ms]) => [step, { p50: percentile(ms, 50), p95: percentile(ms, 95), max: Math.max(...ms), n: ms.length }]))
    report.checkoutTotalMs = runs.map(run => run.requests.reduce((sum, r) => sum + r.ms, 0))
    report.checkoutDatabaseRoundTrips = { perCheckout: roundTrips, busiestPathsLastCheckout: top }
    report.checkoutOutcomes = runs.map(run => ({ step: run.step, status: run.status, application: run.applicationNumber }))
    save()
    for (const run of runs) expect(run.status, `${run.step} ${JSON.stringify(run.body).slice(0, 400)}`).toBeLessThan(300)
  })

  it('C2 a website that resends the same application after a lost response gets the same application, never a second one', async () => {
    const p = person(50)
    const portalUserId = await portalAccount(p)
    const result = await applyAsWebsiteCustomer({ baseUrl: LIVE.appUrl, apiKey: keyA, origin: WEBSITE_ORIGIN, person: p, site: site(), portalUserId, retryFinalSubmit: true })
    const rows = sql<number>(`SELECT to_jsonb(count(*)) FROM public.website_customer_applications WHERE company_id='${tenantA.companyId}' AND (payload::text LIKE '%${p.email}%' OR raw_payload::text LIKE '%${p.email}%')`)
    report.idempotency = { first: [result.status, result.applicationNumber], retry: result.retry, rows }
    save()
    expect(result.status).toBeLessThan(300)
    expect(result.retry?.status).toBeLessThan(300)
    expect(result.retry?.applicationNumber).toBe(result.applicationNumber)
    expect(rows).toBe(1)
  })

  it('C2b one public-contracts request: database round trips', async () => {
    await new Promise(resolve => setTimeout(resolve, 2_000))
    const since = new Date()
    const response = await fetch(`${LIVE.appUrl}/api/v1/website/public-contracts?customer_type=private`, { headers: { authorization: `Bearer ${keyA}`, origin: WEBSITE_ORIGIN } })
    await response.arrayBuffer()
    await new Promise(resolve => setTimeout(resolve, 1_500))
    report.publicContractsRoundTrips = { status: response.status, ...gatewayRequestsSince(since) }
    save()
    expect(response.status).toBe(200)
  })

  it("C3 another supplier's API key cannot read this supplier's application", async () => {
    const applicationNumber = applicationsA[0]
    // Fresh connection per read: a reused idle keep-alive socket failed with "other side closed" (FINDINGS C-B3a).
    const read = (key: string) => appRequest(`/api/v1/website/customer-applications/${encodeURIComponent(applicationNumber)}`, { headers: { authorization: `Bearer ${key}`, origin: WEBSITE_ORIGIN } })
    const own = await read(keyA), foreign = await read(keyB)
    const foreignBody = foreign.text
    report.crossTenant = { applicationNumber, own: own.status, foreign: foreign.status, foreignBody: foreignBody.slice(0, 300) }
    save()
    expect(own.status).toBe(200)
    expect([403, 404]).toContain(foreign.status)
    expect(foreignBody).not.toContain(tenantA.companyId)
  })

  it('C4 the per-client rate limit answers 429 with Retry-After instead of degrading', async () => {
    const statuses: number[] = []
    let retryAfter: string | null = null
    const errorCodes: string[] = []
    const started = Date.now()
    await Promise.all(Array.from({ length: 150 }, async () => {
      const response = await fetch(`${LIVE.appUrl}/api/v1/website/public-contracts?customer_type=private`, { headers: { authorization: `Bearer ${keyB}`, origin: WEBSITE_ORIGIN } })
      statuses.push(response.status)
      if (response.status === 429) retryAfter ??= response.headers.get('retry-after')
      const body = await response.text()
      if (response.status >= 500) errorCodes.push(`${response.status}:${/"code":"([^"]+)"/.exec(body)?.[1] ?? 'none'}`)
    }))
    const counts = statuses.reduce<Record<number, number>>((acc, status) => ({ ...acc, [status]: (acc[status] ?? 0) + 1 }), {})
    report.rateLimit = { requests: 150, limitPerMinute: 120, counts, retryAfter, ms: Date.now() - started,
      errorCodes: errorCodes.reduce<Record<string, number>>((acc, code) => ({ ...acc, [code]: (acc[code] ?? 0) + 1 }), {}) }
    save()
    expect(counts[429] ?? 0).toBeGreaterThan(0)
    expect(counts[500] ?? 0).toBe(0)
    expect(counts[503] ?? 0, JSON.stringify(report.rateLimit)).toBe(0)
  })

  it('C5 third-party outages give the website a fast, explicit answer, never a hang', async () => {
    const cases: Array<{ service: string; mode: string; extra?: Record<string, number> }> = [
      { service: 'spot', mode: 'hang' }, { service: 'spot', mode: 'server_error' }, { service: 'spot', mode: 'rate_limited', extra: { ms: 30_000 } },
      { service: 'papapi', mode: 'hang' }, { service: 'papapi', mode: 'invalid_json' },
      { service: 'lantmateriet', mode: 'hang' },
    ]
    const results: Array<Record<string, unknown>> = []
    // Let the burst of C4 and its rate-limit window pass, so each outage is measured on a quiet system.
    await wallClockWait(65_000)
    for (const [index, c] of cases.entries()) {
      await fault(c.service, c.mode, c.extra)
      const started = Date.now()
      const result = await apply(keyA, 100 + index)
      results.push({ ...c, step: result.step, status: result.status, ms: Date.now() - started,
        slowest: result.requests.reduce((max, r) => (r.ms > max.ms ? r : max), { method: '', path: '', status: 0, ms: 0 }),
        body: result.status >= 300 || result.status === 0 ? JSON.stringify(result.body).slice(0, 300) : undefined })
      await fault(c.service, 'ok')
      report.thirdPartyOutages = results
      save()
    }
    // A website request must never wait for its own 60 s client timeout, and never get a bare 500.
    for (const r of results) {
      expect(Number((r.slowest as { ms: number }).ms), JSON.stringify(r)).toBeLessThan(30_000)
      expect(r.status, JSON.stringify(r)).not.toBe(500)
    }
  })

  it('C9 nothing is left stuck for either supplier', () => {
    const stuck = detectStuckStates({ graceSeconds: 600, companyIds: [tenantA.companyId, tenantB.companyId] })
    report.stuck = stuck
    save()
    expect(stuck.filter(s => s.kind === 'stuck')).toEqual([])
  })
}, 60 * 60_000)
