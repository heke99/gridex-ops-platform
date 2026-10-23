// Reality scenario K: the tenant's statistics are computed correctly and shown correctly.
//
// Same world as scenarios A, F and H: a supplier goes live in ALS and the grid owner is simulated over SMTPS/IMAPS.
// A known set of events is created for that tenant (T) through the real product paths, and a control tenant (C)
// is established beside it:
//   L1, L2  sign two months ago and are switched in for the 1st of last month on the grid owner's Z04;
//   N1      signs last month and is switched in for the 1st of this month (a new customer this month);
//   N2      signs this month at 00:30 on the 1st (Swedish time; still last month in UTC), switch sent, no answer;
//   Q1      signs today for supply in three months: the switch is created and waits for its send window;
//   W1      buys on the tenant's website today (public website API): the switch is sent, no answer;
//   L2      then moves out (the grid owner's PRODAT Z05 LK, end yesterday 00:00);
//   L1      is metered by the grid owner for the last day of last month and the first day of this month (UTILTS
//           E66, Stockholm civil days), i.e. across the month boundary.
// Then the analytics crons run as Vercel runs them, and every number on the tenant's own pages (Driftöversikt,
// Analys, Portföljöversikt) and on the white-label portfolio page must equal the independent count computed from
// the business tables (scripts/helpers/reality/statistics.ts independentMonth), for T and for C. C must never
// contain anything of T. Nothing the grid owner would send is written to the database.
// Synthetic data only (E2E-, example.invalid). The defects found while building it are in DEFECTS below.
import { writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it, type TestContext } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { prepareAndQueueEdielZ03 } from '@/lib/ediel/flows/prodatSwitch'
import { deriveRequestedMethodBeforeSwitch } from '@/lib/operations/switchRequestedMethodPreparation'
import { processPendingContractConfirmations } from '@/lib/customer-contracts/onlineSigning'
import { savePowerOfAttorney } from '@/lib/operations/db'
import { countMissingMeteringPoints } from '@/lib/analytics/db'
import { getPortfolioMonthForCompany, type PortfolioMonthRow } from '@/lib/analytics/customerPortfolio'
import { stockholmLocalToUtc } from '@/lib/time/stockholm'
import { LIVE, augustSupplyCustomer, configureTenant, cron, existingSupplyCustomer, gridOwnerSends, literal, sql, type AugustFacility, type LiveTenant } from '../helpers/live-chain-fixture'
import { closeOperatorConsole, operatorSession } from '../helpers/reality/operatorConsole'
import { pollInboundMailLanes, runOperationalCronSlot, type GridOwnerSim } from '../helpers/reality/world'
import { GRID_AREA, GRID_OWNER_EDIEL_ID, goLiveAlsSupplier } from '../helpers/reality/goLiveAls'
import { createSignedContractSwitch, inboundSources, reprocessHeldUtilts, sourceDiagnosis, supplyState } from '../helpers/reality/leaving'
import { createTenantStaff } from '../helpers/reality/tenantStaff'
import { WEBSITE_ORIGIN, ensureProductionWhiteLabelColumnParity } from '../helpers/reality/tenantWebsite'
import { dayE66, dstDayProfile, stockholmQuarterCount } from '../helpers/reality/dst'
import { registerUtiltsIssuer } from '../helpers/utiltsConsumptionParties'
import { gs1 } from '../helpers/live-chain-wire'
import { createPartnerHomeCompany, createWhiteLabelPartner, ensureProductionWhiteLabelPlatformParity, independentMonth, readLabelledValues, readTable,
  shownNumber, signedInClient, snapshotMonth, stockholmMonths, swedishToday, type IndependentMonth } from '../helpers/reality/statistics'
import { buildZ05End, gridOwnerSendsLeavingFile } from './simulators/gridOwnerLeaving'
import { applyAsWebsiteCustomer, type SimulatedPerson } from './simulators/websiteCustomer'

type Row = Record<string, unknown>
const report: Record<string, unknown> = { scenario: 'K statistics', startedAt: new Date().toISOString() }
const REPORT = process.env.GRIDEX_REALITY_REPORT ?? '/tmp/reality-k-report.json'
const saveReport = (extra: Record<string, unknown> = {}) => writeFileSync(REPORT, JSON.stringify({ ...report, ...extra }, null, 2))
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
let tenant: LiveTenant
let control: LiveTenant
let gridOwner: GridOwnerSim
let apiKey = ''

const TODAY = swedishToday()
const M = stockholmMonths(TODAY)
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const YESTERDAY = addDays(TODAY, -1)
const at = (date: string, hour: number, minute: number) => {
  const [year, month, day] = date.split('-').map(Number)
  return stockholmLocalToUtc({ year, month, day, hour, minute }).toISOString()
}
/** N2 signs 00:30 on the 1st of this month in Sweden: still the previous month in UTC (FINDINGS K-05). */
const BOUNDARY_SIGNED_AT = at(`${M.current}-01`, 0, 30)
/** L2 moves out: the new occupant's supply starts yesterday 00:00 (Ediel fixed normal time). */
const L2_END_MINUTE = `${YESTERDAY.replaceAll('-', '')}0000`
/** L1 is metered across the month boundary; on the 1st itself the first day is not complete, so two days of last month. */
const METERED_DAYS = TODAY > `${M.current}-01` ? [M.lastDay(M.last), `${M.current}-01`] : [addDays(M.lastDay(M.last), -1), M.lastDay(M.last)]
report.timeline = { TODAY, months: M, BOUNDARY_SIGNED_AT, L2_END_MINUTE, METERED_DAYS }

const RUN = Date.now().toString(36)
function personnummer(birth: string, serial: string) {
  const nine = birth.slice(2) + serial
  const sum = [...nine].reduce((total, digit, i) => { const v = Number(digit) * (i % 2 === 0 ? 2 : 1); return total + (v > 9 ? v - 9 : v) }, 0)
  return `${birth}${serial}${(10 - (sum % 10)) % 10}`
}
const facility = () => gs1(`735999${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`)
const address = { street: 'Kungsgatan 1', postalCode: '441 30', city: 'Alingsås' }
type Party = { firstName: string; lastName: string; personalNumber: string; email: string; address: typeof address; gsrn: string
  customerId?: string; facility?: AugustFacility; switchId?: string }
const person = (first: string, birth: string, serial: string): Party => ({ firstName: first, lastName: 'E2E-Statistik', personalNumber: personnummer(birth, serial),
  email: `e2e-${first.toLowerCase()}-${serial}-${RUN}@example.invalid`, address, gsrn: facility() })
