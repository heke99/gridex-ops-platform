// Reality scenario I: the grid owner rejects or stays silent.
//
// Production risk: a rejected or unanswered market request silently stalls, the customer is never told, no
// operator gets a task, or the platform re-sends/duplicates. Same world as scenarios A and F: the supplier goes
// live in ALS (Alingsås) and the grid owner is a separate process that only talks e-mail (SMTPS/IMAPS). Here it
// is the REJECTING grid owner (scripts/reality/simulators/gridOwnerRejects.ts), which answers each received
// request by the facility's plan: business rejection per object (BGM 34 with ERC 40/105, 40/106, 42/210,
// 42/227), whole-message rejection (BGM 27, ERC 40/102), negative CONTRL, silence, Z04 before the APERAK,
// a duplicate APERAK, and a late negative APERAK after the Z04.
//
// Two request types, each on its real path:
//   Z01 (customer/facility request): website customers apply with the tenant's API key; the platform's
//       customer-operations cron sends the Z01.
//   Z03 (switch request): a signed customer (signature RPCs + power of attorney, as in scenario F); the tenant
//       operator presses "Skapa switchärende" on /admin/customers/<id>; the platform builds, gates and sends the Z03.
// The test only starts the world, lets it run on Vercel's cron cadence and inspects the outcome; it never writes
// market state. A step the world cannot reach is a soft check that says exactly why.
//
// Specification: masterplan ACK-02/ACK-06/ACK-07/ACK-09, P-10, P-11, TR-05, ENV-04
// (docs/ediel/masterplan-v2/registers/rules.json). Defects: GOR-01..GOR-09 in DEFECTS below; native proofs in
// scripts/ediel-grid-owner-rejects-native.test.ts and __tests__/ediel-grid-owner-late-negative-ack.test.ts.
// Synthetic data only (E2E-, example.invalid).
import { writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it, type TestContext } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { LIVE, augustSupplyCustomer, literal, sql, type AugustSupplyCustomer, type LiveTenant } from '../helpers/live-chain-fixture'
import { WEBSITE_ORIGIN } from '../helpers/reality/tenantWebsite'
import { closeOperatorConsole, operatorSession } from '../helpers/reality/operatorConsole'
import { runOperationalCronSlot, type GridOwnerSim } from '../helpers/reality/world'
import { clockSettings, cronTick, loopTick } from '../helpers/reality/clock'
import { GRID_AREA, GRID_OWNER_EDIEL_ID, goLiveAlsSupplier } from '../helpers/reality/goLiveAls'
import { detectStuckStates } from '../helpers/reality/stuckDetector'
import { gs1 } from '../helpers/live-chain-wire'
import { REJECTION_CODES, SILENT, type GridOwnerAnswerPlan, type RejectionReason } from '../helpers/reality/rejectsWire'
import { awaitPlatformStartedSwitch, dataRequestStates, operatorSeesSwitch, overdueOutboundAcks, retrySwitchInAdmin, startRejectingGridOwner, switchStates, type RejectingGridOwner, type SwitchState } from '../helpers/reality/rejectsWorld'
import { applyAsWebsiteCustomer, type SimulatedPerson } from './simulators/websiteCustomer'

const report: Record<string, unknown> = { scenario: 'I grid owner rejects or stays silent', startedAt: new Date().toISOString(), clock: clockSettings() }
const REPORT = process.env.GRIDEX_REALITY_REPORT ?? '/tmp/reality-i-report.json'
const saveReport = (extra: Record<string, unknown> = {}) => writeFileSync(REPORT, JSON.stringify({ ...report, ...extra }, null, 2))
let tenant: LiveTenant
let defaultGridOwner: GridOwnerSim | undefined
let gridOwner: RejectingGridOwner
let apiKey = ''
let staff: Awaited<ReturnType<typeof operatorSession>>

