// Reality scenario F: invoices for a customer with several facilities, with contract terms (binding,
// notice, automatic renewal) in every invoice and agreement file.
//
// Same world as scenario A: the supplier goes live in ALS, customers apply on the website, the switch
// runs against the simulated grid owner over SMTPS/IMAPS, the grid owner sends metering values, and the
// monthly billing cron invoices. Owner decision 2026-10-22: the one deviation from real time is the start
// date. The customers are treated as having applied in August for supply from 1 September, so a whole
// month can be invoiced today; the requested start date is set to 2026-09-01 before the switch request is
// sent. Everything else is the real code. Synthetic data only (E2E-, example.invalid).
import { writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { LIVE, literal, sql, type LiveTenant } from '../helpers/live-chain-fixture'
import { WEBSITE_ORIGIN } from '../helpers/reality/tenantWebsite'
import { closeOperatorConsole } from '../helpers/reality/operatorConsole'
import { type GridOwnerSim } from '../helpers/reality/world'
import { GRID_AREA, goLiveAlsSupplier } from '../helpers/reality/goLiveAls'
import { gs1 } from '../helpers/live-chain-wire'
import { applyAsWebsiteCustomer, type SimulatedPerson, type SimulatedSite } from './simulators/websiteCustomer'

const report: Record<string, unknown> = { scenario: 'F invoices', startedAt: new Date().toISOString() }
let tenant: LiveTenant
let gridOwner: GridOwnerSim
let apiKey = ''

/** The offer's contract terms: 12 months binding, 1 month notice, 12-month automatic renewal. */
const TERMS = { bindingMonths: 12, noticeMonths: 1, renewalMonths: 12 }
const SUPPLY_START = '2026-09-01'
report.supplyStart = SUPPLY_START
const RUN = Date.now().toString(36)
function personnummer(birth: string, serial: string) {
  const nine = birth.slice(2) + serial
  const sum = [...nine].reduce((total, digit, i) => { const v = Number(digit) * (i % 2 === 0 ? 2 : 1); return total + (v > 9 ? v - 9 : v) }, 0)
  return `${birth}${serial}${(10 - (sum % 10)) % 10}`
}
const facility = () => gs1(`735999${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`)
const person = (first: string, birth: string, serial: string, street: string): SimulatedPerson => ({ firstName: first, lastName: 'E2E-Faktura', personalNumber: personnummer(birth, serial),
  email: `e2e-${first.toLowerCase()}-${serial}-${RUN}@example.invalid`, phone: '0701234567', address: { street, postalCode: '441 30', city: 'Alingsås' } })
const site = (annualConsumptionKwh: number, street?: string): SimulatedSite => ({ facilityId: facility(), priceArea: 'SE3', annualConsumptionKwh,
  ...(street ? { address: { street, postalCode: '441 30', city: 'Alingsås' } } : {}) })
const CUSTOMERS = [
  // One private customer with a house, a holiday home and a garage: three facilities, one person.
  { person: person('Tre', '19700101', '321', 'Kungsgatan 1'), sites: [site(18_000), site(4_500, 'Drottninggatan 2'), site(1_200, 'Nygatan 3')] },
  // Control: one facility.
  { person: person('En', '19850615', '654', 'Kungsgatan 1'), sites: [site(9_000)] },
]
const EXACT_POINTS: Record<string, { latitude: number; longitude: number }> = {
  'Kungsgatan 1': { latitude: 57.9303, longitude: 12.534 }, 'Drottninggatan 2': { latitude: 57.931, longitude: 12.5355 }, 'Nygatan 3': { latitude: 57.9298, longitude: 12.533 },
}

/** Every row of the tenant that carries the supply start, per facility. */
function startDates() {
  return sql<Array<Record<string, unknown>>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('facility',mp.metering_point_id,
      'application',(SELECT jsonb_build_object('status',a.status,'start',a.requested_start_date) FROM public.website_customer_applications a WHERE a.company_id=mp.company_id AND a.metering_point_id=mp.id ORDER BY a.created_at DESC LIMIT 1),
      'contract',(SELECT jsonb_build_object('status',c.status,'starts_at',c.starts_at,'binding',c.binding_months,'binding_end',c.binding_end_date,'notice',c.notice_months,'renew',c.auto_renew_enabled) FROM public.customer_contracts c WHERE c.company_id=mp.company_id AND c.metering_point_id=mp.id ORDER BY c.created_at DESC LIMIT 1),
      'switch',(SELECT jsonb_build_object('status',s.status,'start',s.requested_start_date,'z03',s.outbound_z03_message_id) FROM public.supplier_switch_requests s WHERE s.company_id=mp.company_id AND s.metering_point_id=mp.id ORDER BY s.created_at DESC LIMIT 1))
    ORDER BY mp.created_at),'[]') FROM public.metering_points mp WHERE mp.company_id=${literal(tenant.companyId)}`)
}

describe.sequential('reality F — invoices for several facilities with contract terms', () => {
  afterAll(async () => {
    gridOwner?.stop()
    await closeOperatorConsole()
    report.finishedAt = new Date().toISOString()
    writeFileSync(process.env.GRIDEX_REALITY_REPORT ?? '/tmp/reality-f-report.json', JSON.stringify(report, null, 2))
  })

  it('F1 the supplier goes live with a 12-month binding offer', async () => {
    expect(LIVE.cronSecret && LIVE.automationUserId).toBeTruthy()
    const live = await goLiveAlsSupplier(report, { terms: TERMS })
    ;({ tenant, gridOwner, apiKey } = live)
    expect(live.provisioned.readinessBlockers, JSON.stringify(live.provisioned.readinessBlockers)).toEqual([])
    expect(apiKey).toBeTruthy()
    expect(sql(`SELECT jsonb_build_object('binding',binding_months,'notice',notice_months,'renew',auto_renew_enabled,'term',renewal_term_months)
      FROM public.contract_price_options WHERE company_id=${literal(tenant.companyId)} AND is_default`)).toEqual({ binding: 12, notice: 1, renew: true, term: 12 })
  })

  it('F2 a customer applies for three facilities and a control customer for one', async () => {
    for (const centroid of [{ postal_code: '441 30', latitude: 57.9303, longitude: 12.534 }]) await fetch('http://127.0.0.1:3901/__sim/geocode', { method: 'POST', body: JSON.stringify(centroid) })
    for (const customer of CUSTOMERS) for (const one of customer.sites) {
      const address = one.address ?? customer.person.address
      const point = EXACT_POINTS[address.street]
      const projected = sql<{ x: number; y: number; area: string | null }>(`SELECT jsonb_build_object('x',round(ST_X(p)::numeric,2),'y',round(ST_Y(p)::numeric,2),
        'area',(SELECT g.grid_area_code FROM public.platform_grid_area_geometries g WHERE g.is_active AND ST_Contains(g.geometry,p) LIMIT 1))
        FROM (SELECT ST_Transform(ST_SetSRID(ST_MakePoint(${point.longitude},${point.latitude}),4326),3006) p) q`)
      expect(projected.area).toBe(GRID_AREA)
      const [street, number] = [address.street.replace(/\s+\d+\w*$/, ''), /(\d+\w*)$/.exec(address.street)?.[1] ?? '']
      await fetch('http://127.0.0.1:3901/__sim/address', { method: 'POST', body: JSON.stringify({ street, number, postalCode: address.postalCode, city: address.city, x: projected.x, y: projected.y }) })
    }
    const results: Array<{ who: string; status: number; step: string; body?: unknown }> = []
    for (const customer of CUSTOMERS) {
      const account = await supabaseService.auth.admin.createUser({ email: customer.person.email, password: `Reality-${customer.person.personalNumber}`, email_confirm: true })
      if (account.error || !account.data.user) throw Error(`portal_account_failed:${account.error?.message}`)
      for (const one of customer.sites) {
        const result = await applyAsWebsiteCustomer({ baseUrl: LIVE.appUrl, apiKey, origin: WEBSITE_ORIGIN, person: customer.person, site: one, portalUserId: account.data.user.id })
        results.push({ who: `${customer.person.firstName} ${one.facilityId}`, status: result.status, step: result.step, body: result.status >= 300 || result.status === 0 ? result.body : undefined })
      }
    }
    report.applications = results
    for (const result of results) expect(result.status, `${result.who}: ${result.step} ${JSON.stringify(result.body).slice(0, 600)}`).toBeLessThan(300)
    report.startDatesAfterApplication = startDates()
    // One customer per person: the three facilities belong to one customer.
    const customers = sql<Array<{ facilities: number }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('facilities',n) ORDER BY n),'[]') FROM (SELECT count(*) n FROM public.metering_points WHERE company_id=${literal(tenant.companyId)} GROUP BY customer_id) x`)
    expect(customers).toEqual([{ facilities: 1 }, { facilities: 3 }])
  })
})