const L1 = person('Matare', '19710101', '211'), L2 = person('Flyttar', '19720202', '322'), N1 = person('Nykund', '19730303', '433')
const N2 = person('Midnatt', '19740404', '544'), Q1 = person('Kolista', '19750505', '655')
const W1: SimulatedPerson = { firstName: 'Webbkund', lastName: 'E2E-Statistik', personalNumber: personnummer('19760606', '766'),
  email: `e2e-webbkund-766-${RUN}@example.invalid`, phone: '0701234567', address }
const W1_GSRN = facility()
/** Lantmäteriet's real point of the synthetic address, inside SVK's ALS polygon (as scenario A). */
const EXACT_POINT = { latitude: 57.9303, longitude: 12.534 }

/** Inconsistencies and defects found while building this scenario (FINDINGS K; proofs named in each). */
const DEFECTS = [
  { id: 'K-01', status: 'confirmed (world read-only, native) + fix 20261022211000', severity: 'high',
    where: 'company_dashboard_summary_v ongoing_supplier_switches/open_switches, gridex_platform_dashboard_summary_v1, app/admin/page.tsx fallback, lib/operations/switchLifecycleBlocks.ts OPEN_SUPPLIER_SWITCH_STATUSES',
    what: "\"Pågående leverantörsbyten\" omits 'prepared' (Z03 sent, waiting for the grid owner) and keeps 'accepted' switches whose supply has started or ended.", proof: 'scripts/statistics-k-native.test.ts' },
  { id: 'K-02', status: 'confirmed (world read-only, native) + fix 20261022211000', severity: 'medium', where: 'company_dashboard_summary_v metering_values_total, platform summary',
    what: '"Mätvärden" counts replaced revisions: a corrected value counts twice.', proof: 'scripts/statistics-k-native.test.ts' },
  { id: 'K-03', status: 'confirmed (world read-only, PGlite, native) + fix 20261022210000, lib/analytics/db.ts fallback', severity: 'high',
    where: 'gridex_rebuild_metering_monthly_consumption (date_trunc in UTC), buildLiveMonthlyFallback',
    what: 'Monthly consumption, "Mottagna mätvärden", actual kWh and forecast history bucket values by UTC month: the first 1-2 Swedish hours of every month belong to the previous month (DST-C1 class).',
    proof: '__tests__/statistics-k-month-buckets-sql.test.ts, scripts/statistics-k-native.test.ts' },
  { id: 'K-04', status: 'confirmed (world read-only, PGlite, native) + fix 20261022210000', severity: 'high', where: 'gridex_missing_metering_points_v1',
    what: '"Saknade mätvärden" uses a UTC month and expects values for every active point, also before supply starts and after the customer left (world, October: 305 shown vs 131 supply-aware).',
    proof: '__tests__/statistics-k-month-buckets-sql.test.ts, scripts/statistics-k-native.test.ts' },
  { id: 'K-05', status: 'confirmed (PGlite) + fix 20261022210000', severity: 'medium', where: 'gridex_customer_portfolio_monthly_internal (SET TimeZone UTC)',
    what: 'Powers of attorney requested/signed and metering requests are bucketed by UTC month: a signature 00:30 on the 1st counts in the previous month.', proof: '__tests__/statistics-k-month-buckets-sql.test.ts' },
  { id: 'K-06', status: 'confirmed (PGlite) + owner decision 2026-10-23 + fix 20261023150000', severity: 'medium',
    where: 'gridex_customer_portfolio_monthly_internal/active_counts/churn_reasons/cohorts_at/bidding_zones, gridex_rebuild_company_analytics_month active sites/points (raw end_date); CustomerPortfolioViews "Sista leveransdag i månaden"',
    what: 'end_date is exclusive for a received Z05 end and inclusive for a manual end; the same departure was churned in different months, and the card hint says last supply day although a switch away on the 1st was counted in the new month. Decision: churn and active counts read the last supply day (gridex_supply_period_last_day_v1); a Z05 end on the 1st churns in the previous month. Active at month start/end = supplied on the day before and on the 1st (this/next month), so end(M) = start(M+1) and net = new - churned apart from re-entries (portfolio, snapshot sites/points, cohorts; point-in-time active_counts/bidding_zones read the same day rule).',
    proof: '__tests__/statistics-k-month-buckets-sql.test.ts, scripts/statistics-k-native.test.ts' },
  { id: 'K-07', status: 'confirmed (PGlite, native) + fix 20261022210000, lib/analytics/db.ts fallback', severity: 'medium', where: 'gridex_rebuild_company_analytics_month total_customers, buildLiveMonthlyFallback',
    what: '"Kunder totalt" counts test-portal and archived/deleted customers; the dashboard "Kunder" does not.', proof: '__tests__/statistics-k-month-buckets-sql.test.ts, scripts/statistics-k-native.test.ts' },
  { id: 'K-08', status: 'confirmed (world read-only, PGlite, native) + fix 20261022210000', severity: 'medium', where: 'gridex_rebuild_company_analytics_month active_sites/active_metering_points',
    what: '"Aktiva anläggningar/mätpunkter" use the status column, which stays active after a move-out or switch away; the portfolio\'s supply definition is the documented one.',
    proof: '__tests__/statistics-k-month-buckets-sql.test.ts, scripts/statistics-k-native.test.ts' },
  { id: 'K-09', status: 'confirmed (native) + fixed lib/analytics/db.ts', severity: 'high', where: 'lib/analytics/db.ts forecast readers, report export, filter options (PostgREST max_rows=1000)',
    what: 'Forecast totals per SE area/grid owner, CSV exports and filter lists silently stop at 1 000 rows.', proof: 'scripts/statistics-k-native.test.ts' },
  { id: 'K-10', status: 'confirmed (world read-only), patch proposed', severity: 'low', where: 'lib/tenant/usageStats.ts listCompanies limit 250, openSupplierSwitches status waiting_response',
    what: 'Platform usage statistics omit every tenant after the 250th (world: 314) and "open switches" counts a status no switch has.' },
  { id: 'K-11', status: 'confirmed (unit) + fixed lib/analytics/db.ts', severity: 'low', where: 'getOverviewBreakdowns', what: 'A zone without metering points shows its forecast kWh as a point count.', proof: '__tests__/statistics-k-analytics-readers.test.ts' },
  { id: 'K-12', status: 'confirmed (unit) + fixed lib/analytics/utils.ts, customerPortfolio.ts', severity: 'low', where: 'monthStart() default, portfolioAsOf, getActiveCustomerCounts',
    what: 'Default month and "today" were UTC: 00:00-02:00 on the 1st showed the previous month.', proof: '__tests__/statistics-k-analytics-readers.test.ts' },
  { id: 'K-B1', status: 'blocked check (replay drift, F47)', severity: 'info', where: 'white_label_platforms/white_label_platform_memberships absent in the replay',
    what: 'The white-label page cannot run locally without production parity; this scenario mirrors the two tables (statistics.ts ensureProductionWhiteLabelPlatformParity).' },
]
report.defects = DEFECTS