/** Defects found while building this scenario (file:line, status). Native/unit proofs named in the header. */
const DEFECTS = [
  { id: 'GOR-01', severity: 'high', status: 'confirmed (native), fixed in lib/ediel/flows/inboundAckProcessing.ts',
    where: 'lib/ediel/flows/inboundAckProcessing.ts:allowBusinessTransition (was wholeSourceRejected || sourceAccepted); SQL gridex_ack_authority.apply_before_committed_replay_v1',
    what: 'A grid owner\'s business rejection of the only object (APERAK BGM 34 + ERC 40/42 per object, the normal PRODAT rejection) never reached the switch/data request: switch stayed "prepared", Z03 "sent" with ack_due_at cleared, canonical "in_progress" - a silent stall with no overdue watch.' },
  { id: 'GOR-02', severity: 'high', status: 'confirmed (unit), fixed in lib/ediel/flows/inboundAckProcessing.ts',
    where: 'lib/ediel/flows/inboundAckProcessing.ts syncSwitchFromInboundAck (negative branch had no state guard); activate_customer_supply_v1 requires switch status accepted',
    what: 'P-11: a late negative APERAK/CONTRL after the Z04 moved an accepted switch to "failed"; the confirmed supply period then could never be activated (activation requires status accepted; the sweep swallows the error).' },
  { id: 'GOR-03', severity: 'medium', status: 'confirmed (native), fixed in lib/ediel/flows/inboundAckProcessing.ts',
    where: 'SQL failure:=family||\' negative whole-source acknowledgement\'; inboundAckProcessing passed it unchanged',
    what: 'The failed switch/outbound/data request carried only "APERAK negative whole-source acknowledgement"; the DSO\'s ERC/FTX code and text were lost to the operator.' },
  { id: 'GOR-04', severity: 'high', status: 'confirmed (native), fixed: lib/ediel/flows/ackRejectionFollowUp.ts wired in lib/ediel/flows/inboundProcessing.ts (negative CONTRL: operator case only, no customer notice)',
    where: 'lib/ediel/flows/inboundProcessing.ts:1259-1273 (ACK families return before applyInboundBusinessStateMachine)',
    what: 'A market rejection opens no operator case, does not move the website application to switch_rejected and queues no "supplier_switch.rejected" customer notification; the legacy state machine that does all three is never called for CONTRL/APERAK.' },
  { id: 'GOR-05', severity: 'high', status: 'confirmed (native + live DB), fixed: migration 20261022160000_ediel_outbound_ack_overdue.sql, outboundAckSla cron step, getSwitchLifecycle "Kvittens försenad"',
    where: 'public.ediel_message_ack_state_v (awaiting_contrl/awaiting_aperak ranked before ack_overdue); lib/ediel/operations/ackSlaMonitor.ts (no caller); lib/ediel/sla/createAckTimers.ts (inbound only); business expectations only Z01/Z13/Z18/Z08',
    what: 'A Z03 the grid owner never answers is never overdue: the overdue view never lists a message still awaiting CONTRL/APERAK, no cron creates an SLA event or task for an outbound Z03, the control tower counts "pending" without a time limit, and the switch lifecycle shows "Väntar på kvittens" forever. (Z01 has its own working watchdog.)' },
  { id: 'GOR-06', severity: 'low', status: 'confirmed (code + native observation), open',
    where: 'lib/ediel/flows/inboundAckProcessing.ts syncSwitchFromInboundAck positive branch (only draft/queued -> submitted)',
    what: 'After the Z03 is sent the switch is "prepared"; a positive final CONTRL+APERAK never moves it to "submitted" (event says "status kept"). Lifecycle relies on the outbound request instead.' },
  { id: 'GOR-07', severity: 'low', status: 'likely (code)',
    where: 'lib/operations/switchLifecycleBlocks.ts:52 OPEN_SUPPLIER_SWITCH_STATUSES vs index supplier_switch_requests_open_site_uidx',
    what: 'The app\'s "open switch" list lacks prepared/sent/waiting_response etc. that the DB unique index treats as open: "Skapa switchärende" while a Z03 is pending hits a unique violation instead of the friendly "Leverantörsbyte finns redan".' },
  { id: 'GOR-S1', severity: 'medium (harness)', status: 'confirmed (probe)', where: 'scripts/reality/simulators/gridOwner.ts:99',
    what: 'The default grid-owner simulator\'s rejectShare path throws APERAK_PRODAT_OBJECT_OUTCOME_SCOPE_MISMATCH (no object outcome given); the failure is recorded and NO APERAK is sent, so a "rejecting" profile is really a silent one.' },
  { id: 'GOR-FP1', severity: 'none', status: 'false positive (native)', where: 'lib/ediel/orchestrator/autoAckOrchestrator.ts:54',
    what: 'A re-delivered identical APERAK is held as a protocol duplicate (duplicate_response_held); no second business effect.' },
]
report.defects = DEFECTS

