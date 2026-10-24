// Reality scenario G: the end of daylight saving time on Sunday 25 October 2026 (Europe/Stockholm 03:00 CEST →
// 02:00 CET; the civil day has 25 hours = 100 quarter-hours) through the whole chain: the grid owner's UTILTS
// E66 files (one Ediel day each, 96 values, also for 25 October) → inbound reception by the real cron → stored
// values → completeness checks → Mina sidor / customer and partner API readers (civil days: 100 values on
// 25 October, by instant) → October billing underlay and invoice for the Ediel month (kWh and spot cost per
// quarter-hour including the repeated hour 02:00–03:00).
//
// Same world as scenarios A and F: the supplier goes live in ALS, the grid owner (16700) is simulated over
// SMTPS/IMAPS. As in F (coordinator decision 2026-10-22), the customer is a September customer: signed in
// September through the platform's signature path, switch request created in September for supply from
// 1 October, Z03 from the real builder and NOT passed through the send-window scheduler (the one stand-in for
// "now is September"). Supply then rests on the grid owner's Z04. Everything after the Z03 is the real code path.
//
// Time model (ENV-08, owner decision 2026-10-23, T15; scripts/helpers/reality/dst.ts):
//  - a grid owner's E66 day is 00:00–24:00 +0100 (DTM+735), always 96 quarter-hours; the 25 October file covers
//    2026-10-24T23:00Z–2026-10-25T23:00Z. No E66 carries 92 or 100 values.
//  - the civil Stockholm day is a view by instant: civil 25 October = the last 4 values of the 24 October file +
//    the 96 of the 25 October file = 100. The portal, the partner API and spot prices are civil.
//  - Ediel-based supply starts at the Z04's instant (DTM+92 202610010000 = 2026-09-30T23:00Z) and is billed per
//    Ediel month: October = [2026-09-30T23:00Z, 2026-10-31T23:00Z) = 31 × 96 = 2 976 quarter-hours.
// GRIDEX_REALITY_G_FRAMING keeps the default 'fixed_cet_day'; every expectation is computed by instant from what
// was sent, so a counterfactual framing would only change the counts it reports. The files are sent directly over
// SMTPS from the grid owner's mailbox (live-chain-fixture gridOwnerSends). In "focus" mode 23–26 October are sent,
// so the civil days 24–26 October are complete (civil 24 October begins with the last hour of the 23 October file).
//
// Wall clock: values for a day cannot be registered before the day exists. The grid owner's registration time
// (DTM+137/597, UNB) is capped at "now" (DTM+137 may not lie after reception, headerGuide.ts:207); when the
// scenario runs before 27 October the report says so (registrationCappedToNow). The October invoice needs spot
// prices for the whole month; only the platform's settlement cron imports and locks them (F109), and it cannot lock
// October before the month is complete (with REALITY_SPOT_SOURCE=real: after 1 November), so G9 asserts the import
// and the civil coverage of the published days and records why the lock is not due, and G10 is a soft check that
// reports exactly why it could not be reached.
//
// Steps that depend on something the world cannot provide are soft checks with the exact reason in the report.
// Run only through scripts/reality/run.sh (owns the world). Synthetic data only (E2E-, example.invalid).
import { writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it, type TestContext } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { prepareAndQueueEdielZ03 } from '@/lib/ediel/flows/prodatSwitch'
import { deriveRequestedMethodBeforeSwitch } from '@/lib/operations/switchRequestedMethodPreparation'
import { processPendingContractConfirmations } from '@/lib/customer-contracts/onlineSigning'
import { calculateEarliestSwitchStartDate } from '@/lib/operations/switchStartDate'
import { evaluateSupplierSwitchSendWindow, loadSupplierSwitchPolicy } from '@/lib/operations/supplierSwitchScheduler'
import { customerNormalizedMeteringValues } from '@/lib/metering/customerMeteringAccess'
import { listPortalMonthlyConsumption } from '@/lib/customer-portal/db'
import { evaluateMeteringCompletenessForMonth } from '@/lib/metering/validation'
import { stockholmDayStartUtc, stockholmNextDayStartUtc } from '@/lib/partner-api/partnerTime'
import { LIVE, approveIssuerHistoryGround, augustSupplyCustomer, cron, gridOwnerSends, literal, sql, type AugustFacility, type LiveTenant } from '../helpers/live-chain-fixture'
import { WEBSITE_ORIGIN } from '../helpers/reality/tenantWebsite'
import { closeOperatorConsole, operatorSession, submitServerAction } from '../helpers/reality/operatorConsole'
import { pollInboundMailLanes, runSlotAfterInbound, runOperationalCronSlot, type GridOwnerSim } from '../helpers/reality/world'
import { clockSettings, cronTick } from '../helpers/reality/clock'
import { GRID_AREA, GRID_OWNER_EDIEL_ID, goLiveAlsSupplier } from '../helpers/reality/goLiveAls'
import { detectStuckStates } from '../helpers/reality/stuckDetector'
import { registerUtiltsIssuer } from '../helpers/utiltsConsumptionParties'
import { gs1 } from '../helpers/live-chain-wire'
import { civilDayTotals, dayE66, e66DayProfile, edielMonthQuarterCount, edielMonthUtc, kwhSum, monthDays, stockholmDayOf, stockholmQuarterCount, stockholmQuarterStarts,
  type E66DayFraming } from '../helpers/reality/dst'

const report: Record<string, unknown> = { scenario: 'G end of DST 2026-10-25', startedAt: new Date().toISOString(), clock: clockSettings() }
const REPORT = process.env.GRIDEX_REALITY_REPORT ?? '/tmp/reality-g-report.json'
const saveReport = (extra: Record<string, unknown> = {}) => writeFileSync(REPORT, JSON.stringify({ ...report, ...extra }, null, 2))
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
type Row = Record<string, unknown>
let tenant: LiveTenant
let gridOwner: GridOwnerSim
let apiKey = ''

