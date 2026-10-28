// Reality scenario J1: inbound PRODAT, what the grid owner sends us about switches and facilities.
//
// Production risk: a grid owner's message the platform mishandles. The wrong state, the wrong customer or tenant,
// a file silently dropped, or no CONTRL/APERAK from us within the deadline. Same world as scenarios A, F and I.
// The supplier goes live in ALS (Alingsås). The grid owner is a separate process that only talks e-mail
// (SMTPS/IMAPS): scripts/reality/simulators/gridOwnerInboundProdat.ts. For each received Z03 it answers by the
// facility's plan:
//   positive CONTRL and APERAK (before or after its business files), then
//   Z04 with the requested start, a later or an earlier start, a Z04 without the counter code (field 259),
//   Z04C (the grid owner cancels the start), the identical Z04 again, a re-sent Z04 as a new document, or a Z04
//   for a switch we never requested.
// It also reads our own CONTRL/APERAK on every file it sent, so the supplier's obligations as a receiver are
// checked from the counterparty's side.
//
// The real path for every switch: a signed customer (signature RPCs and power of attorney, as in scenario F and I);
// the tenant operator presses "Skapa switchärende" on /admin/customers/<id>; the platform builds, gates and sends
// the Z03. The grid owner's files arrive by mail and run through the inbound-mail cron, the Ediel outbox cron and
// customer operations on Vercel's cadence. The test never writes market state. A step the world cannot reach is a
// soft check that says exactly why.
//
// Specification: masterplan P-10, P-11, P-14, ACK-01, ACK-02, ACK-07, TR-05, ENV-04
// (docs/ediel/masterplan-v2/registers/rules.json). Defects: J1-01..J1-11 in DEFECTS below. Native proofs are in
// scripts/inbound-prodat-j1-native.test.ts and __tests__/reality-j1-contrl-outcome.test.ts.
// Synthetic data only (E2E-, example.invalid).
import { writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it, type TestContext } from 'vitest'
import { LIVE, augustSupplyCustomer, literal, sql, type AugustSupplyCustomer, type LiveTenant } from '../helpers/live-chain-fixture'
import { gs1 } from '../helpers/live-chain-wire'
import { closeOperatorConsole, operatorSession } from '../helpers/reality/operatorConsole'
import { runOperationalCronSlot, type GridOwnerSim } from '../helpers/reality/world'
import { clockSettings, loopTick } from '../helpers/reality/clock'
import { GRID_AREA, GRID_OWNER_EDIEL_ID, goLiveAlsSupplier } from '../helpers/reality/goLiveAls'
import { detectStuckStates } from '../helpers/reality/stuckDetector'
import { awaitPlatformStartedSwitch } from '../helpers/reality/rejectsWorld'
import { shiftDate, type InboundProdatPlan } from '../helpers/reality/inboundProdatWire'
import { j1States, startInboundProdatGridOwner, unmatchedInboundProdat, type J1FacilityState, type J1GridOwner, type J1SentFile } from '../helpers/reality/inboundProdatWorld'

const report: Record<string, unknown> = { scenario: 'J1 inbound PRODAT from the grid owner', startedAt: new Date().toISOString(), clock: clockSettings() }
const REPORT = process.env.GRIDEX_REALITY_REPORT ?? '/tmp/reality-j1-report.json'
const saveReport = (extra: Record<string, unknown> = {}) => writeFileSync(REPORT, JSON.stringify({ ...report, ...extra }, null, 2))
let tenant: LiveTenant
let defaultGridOwner: GridOwnerSim | undefined
let gridOwner: J1GridOwner
let staff: Awaited<ReturnType<typeof operatorSession>>