function personnummer(birth: string, serial: string) {
  const nine = birth.slice(2) + serial
  const sum = [...nine].reduce((total, digit, i) => { const v = Number(digit) * (i % 2 === 0 ? 2 : 1); return total + (v > 9 ? v - 9 : v) }, 0)
  return `${birth}${serial}${(10 - (sum % 10)) % 10}`
}
const RUN = Date.now().toString(36)
const facility = () => gs1(`735999${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`)
const person = (first: string, birth: string, serial: string, street = 'Kungsgatan 1'): SimulatedPerson => ({ firstName: first, lastName: 'E2E-Avvisning', personalNumber: personnummer(birth, serial),
  email: `e2e-${first.toLowerCase()}-${serial}-${RUN}@example.invalid`, phone: '0701234567', address: { street, postalCode: '441 30', city: 'Alingsås' } })
const answer = (aperak: GridOwnerAnswerPlan['aperak'], extra: Partial<GridOwnerAnswerPlan> = {}): GridOwnerAnswerPlan => ({ contrl: 'positive', aperak, z04: 'none', duplicateAperak: false, ...extra })
const reject = (reason: RejectionReason) => answer({ kind: 'reject', reason })

/** Website customers (Z01 path), one facility each, and how the grid owner answers their Z01. */
const WEBSITE = [
  { key: 'W1-unknown-gsrn', person: person('Webbokand', '19810101', '111'), gsrn: facility(), plan: reject('unknown_gsrn') },
  { key: 'W2-header-27', person: person('Webbhuvud', '19820202', '222'), gsrn: facility(), plan: answer({ kind: 'header' }) },
  { key: 'W3-contrl-negative', person: person('Webbsyntax', '19830303', '333'), gsrn: facility(), plan: { ...SILENT, contrl: 'negative' } as GridOwnerAnswerPlan },
  { key: 'W4-silent', person: person('Webbtyst', '19840404', '444'), gsrn: facility(), plan: SILENT },
]
/** Signed customers (Z03 path): the operator creates the switch in the admin UI; the grid owner answers by plan. */
const SWITCHES = [
  { key: 'S1-unknown-gsrn', person: person('Bytokand', '19700505', '515'), gsrn: facility(), plan: reject('unknown_gsrn') },
  { key: 'S2-other-supplier', person: person('Bytannan', '19710606', '616'), gsrn: facility(), plan: reject('other_supplier_pending') },
  { key: 'S3-start-date', person: person('Bytdatum', '19720707', '717'), gsrn: facility(), plan: reject('start_date_not_allowed') },
  { key: 'S4-customer-identity', person: person('Bytident', '19730808', '818'), gsrn: facility(), plan: reject('wrong_customer_identity') },
  { key: 'S5-header-27', person: person('Bythuvud', '19740909', '919'), gsrn: facility(), plan: answer({ kind: 'header' }) },
  { key: 'S6-contrl-negative', person: person('Bytsyntax', '19751010', '101'), gsrn: facility(), plan: { ...SILENT, contrl: 'negative' } as GridOwnerAnswerPlan },
  { key: 'S7-silent', person: person('Byttyst', '19761111', '202'), gsrn: facility(), plan: SILENT },
  { key: 'S8-z04-first-duplicate-aperak', person: person('Bytordning', '19771212', '303'), gsrn: facility(), plan: answer({ kind: 'positive' }, { z04: 'before_aperak', duplicateAperak: true }) },
  { key: 'S9-late-negative', person: person('Bytsen', '19780113', '404'), gsrn: facility(), plan: answer({ kind: 'header' }, { z04: 'before_aperak' }) },
]
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
const addDays = (date: string, days: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10) }
/** Inside the Z03 send window: at least the 14-day market lead (P-03), well before any window close. */
const SUPPLY_START = addDays(today, 30)
report.supplyStart = SUPPLY_START