const SUPPLY_START = '2026-10-01'
const MONTH = '2026-10'
const DST_DAY = '2026-10-25'
/** The civil days around the change that the portal and the partner API show (96 / 100 / 96 quarter-hours). */
const FOCUS_DAYS = ['2026-10-24', DST_DAY, '2026-10-26']
/**
 * The grid owner's Ediel days sent: every October day by default (so the Ediel month, the portal card and the
 * invoice can be complete); "focus" sends 23–26 October, which makes the civil days 24–26 October complete.
 */
const DAYS = process.env.GRIDEX_REALITY_G_DAYS === 'focus' ? ['2026-10-23', ...FOCUS_DAYS] : monthDays(MONTH)
const FULL_MONTH = DAYS.length === monthDays(MONTH).length
const FRAMING = (process.env.GRIDEX_REALITY_G_FRAMING ?? 'fixed_cet_day') as E66DayFraming
/** The Ediel month October: [2026-09-30T23:00Z, 2026-10-31T23:00Z), 2 976 quarter-hours (owner decision 2026-10-23). */
const EDIEL_MONTH = { start: new Date(edielMonthUtc(MONTH).start).toISOString(), end: new Date(edielMonthUtc(MONTH).end).toISOString(), quarters: edielMonthQuarterCount(MONTH) }
const SEPTEMBER_SIGNED_AT = '2026-09-10T09:30:00+02:00'
const SEPTEMBER_SWITCH_CREATED_AT = '2026-09-10T09:31:00+02:00'
report.config = { days: DAYS, framing: FRAMING, supplyStart: SUPPLY_START, edielMonth: EDIEL_MONTH }

const RUN = Date.now().toString(36)
function personnummer(birth: string, serial: string) {
  const nine = birth.slice(2) + serial
  const total = [...nine].reduce((acc, digit, i) => { const v = Number(digit) * (i % 2 === 0 ? 2 : 1); return acc + (v > 9 ? v - 9 : v) }, 0)
  return `${birth}${serial}${(10 - (total % 10)) % 10}`
}
const CUSTOMER = { firstName: 'Vintertid', lastName: 'E2E-DST', personalNumber: personnummer('19760425', '357'), email: `e2e-vintertid-${RUN}@example.invalid`,
  address: { street: 'Kungsgatan 1', postalCode: '441 30', city: 'Alingsås' } }
const GSRN = gs1(`735999${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`)
const SCALE = 2.4 // ≈ 8 400 kWh/year household

/** Exactly what the grid owner sent, kept for the independent calculation. */
type SentFile = { day: string; reference: string; values: number[]; starts: string[]; periodStart: string; periodEnd: string; registeredAt: string; naturalRegistration: string }
const sentFiles: SentFile[] = []
const sentFor = (day: string) => sentFiles.find(file => file.day === day)
const fileOf = (reference: string) => sentFiles.filter(file => reference.includes(file.reference)).sort((a, b) => b.reference.length - a.reference.length)[0]

let ids: { customer: string; site: string; mp: string; contract: string } | null = null
let facility: AugustFacility | null = null
let established = false
let supplied = false
let stored = false
function requireStep(flag: boolean, step: string, why: string, context: TestContext) {
  if (flag) return
  report[step] = `skipped: ${why}`
  return context.skip()
}

/**
 * The grid owner sends one Ediel day (00:00–24:00 +0100, 96 values) as one UTILTS E66 mail over SMTPS, like its daily metering run. The tenant
 * is live in production (goLiveAlsSupplier, Z03 environment 'production'), so the files are production interchanges
 * and go to the production platform mailbox (FINDINGS T7).
 */