/** Defects found while building this scenario (file:line, status). Native/unit proofs named in the header. */
const DEFECTS = [
  { id: 'J1-01', severity: 'high', status: 'fixed (owner decision 35): own hold normal_z04_start_date_conflict (20261028100000), negative APERAK ERC 42 field 210 and one operator case at receipt (lib/ediel/flows/normalZ04HoldResponse.ts, openHeldZ04ReconciliationTask)',
    where: 'SQL gridex_received_sources.normal_switch_confirm_v1 (o->>\'start\'=own->>\'start\'); lib/ediel/flows/inboundProcessing.ts:1315-1371 (held -> no APERAK); lib/inbound-mail/inboundStatusUpdater.ts applySafeInboundStatusUpdate (outbound_requests -> confirmed for any Z04)',
    what: 'A Z04 confirming a later or earlier start than requested is held (normal_z04_exact_sent_original_required). The switch stays prepared, there is no supply period, contract/billing/customer notice never move, and the grid owner gets no APERAK at all. The intake already marked the Z03 request "confirmed", so the 24 h "Z04-svar saknas" watch never fired and the control tower showed "Oklassificerad".' },
  { id: 'J1-02', severity: 'medium', status: 'fixed (owner decision 36): own holds normal_z04_own_z03_missing (42/226), normal_z04_object_not_identified (40/105), normal_z04_actor_not_related (40/107) (20261028101000); operator case at receipt',
    where: 'lib/ediel/flows/inboundProcessing.ts:1315-1371',
    what: 'A Z04 for a switch we never requested is held with no APERAK and no operator task; only a generic pending_review ediel_inbound_case identical to the one every confirmed Z04 opens.' },
  { id: 'J1-03', severity: 'medium', status: 'partly fixed (owner decision 37, ACK-09): case duplicate normal_z04_case_duplicate answered 40/104 (20261028102000); OPEN: 40/103 for an identical re-delivery is still held by the ACK-09 owner (wire shape Z07+LI, ux_ediel_ack_related)',
    where: 'SQL gridex_received_sources.normal_switch_confirm_v1 (status must be pre-accept -> normal_z04_locked_original_scope_required)',
    what: 'A Z04 the grid owner re-sends as a new document (same facts) for an already accepted switch is held and never answered, while a Z04 after a Z04C gets a positive no-effect APERAK. The grid owner keeps waiting for our APERAK.' },
  { id: 'J1-04', severity: 'high', status: 'confirmed (native), fixed in lib/inbound-mail/inboundStatusUpdater.ts updateBusinessStatusFromInbound',
    where: 'lib/inbound-mail/inboundStatusUpdater.ts updateBusinessStatusFromInbound (was :945-951)',
    what: 'The mail intake wrote supplier_switch_requests.status=\'confirmed\' for every matched Z04 before validation; the Z04 trigger normalises it to \'accepted\' once a Z04 is linked. A Z04 after the grid owner\'s Z04C brought the cancelled switch back to accepted with no supply period, and every re-received Z04 stamped completed_at and replaced the switch metadata.' },
  { id: 'J1-05', severity: 'medium', status: 'fixed in lib/ediel/flows/inboundBusinessStateMachineLegacy.ts (FINDINGS J1-05)',
    where: 'lib/ediel/flows/inboundBusinessStateMachineLegacy.ts (supplier_switch_cancelled_before_start: no case, no workflow, no notification)',
    what: 'The grid owner\'s Z04C cancels the confirmed period correctly but opens no operator case and sends no customer notice; the customer already received "switch.confirmed" and the contract stays signed.' },
  { id: 'J1-06', severity: 'low', status: 'confirmed (native), open',
    where: 'lib/ediel/matching.ts findMatchingSupplierSwitchRequest (ignores RFF+LI); lib/ediel/inboundCases.ts createOrUpdateInboundProdatCase',
    what: 'Every applied Z04/Z04C also opens a pending_review ediel_inbound_case "admin-godkännande innan masterdata ändras" and logs "stark switch-koppling saknas"; held Z04s get the identical case, so the review queue cannot tell them apart.' },
  { id: 'J1-07', severity: 'low', status: 'likely (code)',
    where: 'lib/customer-notifications/notificationOrchestrator.ts:166,188; inboundBusinessStateMachineLegacy.ts:395',
    what: 'The switch.confirmed notice carries no switch/contract/site/point; its start_date is the customer\'s newest supply period across all facilities and statuses, so a multi-facility customer can be told another facility\'s (or a cancelled) date.' },
  { id: 'J1-08', severity: 'medium', status: 'likely (code)',
    where: 'SQL ediel_apply_reviewed_structure_objects_v2 (writes only receipts); lib/billing/invoiceReadiness.ts:95-121',
    what: 'A reviewed Z06 never updates grid area, price area or metering method on metering_points/customer_sites; billing keeps the contract\'s locked price area and its conflict check compares against the never-updated masterdata.' },
  { id: 'J1-09', severity: 'low', status: 'likely (code)',
    where: 'SQL gridex_received_sources.gridex_apply_exact_z02_core_before_current_source_v1',
    what: 'A Z02 whose installation address differs from ours is not compared; the site is marked market-verified and ready_for_switch. (Grid area, price area, identity and object conflicts are refused; approved AT-Z02 suites.)' },
  { id: 'J1-10', severity: 'high (owner decision)', status: 'fixed (owner decision 38): no own 259 declares no readings (lib/ediel/core/prodatOwnSourceRegisterReadingDeclarations.ts); bounded handover of the approved AT-Z03L/LK component tests',
    where: 'lib/ediel/core/prodatOwnSourceRegisterReadingDeclarations.ts:177 (L/LK: true or null, never false)',
    what: 'A Z04L without field 259 (counter code) is held: no confirmation and no APERAK. P26.A field 259 says its absence means no meter readings in UTILTS, so 214/218 are not required.' },
  { id: 'J1-11', severity: 'medium', status: 'fixed in lib/inbound-mail/canonicalInboundAckStatusUpdater.ts and inboundStatusUpdater.ts (FINDINGS J1-11)',
    where: 'ACK correlation of an inbound APERAK after our APERAK on the Z04 (related_message_id rewritten)',
    what: 'Z04 before the grid owner\'s ACKs: our positive APERAK on the Z04 was later found with related_message_id pointing at the grid owner\'s inbound APERAK on our Z03 (same tenant). The Z04\'s aperak_due watch reads our answers by related_message_id.' },
  { id: 'J1-12', severity: 'high', status: 'confirmed (unit), fixed in lib/inbound-mail/inboundStatusUpdater.ts isNegativeContrL (J4-D12)',
    where: 'lib/inbound-mail/inboundStatusUpdater.ts isNegativeContrL',
    what: 'The intake read CONTRL action 7 as negative and 4 as positive; Ediel ACK-01 uses 1 (accepted) and 4 (rejected).' },
  { id: 'J1-FP1', severity: 'none', status: 'false positive (native)', where: 'tenant routing + native owner company scope',
    what: 'A Z04 addressed to tenant A naming tenant B\'s pending switch changes neither tenant.' },
  { id: 'J1-FP2', severity: 'none', status: 'false positive for the business effect (native); the missing 40/103 is open under J1-03', where: 'reception owner (protocol duplicate)',
    what: 'An identical Z04 re-delivered never becomes a second Ediel message or effect; it is held for review with its own refusal code (owner decision 37 requires 40/103).' },
  { id: 'J1-FP3', severity: 'none', status: 'false positive (native) for the business state; see J1-11',
    where: 'P-11', what: 'A Z04 before the grid owner\'s CONTRL/APERAK confirms the switch; the late ACKs complete the Z03.' },
]
report.defects = DEFECTS