const signed = new Map<string, AugustSupplyCustomer>()
const byKey = (key: string) => SWITCHES.find(s => s.key === key)!
const stateOf = (key: string, states: SwitchState[]) => states.filter(s => s.facility === byKey(key).gsrn)
let z03Reached = false
let z01Reached = false
function requireZ03(step: string, context: TestContext) {
  if (z03Reached) return
  report[step] = 'skipped: no Z03 reached the grid owner in I3 (see report.switchCreation / report.cronSlots for the platform\'s blockers)'
  return context.skip()
}

describe.sequential('reality I — the grid owner rejects or stays silent', () => {
  afterAll(async () => {
    defaultGridOwner?.stop()
    gridOwner?.stop()
    await closeOperatorConsole()
    report.finishedAt = new Date().toISOString()
    saveReport()
  })

  it('I1 the supplier goes live in ALS; the rejecting grid owner takes over the grid owner\'s mailbox', async () => {
    expect(LIVE.cronSecret && LIVE.automationUserId).toBeTruthy()
    const live = await goLiveAlsSupplier(report)
    ;({ tenant, apiKey } = live)
    defaultGridOwner = live.gridOwner
    staff = await operatorSession(tenant.operatorEmail, tenant.operatorPassword)
    expect(live.provisioned.readinessBlockers, JSON.stringify(live.provisioned.readinessBlockers)).toEqual([])
    // One counterparty per mailbox: the default simulator would mark our mails read first.
    defaultGridOwner.stop()
    gridOwner = await startRejectingGridOwner({ edielId: live.gridOwner.edielId, email: live.gridOwner.email })
    await gridOwner.plan(Object.fromEntries([...WEBSITE, ...SWITCHES].map(c => [c.gsrn, c.plan])))
    report.plans = Object.fromEntries([...WEBSITE, ...SWITCHES].map(c => [c.key, { gsrn: c.gsrn, plan: c.plan }]))
    expect(apiKey).toBeTruthy()
    saveReport()
  })

  it('I2 Z01 path: website customers apply; Z03 path: signed customers, the operator creates each switch in the admin UI', async () => {
    await fetch('http://127.0.0.1:3901/__sim/geocode', { method: 'POST', body: JSON.stringify({ postal_code: '441 30', latitude: 57.9303, longitude: 12.534 }) })
    const point = sql<{ x: number; y: number }>(`SELECT jsonb_build_object('x',round(ST_X(p)::numeric,2),'y',round(ST_Y(p)::numeric,2))
      FROM (SELECT ST_Transform(ST_SetSRID(ST_MakePoint(12.534,57.9303),4326),3006) p) q`)
    await fetch('http://127.0.0.1:3901/__sim/address', { method: 'POST', body: JSON.stringify({ street: 'Kungsgatan', number: '1', postalCode: '441 30', city: 'Alingsås', ...point }) })
    const applications: unknown[] = []
    for (const customer of WEBSITE) {
      const account = await supabaseService.auth.admin.createUser({ email: customer.person.email, password: `Reality-${customer.person.personalNumber}`, email_confirm: true })
      if (account.error || !account.data.user) throw Error(`portal_account_failed:${account.error?.message}`)
      const result = await applyAsWebsiteCustomer({ baseUrl: LIVE.appUrl, apiKey, origin: WEBSITE_ORIGIN, person: customer.person,
        site: { facilityId: customer.gsrn, priceArea: 'SE3', annualConsumptionKwh: 9_000 }, portalUserId: account.data.user.id })
      applications.push({ key: customer.key, status: result.status, step: result.step, number: result.applicationNumber })
      expect(result.status, `${customer.key}: ${result.step} ${JSON.stringify(result.body).slice(0, 400)}`).toBeLessThan(300)
    }
    report.websiteApplications = applications

    // Signed customers: contract through the signature RPCs, power of attorney through the admin writer (scenario F's
    // helper); the platform's contract confirmation (archived signed PDF) is delivered by the customer-operations cron.
    const grid = sql<{ id: string; ediel: string }>(`SELECT jsonb_build_object('id',id,'ediel',ediel_id) FROM public.grid_owners WHERE ediel_id=${literal(GRID_OWNER_EDIEL_ID)} AND company_id IS NULL`)
    for (const s of SWITCHES) signed.set(s.key, await augustSupplyCustomer(tenant, { firstName: s.person.firstName, lastName: s.person.lastName, personalNumber: s.person.personalNumber,
      email: s.person.email, address: s.person.address, supplyStart: SUPPLY_START, authorizedAt: new Date().toISOString(),
      grid: { gridOwnerId: grid.id, gridOwnerEdielId: grid.ediel, gridAreaCode: GRID_AREA },
      facilities: [{ gsrn: s.gsrn, street: s.person.address.street, postalCode: '441 30', city: 'Alingsås', annualConsumptionKwh: 9_000 }] }))
    const confirmations: unknown[] = []
    for (let slot = 0; slot < 3; slot += 1) confirmations.push((await runOperationalCronSlot()).map(r => ({ path: r.path, status: r.status })))
    report.signedConfirmations = confirmations
    // The platform starts each signed customer's switch itself (contract_signed job; FINDINGS I-B2c).
    const created: unknown[] = []
    for (const s of SWITCHES) {
      const customer = signed.get(s.key)!
      created.push({ key: s.key, ...await awaitPlatformStartedSwitch({ companyId: tenant.companyId, siteId: customer.facilities[0].siteId }) })
    }
    report.switchCreation = { created, states: switchStates(tenant.companyId).map(s => ({ facility: s.facility, status: s.status, z03: s.z03.length, failure: s.failureReason })) }
    saveReport()
    expect(switchStates(tenant.companyId).length, JSON.stringify(report.switchCreation).slice(0, 2000)).toBeGreaterThanOrEqual(SWITCHES.length)
  }, 30 * 60_000)

  it('I3 the world runs on the Vercel cron cadence until every request has its answer or its deadline has passed', async () => {
    // Every answer of the grid owner arrives within minutes; 35 minutes covers the 30-minute ack/business watches.
    const deadline = Date.now() + Number(process.env.GRIDEX_REALITY_I3_MINUTES ?? 40) * 60_000
    const slots: unknown[] = []
    for (;;) {
      const ran = await runOperationalCronSlot()
      slots.push({ at: new Date().toISOString(), crons: ran.map(r => ({ path: r.path, status: r.status, ms: r.ms })) })
      const sim = await gridOwner.state()
      const switches = switchStates(tenant.companyId), requests = dataRequestStates(tenant.companyId)
      saveReport({ cronSlots: slots, switches, dataRequests: requests, gridOwner: sim })
      const answered = sim.pendingSends === 0 && sim.received.filter(m => m.code === 'Z03').length >= SWITCHES.length && sim.received.filter(m => m.code === 'Z01').length >= WEBSITE.length
      const watchesDue = Date.now() - Date.parse(String(report.startedAt)) > 35 * 60_000
      if ((answered && watchesDue) || Date.now() > deadline) break
      // Once every answer is in, only the 30-minute watches remain: wall clock, polled at the real minute.
      await loopTick(answered)
    }
    report.cronSlots = slots
    const sim = await gridOwner.state()
    report.gridOwner = sim
    z03Reached = sim.received.some(m => m.code === 'Z03')
    z01Reached = sim.received.some(m => m.code === 'Z01')
    report.reached = { z01: z01Reached, z03: z03Reached }
    // The counterparty itself never failed to build or send an answer.
    expect(sim.failures).toEqual([])
    expect(z01Reached || z03Reached, 'neither a Z01 nor a Z03 reached the grid owner; see report.cronSlots and report.switchCreation').toBe(true)
  }, 60 * 60_000)

  it('I4 business and whole-message rejections of Z03: the switch fails with the grid owner\'s code, no supply, no resend; the operator sees it', async context => {
    requireZ03('I4', context)
    const states = switchStates(tenant.companyId)
    const rows = ['S1-unknown-gsrn', 'S2-other-supplier', 'S3-start-date', 'S4-customer-identity', 'S5-header-27'].map(key => ({ key, state: stateOf(key, states)[0] }))
    report.I4 = rows
    for (const { key, state } of rows) {
      if (!state?.z03.length) { expect.soft(state?.z03.length ?? 0, `${key}: no Z03 was sent (blocked before dispatch: ${state?.failureReason ?? state?.status})`).toBeGreaterThan(0); continue }
      const plan = byKey(key).plan
      const code = plan.aperak.kind === 'reject' ? `${REJECTION_CODES[plan.aperak.reason].erc}/${REJECTION_CODES[plan.aperak.reason].code}` : '40/102'
      // GOR-01 / GOR-03: the rejection reaches the switch with the DSO's own code.
      expect(state.status, `${key} ${JSON.stringify(state.events.slice(-3))}`).toBe('failed')
      expect(state.failureReason ?? '', key).toContain(code)
      // Never a supply period, never a re-sent original.
      expect(state.periods, key).toEqual([])
      expect(state.z03, key).toHaveLength(1)
    }
    const sim = await gridOwner.state()
    for (const { key } of rows) expect(sim.received.filter(m => m.code === 'Z03' && m.facility === byKey(key).gsrn), `${key}: one Z03 at the grid owner`).toHaveLength(1)
    // The operator's switch list names the failure.
    const seen = await operatorSeesSwitch(staff, rows.map(r => r.state?.failureReason).filter((x): x is string => Boolean(x)).map(reason => reason.slice(reason.indexOf('ERC'))))
    report.I4operator = seen
    expect(seen.status).toBeLessThan(400)
    expect.soft(seen.found.length, 'every failure reason is on /admin/operations/switches').toBe(rows.filter(r => r.state?.failureReason).length)
    // GOR-04: one operator case and one customer rejection notice per rejected switch.
    const followUp = sql<{ cases: number; notifications: number; workflows: unknown }>(`SELECT jsonb_build_object(
      'cases',(SELECT count(*) FROM public.customer_cases WHERE company_id=${literal(tenant.companyId)} AND supplier_switch_request_id IS NOT NULL),
      'notifications',(SELECT count(*) FROM public.customer_operation_jobs WHERE company_id=${literal(tenant.companyId)} AND job_type='dispatch_lifecycle_notification' AND idempotency_key LIKE '%switch.action_required%'))`)
    report.I4followUp = followUp
    const rejected = rows.filter(r => r.state?.status === 'failed').length
    expect(followUp.cases, 'GOR-04: an operator case per rejected switch').toBe(rejected + (stateOf('S6-contrl-negative', states)[0]?.status === 'failed' ? 1 : 0))
    expect(followUp.notifications, 'GOR-04: the customer is told the switch was rejected (switch.action_required), once').toBe(rejected)
  })

  it('I5 negative CONTRL on a Z03: the switch fails, nothing more is processed or re-sent', async context => {
    requireZ03('I5', context)
    const [state] = stateOf('S6-contrl-negative', switchStates(tenant.companyId))
    report.I5 = state
    if (!state?.z03.length) return expect.soft(0, 'S6: no Z03 was sent').toBeGreaterThan(0)
    expect(state.status).toBe('failed')
    expect(state.z03[0]).toMatchObject({ status: 'failed', contrl: 'failed' })
    expect(state.periods).toEqual([])
    expect(state.z03).toHaveLength(1)
    // GOR-04: our own syntax error is an operator case only; the customer is not told.
    expect(sql(`SELECT jsonb_build_object('cases',(SELECT count(*) FROM public.customer_cases WHERE company_id=${literal(tenant.companyId)} AND supplier_switch_request_id=${literal(state.switchId)} AND case_type='technical_rejection'),
      'notices',(SELECT count(*) FROM public.customer_operation_jobs WHERE company_id=${literal(tenant.companyId)} AND job_type='dispatch_lifecycle_notification' AND payload->>'supplier_switch_request_id'=${literal(state.switchId)}))`)).toEqual({ cases: 1, notices: 0 })
  })

  it('I6 silence: a Z03 and a Z01 nobody answers become overdue for an operator and are never re-sent automatically', async context => {
    requireZ03('I6', context)
    const [state] = stateOf('S7-silent', switchStates(tenant.companyId))
    const overdue = overdueOutboundAcks(tenant.companyId)
    const silentZ01 = dataRequestStates(tenant.companyId).filter(r => r.facility === WEBSITE[3].gsrn)
    report.I6 = { state, overdue, silentZ01, overdueView: sql(`SELECT coalesce(jsonb_agg(id),'[]') FROM public.ediel_overdue_message_acks_v WHERE company_id=${literal(tenant.companyId)}`) }
    if (!state?.z03.length) return expect.soft(0, 'S7: no Z03 was sent').toBeGreaterThan(0)
    const sentAt = overdue.find(o => o.id === state.z03[0].id)
    if (!sentAt) return expect.soft(0, 'S7: the Z03 ack deadline has not passed yet in this run (GRIDEX_REALITY_I3_MINUTES too short)').toBeGreaterThan(0)
    // Never re-sent: one Z03 at the grid owner, no automatic resend (TR-05).
    expect((await gridOwner.state()).received.filter(m => m.code === 'Z03' && m.facility === byKey('S7-silent').gsrn)).toHaveLength(1)
    // GOR-05: the platform's own overdue view says overdue and the cron's outboundAckSla step opened one SLA event.
    expect(state.z03[0].canonical).toBe('ack_overdue')
    expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_ack_sla_events WHERE company_id=${literal(tenant.companyId)} AND ediel_message_id=${literal(state.z03[0].id)} AND status='open'`),
      'GOR-05: one open ACK SLA event for the silent Z03').toBe(1)
    // The operator's switch list says the acknowledgement is late (getSwitchLifecycle, GOR-05).
    const seen = await operatorSeesSwitch(staff, ['Kvittens försenad'])
    report.I6operator = seen
    expect(seen.found, seen.excerpt).toEqual(['Kvittens försenad'])
    // The Z01 has its own watchdog (customer_data.response_overdue after 30 minutes).
    if (silentZ01.length && silentZ01[0].z01[0]?.status === 'sent') expect(silentZ01[0].overdueEvents, 'Z01 watchdog escalates the silent Z01').toBeGreaterThan(0)
  })

  it('I7 out of order and duplicate: Z04 before the APERAK confirms the switch; the late positive and the duplicate APERAK change nothing', async context => {
    requireZ03('I7', context)
    const [state] = stateOf('S8-z04-first-duplicate-aperak', switchStates(tenant.companyId))
    report.I7 = state
    if (!state?.z03.length) return expect.soft(0, 'S8: no Z03 was sent').toBeGreaterThan(0)
    // P-11: a valid Z04 may come before the positive APERAK.
    expect(state.status).toBe('accepted')
    expect(state.z04).toBe(true)
    expect(state.periods.map(p => p.status)).toEqual(['confirmed_by_grid_owner'])
    // The grid owner really sent the APERAK twice; the duplicate is held as a protocol duplicate (ACK-09): one ACK
    // event, for the final acknowledgement, never a failure. A positive CONTRL before the APERAK is not final and moves
    // nothing on the switch (owner decision 27, GOR-06), so it has no switch event (FINDINGS T39).
    const sent = (await gridOwner.state()).sent.filter(m => m.facility === byKey('S8-z04-first-duplicate-aperak').gsrn).map(m => m.kind)
    report.I7sent = sent
    expect(sent.filter(kind => kind.startsWith('APERAK'))).toHaveLength(2)
    expect(state.events.filter(e => e.type === 'ediel_ack_received')).toHaveLength(1)
    expect(state.events.filter(e => e.status === 'failed')).toEqual([])
  })

  it('I8 a late negative APERAK after the Z04 does not take back the confirmed switch (P-11, GOR-02)', async context => {
    requireZ03('I8', context)
    const [state] = stateOf('S9-late-negative', switchStates(tenant.companyId))
    report.I8 = state
    if (!state?.z03.length) return expect.soft(0, 'S9: no Z03 was sent').toBeGreaterThan(0)
    expect(state.z04).toBe(true)
    expect(state.status).toBe('accepted')
    expect(state.periods.map(p => p.status)).toEqual(['confirmed_by_grid_owner'])
    // ACK-07: the contradiction is on the switch for an operator.
    expect(state.events.some(e => e.status === 'warning' && /Z04/.test(e.message))).toBe(true)
  })

  it('I9 correction and resend: the tenant operator retries the rejected switch (Försök igen); a new Z03 (new BGM and LI) is accepted, the old one stays failed', async context => {
    requireZ03('I9', context)
    const key = 'S4-customer-identity', s = byKey(key), customer = signed.get(key)!
    const [rejected] = stateOf(key, switchStates(tenant.companyId))
    if (rejected?.status !== 'failed') return expect.soft(rejected?.status, `${key}: the first switch never failed, nothing to correct`).toBe('failed')
    // The grid owner now accepts this facility (the identity was corrected with the customer).
    await gridOwner.plan({ [s.gsrn]: answer({ kind: 'positive' }, { z04: 'after_aperak' }) })
    // The tenant operator presses "Försök igen" on the failed switch (owner decision 32); the automation sends the new Z03.
    report.I9retry = await retrySwitchInAdmin(staff, { customerId: customer.customerId, switchRequestId: rejected.switchId })
    expect(report.I9retry).toMatchObject({ outcome: 'queued' })
    const deadline = Date.now() + 15 * 60_000
    let states: SwitchState[] = []
    for (;;) {
      await runOperationalCronSlot()
      states = stateOf(key, switchStates(tenant.companyId))
      if (states.some(st => st.status === 'accepted') || Date.now() > deadline) break
      await cronTick()
    }
    report.I9 = states
    const sim = (await gridOwner.state()).received.filter(m => m.code === 'Z03' && m.facility === s.gsrn)
    expect(states.map(st => st.status).sort()).toEqual(['accepted', 'failed'])
    expect(sim).toHaveLength(2)
    const [first, second] = [states.find(st => st.status === 'failed')!.z03[0], states.find(st => st.status === 'accepted')!.z03[0]]
    // TR-05: a negative APERAK is corrected with a NEW document (BGM) and its own case reference.
    expect(second.document).not.toBe(first.document)
    expect(second.li).not.toBe(first.li)
  }, 20 * 60_000)

  it('I10 Z01 rejections and silence reach the facility request; nothing is left stuck', async () => {
    const requests = dataRequestStates(tenant.companyId)
    report.I10 = requests
    if (!z01Reached) expect.soft(z01Reached, 'no Z01 reached the grid owner (website applications did not get a Z01 sent; see report.cronSlots)').toBe(true)
    else for (const w of WEBSITE.slice(0, 3)) {
      const row = requests.find(r => r.facility === w.gsrn)
      if (!row) { expect.soft(row, `${w.key}: no Z01 for the facility`).toBeTruthy(); continue }
      expect.soft(row.status, `${w.key}: the grid-owner data request ends failed (GOR-01 covers BGM 34)`).toBe('failed')
    }
    const sim = await gridOwner.state()
    for (const w of WEBSITE) expect(sim.received.filter(m => m.code === 'Z01' && m.facility === w.gsrn).length, `${w.key}: Z01 never re-sent`).toBeLessThanOrEqual(1)
    const stuck = detectStuckStates({ graceSeconds: 600, companyIds: [tenant.companyId] })
    report.stuck = stuck
    expect(stuck.filter(row => row.kind === 'stuck')).toEqual([])
  })
})
