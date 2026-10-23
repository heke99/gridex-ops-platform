// Reality scenario G: the end of daylight saving time on Sunday 25 October 2026 (Europe/Stockholm 03:00 CEST →
// 02:00 CET; the civil day has 25 hours = 100 quarter-hours) through the whole chain: the grid owner's UTILTS
// E66 files for 24, 25 and 26 October (96/100/96 values) → inbound reception by the real cron → stored values →
// completeness checks → Mina sidor / customer and partner API readers (daily and monthly sums) → October billing
// underlay and invoice (kWh and spot cost per quarter-hour including the repeated hour 02:00–03:00).
//
// Same world as scenarios A and F: the supplier goes live in ALS, the grid owner (16700) is simulated over
// SMTPS/IMAPS. As in F (coordinator decision 2026-10-22), the customer is a September customer: signed in
// September through the platform's signature path, switch request created in September for supply from
// 1 October, Z03 from the real builder and NOT passed through the send-window scheduler (the one stand-in for
// "now is September"). Supply then rests on the grid owner's Z04. Everything after the Z03 is the real code path.
//
// Grid-owner framing (scripts/helpers/reality/dst.ts): each file is one Stockholm civil day in the fixed
// offset +0100 (ENV-08, DTM+735), i.e. 25 October is the 25-hour period 2026-10-24 23:00 – 2026-10-26 00:00
// +0100. GRIDEX_REALITY_G_FRAMING=civil_start_offset frames it as the simulator frames summer days (+0200).
// The files are sent directly over SMTPS from the grid owner's mailbox (live-chain-fixture gridOwnerSends): the
// running simulator process predates the DST-aware dailyE66 (DST-H1) and could not send 100 values.
//
// Wall clock: values for a day cannot be registered before the day exists. The grid owner's registration time
// (DTM+137/597, UNB) is capped at "now" (DTM+137 may not lie after reception, headerGuide.ts:207); when the
// scenario runs before 27 October the report says so (registrationCappedToNow). The October invoice needs spot
// prices for the whole month; with REALITY_SPOT_SOURCE=real they exist only after the month, so G10 is a soft
// check that reports exactly why it could not be reached.
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
import { stockholmMonthBounds } from '@/lib/time/stockholm'
import { LIVE, approveIssuerHistoryGround, augustSupplyCustomer, cron, gridOwnerSends, literal, sql, type AugustFacility, type LiveTenant } from '../helpers/live-chain-fixture'
import { WEBSITE_ORIGIN } from '../helpers/reality/tenantWebsite'
import { closeOperatorConsole, operatorSession, submitServerAction } from '../helpers/reality/operatorConsole'
import { runOperationalCronSlot, type GridOwnerSim } from '../helpers/reality/world'
import { GRID_AREA, GRID_OWNER_EDIEL_ID, goLiveAlsSupplier } from '../helpers/reality/goLiveAls'
import { detectStuckStates } from '../helpers/reality/stuckDetector'
import { registerUtiltsIssuer } from '../helpers/utiltsConsumptionParties'
import { gs1 } from '../helpers/live-chain-wire'
import { dayE66, dstDayProfile, kwhSum, monthDays, stockholmQuarterCount, stockholmQuarterStarts, type E66DayFraming } from '../helpers/reality/dst'

const report: Record<string, unknown> = { scenario: 'G end of DST 2026-10-25', startedAt: new Date().toISOString() }
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
const FOCUS_DAYS = ['2026-10-24', DST_DAY, '2026-10-26']
/** Every October day by default (so the month, the portal card and the invoice can be complete); "focus" sends only 24–26 October. */
const DAYS = process.env.GRIDEX_REALITY_G_DAYS === 'focus' ? FOCUS_DAYS : monthDays(MONTH)
const FRAMING = (process.env.GRIDEX_REALITY_G_FRAMING ?? 'civil_fixed_cet') as E66DayFraming
if (FRAMING === 'fixed_cet_day') throw Error('scenario G sends Stockholm civil days; fixed_cet_day is covered by __tests__/dst-utilts-civil-day.test.ts')
const SEPTEMBER_SIGNED_AT = '2026-09-10T09:30:00+02:00'
const SEPTEMBER_SWITCH_CREATED_AT = '2026-09-10T09:31:00+02:00'
report.config = { days: DAYS, framing: FRAMING, supplyStart: SUPPLY_START }

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