let established = false
function requireEstablished(step: string, context: TestContext) {
  if (established) return
  report[step] = 'skipped: L1, L2 and N1 were not supplied on the grid owner\'s Z04 in K3'
  return context.skip()
}
const companyLiteral = () => literal(tenant.companyId)
const brpEdielId = () => sql<string>(`SELECT to_jsonb(brp_ediel_id) FROM public.ediel_brp_settings WHERE company_id=${companyLiteral()} AND environment='production' AND is_active ORDER BY valid_from DESC LIMIT 1`)
/** Like Vercel: inbound mail, then the Ediel outbox, then customer operations, once a minute. */
async function receiveUntil(done: () => boolean, minutes: number) {
  const runs: unknown[] = []
  const deadline = Date.now() + minutes * 60_000
  for (;;) {
    // Both inbound lanes: production as Vercel polls it (the tenant is live in production), then test.
    const inbound = await pollInboundMailLanes()
    const outbox = await cron('/api/ediel/outbox/process')
    const operations = await cron('/api/internal/customer-operations/cron')
    runs.push({ at: new Date().toISOString(), inbound: inbound.production.status, inboundTest: inbound.test.status, outbox: outbox.status, operations: operations.status })
    if (done() || Date.now() > deadline) break
    await pause(60_000)
  }
  return runs
}
const gridOwnerOfAls = () => sql<{ id: string; ediel: string }>(`SELECT jsonb_build_object('id',id,'ediel',ediel_id) FROM public.grid_owners WHERE ediel_id=${literal(GRID_OWNER_EDIEL_ID)} AND company_id IS NULL`)

/** Signed contract + power of attorney (augustSupplyCustomer) and, unless `build` is false, the real Z03. */
async function signAndSwitch(p: Party, input: { supplyStart: string; signedAt: string; switchCreatedAt: string; build: boolean }) {
  const grid = gridOwnerOfAls()
  const one = await augustSupplyCustomer(tenant, { firstName: p.firstName, lastName: p.lastName, personalNumber: p.personalNumber, email: p.email, address: p.address,
    supplyStart: input.supplyStart, authorizedAt: input.signedAt, grid: { gridOwnerId: grid.id, gridOwnerEdielId: grid.ediel, gridAreaCode: GRID_AREA },
    facilities: [{ gsrn: p.gsrn, ...p.address, annualConsumptionKwh: 6_000 }] })
  p.customerId = one.customerId
  p.facility = one.facilities[0]
  const ready = () => sql<boolean>(`SELECT coalesce(bool_and(switch_ready),false) FROM public.customer_contract_lifecycle_readiness_v WHERE company_id=${companyLiteral()} AND metering_point_id=${literal(p.facility!.meteringPointId)}`)
  for (let attempt = 0; attempt < 3 && !ready(); attempt += 1) await processPendingContractConfirmations(50)
  const created = await createSignedContractSwitch(tenant, { customerId: p.customerId, facility: p.facility, supplyStart: input.supplyStart, createdAt: input.switchCreatedAt })
  p.switchId = created.switchId
  if (!input.build) return { who: p.firstName, ok: true, built: false, start: created.start }
  try {
    await deriveRequestedMethodBeforeSwitch({ actorUserId: LIVE.automationUserId, switchRequestId: created.switchId })
    const message = await prepareAndQueueEdielZ03({ actorUserId: LIVE.automationUserId, switchRequestId: created.switchId, environment: 'production' })
    return { who: p.firstName, ok: true, built: true, message: message.id, start: created.start }
  } catch (error) { return { who: p.firstName, ok: false, error: error instanceof Error ? error.message : String(error) } }
}
const latestPeriod = (p: Party) => { const periods = supplyState(tenant.companyId, [p.gsrn])[0]?.periods ?? []; return periods[periods.length - 1] ?? null }

/** One compared number: shown by the platform vs the independent count. Every mismatch is recorded and fails the test. */
const comparisons: Array<{ surface: string; tenant: string; month: string; metric: string; shown: number | null; independent: number; hint?: string }> = []
function compare(surface: string, who: 'T' | 'C', month: string, metric: string, shown: number | null | undefined, independent: number, hint?: string) {
  const value = shown === undefined ? null : shown
  comparisons.push({ surface, tenant: who, month, metric, shown: value, independent, hint })
  expect.soft(value, `${surface} ${who} ${month} ${metric}${hint ? ` (${hint})` : ''}`).toBe(independent)
}
const independent: Record<string, IndependentMonth> = {}
const truth = (who: 'T' | 'C', month: string) => {
  const key = `${who}:${month}`
  independent[key] ??= independentMonth(who === 'T' ? tenant.companyId : control.companyId, month, TODAY)
  return independent[key]
}

