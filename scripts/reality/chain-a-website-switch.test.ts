// Reality scenario A: new customers buy electricity on the supplier's website
// and the supplier switch runs against a simulated grid owner, as if live.
//
// The platform runs as `next start` with its real cron endpoints. The grid owner
// is its own process that only talks e-mail (SMTPS/IMAPS); the website is a
// client of the public website API with the tenant's own API key. The test
// only starts the world, lets it run on Vercel's cron cadence and inspects the
// outcome. Synthetic data only (E2E-, example.invalid).
import { writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { configurePlatformMailbox, configureTenant, LIVE, literal, sql, type LiveTenant } from '../helpers/live-chain-fixture'
import { goLiveOnWebsite, WEBSITE_ORIGIN } from '../helpers/reality/tenantWebsite'
import { startGridOwner, type GridOwnerSim } from '../helpers/reality/world'
import { detectStuckStates } from '../helpers/reality/stuckDetector'
import { gs1 } from '../helpers/live-chain-wire'
import { applyAsWebsiteCustomer, type SimulatedPerson, type SimulatedSite, type WebsiteApplicationResult } from './simulators/websiteCustomer'

const report: Record<string, unknown> = { scenario: 'A website switch', startedAt: new Date().toISOString() }
let tenant: LiveTenant
let gridOwner: GridOwnerSim
let apiKey = ''

/** Swedish personal identity number (12 digits) with a valid Luhn check digit; synthetic birth dates. */
function personnummer(birth: string, serial: string) {
  const nine = birth.slice(2) + serial
  const sum = [...nine].reduce((total, digit, i) => { const v = Number(digit) * (i % 2 === 0 ? 2 : 1); return total + (v > 9 ? v - 9 : v) }, 0)
  return `${birth}${serial}${(10 - (sum % 10)) % 10}`
}
const RUN = Date.now().toString(36)
// A real SE3 grid area imported from Svenska kraftnät (ALS, Alingsås); the grid owner itself is simulated.
const GRID_AREA = 'ALS'
const facility = () => gs1(`735999${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`)
const person = (first: string, birth: string, serial: string, street: string): SimulatedPerson => ({ firstName: first, lastName: 'E2E-Reality', personalNumber: personnummer(birth, serial),
  email: `e2e-${first.toLowerCase()}-${serial}-${RUN}@example.invalid`, phone: '0701234567', address: { street, postalCode: '441 30', city: 'Alingsås' } })
const site = (annualConsumptionKwh: number, extra: Partial<SimulatedSite> = {}): SimulatedSite => ({ facilityId: facility(), priceArea: 'SE3', annualConsumptionKwh, ...extra })
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
const CUSTOMERS = [
  { person: person('Villa', '19800212', '123', 'Kungsgatan 1'), sites: [site(18_000)] },
  { person: person('Tva', '19750503', '456', 'Drottninggatan 2'), sites: [site(4_500), site(9_000, { address: { street: 'Sommarstugevägen 5', postalCode: '441 95', city: 'Alingsås' } })] },
  { person: person('Flytt', '19920917', '789', 'Nygatan 3'), sites: [site(2_500, { moveInDate: today })] },
]

/** Postal-code centroids the geocoder knows (real coordinates inside SVK's ALS polygon). */
const POSTAL_CENTROIDS = [{ postal_code: '441 30', latitude: 57.9303, longitude: 12.534 }, { postal_code: '441 95', latitude: 57.93857, longitude: 12.52313 }]

describe.sequential('reality A — website customers switch supplier', () => {
  afterAll(() => {
    gridOwner?.stop()
    report.finishedAt = new Date().toISOString()
    writeFileSync(process.env.GRIDEX_REALITY_REPORT ?? '/tmp/reality-a-report.json', JSON.stringify(report, null, 2))
  })

  it('A1 the supplier goes live: Ediel identity, grid owner, published offer and website integration', async () => {
    expect(LIVE.cronSecret && LIVE.automationUserId).toBeTruthy()
    expect(configurePlatformMailbox()).toBe(1)
    tenant = await configureTenant(supabaseService as never)
    gridOwner = await startGridOwner({ edielId: tenant.issuerEdielId, email: tenant.gridOwnerEmail, pollMs: 10_000 })
    const provisioned = await goLiveOnWebsite(tenant, tenant.adminUserId)
    report.tenant = { companyId: tenant.companyId, supplier: tenant.supplierEdielId, gridOwner: tenant.issuerEdielId }
    report.websiteGoLive = { state: provisioned.state, launchReady: provisioned.launchReady, visibleContracts: provisioned.visibleContractCount,
      blockers: provisioned.readinessBlockers, warnings: provisioned.readinessWarnings }
    apiKey = provisioned.credential?.token ?? ''
    expect(provisioned.readinessBlockers, JSON.stringify(provisioned.readinessBlockers)).toEqual([])
    expect(apiKey).toBeTruthy()
  })

  it('A1b the website sees the published offer through its own API key', async () => {
    const response = await fetch(new URL('/api/v1/website/public-contracts', LIVE.appUrl), { headers: { authorization: `Bearer ${apiKey}`, origin: WEBSITE_ORIGIN } })
    const body = await response.json().catch(() => null) as { contracts?: unknown[]; data?: unknown[] } | null
    report.publicContracts = { status: response.status, count: (body?.contracts ?? body?.data ?? []).length }
    expect(response.status, JSON.stringify(body).slice(0, 500)).toBe(200)
  })

  it('A2 new customers apply on the website: a house, a customer with two facilities and a move-in', async () => {
    for (const centroid of POSTAL_CENTROIDS) await fetch('http://127.0.0.1:3901/__sim/geocode', { method: 'POST', body: JSON.stringify(centroid) })
    const results: Array<{ who: string; result: WebsiteApplicationResult }> = []
    for (const customer of CUSTOMERS) {
      // The customer first creates their Mina sidor account (Supabase Auth), then checks out logged in.
      const account = await supabaseService.auth.admin.createUser({ email: customer.person.email, password: `Reality-${customer.person.personalNumber}`, email_confirm: true })
      if (account.error || !account.data.user) throw Error(`portal_account_failed:${account.error?.message}`)
      for (const site of customer.sites) {
        const result = await applyAsWebsiteCustomer({ baseUrl: LIVE.appUrl, apiKey, origin: WEBSITE_ORIGIN, person: customer.person, site, portalUserId: account.data.user.id })
        results.push({ who: `${customer.person.firstName} ${site.facilityId}`, result })
      }
    }
    report.applications = results.map(({ who, result }) => ({ who, step: result.step, status: result.status, applicationNumber: result.applicationNumber,
      body: result.status >= 300 || result.status === 0 ? result.body : undefined, requests: result.requests }))
    for (const { who, result } of results) expect(result.status, `${who}: ${result.step} ${JSON.stringify(result.body).slice(0, 600)}`).toBeLessThan(300)
  })

  it('A9 nothing is left stuck in any queue of this tenant', () => {
    const stuck = detectStuckStates({ graceSeconds: 600, companyIds: [tenant.companyId] })
    report.stuck = stuck
    expect(stuck.filter(row => row.kind === 'stuck')).toEqual([])
    expect(sql(`SELECT to_jsonb(count(*)) FROM public.companies WHERE id=${literal(tenant.companyId)}`)).toBe(1)
  })
})