function personnummer(birth: string, serial: string) {
  const nine = birth.slice(2) + serial
  const sum = [...nine].reduce((total, digit, i) => { const v = Number(digit) * (i % 2 === 0 ? 2 : 1); return total + (v > 9 ? v - 9 : v) }, 0)
  return `${birth}${serial}${(10 - (sum % 10)) % 10}`
}
const RUN = Date.now().toString(36)
const facility = () => gs1(`735999${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`)
const plan = (steps: InboundProdatPlan['steps'], acksFirst = true): InboundProdatPlan => ({ acksFirst, steps })
/** One signed customer and switch per case; the grid owner answers the case's Z03 by its plan. */
const CASES = [
  { key: 'C1-confirmed', first: 'Bekraftad', birth: '19800101', serial: '121', plan: plan(['z04']) },
  { key: 'C2-later-start', first: 'Senare', birth: '19800202', serial: '232', plan: plan(['z04-later']) },
  { key: 'C3-earlier-start', first: 'Tidigare', birth: '19800303', serial: '343', plan: plan(['z04-earlier']) },
  { key: 'C4-duplicate-resend', first: 'Dubblett', birth: '19800404', serial: '454', plan: plan(['z04', 'z04-again', 'z04-resend']) },
  { key: 'C5-z04-before-acks', first: 'Fore', birth: '19800505', serial: '565', plan: plan(['z04'], false) },
  { key: 'C6-cancel-confirmed', first: 'Aterkallad', birth: '19800606', serial: '676', plan: plan(['z04', 'z04c']) },
  { key: 'C7-cancel-then-z04', first: 'Aterupplivad', birth: '19800707', serial: '787', plan: plan(['z04c', 'z04']) },
  { key: 'C8-no-counter-code', first: 'Rakneverk', birth: '19800808', serial: '898', plan: plan(['z04-no-counter']) },
  { key: 'C9-never-requested', first: 'Okand', birth: '19800909', serial: '909', plan: plan(['z04-unknown-switch']) },
  // J1-12 (T31): after the confirmation the grid owner reports a customer/masterdata change and two structure changes.
  { key: 'C10-z06-changes', first: 'Strukturandring', birth: '19801010', serial: '010', plan: plan(['z04', 'z06e', 'z06f', 'z06g']) },
].map(c => ({ ...c, gsrn: facility(), person: { firstName: c.first, lastName: 'E2E-Inkommande', personalNumber: personnummer(c.birth, c.serial),
  email: `e2e-${c.first.toLowerCase()}-${c.serial}-${RUN}@example.invalid`, address: { street: 'Kungsgatan 3', postalCode: '441 30', city: 'Alingsås' } } }))
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
/** Inside the Z03 send window: at least the 14-day market lead (P-03). */
const SUPPLY_START = shiftDate(today, 30)
report.supplyStart = SUPPLY_START