describe.sequential('reality K — statistics are computed and shown correctly', () => {
  afterAll(async () => {
    gridOwner?.stop()
    await closeOperatorConsole()
    report.comparisons = comparisons
    report.mismatches = comparisons.filter(c => c.shown !== c.independent)
    report.independent = independent
    report.finishedAt = new Date().toISOString()
    saveReport()
  })

  it('K1 the supplier goes live in ALS; a control supplier with its own customers runs beside it', async () => {
    expect(LIVE.cronSecret && LIVE.automationUserId).toBeTruthy()
    const live = await goLiveAlsSupplier(report, { brpValidFrom: `${M.beforeLast}-01` })
    ;({ tenant, gridOwner, apiKey } = live)
    expect(live.provisioned.readinessBlockers, JSON.stringify(live.provisioned.readinessBlockers)).toEqual([])
    // C: a supplier already serving two migrated customers since the 1st of last month; one signed power of attorney.
    control = await configureTenant(supabaseService as never)
    const c1 = await existingSupplyCustomer(supabaseService as never, control, { name: 'Kontroll Ett', supplyStart: `${M.last}-01` })
    const c2 = await existingSupplyCustomer(supabaseService as never, control, { name: 'Kontroll Tva', supplyStart: `${M.last}-01` })
    const signedAt = at(`${M.beforeLast}-15`, 10, 0)
    const poaInput = { customer_id: c1.customerId, site_id: c1.siteId, companyId: control.companyId, reference: `POAK${RUN.toUpperCase()}`, scope: 'supplier_switch' as const,
      valid_from: `${M.beforeLast}-15`, valid_to: `${Number(M.beforeLast.slice(0, 4)) + 1}${M.beforeLast.slice(4)}-15`, method: 'manual_pdf', signer_name: 'E2E Kontroll Ett',
      signer_identity_number: personnummer('19600101', '877'), accepted_source: 'e2e_reality_k', signedScopes: ['supplier_switch'], scopeSummary: { scopes: ['supplier_switch'] } }
    const poa = await savePowerOfAttorney(supabaseService, { ...poaInput, status: 'draft', signed_at: null, accepted_at: null })
    await savePowerOfAttorney(supabaseService, { ...poaInput, id: poa.id, status: 'signed', signed_at: signedAt, accepted_at: signedAt })
    report.control = { companyId: control.companyId, customers: [c1.customerId, c2.customerId], poa: poa.id }
    saveReport()
  })

  // Signed on the 3rd so the market lead time to the 1st of the next month holds in every month (also February).
  it('K2 L1 and L2 (two months ago) and N1 (last month) sign and are switched in through the real Z03 builder', async () => {
    const built = [
      await signAndSwitch(L1, { supplyStart: `${M.last}-01`, signedAt: at(`${M.beforeLast}-03`, 9, 30), switchCreatedAt: at(`${M.beforeLast}-03`, 9, 31), build: true }),
      await signAndSwitch(L2, { supplyStart: `${M.last}-01`, signedAt: at(`${M.beforeLast}-03`, 9, 40), switchCreatedAt: at(`${M.beforeLast}-03`, 9, 41), build: true }),
      await signAndSwitch(N1, { supplyStart: `${M.current}-01`, signedAt: at(`${M.last}-03`, 9, 30), switchCreatedAt: at(`${M.last}-03`, 9, 31), build: true }),
    ]
    report.establishedZ03 = built
    expect(built.filter(b => !b.ok), 'the real Z03 builder refused a switch').toEqual([])
  }, 15 * 60_000)

  it('K3 the world runs on cron cadence until the grid owner\'s Z04 makes L1, L2 and N1 supplied', async () => {
    await gridOwner.profile({ contrlDelayMs: 20_000, aperakDelayMs: 40_000, z04DelayMs: 90_000 })
    const gsrns = [L1, L2, N1].map(p => p.gsrn)
    const deadline = Date.now() + Number(process.env.GRIDEX_REALITY_K3_MINUTES ?? 30) * 60_000
    const slots: unknown[] = []
    let state = supplyState(tenant.companyId, gsrns)
    for (;;) {
      const ran = await runOperationalCronSlot()
      slots.push({ at: new Date().toISOString(), crons: ran.map(r => ({ path: r.path, status: r.status })) })
      state = supplyState(tenant.companyId, gsrns)
      saveReport({ worldSlots: slots, supply: state })
      if (state.every(row => row.periods.some(p => p.status === 'active')) || state.some(row => row.switch === 'failed') || Date.now() > deadline) break
      await pause(60_000)
    }
    report.supplyAfterZ04 = state
    const startOf = (p: Party) => state.find(row => row.facility === p.gsrn)?.periods.find(x => x.status === 'active')?.start
    established = [startOf(L1), startOf(L2), startOf(N1)].join() === [`${M.last}-01`, `${M.last}-01`, `${M.current}-01`].join()
    expect(established, JSON.stringify(state)).toBe(true)
  }, 40 * 60_000)

  it('K4 three switches stay open: N2 (signed 00:30 on the 1st) and W1 (website) are sent without answer, Q1 waits for its window', async (context) => {
    requireEstablished('K4', context)
    // The grid owner stops answering switch requests (acknowledgements continue).
    await gridOwner.profile({ z04DelayMs: 24 * 3_600_000 })
    const now = new Date().toISOString()
    report.pendingZ03 = [
      await signAndSwitch(N2, { supplyStart: `${M.next}-01`, signedAt: BOUNDARY_SIGNED_AT, switchCreatedAt: new Date(Date.parse(BOUNDARY_SIGNED_AT) + 60_000).toISOString(), build: true }),
      await signAndSwitch(Q1, { supplyStart: `${M.later}-01`, signedAt: now, switchCreatedAt: now, build: false }),
    ]
    // W1 buys on the website: Lantmäteriet's exact point (as scenario A), a Mina sidor account, then the checkout.
    await fetch('http://127.0.0.1:3901/__sim/geocode', { method: 'POST', body: JSON.stringify({ postal_code: address.postalCode, ...EXACT_POINT }) })
    const projected = sql<{ x: number; y: number }>(`SELECT jsonb_build_object('x',round(ST_X(p)::numeric,2),'y',round(ST_Y(p)::numeric,2))
      FROM (SELECT ST_Transform(ST_SetSRID(ST_MakePoint(${EXACT_POINT.longitude},${EXACT_POINT.latitude}),4326),3006) p) q`)
    await fetch('http://127.0.0.1:3901/__sim/address', { method: 'POST', body: JSON.stringify({ street: 'Kungsgatan', number: '1', postalCode: address.postalCode, city: address.city, x: projected.x, y: projected.y }) })
    const account = await supabaseService.auth.admin.createUser({ email: W1.email, password: `Reality-${W1.personalNumber}`, email_confirm: true })
    if (account.error || !account.data.user) throw Error(`portal_account_failed:${account.error?.message}`)
    const website = await applyAsWebsiteCustomer({ baseUrl: LIVE.appUrl, apiKey, origin: WEBSITE_ORIGIN, person: W1,
      site: { facilityId: W1_GSRN, priceArea: 'SE3', annualConsumptionKwh: 9_000 }, portalUserId: account.data.user.id })
    report.website = { step: website.step, status: website.status, applicationNumber: website.applicationNumber, body: website.status >= 300 || website.status === 0 ? website.body : undefined }
    expect.soft(website.status, `W1 ${website.step}: ${JSON.stringify(website.body).slice(0, 500)}`).toBeLessThan(300)
    const sent = (switchId: string | undefined) => Boolean(switchId) && sql<boolean>(`SELECT EXISTS(SELECT FROM public.ediel_messages WHERE id=(SELECT outbound_z03_message_id FROM public.supplier_switch_requests WHERE id=${literal(switchId!)}) AND status IN ('sent','acknowledged','delivered'))`)
    const w1Switch = () => sql<string | null>(`SELECT to_jsonb(s.id) FROM public.supplier_switch_requests s JOIN public.metering_points mp ON mp.id=s.metering_point_id
      WHERE s.company_id=${companyLiteral()} AND mp.metering_point_id=${literal(W1_GSRN)} ORDER BY s.created_at DESC LIMIT 1`)
    const slots: unknown[] = []
    const deadline = Date.now() + Number(process.env.GRIDEX_REALITY_K4_MINUTES ?? 20) * 60_000
    for (;;) {
      const ran = await runOperationalCronSlot()
      slots.push({ at: new Date().toISOString(), crons: ran.map(r => ({ path: r.path, status: r.status })) })
      if ((sent(N2.switchId) && sent(w1Switch() ?? undefined)) || Date.now() > deadline) break
      await pause(60_000)
    }
    report.pendingSlots = slots
    report.pendingSwitches = sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('facility',mp.metering_point_id,'status',s.status,'start',s.requested_start_date,'z04',s.inbound_z04_message_id IS NOT NULL)),'[]')
      FROM public.supplier_switch_requests s JOIN public.metering_points mp ON mp.id=s.metering_point_id WHERE s.company_id=${companyLiteral()}`)
    saveReport()
    expect(sent(N2.switchId), 'N2: the Z03 reached the grid owner').toBe(true)
    expect.soft(sent(w1Switch() ?? undefined), 'W1: the website customer\'s Z03 reached the grid owner').toBe(true)
    expect(sql<string>(`SELECT to_jsonb(status) FROM public.supplier_switch_requests WHERE id=${literal(Q1.switchId!)}`), 'Q1 waits for its send window').toMatch(/^(queued|draft|prepared)$/)
  }, 30 * 60_000)

  it('K5 L2 moves out: the grid owner\'s Z05 LK ends its supply yesterday', async (context) => {
    requireEstablished('K5', context)
    const ourZ03 = sql<string>(`SELECT to_jsonb(raw_payload) FROM public.ediel_messages WHERE id=(SELECT outbound_z03_message_id FROM public.supplier_switch_requests WHERE id=${literal(L2.switchId!)})`)
    const qualifier = /UNB\+UNOC:3\+[^:+]+:([^+:']+)/.exec(ourZ03)?.[1] ?? '14'
    const z05 = buildZ05End({ gridOwner: GRID_OWNER_EDIEL_ID, supplier: tenant.supplierEdielId, gridArea: GRID_AREA, brp: brpEdielId(), qualifier,
      point: L2.gsrn, customerIdentity: L2.personalNumber, customerName: `${L2.firstName} ${L2.lastName}`, endMinute: L2_END_MINUTE, variant: 'LK', environment: 'production' })
    await gridOwnerSendsLeavingFile({ from: gridOwner.email, kind: 'PRODAT-Z05LK', edifact: z05.raw, reference: z05.reference })
    const z05s = () => inboundSources(tenant.companyId, ['Z05'])
    report.z05Reception = await receiveUntil(() => z05s().length >= 1 && z05s().every(m => !['received', 'processing'].includes(m.status)), Number(process.env.GRIDEX_REALITY_K5_MINUTES ?? 10))
    for (let i = 0; i < 2; i += 1) await runOperationalCronSlot()
    report.z05Received = z05s().map(m => ({ ...m, diagnosis: sourceDiagnosis(m.id) }))
    report.l2Period = latestPeriod(L2)
    saveReport()
    expect(latestPeriod(L2), JSON.stringify(report.z05Received)).toMatchObject({ status: 'ended', end: YESTERDAY })
  }, 20 * 60_000)

  it('K6 the grid owner meters L1 across the month boundary (UTILTS E66, Stockholm civil days)', async (context) => {
    requireEstablished('K6', context)
    registerUtiltsIssuer(sql as never, literal, GRID_OWNER_EDIEL_ID, tenant.adminUserId)
    const sent: Row[] = []
    for (const [index, day] of METERED_DAYS.entries()) {
      const values = dstDayProfile(day, index, 2)
      const reference = `K${day.replaceAll('-', '').slice(2)}${L1.gsrn.slice(-6)}`
      // Production interchanges: the tenant is live in production (Z03 environment 'production'; FINDINGS T7).
      const wire = dayE66({ issuer: GRID_OWNER_EDIEL_ID, receiver: tenant.supplierEdielId, meterId: L1.gsrn, day, values, reference, framing: 'civil_fixed_cet', notAfter: Date.now() - 2 * 60_000,
        environment: 'production' })
      await gridOwnerSends({ from: gridOwner.email, subject: `UTILTS-E66 ${reference}`, filename: `UTILTS-E66_${reference}.edi`, edifact: wire.edifact })
      sent.push({ day, reference, quarters: values.length, periodStart: wire.periodStart, periodEnd: wire.periodEnd })
    }
    report.e66Sent = sent
    const e66 = () => inboundSources(tenant.companyId, ['E66'])
    report.e66Reception = await receiveUntil(() => e66().length >= METERED_DAYS.length, Number(process.env.GRIDEX_REALITY_K6_MINUTES ?? 15))
    report.e66Reprocess = await reprocessHeldUtilts(tenant, e66().map(m => m.id))
    const stored = sql<Record<string, number>>(`SELECT coalesce(jsonb_object_agg(d,n),'{}') FROM (SELECT (period_start AT TIME ZONE 'Europe/Stockholm')::date::text d,count(*) n
      FROM public.metering_values WHERE company_id=${companyLiteral()} AND metering_point_id=${literal(L1.facility!.meteringPointId)} AND coalesce(is_current,true) GROUP BY 1) x`)
    report.e66Stored = stored
    saveReport()
    for (const day of METERED_DAYS) expect(stored[day], `L1 ${day}: every quarter-hour of the Swedish day is stored once`).toBe(stockholmQuarterCount(day))
  }, 30 * 60_000)

  it('K7 the analytics crons run as Vercel runs them (daily for this month, monthly for last month)', async (context) => {
    requireEstablished('K7', context)
    const daily = await cron(`/api/cron/analytics/daily?month=${M.current}`)
    const monthly = await cron(`/api/cron/analytics/monthly?month=${M.last}`)
    report.analyticsCrons = { daily: { status: daily.status, companies: (daily.body as Row).companies }, monthly: { status: monthly.status, companies: (monthly.body as Row).companies } }
    saveReport()
    expect(daily.status, JSON.stringify(daily.body).slice(0, 800)).toBe(200)
    expect(monthly.status, JSON.stringify(monthly.body).slice(0, 800)).toBe(200)
    for (const id of [tenant.companyId, control.companyId]) for (const month of [M.current, M.last]) expect(snapshotMonth(id, month), `snapshot ${id} ${month}`).not.toBeNull()
  }, 60 * 60_000)

  it('K8 the known events are what the business tables hold (independent counts vs the event ledger)', (context) => {
    requireEstablished('K8', context)
    const churnMonth = addDays(YESTERDAY, -1).slice(0, 7) // L2's last supply day (Z05 end_date = YESTERDAY is exclusive)
    // Active at a month boundary = supplied on the day before and on the 1st: L2 is still active at this month's
    // start unless its last supply day was last month (run on the 1st or 2nd); N1 (from the 1st) is new, not at the start.
    const l2AtStart = churnMonth === M.current ? 1 : 0
    const t0 = truth('T', M.current), t1 = truth('T', M.last), c0 = truth('C', M.current), c1 = truth('C', M.last)
    const website = Number((report.website as Row | undefined)?.status ?? 999) < 300 ? 1 : 0
    // T: L1, L2, N1, N2, Q1 (+ W1); active at the end of this month L1 and N1, of last month L1 and L2 (see l2AtStart).
    expect.soft(t0.customers, 'T customers').toBe(5 + website)
    expect.soft([t1.newCustomers, t1.activeEnd, t1.activePointsEnd], 'T last month: new L1+L2, both active at its end').toEqual([2, 1 + l2AtStart, 1 + l2AtStart])
    expect.soft([t0.newCustomers, t0.activeStart, t0.activeEnd], 'T this month: N1 new; L1+L2 at the start; L1+N1 at the end').toEqual([1, 1 + l2AtStart, 2])
    expect.soft(t1.activeEnd, 'T: active at the end of last month = at the start of this month').toBe(t0.activeStart)
    expect.soft(churnMonth === M.current ? t0.churned : t1.churned, 'T: L2 churned in the month of its last supply day').toBe(1)
    // Powers of attorney: created during this run (this month); signed: N2 at 00:30 on the 1st, Q1 and W1 today (this month), N1 last month.
    expect.soft([t0.poaCreated, t0.poaSigned, t1.poaSigned], 'T powers of attorney created/signed').toEqual([5 + website, 2 + website, 1])
    expect.soft(t0.ongoingSwitches, 'T ongoing switches: N2, Q1, W1').toBe(2 + website)
    expect.soft([t0.valuesInMonth + t1.valuesInMonth, t0.valuesCurrent], 'T values: every stored quarter-hour once').toEqual([
      METERED_DAYS.reduce((sum, day) => sum + stockholmQuarterCount(day), 0), METERED_DAYS.reduce((sum, day) => sum + stockholmQuarterCount(day), 0)])
    // C: two migrated customers supplied since the 1st of last month, one power of attorney signed two months ago.
    expect.soft([c0.customers, c0.activeEnd, c1.newCustomers, c0.newCustomers, c0.churned], 'C customers').toEqual([2, 2, 2, 0, 0])
    expect.soft([c0.poaCreated, c0.poaSigned, c0.ongoingSwitches, c0.valuesCurrent], 'C powers of attorney, switches, values').toEqual([1, 0, 0, 0])
    report.independentLedger = { t0, t1, c0, c1 }
    saveReport()
  })

  it('K9 the platform\'s own statistics functions equal the independent counts (T and C, this and last month)', async (context) => {
    requireEstablished('K9', context)
    for (const who of ['T', 'C'] as const) {
      const companyId = who === 'T' ? tenant.companyId : control.companyId
      for (const month of [M.current, M.last]) {
        const want = truth(who, month)
        const portfolio = await getPortfolioMonthForCompany(companyId, `${month}-01`) as PortfolioMonthRow
        compare('portfolio RPC', who, month, 'active customers (month end)', portfolio?.activeCustomers, want.activeEnd)
        compare('portfolio RPC', who, month, 'new customers', portfolio?.newCustomers, want.newCustomers)
        compare('portfolio RPC', who, month, 'churned customers', portfolio?.churnedCustomers, want.churned)
        compare('portfolio RPC', who, month, 'net change', portfolio?.netChange, want.activeEnd - want.activeStart)
        compare('portfolio RPC', who, month, 'active facilities (month end)', portfolio?.activeMeteringPoints, want.activePointsEnd)
        compare('portfolio RPC', who, month, 'powers of attorney requested', portfolio?.poaRequested, want.poaCreated, 'K-05')
        compare('portfolio RPC', who, month, 'powers of attorney signed', portfolio?.poaSigned, want.poaSigned, 'K-05')
        compare('portfolio RPC', who, month, 'valid powers of attorney', portfolio?.poaActive, want.poaValidEnd)
        const snapshot = snapshotMonth(companyId, month) ?? {}
        compare('monthly snapshot', who, month, 'customers total', snapshot.total_customers, want.customers, 'K-07')
        compare('monthly snapshot', who, month, 'new customers', snapshot.new_customers, want.newCustomers)
        compare('monthly snapshot', who, month, 'active sites', snapshot.active_sites, want.activeSitesEnd, 'K-08')
        compare('monthly snapshot', who, month, 'active metering points', snapshot.active_metering_points, want.activePointsEnd, 'K-08')
        compare('monthly snapshot', who, month, 'metering values received', snapshot.metering_values_received, want.valuesInMonth, 'K-03')
        compare('monthly snapshot', who, month, 'metering values missing', snapshot.metering_values_missing, want.missingPoints, 'K-04')
        compare('missing-points RPC', who, month, 'metering points without values', await countMissingMeteringPoints(companyId, `${month}-01`), want.missingPoints, 'K-04')
      }
      const want = truth(who, M.current)
      const dashboard = sql<Row>(`SELECT to_jsonb(x) FROM (SELECT customers_total,contracts_total,sites_total,metering_points_total,ongoing_supplier_switches,metering_values_total
        FROM public.company_dashboard_summary_v WHERE company_id=${literal(companyId)}) x`)
      compare('dashboard view', who, M.current, 'customers', Number(dashboard.customers_total), want.customers)
      compare('dashboard view', who, M.current, 'contracts', Number(dashboard.contracts_total), want.contracts)
      compare('dashboard view', who, M.current, 'sites', Number(dashboard.sites_total), want.sites)
      compare('dashboard view', who, M.current, 'metering points', Number(dashboard.metering_points_total), want.meteringPoints)
      compare('dashboard view', who, M.current, 'ongoing switches', Number(dashboard.ongoing_supplier_switches), want.ongoingSwitches, 'K-01')
      compare('dashboard view', who, M.current, 'metering values', Number(dashboard.metering_values_total), want.valuesCurrent, 'K-02')
    }
    saveReport({ comparisons })
  })

  it('K10 the tenant admin pages show the independent counts (Driftöversikt, Analys, Portföljöversikt) for T and C', async (context) => {
    requireEstablished('K10', context)
    for (const who of ['T', 'C'] as const) {
      const companyId = who === 'T' ? tenant.companyId : control.companyId
      const staff = await createTenantStaff(companyId, `E2E Statistik ${who}`)
      const page = await (await operatorSession(staff.email, staff.password)).newPage()
      const now = truth(who, M.current)
      await page.goto('/admin')
      await page.locator('main').waitFor({ timeout: 120_000 })
      const dashboard = await readLabelledValues(page, ['Kunder', 'Avtal', 'Anläggningar', 'Mätpunkter', 'Pågående leverantörsbyten', 'Mätvärden'])
      compare('/admin', who, M.current, 'Kunder', shownNumber(dashboard['Kunder']), now.customers)
      compare('/admin', who, M.current, 'Avtal', shownNumber(dashboard['Avtal']), now.contracts)
      compare('/admin', who, M.current, 'Anläggningar', shownNumber(dashboard['Anläggningar']), now.sites)
      compare('/admin', who, M.current, 'Mätpunkter', shownNumber(dashboard['Mätpunkter']), now.meteringPoints)
      compare('/admin', who, M.current, 'Pågående leverantörsbyten', shownNumber(dashboard['Pågående leverantörsbyten']), now.ongoingSwitches, 'K-01')
      compare('/admin', who, M.current, 'Mätvärden', shownNumber(dashboard['Mätvärden']), now.valuesCurrent, 'K-02')
      for (const month of [M.current, M.last]) {
        const want = truth(who, month)
        await page.goto(`/admin/analytics?month=${month}`)
        await page.locator('main').waitFor({ timeout: 120_000 })
        const cards = await readLabelledValues(page, ['Kunder totalt', 'Nya kunder denna månad', 'Aktiva anläggningar', 'Aktiva mätpunkter', 'Mottagna mätvärden', 'Saknade mätvärden'])
        compare('/admin/analytics', who, month, 'Kunder totalt', shownNumber(cards['Kunder totalt']), want.customers, 'K-07')
        compare('/admin/analytics', who, month, 'Nya kunder denna månad', shownNumber(cards['Nya kunder denna månad']), want.newCustomers)
        compare('/admin/analytics', who, month, 'Aktiva anläggningar', shownNumber(cards['Aktiva anläggningar']), want.activeSitesEnd, 'K-08')
        compare('/admin/analytics', who, month, 'Aktiva mätpunkter', shownNumber(cards['Aktiva mätpunkter']), want.activePointsEnd, 'K-08')
        compare('/admin/analytics', who, month, 'Mottagna mätvärden', shownNumber(cards['Mottagna mätvärden']), want.valuesInMonth, 'K-03')
        compare('/admin/analytics', who, month, 'Saknade mätvärden', shownNumber(cards['Saknade mätvärden']), want.missingPoints, 'K-04')
      }
      await page.goto(`/admin/analytics/portfolio?month=${M.current}`)
      await page.locator('main').waitFor({ timeout: 120_000 })
      const kpis = await readLabelledValues(page, ['Aktiva kunder', 'Nya kunder', 'Lämnade kunder', 'Nettoförändring'])
      compare('/admin/analytics/portfolio', who, M.current, 'Aktiva kunder', shownNumber(kpis['Aktiva kunder']), now.activeEnd)
      compare('/admin/analytics/portfolio', who, M.current, 'Nya kunder', shownNumber(kpis['Nya kunder']), now.newCustomers)
      compare('/admin/analytics/portfolio', who, M.current, 'Lämnade kunder', shownNumber(kpis['Lämnade kunder']), now.churned)
      compare('/admin/analytics/portfolio', who, M.current, 'Nettoförändring', shownNumber(kpis['Nettoförändring']), now.activeEnd - now.activeStart)
      const rows = await readTable(page)
      for (const month of [M.current, M.last]) {
        const want = truth(who, month), row = rows.find(r => r['Månad'] === month)
        compare('/admin/analytics/portfolio table', who, month, 'Fullmakter begärda', shownNumber(row?.['Fullmakter begärda']), want.poaCreated, 'K-05')
        compare('/admin/analytics/portfolio table', who, month, 'Fullmakter signerade', shownNumber(row?.['Fullmakter signerade']), want.poaSigned, 'K-05')
        compare('/admin/analytics/portfolio table', who, month, 'Giltiga fullmakter', shownNumber(row?.['Giltiga fullmakter']), want.poaValidEnd)
        compare('/admin/analytics/portfolio table', who, month, 'Aktiva', shownNumber(row?.['Aktiva']), want.activeEnd)
        compare('/admin/analytics/portfolio table', who, month, 'Nya', shownNumber(row?.['Nya']), want.newCustomers)
        compare('/admin/analytics/portfolio table', who, month, 'Lämnade', shownNumber(row?.['Lämnade']), want.churned)
      }
      await page.close()
      // Isolation: this tenant's admin cannot read the other tenant's portfolio through the same RPC.
      const client = await signedInClient(staff.email, staff.password)
      const other = who === 'T' ? control.companyId : tenant.companyId
      const foreign = await client.rpc('gridex_customer_portfolio_summary', { p_company_id: other, p_from: `${M.current}-01`, p_to: `${M.current}-01` })
      expect(foreign.error?.code, `${who} admin reading the other tenant's portfolio`).toBe('42501')
    }
    saveReport({ comparisons })
  }, 20 * 60_000)

  it('K11 the white-label portfolio shows each attached tenant\'s own numbers and nothing to another platform', async (context) => {
    requireEstablished('K11', context)
    ensureProductionWhiteLabelColumnParity()
    ensureProductionWhiteLabelPlatformParity()
    const home = createPartnerHomeCompany('E2E WL Partner Hem')
    const partner = await createWhiteLabelPartner(`E2E WL Plattform ${RUN}`, home)
    const stranger = await createWhiteLabelPartner(`E2E WL Annan ${RUN}`, home)
    // Gridex staff attach both tenants to the partner's platform (the platform-admin RPC behind /admin/platform/white-labels).
    const staff = await signedInClient(tenant.operatorEmail, tenant.operatorPassword)
    for (const companyId of [tenant.companyId, control.companyId]) {
      const assigned = await staff.rpc('gridex_assign_company_to_whitelabel', { p_company_id: companyId, p_white_label_platform_id: partner.platformId })
      expect(assigned.error, JSON.stringify(assigned.error)).toBeNull()
    }
    report.whiteLabel = { platform: partner.platformId, other: stranger.platformId }
    // The page's own RPC as the partner (its JWT), for the current month as the page asks it (today's date).
    const member = await signedInClient(partner.email, partner.password)
    const overview = await member.rpc('gridex_whitelabel_portfolio_overview', { p_white_label_platform_id: partner.platformId, p_month: TODAY })
    expect(overview.error, JSON.stringify(overview.error)).toBeNull()
    const rows = (overview.data ?? []) as Row[]
    expect(rows.map(r => r.company_id).sort()).toEqual([tenant.companyId, control.companyId].sort())
    for (const who of ['T', 'C'] as const) {
      const row = rows.find(r => r.company_id === (who === 'T' ? tenant.companyId : control.companyId)) ?? {}, want = truth(who, M.current)
      compare('white-label RPC', who, M.current, 'Aktiva', Number(row.active_customers), want.activeEnd)
      compare('white-label RPC', who, M.current, 'Nya', Number(row.new_customers), want.newCustomers)
      compare('white-label RPC', who, M.current, 'Lämnade', Number(row.churned_customers), want.churned)
      compare('white-label RPC', who, M.current, 'Netto', Number(row.net_change), want.activeEnd - want.activeStart)
      compare('white-label RPC', who, M.current, 'Fullmakter', Number(row.poa_requested), want.poaCreated, 'K-05')
      compare('white-label RPC', who, M.current, 'Giltiga fullmakter', Number(row.poa_active), want.poaValidEnd)
    }
    // Another platform's member sees neither tenant and may not read this platform.
    const outsider = await signedInClient(stranger.email, stranger.password)
    const denied = await outsider.rpc('gridex_whitelabel_portfolio_overview', { p_white_label_platform_id: partner.platformId, p_month: TODAY })
    expect(denied.error?.code, 'another white-label platform reading this one').toBe('42501')
    const own = await outsider.rpc('gridex_whitelabel_portfolio_overview', { p_white_label_platform_id: stranger.platformId, p_month: TODAY })
    expect((own.data ?? []) as Row[], 'another white-label platform has no tenants').toEqual([])
    const foreignTenant = await outsider.rpc('gridex_customer_portfolio_summary', { p_company_id: tenant.companyId, p_from: `${M.current}-01`, p_to: `${M.current}-01` })
    expect(foreignTenant.error?.code, 'another platform reading T directly').toBe('42501')

    // The page itself, as the partner signs in. A blocked page (replay drift) is reported, the RPC above is the contract.
    const page = await (await operatorSession(partner.email, partner.password)).newPage()
    await page.goto(`/admin/whitelabel/portfolio?platform=${partner.platformId}&month=${M.current}`)
    await page.locator('main').waitFor({ timeout: 120_000 }).catch(() => undefined)
    const table = await readTable(page).catch(() => [])
    report.whiteLabelPage = { url: page.url(), rows: table }
    expect.soft(table.length, `K-B1 the white-label page renders its tenant table (${page.url()})`).toBe(2)
    for (const who of ['T', 'C'] as const) {
      const row = table.find(r => r['@company'] === (who === 'T' ? tenant.companyId : control.companyId)), want = truth(who, M.current)
      if (!row) continue
      compare('/admin/whitelabel/portfolio', who, M.current, 'Aktiva', shownNumber(row['Aktiva']), want.activeEnd)
      compare('/admin/whitelabel/portfolio', who, M.current, 'Nya', shownNumber(row['Nya']), want.newCustomers)
      compare('/admin/whitelabel/portfolio', who, M.current, 'Lämnade', shownNumber(row['Lämnade']), want.churned)
      compare('/admin/whitelabel/portfolio', who, M.current, 'Netto', shownNumber(row['Netto']), want.activeEnd - want.activeStart)
      compare('/admin/whitelabel/portfolio', who, M.current, 'Fullmakter', shownNumber(row['Fullmakter']), want.poaCreated, 'K-05')
      compare('/admin/whitelabel/portfolio', who, M.current, 'Giltiga fullmakter', shownNumber(row['Giltiga fullmakter']), want.poaValidEnd)
    }
    await page.close()
    saveReport({ comparisons })
  }, 20 * 60_000)

  it('K12 isolation: no record of T is counted for C or attached to another tenant', (context) => {
    requireEstablished('K12', context)
    const t = literal(tenant.companyId), c = literal(control.companyId)
    const leaks = sql<Record<string, number>>(`SELECT jsonb_build_object(
      'tPointsInC',(SELECT count(*) FROM public.metering_values v JOIN public.metering_points mp ON mp.id=v.metering_point_id WHERE v.company_id=${c} AND mp.company_id=${t}),
      'tValuesElsewhere',(SELECT count(*) FROM public.metering_values v JOIN public.metering_points mp ON mp.id=v.metering_point_id WHERE mp.company_id=${t} AND v.company_id<>${t}),
      'tPoaElsewhere',(SELECT count(*) FROM public.powers_of_attorney x JOIN public.customers cu ON cu.id=x.customer_id WHERE cu.company_id=${t} AND x.company_id<>${t}),
      'tSwitchesElsewhere',(SELECT count(*) FROM public.supplier_switch_requests s JOIN public.customers cu ON cu.id=s.customer_id WHERE cu.company_id=${t} AND s.company_id<>${t}),
      'tRollupInC',(SELECT count(*) FROM public.metering_point_monthly_consumption r JOIN public.metering_points mp ON mp.id=r.metering_point_id WHERE r.company_id=${c} AND mp.company_id=${t}))`)
    report.isolation = leaks
    expect(leaks).toEqual({ tPointsInC: 0, tValuesElsewhere: 0, tPoaElsewhere: 0, tSwitchesElsewhere: 0, tRollupInC: 0 })
    report.mismatches = comparisons.filter(row => row.shown !== row.independent)
    saveReport()
  })
})