async function gridOwnerSendsDay(day: string, index: number) {
  const values = e66DayProfile(day, FRAMING, index, SCALE)
  const reference = `G${day.replaceAll('-', '').slice(2)}${GSRN.slice(-6)}`
  const natural = dayE66({ issuer: GRID_OWNER_EDIEL_ID, receiver: tenant.supplierEdielId, meterId: GSRN, day, values, reference, framing: FRAMING, environment: 'production' })
  const wire = dayE66({ issuer: GRID_OWNER_EDIEL_ID, receiver: tenant.supplierEdielId, meterId: GSRN, day, values, reference, framing: FRAMING, notAfter: Date.now() - 2 * 60_000,
    environment: 'production' })
  await gridOwnerSends({ from: gridOwner.email, subject: `UTILTS-E66 ${reference}`, filename: `UTILTS-E66_${reference}.edi`, edifact: wire.edifact })
  sentFiles.push({ day, reference, values, starts: wire.starts, periodStart: wire.periodStart, periodEnd: wire.periodEnd, registeredAt: wire.registeredAt, naturalRegistration: natural.registeredAt })
}
const inboundE66 = () => sql<Array<{ id: string; reference: string; status: string }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,
    'reference',coalesce(external_reference,interchange_reference,''),'status',status) ORDER BY created_at),'[]')
  FROM public.ediel_messages WHERE company_id=${literal(tenant.companyId)} AND direction='inbound' AND message_code='E66'`)
/** Like Vercel: the inbound mail cron (production lane, plus the test lane), then the Ediel outbox (which sends our CONTRL), once a minute. */
async function receiveUntil(done: () => boolean, minutes: number) {
  const runs: unknown[] = []
  const deadline = Date.now() + minutes * 60_000
  for (;;) {
    const inbound = await pollInboundMailLanes()
    const outbox = await runSlotAfterInbound()
    runs.push({ at: new Date().toISOString(), inbound: inbound.production.status, inboundTest: inbound.test.status, outbox: outbox.status })
    expect(inbound.status, JSON.stringify(inbound.body)).toBe(200)
    if (done() || Date.now() > deadline) break
    await cronTick()
  }
  return runs
}

/** Stored current values of the facility per Stockholm civil day, counted by instant, from both series (billing and Mina sidor sources). */
function storedPerDay() {
  return sql<Record<string, { normalized: number; distinctStarts: number; kwh: number; metering: number; meteringKwh: number; eligible: number; first: string; last: string }>>(`
    WITH n AS (SELECT (period_start AT TIME ZONE 'Europe/Stockholm')::date d,period_start,period_end,quantity_kwh,billing_gate_status FROM public.normalized_metering_values
      WHERE company_id=${literal(tenant.companyId)} AND metering_point_id=${literal(ids!.mp)} AND revision_status='current'),
     m AS (SELECT (period_start AT TIME ZONE 'Europe/Stockholm')::date d,value_kwh FROM public.metering_values
      WHERE company_id=${literal(tenant.companyId)} AND metering_point_id=${literal(ids!.mp)} AND is_current AND revision_status='current')
    SELECT coalesce(jsonb_object_agg(d::text,x),'{}') FROM (SELECT n.d,jsonb_build_object('normalized',count(*),'distinctStarts',count(DISTINCT n.period_start),'kwh',sum(n.quantity_kwh),
      'eligible',count(*) FILTER (WHERE n.billing_gate_status='eligible'),'first',min(n.period_start),'last',max(n.period_end),
      'metering',(SELECT count(*) FROM m WHERE m.d=n.d),'meteringKwh',(SELECT coalesce(sum(value_kwh),0) FROM m WHERE m.d=n.d)) x FROM n GROUP BY n.d) y`)
}
/** Every stored current start of one Stockholm civil day, ascending, as ISO. */
function storedStarts(day: string) {
  return sql<string[]>(`SELECT coalesce(jsonb_agg(to_char(period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ORDER BY period_start),'[]')
    FROM public.normalized_metering_values WHERE company_id=${literal(tenant.companyId)} AND metering_point_id=${literal(ids!.mp)} AND revision_status='current'
     AND period_start>=${literal(stockholmDayStartUtc(day).toISOString())} AND period_start<${literal(stockholmNextDayStartUtc(day).toISOString())}`)
}

describe.sequential('reality G — end of daylight saving time 2026-10-25 through metering, portal and invoice', () => {
  afterAll(async () => {
    gridOwner?.stop()
    await closeOperatorConsole()
    report.finishedAt = new Date().toISOString()
    saveReport()
  })

  it('G1 the supplier goes live in ALS with its BRP from 1 September', async () => {
    expect(LIVE.cronSecret && LIVE.automationUserId).toBeTruthy()
    const live = await goLiveAlsSupplier(report, { brpValidFrom: '2026-09-01' })
    ;({ tenant, gridOwner, apiKey } = live)
    expect(live.provisioned.readinessBlockers, JSON.stringify(live.provisioned.readinessBlockers)).toEqual([])
    report.civilDays = Object.fromEntries(FOCUS_DAYS.map(day => [day, stockholmQuarterCount(day)]))
    expect(stockholmQuarterCount(DST_DAY)).toBe(100)
  })

  it('G2 the September customer: signed contract, switch request created in September, Z03 for 1 October from the real builder', async () => {
    const company = literal(tenant.companyId)
    const grid = sql<{ id: string; ediel: string }>(`SELECT jsonb_build_object('id',id,'ediel',ediel_id) FROM public.grid_owners WHERE ediel_id=${literal(GRID_OWNER_EDIEL_ID)} AND company_id IS NULL`)
    report.brpAtSupplyStart = sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('environment',environment,'from',valid_from,'to',valid_to,'active',is_active)),'[]')
      FROM public.ediel_brp_settings WHERE company_id=${company}`)
    const customer = await augustSupplyCustomer(tenant, { ...CUSTOMER, supplyStart: SUPPLY_START, authorizedAt: SEPTEMBER_SIGNED_AT,
      grid: { gridOwnerId: grid.id, gridOwnerEdielId: grid.ediel, gridAreaCode: GRID_AREA },
      facilities: [{ gsrn: GSRN, ...CUSTOMER.address, annualConsumptionKwh: 8_400 }] })
    facility = customer.facilities[0]
    const facilityIds = { customer: customer.customerId, site: facility.siteId, mp: facility.meteringPointId, contract: facility.contractId }
    ids = facilityIds
    // The signed-agreement confirmation (archived PDF) as the customer-operations cron delivers it.
    const readiness = () => sql<Array<{ ready: boolean; blockers: unknown }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('ready',switch_ready,'blockers',blockers)),'[]')
      FROM public.customer_contract_lifecycle_readiness_v WHERE company_id=${company} AND metering_point_id=${literal(facilityIds.mp)}`)
    const deliveries: unknown[] = []
    for (let attempt = 0; attempt < 3 && !readiness().every(row => row.ready); attempt += 1) deliveries.push(await processPendingContractConfirmations(50))
    report.septemberReadiness = { deliveries, readiness: readiness() }
    expect(readiness().filter(row => !row.ready), 'the September contract is switch-ready').toEqual([])

    // The switch request exactly as the platform's own creation writes it, evaluated on the September creation day.
    const now = new Date(SEPTEMBER_SWITCH_CREATED_AT), policy = loadSupplierSwitchPolicy({ subtype: 'L' })
    const startDateCalculation = calculateEarliestSwitchStartDate({ requestType: 'switch', requestedStartDate: SUPPLY_START, noticePeriod: null, contractEndDate: null,
      earliestSupplierStartDate: null, moveInDate: null, marketLeadDays: policy.marketLeadDays, today: now })
    const window = evaluateSupplierSwitchSendWindow({ requestedStartDate: startDateCalculation.effectiveStartDate, policy, now })
    const supplier = sql<{ name: string; org: string | null }>(`SELECT jsonb_build_object('name',coalesce(legal_name,name),'org',org_number) FROM public.companies WHERE id=${company}`)
    const site = sql<Row>(`SELECT jsonb_build_object('gridOwner',grid_owner_id) FROM public.customer_sites WHERE id=${literal(facility.siteId)}`)
    const request = { customer_id: ids.customer, contract_id: facility.contractId, customer_contract_id: facility.contractId, site_id: facility.siteId, customer_site_id: facility.siteId,
      metering_point_id: facility.meteringPointId, power_of_attorney_id: facility.powerOfAttorneyId, authorization_document_id: facility.authorizationDocumentId,
      request_type: 'switch', status: 'queued', requested_start_date: startDateCalculation.effectiveStartDate, current_supplier_unknown: true,
      incoming_supplier_name: supplier.name, incoming_supplier_org_number: supplier.org, grid_owner_id: site.gridOwner, price_area_code: 'SE3',
      validation_snapshot: { isReady: true, issues: [], candidateMeteringPointId: facility.meteringPointId, latestPowerOfAttorneyId: facility.powerOfAttorneyId,
        ownSupplierResolution: 'company_record', currentSupplier: { id: null, name: null, orgNumber: null, edielId: null, unknown: true, contractStatus: null, contractEndDate: null,
          noticePeriod: null, terminationFee: null, responseStatus: null }, manualSupplierTerms: null, startDateCalculation, businessBlockers: [] },
      lifecycle_blocked: false, lifecycle_block_source: null, automation_origin: 'customer_operation_job',
      automation_key: `customer-operation:${ids.customer}:${facility.siteId}:${facility.meteringPointId}`,
      metadata: { supplier_switch_blockers: [], pending_review_reason: null, reality_september_establishment: { createdAt: SEPTEMBER_SWITCH_CREATED_AT, sendWindow: window } },
      created_by: LIVE.automationUserId, updated_by: LIVE.automationUserId, created_at: SEPTEMBER_SWITCH_CREATED_AT, updated_at: SEPTEMBER_SWITCH_CREATED_AT }
    const created = await supabaseService.rpc('gridex_create_supplier_switch_v1', { p_company_id: tenant.companyId, p_request: request,
      p_event: { event_type: 'created', event_status: 'success', message: 'Switchärende skapat och köat för vidare handläggning.', created_by: LIVE.automationUserId,
        payload: { requestType: 'switch', requestedStartDate: SUPPLY_START, incomingSupplierName: supplier.name, incomingSupplierOrgNumber: supplier.org, ownSupplierResolution: 'company_record', businessBlockers: [] } } })
    expect(created.error, JSON.stringify(created.error)).toBeNull()
    const switchId = (created.data as { request: { id: string } }).request.id
    expect(startDateCalculation.requestedHonored, 'start 1 October was valid on the September creation day').toBe(true)
    expect(window.windowOpen, `the send window was open in September: ${JSON.stringify(window)}`).toBe(true)

    // The Z03 from the platform's builder, as edielAutomation.ts calls it, without the send-window scheduler.
    let built: Row
    try {
      await deriveRequestedMethodBeforeSwitch({ actorUserId: LIVE.automationUserId, switchRequestId: switchId })
      const message = await prepareAndQueueEdielZ03({ actorUserId: LIVE.automationUserId, switchRequestId: switchId, environment: 'production' })
      built = { ok: true, message: message.id, status: message.status }
    } catch (error) { built = { ok: false, error: error instanceof Error ? error.message : String(error) } }
    const z03 = sql<{ start: string | null; status: string | null } | null>(`SELECT to_jsonb(x) FROM (SELECT substring(m.raw_payload from 'DTM\\+92:(\\d{8})') start,m.status FROM public.ediel_messages m
      WHERE m.company_id=${company} AND m.switch_request_id=${literal(switchId)} AND m.message_code LIKE 'Z03%' ORDER BY m.created_at DESC LIMIT 1) x`)
    report.septemberSwitch = { switchId, startDateCalculation, window, built, z03 }
    established = Boolean(built.ok) && z03?.start === '20261001'
    expect(built, 'the real Z03 builder accepted the September switch').toMatchObject({ ok: true })
    expect(z03?.start, 'the Z03 carries the supply start 20261001').toBe('20261001')
  }, 15 * 60_000)

  it('G3 the world runs on cron cadence until supply rests on the Z04 from 1 October', async (context) => {
    requireStep(established, 'G3', 'no Z03 for 2026-10-01 was established in G2', context)
    await gridOwner.profile({ contrlDelayMs: 20_000, aperakDelayMs: 40_000, z04DelayMs: 90_000 })
    const supply = () => sql<{ switch: string | null; z04: string | null; period: Row | null }>(`SELECT jsonb_build_object('switch',s.status,'z04',s.inbound_z04_message_id,
        'period',(SELECT jsonb_build_object('id',p.id,'status',p.status,'start',p.start_date,'customer',p.customer_id,'message',p.source_message_id,
          'atSupplyStart',p.market_start_at=(TIMESTAMP '2026-10-01 00:00' AT TIME ZONE 'Etc/GMT-1'))
          FROM public.customer_supply_periods p WHERE p.company_id=s.company_id AND p.metering_point_id=s.metering_point_id ORDER BY p.created_at DESC LIMIT 1))
      FROM public.supplier_switch_requests s WHERE s.company_id=${literal(tenant.companyId)} AND s.metering_point_id=${literal(ids!.mp)} ORDER BY s.created_at DESC LIMIT 1`)
    const deadline = Date.now() + Number(process.env.GRIDEX_REALITY_G3_MINUTES ?? 30) * 60_000
    const slots: unknown[] = []
    let state = supply()
    for (;;) {
      const ran = await runOperationalCronSlot()
      slots.push({ at: new Date().toISOString(), crons: ran.map(r => ({ path: r.path, status: r.status, ms: r.ms })) })
      state = supply()
      saveReport({ worldSlots: slots, supply: state })
      if (state?.period?.status === 'active' || state?.switch === 'failed' || Date.now() > deadline) break
      await cronTick()
    }
    report.worldSlots = slots
    report.supply = state
    expect(state?.switch, JSON.stringify(state)).toMatch(/^(accepted|active|completed)$/)
    expect(state?.z04, 'supply rests on the grid owner\'s Z04').toBeTruthy()
    expect(state?.period, JSON.stringify(state)).toMatchObject({ status: 'active', start: SUPPLY_START, atSupplyStart: true, customer: ids!.customer, message: state?.z04 })
    supplied = true
  }, 40 * 60_000)

  it('G4 the grid owner sends October as one Ediel day per file: 96 / 96 / 96 quarter-hours around the DST change', async (context) => {
    requireStep(supplied, 'G4', 'no supply period rests on a Z04 from 1 October (G3)', context)
    // SYNTHETIC stand-in for EXT-ISSUER-01, exactly as scenario F registers the ALS grid owner.
    registerUtiltsIssuer(sql as never, literal, GRID_OWNER_EDIEL_ID, tenant.adminUserId)
    for (const [index, day] of DAYS.entries()) await gridOwnerSendsDay(day, index)
    const capped = sentFiles.filter(file => file.registeredAt !== file.naturalRegistration)
    report.registrationCappedToNow = capped.map(file => ({ day: file.day, natural: file.naturalRegistration, sent: file.registeredAt }))
    report.sentFiles = sentFiles.map(({ values, starts, ...file }) => ({ ...file, quarters: values.length, kwh: kwhSum(values), firstStart: starts[0], lastStart: starts[starts.length - 1] }))
    if (FRAMING === 'fixed_cet_day') {
      for (const day of FOCUS_DAYS) expect(sentFor(day)?.values.length, day).toBe(96)
      expect(sentFor(DST_DAY)).toMatchObject({ periodStart: '2026-10-24T23:00:00.000Z', periodEnd: '2026-10-25T23:00:00.000Z' })
      expect(sentFor(DST_DAY)?.starts).toEqual(Array.from({ length: 96 }, (_, q) => new Date(Date.parse('2026-10-24T23:00:00Z') + q * 900_000).toISOString()))
    }
    // The sent instants, as the civil views will count them: civil 25 October = the last 4 of 24 October + 96 = 100.
    report.sentCivilDays = civilDayTotals(sentFiles)
  }, 15 * 60_000)

  it('G5 the inbound cron receives every file on the tenant', async (context) => {
    requireStep(sentFiles.length > 0, 'G5', 'nothing was sent (G4)', context)
    report.receptionRuns = await receiveUntil(() => inboundE66().length >= sentFiles.length, Number(process.env.GRIDEX_REALITY_G5_MINUTES ?? 20))
    const inbound = inboundE66()
    report.inbound = inbound
    const arrived = new Set(inbound.map(message => fileOf(message.reference)?.reference))
    expect(sentFiles.filter(file => !arrived.has(file.reference)).map(file => file.day), 'files never received on the tenant').toEqual([])
  }, 30 * 60_000)

  it('G6 after issuer evidence and operator reprocessing every value is stored: civil 25 October holds 100 by instant, no gap, no duplicate', async (context) => {
    requireStep(inboundE66().length > 0, 'G6', 'no inbound E66 on the tenant (G5)', context)
    const sources = inboundE66()
    for (const source of sources) approveIssuerHistoryGround(source.id, tenant.adminUserId)
    // No job re-evaluates held UTILTS: Gridex staff run the UTILTS engine per message (scenarios E5, F6c).
    const staff = await operatorSession(tenant.operatorEmail, tenant.operatorPassword)
    const page = await staff.newPage()
    const storedFor = (id: string) => sql<number>(`SELECT to_jsonb(count(*)) FROM public.normalized_metering_values WHERE source_message_id=${literal(id)}`)
    const outcomes: Array<Row & { stored: number; expected: number }> = []
    for (const source of sources) {
      const file = fileOf(source.reference)
      const expected = file?.values.length ?? 96
      await page.goto(`/admin/ediel/messages/${source.id}`)
      await page.getByText('Detaljvy för canonical kernel').first().waitFor({ timeout: 180_000 })
      const button = page.getByRole('button', { name: /Kör UTILTS engine \/ skapa TGT-svar|Återuppta hållna transaktioner/ })
      const visible = await button.count()
      const actionStatus = visible ? await submitServerAction(page, () => button.first().click(), 600_000) : null
      const started = Date.now()
      let count = storedFor(source.id)
      while (visible && count < expected && Date.now() - started < 90_000) { await pause(3_000); count = storedFor(source.id) }
      const outcome: (typeof outcomes)[number] = { source: source.id, day: file?.day ?? null, button: Boolean(visible), actionStatus, stored: count, expected }
      if (count < expected || file?.day === DST_DAY) {
        // The engine's own verdict, also for the DST day when everything went well: no count-mismatch issue.
        outcome.diagnosis = sql(`SELECT jsonb_build_object('status',m.status,
          'issues',(SELECT coalesce(jsonb_agg(i->>'code'),'[]') FROM jsonb_array_elements(coalesce(m.validation_report#>'{utiltsRuntime,validation,issues}','[]')) i),
          'transactions',(SELECT coalesce(jsonb_agg(jsonb_build_object('disposition',t.disposition,'persistence',t.persistence_status,'issues',t.issue_codes)),'[]') FROM public.ediel_ack_transaction_results t WHERE t.source_message_id=m.id))
          FROM public.ediel_messages m WHERE m.id=${literal(source.id)}`)
      }
      outcomes.push(outcome)
      if (outcomes.length % 10 === 0) saveReport({ reprocessProgress: outcomes })
    }
    await page.close()
    report.reprocess = outcomes
    expect(outcomes.filter(outcome => outcome.stored < outcome.expected).map(outcome => `${outcome.day}: ${outcome.stored}/${outcome.expected}`), 'values not stored').toEqual([])

    // Per civil Stockholm day, by instant: each sent value counts on the civil day its UTC start falls on (every sent
    // value lies inside the supply, which starts 2026-09-30T23:00Z: civil 1 October therefore holds 92).
    const perDay = storedPerDay(), expectedPerDay = civilDayTotals(sentFiles)
    report.storedPerDay = perDay
    report.expectedCivilDays = expectedPerDay
    expect(Object.keys(perDay).sort(), 'civil days with stored values').toEqual(Object.keys(expectedPerDay).sort())
    for (const [day, want] of Object.entries(expectedPerDay)) {
      const got = perDay[day]
      expect(got, `${day} stored`).toBeTruthy()
      expect({ normalized: got.normalized, distinct: got.distinctStarts, metering: got.metering, eligible: got.eligible }, day)
        .toEqual({ normalized: want.count, distinct: want.count, metering: want.count, eligible: want.count })
      expect(Number(got.kwh), `${day} kWh`).toBeCloseTo(want.kwh, 6)
      expect(Number(got.meteringKwh), `${day} kWh (Mina sidor series)`).toBeCloseTo(want.kwh, 6)
    }
    // Civil 25 October: exactly the 100 UTC quarter-hours 22:00Z–23:00Z, both passes of 02:00–03:00 (00:00Z and
    // 01:00Z) = the last 4 values of the 24 October file + the 96 of the 25 October file.
    const starts = storedStarts(DST_DAY)
    report.dstDayStarts = { count: starts.length, first: starts[0], last: starts[starts.length - 1], repeatedHour: starts.filter(s => s >= '2026-10-25T00:00' && s < '2026-10-25T02:00') }
    expect(starts).toEqual(stockholmQuarterStarts(DST_DAY))
    expect(starts).toEqual(sentFiles.flatMap(file => file.starts).filter(iso => stockholmDayOf(Date.parse(iso)) === DST_DAY).sort())
    if (FRAMING === 'fixed_cet_day') expect(starts).toEqual([...sentFor('2026-10-24')!.starts.slice(92), ...sentFor(DST_DAY)!.starts])
    // Around the change: one continuous series of 15-minute steps from civil 24 Oct 00:00 CEST to 27 Oct 00:00 CET.
    const around = FOCUS_DAYS.flatMap(storedStarts)
    expect(around).toHaveLength(292)
    expect(around.every((iso, i) => i === 0 || Date.parse(iso) - Date.parse(around[i - 1]) === 900_000), 'no gap and no duplicate around the change').toBe(true)
    stored = true
  }, 150 * 60_000)

  it('G7 completeness is not flagged: engine and billing completeness of the Ediel month October (2 976 quarter-hours)', async (context) => {
    requireStep(stored, 'G7', 'values were not stored (G6)', context)
    const reprocess = (report.reprocess ?? []) as Array<{ day: string | null; diagnosis?: { issues?: string[] } }>
    const dst = reprocess.find(outcome => outcome.day === DST_DAY)
    expect(dst?.diagnosis?.issues ?? [], 'no interval-count issue on the DST day').not.toEqual(expect.arrayContaining(['UTILTS_DST_INTERVAL_COUNT_MISMATCH']))
    expect(dst?.diagnosis?.issues ?? []).not.toEqual(expect.arrayContaining(['UTILTS_E66_OBSERVATION_COUNT_MISMATCH']))
    const completeness = await evaluateMeteringCompletenessForMonth({ companyId: tenant.companyId, billingMonth: MONTH,
      meteringPoints: [{ meteringPointId: ids!.mp, requiredResolution: 'quarter_hour' }] })
    const sentQuarters = sentFiles.reduce((n, file) => n + file.values.length, 0)
    report.completeness = { ...completeness, edielMonth: EDIEL_MONTH, sentQuarters }
    if (FULL_MONTH) {
      // The Ediel month October: [2026-09-30T23:00Z, 2026-10-31T23:00Z) = 31 × 96 = 2 976 quarter-hours.
      // DST-C1: before the paging fix in lib/metering/validation.ts this read only PostgREST's first 1 000 rows.
      expect(sentQuarters).toBe(EDIEL_MONTH.quarters)
      expect(completeness, JSON.stringify(completeness.issues)).toMatchObject({ status: 'complete', valueCount: EDIEL_MONTH.quarters })
    } else {
      expect(completeness.valueCount).toBe(sentQuarters)
      expect(completeness.issues.filter(issue => issue.code === 'metering_overlap')).toEqual([])
    }
  })

  it('G8 Mina sidor and the customer/partner API readers show civil days by instant (100 on 25 October) and October', async (context) => {
    requireStep(stored, 'G8', 'values were not stored (G6)', context)
    const scope = { companyId: tenant.companyId, customerIds: [ids!.customer] }
    const days: Record<string, Row> = {}
    const civil = civilDayTotals(sentFiles)
    expect(FOCUS_DAYS.map(day => civil[day]?.count), 'civil 24/25/26 October by instant').toEqual(FOCUS_DAYS.map(stockholmQuarterCount))
    for (const day of FOCUS_DAYS) {
      const { data, error } = await customerNormalizedMeteringValues(scope, { periodStartFrom: stockholmDayStartUtc(day).toISOString(), periodStartBefore: stockholmNextDayStartUtc(day).toISOString() })
        .select('period_start,quantity_kwh')
      expect(error).toBeNull()
      const rows = (data ?? []) as Array<{ period_start: string; quantity_kwh: number }>
      days[day] = { rows: rows.length, kwh: kwhSum(rows.map(row => Number(row.quantity_kwh))), sent: civil[day] }
      expect(rows.length, day).toBe(civil[day].count)
      expect(kwhSum(rows.map(row => Number(row.quantity_kwh))), day).toBeCloseTo(civil[day].kwh, 6)
    }
    const sentMonth = kwhSum(sentFiles.flatMap(file => file.values)), sentQuarters = sentFiles.reduce((n, file) => n + file.values.length, 0)
    const months = await listPortalMonthlyConsumption(scope as Parameters<typeof listPortalMonthlyConsumption>[0], { now: new Date('2026-10-28T12:00:00Z'), months: 2 })
    const october = months.find(month => month.monthKey === MONTH)
    report.portal = { days, october, sentMonth, sentQuarters }
    // The civil month October [2026-09-30T22:00Z, 2026-10-31T23:00Z) contains every sent value (the Ediel month).
    expect(october?.valueCount).toBe(sentQuarters)
    expect(october?.totalKwh).toBeCloseTo(sentMonth, 6)
    // Civil 1 October 00:00–01:00 CEST belongs to the previous supplier (supply starts 00:00 +0100): whether the civil
    // card then counts the month as complete is the portal's rule, so it is soft and the report shows the card.
    if (FULL_MONTH) expect.soft(october?.complete, 'the whole supplied October incl. the extra hour is covered').toBe(true)
    else expect(october?.complete, 'four days of October are not a complete month').toBe(false)

    // The partner (website) API over HTTP: soft, it resolves a site only by facility_reference.
    const site = sql<{ reference: string | null }>(`SELECT jsonb_build_object('reference',facility_reference) FROM public.customer_sites WHERE id=${literal(ids!.site)}`)
    if (!site.reference) report.partnerApi = 'not reachable: the September customer\'s site has no facility_reference (lib/partner-api/core.ts resolveSite); the same reader (customerNormalizedMeteringValues) is asserted above'
    else {
      const response = await fetch(`${LIVE.appUrl}/api/partner/v1/sites/${encodeURIComponent(site.reference)}/measurements?from_date=${DST_DAY}&to_date=${DST_DAY}&resolution=15m`,
        { headers: { authorization: `Bearer ${apiKey}`, origin: WEBSITE_ORIGIN } })
      const body = await response.json().catch(() => null) as { data?: { measurements?: Array<{ value: number }> } } | null
      const measurements = body?.data?.measurements ?? null
      report.partnerApi = { status: response.status, count: measurements?.length ?? null, kwh: measurements ? kwhSum(measurements.map(m => Number(m.value))) : null, body: measurements ? undefined : body }
      expect.soft(measurements?.length ?? null, `partner API ${DST_DAY} (status ${response.status})`).toBe(100)
    }
  })

  it('G9 October spot prices through the settlement cron: imported with civil coverage (100 on 25 October); the lock is not due before 1 November', async (context) => {
    requireStep(stored, 'G9', 'values were not stored (G6)', context)
    // Only the platform and the nightly settlement cron import and lock spot prices (owner decision 2026-10-23, F109).
    const settlement = await cron(`/api/cron/pricing/spot-settlement?billing_month=${MONTH}&price_areas=SE3`)
    // Spot prices are civil delivery days: count them per Stockholm day of the civil month October.
    const perDay = sql<Record<string, number>>(`SELECT coalesce(jsonb_object_agg(d,n),'{}') FROM (SELECT (time_start AT TIME ZONE 'Europe/Stockholm')::date::text d,count(*) n
      FROM public.spot_price_intervals WHERE price_area='SE3' AND resolution='quarter_hour'
       AND time_start>='2026-09-30T22:00:00Z' AND time_start<'2026-10-31T23:00:00Z' GROUP BY 1) x`)
    const intervals = Object.values(perDay).reduce((n, count) => n + Number(count), 0)
    const dstDay = Number(perDay[DST_DAY] ?? 0)
    const summaries = sql<Row[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('source',source,'status',status,'covered',covered_duration_minutes,'expected',expected_duration_minutes,
        'issues',quality_issues,'lockedAt',locked_at)),'[]') FROM public.spot_price_monthly_summaries WHERE price_area='SE3' AND billing_month=${literal(MONTH)}`)
    const monthComplete = Date.now() >= Date.parse('2026-11-01T00:00:00+01:00')
    const body = settlement.body as { settlement_locked?: boolean; failed_areas?: unknown; error?: unknown; result?: unknown }
    report.spot = { cron: { status: settlement.status, body: settlement.body }, perDay, intervals, dstDay, summaries,
      lock: { due: monthComplete, locked: body.settlement_locked === true,
        reason: monthComplete ? null : `October cannot be complete before 1 November (lock refused as market_price_incomplete; the cron answers ${settlement.status} ${JSON.stringify(body.failed_areas ?? body.error ?? null)})` } }
    // The cron ran its import (200 when the lock also succeeded, 500 with failed_areas when it could not lock).
    expect([200, 500], JSON.stringify(settlement.body).slice(0, 2000)).toContain(settlement.status)
    expect(settlement.body, 'the settlement cron ran in settlement mode (import, then lock)').toMatchObject({ mode: 'settlement_lock' })
    // Civil coverage: every published day is a complete Stockholm day (92/96/100 quarter-hours by instant).
    expect(Object.entries(perDay).filter(([day, count]) => Number(count) !== stockholmQuarterCount(day)), 'every imported civil day is complete').toEqual([])
    expect.soft(dstDay, 'the DST day has 100 spot quarter-hours (published the afternoon before)').toBe(100)
    if (monthComplete) {
      expect.soft(intervals, 'October has 2 980 civil spot quarter-hours').toBe(2980)
      expect.soft(body.settlement_locked, 'the cron locked October once the month was complete').toBe(true)
    } else expect.soft(summaries.filter(row => row.status === 'locked'), 'October is not locked before it is complete').toEqual([])
  }, 15 * 60_000)

  it('G10 the October underlay and invoice match an independent calculation including the extra hour (soft)', async (context) => {
    requireStep(stored, 'G10', 'values were not stored (G6)', context)
    const result = await cron(`/api/cron/billing/monthly?company_id=${tenant.companyId}&billing_month=${MONTH}`)
    const graph = sql<{ underlays: Row[]; invoices: Row[]; runs: Array<Row & { lines: Row[] }> }>(`SELECT jsonb_build_object(
      'underlays',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'status',u.status,'readiness',u.readiness_status,'kwh',u.total_kwh,'missing',u.missing_values_count,
        'values',u.source_meter_value_count,'block',u.billing_block_reason,'start',u.billing_period_start,'end',u.billing_period_end)),'[]')
        FROM public.billing_underlays u WHERE u.company_id=${literal(tenant.companyId)} AND u.metering_point_id=${literal(ids!.mp)} AND u.underlay_year=2026 AND u.underlay_month=10),
      'invoices',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'status',i.status,'kwh',i.total_kwh,'exVat',i.amount_ex_vat,'vat',i.vat_amount,'incVat',i.amount_inc_vat,
        'start',i.period_start,'end',i.period_end,'run',i.calculation_snapshot->>'pricing_run_id')),'[]') FROM public.customer_invoices i WHERE i.company_id=${literal(tenant.companyId)} AND i.customer_id=${literal(ids!.customer)}),
      'runs',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'status',r.status,'exVat',r.total_ex_vat,'locked',r.locked_at IS NOT NULL,
        'lines',(SELECT coalesce(jsonb_agg(jsonb_build_object('type',l.line_type,'description',l.description,'quantity',l.quantity,'unit',l.unit,'unitPrice',l.unit_price_ex_vat,'exVat',l.amount_ex_vat,
          'component',l.metadata->>'component_code') ORDER BY l.sort_order),'[]') FROM public.pricing_preview_lines l WHERE l.pricing_run_id=r.id))),'[]')
        FROM public.pricing_runs r WHERE r.company_id=${literal(tenant.companyId)}))`)
    // Independent: every sent quarter priced at its own UTC quarter's spot price (the repeated hour has its own
    // prices), over the Ediel month [2026-09-30T23:00Z, 2026-10-31T23:00Z).
    const prices = sql<Array<{ s: string; p: number }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('s',time_start,'p',sek_per_kwh) ORDER BY time_start),'[]')
      FROM public.spot_price_intervals WHERE price_area='SE3' AND resolution='quarter_hour' AND time_start>=${literal(EDIEL_MONTH.start)} AND time_start<${literal(EDIEL_MONTH.end)}`)
    const price = new Map(prices.map(row => [new Date(row.s).toISOString(), Number(row.p)]))
    let energy = 0, kwh = 0, unpriced = 0, extraHourKwh = 0, extraHourSek = 0
    for (const file of sentFiles) file.values.forEach((value, q) => {
      const start = file.starts[q], p = price.get(start)
      kwh += value
      if (p === undefined) { unpriced += 1; return }
      energy += value * p
      if (start >= '2026-10-25T01:00:00.000Z' && start < '2026-10-25T02:00:00.000Z') { extraHourKwh += value; extraHourSek += value * p }
    })
    const independent = { kwh, spotSek: energy, markupSek: kwh * 0.04, monthlyFeeSek: 49, exVat: energy + kwh * 0.04 + 49, unpriced, extraHour: { kwh: extraHourKwh, spotSek: extraHourSek } }
    const underlay = graph.underlays[0] ?? null
    const invoice = graph.invoices.find(i => graph.runs.some(run => run.id === i.run)) ?? graph.invoices[0] ?? null
    report.october = { cron: { status: result.status, body: result.body }, graph, independent }
    if (!underlay) {
      report.october = { ...(report.october as Row), unreachable: 'no October underlay was prepared (see cron body and storedPerDay)' }
      expect.soft(underlay, 'an October underlay exists').not.toBeNull()
      return
    }
    expect.soft(Number(underlay.kwh), 'underlay kWh = all sent quarter-hours incl. the extra hour').toBeCloseTo(kwh, 3)
    // The Ediel month October has 2 976 quarter-hours (31 × 96); a focus run sends fewer.
    expect.soft(Number(underlay.values ?? 0), 'underlay value count').toBe(FULL_MONTH ? EDIEL_MONTH.quarters : sentFiles.reduce((n, file) => n + file.values.length, 0))
    // Pending billing agent: the underlay and invoice period is the Ediel month (field form not known yet).
    report.october = { ...(report.october as Row), periods: { expected: EDIEL_MONTH, underlay: { start: underlay.start, end: underlay.end } } }
    if (!invoice) {
      report.october = { ...(report.october as Row), unreachable: unpriced ? `${unpriced} sent quarter-hours have no spot price yet (G9), so no invoice can be priced` : 'no invoice prepared; see underlay readiness/block reason' }
      expect.soft(invoice, 'an October invoice draft exists').not.toBeNull()
      return
    }
    expect.soft(Number(invoice.kwh), 'invoice kWh incl. the extra hour').toBeCloseTo(kwh, 3)
    report.october = { ...(report.october as Row), invoicePeriod: { start: invoice.start, end: invoice.end } }
    expect.soft([invoice.start, invoice.end].map(value => typeof value === 'string' && /T\d{2}:/.test(value) ? new Date(value).toISOString() : value),
      `pending billing agent: the invoice prints the Ediel month ${JSON.stringify(EDIEL_MONTH)}`).toEqual([EDIEL_MONTH.start, EDIEL_MONTH.end])
    expect.soft(Math.abs(Number(invoice.exVat) - independent.exVat), `invoice ex VAT vs independent ${JSON.stringify(independent)}`).toBeLessThan(1)
  }, 20 * 60_000)

  it('G11 isolation and queues: values only on this tenant and customer, nothing stuck', async (context) => {
    requireStep(Boolean(ids), 'G11', 'no customer was established (G2)', context)
    const leaks = sql<Record<string, number>>(`SELECT jsonb_build_object(
      'valuesElsewhere',(SELECT count(*) FROM public.normalized_metering_values WHERE company_id<>${literal(tenant.companyId)} AND (metering_point_id=${literal(ids!.mp)} OR facility_id=${literal(GSRN)})),
      'otherCustomersHere',(SELECT count(*) FROM public.normalized_metering_values WHERE company_id=${literal(tenant.companyId)} AND metering_point_id=${literal(ids!.mp)} AND customer_id IS DISTINCT FROM ${literal(ids!.customer)}))`)
    report.isolation = leaks
    expect(leaks).toEqual({ valuesElsewhere: 0, otherCustomersHere: 0 })
    // G-11: G6 runs the operator's reprocessing for about an hour with no cron slot, so the replies it queued and
    // the jobs of that hour are only due, not stuck. Like Vercel, the world keeps running its crons: settle a few
    // slots first, then judge what is still not progressing.
    const settle: unknown[] = []
    let stuck = detectStuckStates({ graceSeconds: 600, companyIds: [tenant.companyId] })
    for (let slot = 0; slot < Number(process.env.GRIDEX_REALITY_G11_SETTLE_SLOTS ?? 4) && stuck.some(row => row.kind === 'stuck'); slot += 1) {
      const ran = await runOperationalCronSlot()
      settle.push({ at: new Date().toISOString(), crons: ran.map(r => ({ path: r.path, status: r.status, ms: r.ms })) })
      stuck = detectStuckStates({ graceSeconds: 600, companyIds: [tenant.companyId] })
      if (stuck.some(row => row.kind === 'stuck')) await cronTick()
    }
    report.settleSlots = settle
    report.stuck = stuck
    expect(stuck.filter(row => row.kind === 'stuck')).toEqual([])
  }, 30 * 60_000)
})