const signed = new Map<string, AugustSupplyCustomer>()
const byKey = (key: string) => CASES.find(c => c.key === key)!
const stateOf = (key: string, states = j1States(tenant.companyId)): J1FacilityState | undefined => states.find(s => s.facility === byKey(key).gsrn)
const filesFor = (key: string, sent: J1SentFile[]) => sent.filter(f => f.facility === byKey(key).gsrn)
const aperaks = (s: J1FacilityState | undefined, index = 0) => s?.inbound[index]?.answers.filter(a => a.family === 'APERAK').map(a => a.outcome) ?? []
let z03Reached = false
function requireZ03(step: string, context: TestContext) {
  if (z03Reached) return
  report[step] = 'skipped: no Z03 reached the grid owner in J1-3 (see report.switchCreation / report.cronSlots for the platform\'s blockers)'
  return context.skip()
}
function requireCase(key: string, state: J1FacilityState | undefined) {
  if (state?.outbound && state.outbound.status !== 'queued' && state.outbound.status !== 'prepared') return true
  expect.soft(state?.outbound?.status ?? 'none', `${key}: no Z03 was sent for this facility (switch ${state?.status ?? 'missing'})`).toBe('sent')
  return false
}

describe.sequential('reality J1 — inbound PRODAT from the grid owner', () => {
  afterAll(async () => {
    defaultGridOwner?.stop()
    gridOwner?.stop()
    await closeOperatorConsole()
    report.finishedAt = new Date().toISOString()
    saveReport()
  })

  it('J1-1 the supplier goes live in ALS; the J1 grid owner takes over the grid owner\'s mailbox', async () => {
    expect(LIVE.cronSecret && LIVE.automationUserId).toBeTruthy()
    const live = await goLiveAlsSupplier(report)
    tenant = live.tenant
    defaultGridOwner = live.gridOwner
    staff = await operatorSession(tenant.operatorEmail, tenant.operatorPassword)
    expect(live.provisioned.readinessBlockers, JSON.stringify(live.provisioned.readinessBlockers)).toEqual([])
    // One counterparty per mailbox: the default simulator would mark our mails read and answer with its own Z04.
    defaultGridOwner.stop()
    gridOwner = await startInboundProdatGridOwner({ edielId: live.gridOwner.edielId, email: live.gridOwner.email })
    await gridOwner.plan(Object.fromEntries(CASES.map(c => [c.gsrn, c.plan])))
    report.plans = Object.fromEntries(CASES.map(c => [c.key, { gsrn: c.gsrn, plan: c.plan }]))
    saveReport()
  })

  it('J1-2 signed customers; the operator creates each switch in the admin UI', async () => {
    const grid = sql<{ id: string; ediel: string }>(`SELECT jsonb_build_object('id',id,'ediel',ediel_id) FROM public.grid_owners WHERE ediel_id=${literal(GRID_OWNER_EDIEL_ID)} AND company_id IS NULL`)
    for (const c of CASES) signed.set(c.key, await augustSupplyCustomer(tenant, { ...c.person, supplyStart: SUPPLY_START, authorizedAt: new Date().toISOString(),
      grid: { gridOwnerId: grid.id, gridOwnerEdielId: grid.ediel, gridAreaCode: GRID_AREA },
      facilities: [{ gsrn: c.gsrn, street: c.person.address.street, postalCode: '441 30', city: 'Alingsås', annualConsumptionKwh: 9_000 }] }))
    // The platform's contract confirmations (archived signed PDF) are delivered by the customer-operations cron.
    const confirmations: unknown[] = []
    for (let slot = 0; slot < 3; slot += 1) confirmations.push((await runOperationalCronSlot()).map(r => ({ path: r.path, status: r.status })))
    report.signedConfirmations = confirmations
    const created: unknown[] = []
    for (const c of CASES) {
      const customer = signed.get(c.key)!
      created.push({ key: c.key, ...await awaitPlatformStartedSwitch({ companyId: tenant.companyId, siteId: customer.facilities[0].siteId }) })
    }
    report.switchCreation = { created, states: j1States(tenant.companyId).map(s => ({ facility: s.facility, status: s.status, outbound: s.outbound })) }
    saveReport()
    expect(j1States(tenant.companyId).length, JSON.stringify(report.switchCreation).slice(0, 2000)).toBeGreaterThanOrEqual(CASES.length)
  }, 30 * 60_000)

  it('J1-3 the world runs on the Vercel cron cadence until every file is answered and our own APERAK deadline has passed', async () => {
    // The grid owner's files arrive within minutes; our APERAK watch for a held Z04 is 30 minutes after its arrival.
    const deadline = Date.now() + Number(process.env.GRIDEX_REALITY_J1_MINUTES ?? 55) * 60_000
    const slots: unknown[] = []
    let quietSince: number | null = null
    for (;;) {
      const ran = await runOperationalCronSlot()
      slots.push({ at: new Date().toISOString(), crons: ran.map(r => ({ path: r.path, status: r.status, ms: r.ms })) })
      const sim = await gridOwner.state()
      saveReport({ cronSlots: slots, states: j1States(tenant.companyId), gridOwner: sim })
      const allSent = sim.pendingSends === 0 && sim.received.filter(m => m.code === 'Z03').length >= CASES.length
      quietSince = allSent ? quietSince ?? Date.now() : null
      if ((quietSince !== null && Date.now() - quietSince > 35 * 60_000) || Date.now() > deadline) break
      // Once every file is sent, only our 30-minute APERAK watch remains: wall clock, polled at the real minute.
      await loopTick(quietSince !== null)
    }
    report.cronSlots = slots
    const sim = await gridOwner.state()
    report.gridOwner = sim
    z03Reached = sim.received.some(m => m.code === 'Z03')
    report.reached = { z03: z03Reached, filesSent: sim.sent.length }
    expect(sim.failures).toEqual([])
    expect(z03Reached, 'no Z03 reached the grid owner; see report.cronSlots and report.switchCreation').toBe(true)
  }, 75 * 60_000)

  it('J1-4 a Z04 with the requested start: confirmed period, our CONTRL+APERAK positive to the grid owner, the customer is told', async context => {
    requireZ03('J1-4', context)
    const s = stateOf('C1-confirmed')
    report.J1_4 = s
    if (!requireCase('C1-confirmed', s)) return
    expect(s!.status).toBe('accepted')
    expect(s!.confirmed).toBe(SUPPLY_START)
    expect(s!.periods).toEqual([{ status: 'confirmed_by_grid_owner', start: SUPPLY_START }])
    expect(s!.notices).toContain('supplier_switch.accepted')
    // The grid owner's view of our answers to its Z04.
    const z04 = filesFor('C1-confirmed', (await gridOwner.state()).sent).filter(f => f.kind === 'z04')
    expect(z04).toHaveLength(1)
    expect.soft(z04[0].answers.map(a => `${a.family}:${a.outcome}`).sort(), 'our CONTRL and APERAK reached the grid owner').toEqual(['APERAK:positive', 'CONTRL:positive'])
  })

  it('J1-5 a Z04 confirming another start than requested (later / earlier) never becomes supply on a wrong date and reaches an operator', async context => {
    requireZ03('J1-5', context)
    const rows = ['C2-later-start', 'C3-earlier-start'].map(key => ({ key, state: stateOf(key) }))
    report.J1_5 = rows
    for (const { key, state } of rows) {
      if (!requireCase(key, state)) continue
      // Never a supply period or a confirmed switch on a date nobody agreed.
      expect(state!.periods.filter(p => p.start !== SUPPLY_START), key).toEqual([])
      // J1-01 (owner decision 35): one operator case for reconciliation, a negative APERAK 42/210, no business effect.
      expect(state!.tasks.filter(t => t === 'ediel_z04_unconfirmed'), `${key}: J1-01 exactly one operator case`).toHaveLength(1)
      expect.soft(aperaks(state), `${key}: J1-01 the grid owner gets a negative APERAK on its Z04`).toEqual(['negative'])
      expect.soft(state!.inbound[0]?.hold ?? null, key).toBe('normal_z04_start_date_conflict')
      expect(state!.periods, key).toEqual([])
    }
  })

  it('J1-6 duplicates: identical bytes are held at intake; a re-sent Z04 (new document) changes nothing and is answered', async context => {
    requireZ03('J1-6', context)
    const s = stateOf('C4-duplicate-resend')
    const files = filesFor('C4-duplicate-resend', (await gridOwner.state()).sent)
    report.J1_6 = { state: s, files }
    if (!requireCase('C4-duplicate-resend', s)) return
    expect(s!.status).toBe('accepted')
    expect(s!.periods).toEqual([{ status: 'confirmed_by_grid_owner', start: SUPPLY_START }])
    // The identical re-delivery never becomes a second Ediel message (reception owner, J1-FP2).
    expect(s!.inbound.filter(m => m.code === 'Z04')).toHaveLength(2)
    // J1-03 (owner decision 37): the re-sent document is a case duplicate, answered 40/104 with no second effect.
    expect.soft(aperaks(s, 1), 'J1-03 the re-sent Z04 gets a negative APERAK (40/104)').toEqual(['negative'])
    expect.soft(s!.inbound[1]?.hold ?? null, 'J1-03 own case-duplicate hold').toBe('normal_z04_case_duplicate')
  })

  it('J1-7 a Z04 before the grid owner\'s CONTRL/APERAK confirms the switch (P-11); our APERAK stays tied to the Z04', async context => {
    requireZ03('J1-7', context)
    const s = stateOf('C5-z04-before-acks')
    report.J1_7 = s
    if (!requireCase('C5-z04-before-acks', s)) return
    expect(s!.status).toBe('accepted')
    expect(s!.periods.map(p => p.status)).toEqual(['confirmed_by_grid_owner'])
    expect.soft(aperaks(s), 'J1-11 our APERAK on the Z04 is still related to it').toEqual(['positive'])
  })

  it('J1-8 grid-owner cancellation (Z04C): the start is withdrawn, a later Z04 never revives it, people are told', async context => {
    requireZ03('J1-8', context)
    const cancelled = stateOf('C6-cancel-confirmed'), revived = stateOf('C7-cancel-then-z04')
    report.J1_8 = { cancelled, revived }
    if (requireCase('C6-cancel-confirmed', cancelled)) {
      expect(cancelled!.status).toBe('cancelled_before_start')
      expect(cancelled!.periods).toEqual([{ status: 'cancelled', start: SUPPLY_START }])
      // J1-05 (fixed): an operator case and a customer notice follow the cancellation.
      expect.soft(cancelled!.cases.length, 'J1-05 an operator case for the withdrawn start').toBeGreaterThan(0)
      expect.soft(cancelled!.notices.filter(n => n !== 'supplier_switch.accepted').length, 'J1-05 the customer is told the start is withdrawn').toBeGreaterThan(0)
    }
    if (requireCase('C7-cancel-then-z04', revived)) {
      // J1-04 (fixed): the late Z04 never brings the cancelled switch back.
      expect(revived!.status).toBe('cancelled_before_start')
      expect(revived!.periods).toEqual([])
    }
  })

  it('J1-9 a Z04L without the counter code (field 259) declares no readings and confirms the switch (J1-10, owner decision 38)', async context => {
    requireZ03('J1-9', context)
    const s = stateOf('C8-no-counter-code')
    report.J1_9 = s
    if (!requireCase('C8-no-counter-code', s)) return
    expect(s!.status, 'J1-10 a Z04 that declares no meter readings confirms the switch').toBe('accepted')
    expect(s!.periods).toEqual([{ status: 'confirmed_by_grid_owner', start: SUPPLY_START }])
    expect.soft(aperaks(s), 'J1-10 our APERAK is positive').toEqual(['positive'])
  })

  it('J1-10 a Z04 for a switch we never requested changes nothing and is answered', async context => {
    requireZ03('J1-10', context)
    const s = stateOf('C9-never-requested')
    const file = filesFor('C9-never-requested', (await gridOwner.state()).sent).find(f => f.kind === 'z04-unknown-switch')
    const received = file ? unmatchedInboundProdat(tenant.companyId, file.object) : []
    report.J1_10 = { state: s, file, received }
    if (!file) return expect.soft(file, 'C9: the grid owner never sent its unknown-switch Z04 (no Z03 for C9)').toBeTruthy()
    // The real switch of the customer is untouched.
    expect(s?.periods ?? []).toEqual([])
    expect(s?.z04Linked ?? false).toBe(false)
    expect(received, 'the unknown Z04 is retained for the tenant').toHaveLength(1)
    expect.soft(received[0]?.answers.filter(a => a.family === 'APERAK').map(a => a.outcome), 'J1-02 the grid owner gets a negative APERAK (42/226)').toEqual(['negative'])
  })

  it('J1-11 our obligations as receiver: a CONTRL on every interchange the grid owner sent, an APERAK on every business file', async context => {
    requireZ03('J1-11', context)
    const sent = (await gridOwner.state()).sent
    const business = sent.filter(f => !['CONTRL', 'APERAK'].includes(f.kind))
    const matrix = business.map(f => ({ kind: f.kind, facility: f.facility, contrl: f.answers.filter(a => a.family === 'CONTRL').map(a => a.outcome),
      aperak: f.answers.filter(a => a.family === 'APERAK').map(a => a.outcome) }))
    report.J1_11 = matrix
    // ACK-01: a positive CONTRL on every syntactically valid interchange (the identical re-delivery is the reception
    // owner's held duplicate, J1-FP2) and never a CONTRL on the grid owner's own CONTRL. An APERAK requests a CONTRL
    // (UNB/0031 = 1, SC-041), so it gets one; only a CONTRL is never acknowledged (no acknowledgement loop, FINDINGS T40).
    for (const row of matrix.filter(r => r.kind !== 'z04-again')) expect.soft(row.contrl, `${row.kind} ${row.facility}: our CONTRL`).toEqual(['positive'])
    for (const ack of sent.filter(f => f.kind === 'CONTRL')) expect(ack.answers.filter(a => a.family === 'CONTRL'), 'no CONTRL on a CONTRL').toEqual([])
    for (const ack of sent.filter(f => f.kind.startsWith('APERAK') && f.kind !== 'APERAK (duplicate)')) expect.soft(ack.answers.filter(a => a.family === 'CONTRL').map(a => a.outcome), 'our CONTRL on the APERAK').toEqual(['positive'])
    // ACK-02: exactly one APERAK per business file (J1-01/02/03/10 fixed, owner decisions 35-38).
    for (const row of matrix.filter(r => r.kind !== 'z04-again')) expect.soft(row.aperak, `${row.kind} ${row.facility}: our APERAK`).toHaveLength(1)
  })

  it('J1-12 Z02 and Z06 from the grid owner; nothing is left stuck', async context => {
    requireZ03('J1-12', context)
    // Z06 (T31): C10's grid owner sends Z06 E (E34), F (E64) and G (E32) after its Z04, built from our Z03
    // (scripts/helpers/reality/inboundProdatWire.ts z06For). Each is stored as the tenant's inbound PRODAT with its own
    // reason and answered like every business file: a positive CONTRL and exactly one APERAK.
    const sim = await gridOwner.state()
    const z06Files = filesFor('C10-z06-changes', sim.sent).filter(f => f.kind.startsWith('z06'))
    const stored = (stateOf('C10-z06-changes')?.inbound ?? []).filter(m => m.code === 'Z06')
    report.J1_12 = { z06Files: z06Files.map(f => ({ kind: f.kind, document: f.document, answers: f.answers })), z06Stored: stored,
      z01Received: sim.received.filter(m => m.code === 'Z01').length, z02Sent: sim.sent.filter(f => f.kind === 'z02').map(f => ({ facility: f.facility, answers: f.answers })) }
    expect(z06Files.map(f => f.kind), 'the grid owner sent Z06 E, F and G').toEqual(['z06e', 'z06f', 'z06g'])
    expect(stored.map(m => m.reason).sort(), 'every Z06 is stored for the tenant with its reason').toEqual(['E32', 'E34', 'E64'])
    for (const file of z06Files) {
      expect.soft(file.answers.filter(a => a.family === 'CONTRL').map(a => a.outcome), `${file.kind}: our CONTRL`).toEqual(['positive'])
      expect.soft(file.answers.filter(a => a.family === 'APERAK'), `${file.kind}: exactly one APERAK`).toHaveLength(1)
    }
    // Z02 (T31): the simulator answers every Z01 it receives with CONTRL, APERAK and a Z02 (z02For). Scenario J1 itself
    // sends only Z03; the Z01 path is scenario I's (website customers). Any Z01 that does reach this grid owner must
    // get its Z02 answered with a positive CONTRL and one APERAK.
    for (const file of sim.sent.filter(f => f.kind === 'z02')) {
      expect.soft(file.answers.filter(a => a.family === 'CONTRL').map(a => a.outcome), `z02 ${file.facility}: our CONTRL`).toEqual(['positive'])
      expect.soft(file.answers.filter(a => a.family === 'APERAK'), `z02 ${file.facility}: exactly one APERAK`).toHaveLength(1)
    }
    expect(sim.failures.filter(f => /Z0[16]|z0[26]/.test(f.error)), 'no Z02/Z06 build failure in the grid owner').toEqual([])
    const stuck = detectStuckStates({ graceSeconds: 600, companyIds: [tenant.companyId] })
    report.stuck = stuck
    expect(stuck.filter(row => row.kind === 'stuck')).toEqual([])
  })
})