/** The grid owner sends one Stockholm day as one UTILTS E66 mail over SMTPS, like its daily metering run. */
async function gridOwnerSendsDay(day: string, index: number) {
  const values = dstDayProfile(day, index, SCALE)
  const reference = `G${day.replaceAll('-', '').slice(2)}${GSRN.slice(-6)}`
  const natural = dayE66({ issuer: GRID_OWNER_EDIEL_ID, receiver: tenant.supplierEdielId, meterId: GSRN, day, values, reference, framing: FRAMING })
  const wire = dayE66({ issuer: GRID_OWNER_EDIEL_ID, receiver: tenant.supplierEdielId, meterId: GSRN, day, values, reference, framing: FRAMING, notAfter: Date.now() - 2 * 60_000 })
  await gridOwnerSends({ from: gridOwner.email, subject: `UTILTS-E66 ${reference}`, filename: `UTILTS-E66_${reference}.edi`, edifact: wire.edifact })
  sentFiles.push({ day, reference, values, starts: wire.starts, periodStart: wire.periodStart, periodEnd: wire.periodEnd, registeredAt: wire.registeredAt, naturalRegistration: natural.registeredAt })
}
const inboundE66 = () => sql<Array<{ id: string; reference: string; status: string }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,
    'reference',coalesce(external_reference,interchange_reference,''),'status',status) ORDER BY created_at),'[]')
  FROM public.ediel_messages WHERE company_id=${literal(tenant.companyId)} AND direction='inbound' AND message_code='E66'`)
/** Like Vercel: the inbound mail cron, then the Ediel outbox (which sends our CONTRL), once a minute. */
async function receiveUntil(done: () => boolean, minutes: number) {
  const runs: unknown[] = []
  const deadline = Date.now() + minutes * 60_000
  for (;;) {
    const inbound = await cron('/api/internal/inbound-mail/cron?environment=test')
    const outbox = await cron('/api/ediel/outbox/process')
    runs.push({ at: new Date().toISOString(), inbound: inbound.status, outbox: outbox.status })
    expect(inbound.status, JSON.stringify(inbound.body)).toBe(200)
    if (done() || Date.now() > deadline) break
    await pause(60_000)
  }
  return runs
}

/** Stored current values of the facility per Stockholm day, from both series (billing and Mina sidor sources). */
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
/** Every stored current start of one Stockholm day, ascending, as ISO. */
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
    const established = { customer: customer.customerId, site: facility.siteId, mp: facility.meteringPointId, contract: facility.contractId }
    ids = established
    // The signed-agreement confirmation (archived PDF) as the customer-operations cron delivers it.
    const readiness = () => sql<Array<{ ready: boolean; blockers: unknown }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('ready',switch_ready,'blockers',blockers)),'[]')
      FROM public.customer_contract_lifecycle_readiness_v WHERE company_id=${company} AND metering_point_id=${literal(established.mp)}`)
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
          'atSupplyStart',p.market_start_at=(TIMESTAMP '2026-10-01 00:00' AT TIME ZONE 'Europe/Stockholm'))
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
      await pause(60_000)
    }
    report.worldSlots = slots
    report.supply = state
    expect(state?.switch, JSON.stringify(state)).toMatch(/^(accepted|active|completed)$/)
    expect(state?.z04, 'supply rests on the grid owner\'s Z04').toBeTruthy()
    expect(state?.period, JSON.stringify(state)).toMatchObject({ status: 'active', start: SUPPLY_START, atSupplyStart: true, customer: ids!.customer, message: state?.z04 })
    supplied = true
  }, 40 * 60_000)

  it('G4 the grid owner sends October as one civil day per file: 96 / 100 / 96 quarter-hours around the DST change', async (context) => {
    requireStep(supplied, 'G4', 'no supply period rests on a Z04 from 1 October (G3)', context)
    // SYNTHETIC stand-in for EXT-ISSUER-01, exactly as scenario F registers the ALS grid owner.
    registerUtiltsIssuer(sql as never, literal, GRID_OWNER_EDIEL_ID, tenant.adminUserId)
    for (const [index, day] of DAYS.entries()) await gridOwnerSendsDay(day, index)
    const capped = sentFiles.filter(file => file.registeredAt !== file.naturalRegistration)
    report.registrationCappedToNow = capped.map(file => ({ day: file.day, natural: file.naturalRegistration, sent: file.registeredAt }))
    report.sentFiles = sentFiles.map(({ values, starts, ...file }) => ({ ...file, quarters: values.length, kwh: kwhSum(values), firstStart: starts[0], lastStart: starts[starts.length - 1] }))
    for (const day of FOCUS_DAYS) expect(sentFor(day)?.values.length, day).toBe(stockholmQuarterCount(day))
    expect(sentFor(DST_DAY)).toMatchObject({ periodStart: '2026-10-24T22:00:00.000Z', periodEnd: '2026-10-25T23:00:00.000Z' })
  }, 15 * 60_000)

  it('G5 the inbound cron receives every file on the tenant', async (context) => {
    requireStep(sentFiles.length > 0, 'G5', 'nothing was sent (G4)', context)
    report.receptionRuns = await receiveUntil(() => inboundE66().length >= sentFiles.length, Number(process.env.GRIDEX_REALITY_G5_MINUTES ?? 20))
    const inbound = inboundE66()
    report.inbound = inbound
    const arrived = new Set(inbound.map(message => fileOf(message.reference)?.reference))
    expect(sentFiles.filter(file => !arrived.has(file.reference)).map(file => file.day), 'files never received on the tenant').toEqual([])
  }, 30 * 60_000)

  it('G6 after issuer evidence and operator reprocessing every value is stored: 100 on 25 October, no gap, no duplicate', async (context) => {
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

    const perDay = storedPerDay()
    report.storedPerDay = perDay
    for (const day of DAYS) {
      const sent = sentFor(day)!, got = perDay[day]
      expect(got, `${day} stored`).toBeTruthy()
      expect({ normalized: got.normalized, distinct: got.distinctStarts, metering: got.metering, eligible: got.eligible }, day)
        .toEqual({ normalized: sent.values.length, distinct: sent.values.length, metering: sent.values.length, eligible: sent.values.length })
      expect(Number(got.kwh), `${day} kWh`).toBeCloseTo(kwhSum(sent.values), 6)
      expect(Number(got.meteringKwh), `${day} kWh (Mina sidor series)`).toBeCloseTo(kwhSum(sent.values), 6)
    }
    // 25 October: exactly the 100 UTC quarter-hours 22:00Z–23:00Z, both passes of 02:00–03:00 (00:00Z and 01:00Z).
    const starts = storedStarts(DST_DAY)
    report.dstDayStarts = { count: starts.length, first: starts[0], last: starts[starts.length - 1], repeatedHour: starts.filter(s => s >= '2026-10-25T00:00' && s < '2026-10-25T02:00') }
    expect(starts).toEqual(stockholmQuarterStarts(DST_DAY))
    expect(starts).toEqual(sentFor(DST_DAY)!.starts)
    // Around the change: one continuous series of 15-minute steps from 24 Oct 00:00 CEST to 27 Oct 00:00 CET.
    const around = FOCUS_DAYS.flatMap(storedStarts)
    expect(around).toHaveLength(292)
    expect(around.every((iso, i) => i === 0 || Date.parse(iso) - Date.parse(around[i - 1]) === 900_000), 'no gap and no duplicate around the change').toBe(true)
    stored = true
  }, 150 * 60_000)

  it('G7 completeness is not flagged: engine, billing completeness and the month card', async (context) => {
    requireStep(stored, 'G7', 'values were not stored (G6)', context)
    const reprocess = (report.reprocess ?? []) as Array<{ day: string | null; diagnosis?: { issues?: string[] } }>
    const dst = reprocess.find(outcome => outcome.day === DST_DAY)
    expect(dst?.diagnosis?.issues ?? [], 'no interval-count issue on the DST day').not.toEqual(expect.arrayContaining(['UTILTS_DST_INTERVAL_COUNT_MISMATCH']))
    expect(dst?.diagnosis?.issues ?? []).not.toEqual(expect.arrayContaining(['UTILTS_E66_OBSERVATION_COUNT_MISMATCH']))
    const completeness = await evaluateMeteringCompletenessForMonth({ companyId: tenant.companyId, billingMonth: MONTH,
      meteringPoints: [{ meteringPointId: ids!.mp, requiredResolution: 'quarter_hour' }] })
    report.completeness = completeness
    if (DAYS.length === monthDays(MONTH).length) {
      // DST-C1: before the paging fix in lib/metering/validation.ts this read only PostgREST's first 1 000 rows.
      expect(completeness, JSON.stringify(completeness.issues)).toMatchObject({ status: 'complete', valueCount: 2980 })
    } else {
      expect(completeness.valueCount).toBe(292)
      expect(completeness.issues.filter(issue => issue.code === 'metering_overlap')).toEqual([])
    }
  })

  it('G8 Mina sidor and the customer/partner API readers show the sent sums per day and for October', async (context) => {
    requireStep(stored, 'G8', 'values were not stored (G6)', context)
    const scope = { companyId: tenant.companyId, customerIds: [ids!.customer] }
    const days: Record<string, Row> = {}
    for (const day of FOCUS_DAYS) {
      const { data, error } = await customerNormalizedMeteringValues(scope, { periodStartFrom: stockholmDayStartUtc(day).toISOString(), periodStartBefore: stockholmNextDayStartUtc(day).toISOString() })
        .select('period_start,quantity_kwh')
      expect(error).toBeNull()
      const rows = (data ?? []) as Array<{ period_start: string; quantity_kwh: number }>
      days[day] = { rows: rows.length, kwh: kwhSum(rows.map(row => Number(row.quantity_kwh))), sent: kwhSum(sentFor(day)!.values) }
      expect(rows.length, day).toBe(sentFor(day)!.values.length)
      expect(kwhSum(rows.map(row => Number(row.quantity_kwh))), day).toBeCloseTo(kwhSum(sentFor(day)!.values), 6)
    }
    const sentMonth = kwhSum(sentFiles.flatMap(file => file.values)), sentQuarters = sentFiles.reduce((n, file) => n + file.values.length, 0)
    const months = await listPortalMonthlyConsumption(scope as Parameters<typeof listPortalMonthlyConsumption>[0], { now: new Date('2026-10-28T12:00:00Z'), months: 2 })
    const october = months.find(month => month.monthKey === MONTH)
    report.portal = { days, october, sentMonth, sentQuarters }
    expect(october?.valueCount).toBe(sentQuarters)
    expect(october?.totalKwh).toBeCloseTo(sentMonth, 6)
    if (DAYS.length === monthDays(MONTH).length) expect(october?.complete, 'the whole October incl. the extra hour is covered').toBe(true)
    else expect(october?.complete, 'three days of October are not a complete month').toBe(false)

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

  it('G9 October spot prices: 2 980 quarter-hours including the repeated hour (soft)', async (context) => {
    requireStep(stored, 'G9', 'values were not stored (G6)', context)
    const admin = await operatorSession(tenant.adminEmail, tenant.adminPassword)
    const imported = await admin.request.post('/api/internal/spot/import-month', { data: { billing_month: MONTH, price_areas: ['SE3'] } })
    const importBody = await imported.json().catch(() => null)
    const bounds = stockholmMonthBounds(MONTH)
    const intervals = sql<number>(`SELECT to_jsonb(count(*)) FROM public.spot_price_intervals WHERE price_area='SE3' AND resolution='quarter_hour'
      AND time_start>=${literal(bounds.start)} AND time_start<${literal(bounds.end)}`)
    const dstDay = sql<number>(`SELECT to_jsonb(count(*)) FROM public.spot_price_intervals WHERE price_area='SE3' AND resolution='quarter_hour'
      AND time_start>='2026-10-24T22:00:00Z' AND time_start<'2026-10-25T23:00:00Z'`)
    let locked: Row | null = null
    if (intervals === 2980) {
      const response = await admin.request.post('/api/internal/spot/lock-month', { data: { billing_month: MONTH, price_area: 'SE3', reason: 'E2E reality G' } })
      locked = { status: response.status(), body: await response.json().catch(() => null) }
    }
    report.spot = { importStatus: imported.status(), importBody, intervals, dstDay, locked,
      ...(intervals === 2980 ? {} : { unreachable: `only ${intervals} of 2 980 October quarter-hours exist: with REALITY_SPOT_SOURCE=real the provider publishes a day the afternoon before; before 1 November the month cannot be complete` }) }
    expect.soft(dstDay, 'the DST day has 100 spot quarter-hours').toBe(100)
    expect.soft(intervals, 'October has 2 980 spot quarter-hours').toBe(2980)
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
    // Independent: every sent quarter priced at its own UTC quarter's spot price (the repeated hour has its own prices).
    const prices = sql<Array<{ s: string; p: number }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('s',time_start,'p',sek_per_kwh) ORDER BY time_start),'[]')
      FROM public.spot_price_intervals WHERE price_area='SE3' AND resolution='quarter_hour' AND time_start>='2026-09-30T22:00:00Z' AND time_start<'2026-10-31T23:00:00Z'`)
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
    expect.soft(Number(underlay.values ?? 0), 'underlay value count').toBe(sentFiles.reduce((n, file) => n + file.values.length, 0))
    if (!invoice) {
      report.october = { ...(report.october as Row), unreachable: unpriced ? `${unpriced} sent quarter-hours have no spot price yet (G9), so no invoice can be priced` : 'no invoice prepared; see underlay readiness/block reason' }
      expect.soft(invoice, 'an October invoice draft exists').not.toBeNull()
      return
    }
    expect.soft(Number(invoice.kwh), 'invoice kWh incl. the extra hour').toBeCloseTo(kwh, 3)
    expect.soft(Math.abs(Number(invoice.exVat) - independent.exVat), `invoice ex VAT vs independent ${JSON.stringify(independent)}`).toBeLessThan(1)
  }, 20 * 60_000)

  it('G11 isolation and queues: values only on this tenant and customer, nothing stuck', (context) => {
    requireStep(Boolean(ids), 'G11', 'no customer was established (G2)', context)
    const leaks = sql<Record<string, number>>(`SELECT jsonb_build_object(
      'valuesElsewhere',(SELECT count(*) FROM public.normalized_metering_values WHERE company_id<>${literal(tenant.companyId)} AND (metering_point_id=${literal(ids!.mp)} OR facility_id=${literal(GSRN)})),
      'otherCustomersHere',(SELECT count(*) FROM public.normalized_metering_values WHERE company_id=${literal(tenant.companyId)} AND metering_point_id=${literal(ids!.mp)} AND customer_id IS DISTINCT FROM ${literal(ids!.customer)}))`)
    report.isolation = leaks
    expect(leaks).toEqual({ valuesElsewhere: 0, otherCustomersHere: 0 })
    const stuck = detectStuckStates({ graceSeconds: 600, companyIds: [tenant.companyId] })
    report.stuck = stuck
    expect(stuck.filter(row => row.kind === 'stuck')).toEqual([])
  })
})
