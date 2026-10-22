// Reality scenario H: the customer leaves.
//
// Same world as scenarios A and F: the supplier goes live in ALS, the grid owner is simulated over SMTPS/IMAPS.
// Three August customers (signed in August, switched in through the real Z03 builder, supplied from
// 1 September on the grid owner's Z04) then leave or stay:
//   S  switches away: another supplier takes over on 1 November; the grid owner sends us PRODAT Z05 L.
//   M  moves out: a new customer moves in with another supplier; the grid owner sends us PRODAT Z05 LK.
//   K  stays (control).
// Then two customers whose switch is still pending:
//   W  uses the right of withdrawal (ångerrätt, 14 days) through the staff console.
//   C  is cancelled by the supplier (Z03C); the grid owner confirms with Z04C.
// Every market fact arrives as a real inbound message and is processed by the real crons. Nothing the grid
// owner would send is written to the database. Steps a run cannot reach are soft checks that say why.
// Synthetic data only (E2E-, example.invalid). The defects found while building it are in DEFECTS below.
import { writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it, type TestContext } from 'vitest'
import { prepareAndQueueEdielZ03 } from '@/lib/ediel/flows/prodatSwitch'
import { prepareAndQueueSwitchCancellation } from '@/lib/ediel/flows/prodatSwitchCancellation'
import { deriveRequestedMethodBeforeSwitch } from '@/lib/operations/switchRequestedMethodPreparation'
import { processPendingContractConfirmations } from '@/lib/customer-contracts/onlineSigning'
import { customerNormalizedMeteringValues } from '@/lib/metering/customerMeteringAccess'
import { LIVE, augustSupplyCustomer, cron, literal, sql, type AugustFacility, type LiveTenant } from '../helpers/live-chain-fixture'
import { closeOperatorConsole, operatorSession, submitServerAction } from '../helpers/reality/operatorConsole'
import { runOperationalCronSlot, type GridOwnerSim } from '../helpers/reality/world'
import { GRID_AREA, GRID_OWNER_EDIEL_ID, goLiveAlsSupplier } from '../helpers/reality/goLiveAls'
import { detectStuckStates } from '../helpers/reality/stuckDetector'
import { registerUtiltsIssuer } from '../helpers/utiltsConsumptionParties'
import { dayProfile, gs1 } from '../helpers/live-chain-wire'
import { billingMonth, createSignedContractSwitch, gatedValues, inboundSources, leavingFollowup, outboundFor, reprocessHeldUtilts, sourceDiagnosis, supplyState } from '../helpers/reality/leaving'
import { buildZ04CancellationFor, buildZ05End, gridOwnerSendsLeavingFile, readLeavingWire } from './simulators/gridOwnerLeaving'

type Row = Record<string, unknown>
const report: Record<string, unknown> = { scenario: 'H the customer leaves', startedAt: new Date().toISOString() }
const REPORT = process.env.GRIDEX_REALITY_REPORT ?? '/tmp/reality-h-report.json'
const saveReport = (extra: Record<string, unknown> = {}) => writeFileSync(REPORT, JSON.stringify({ ...report, ...extra }, null, 2))
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
let tenant: LiveTenant
let gridOwner: GridOwnerSim

const TERMS = { bindingMonths: 12, noticeMonths: 1, renewalMonths: 12 }
const SUPPLY_START = '2026-09-01'
const AUGUST_SIGNED_AT = '2026-08-12T09:30:00+02:00'
const AUGUST_SWITCH_CREATED_AT = '2026-08-12T09:31:00+02:00'
/** Ediel minutes are fixed normal time (+01:00, ENV-08). */
const cetDate = (instant: Date) => new Date(instant.getTime() + 3_600_000).toISOString().slice(0, 10)
const TODAY = cetDate(new Date())
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
/** S: the new supplier starts 1 November 00:00 (the first day no longer ours). */
const S_END = '202611010000'
/** M: the new occupant moved in yesterday 00:00, so the end already lies in the past. */
const M_END_DATE = addDays(TODAY, -1)
const M_END = `${M_END_DATE.replaceAll('-', '')}0000`
/** The last three complete days the grid owner meters for every facility. */
const DAYS = [addDays(TODAY, -3), addDays(TODAY, -2), addDays(TODAY, -1)]
/** W and C: signed today for supply in a month (the switch is still pending). */
const PENDING_START = addDays(TODAY, 30)
report.timeline = { TODAY, S_END, M_END, DAYS, PENDING_START }

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
const person = (first: string, birth: string, serial: string): Party => ({ firstName: first, lastName: 'E2E-Avslut', personalNumber: personnummer(birth, serial),
  email: `e2e-${first.toLowerCase()}-${serial}-${RUN}@example.invalid`, address, gsrn: facility() })
const S = person('Bytare', '19700202', '311'), M = person('Flyttare', '19750505', '422'), K = person('Kvar', '19800808', '533')
const W = person('Angrare', '19850303', '644'), C = person('Annullerad', '19900404', '755')
const LEAVING: Party[] = [S, M, K]

/** Inconsistencies and defects found while building this scenario (FINDINGS H1–H9; tests named in each). */
const DEFECTS = [
  { id: 'H1', status: 'confirmed (native) + fixed', severity: 'high', where: 'lib/billing/underlayEngine.ts segmentBounds, lib/billing/billingGate.ts covers, lib/billing/meterValueBillingMatcher.ts (fix: lib/billing/supplyPeriodEnd.ts)',
    what: 'A Z05 writes end_date = the first day no longer supplied (permission_date_v1 of DTM+93, plus market_end_at); billing read every end_date as the last supplied day. The month after a switch away got a 1-day segment for the customer who left (blocked underlay, estimate or a Z13 history request for a facility we no longer supply), and a same-point move-in was blocked as overlapping periods.',
    proof: 'scripts/customer-leaves-native.test.ts, scripts/customer-leaves-z05-native.test.ts (control), __tests__/customer-leaves-billing.test.ts' },
  { id: 'H2', status: 'confirmed (unit, native) + fixed (20261022150000, billing status lists, monthly re-gating)', severity: 'high', where: 'lib/billing/meterValueBillingMatcher.ts:126 and underlayEngine.ts loadSupplyPeriods (status list), billingGate.ts ACTIVE_SUPPLY_STATES, billingReadiness.ts BILLABLE_SUPPLY_PERIOD_STATUSES, DB gridex_set_metering_billing_gate',
    what: "A Z05 for a future end makes the period 'ending' until the end. Billing does not know 'ending': every value of the last weeks is gated supply_period_missing once at reception (never re-evaluated), a re-run of the previous month drops the customer, and readiness says delivery_not_started." },
  { id: 'H3', status: 'confirmed (unit + DB code) + fixed (20261022150000, gate/readiness accept the supply-end termination)', severity: 'high', where: 'gridex_supply_end_followup_v1 (terminates at once, also on ending), billingGate.ts ACTIVE_CONTRACT_STATES, billingReadiness.ts BILLABLE_CONTRACT_STATUSES, DB gridex_set_metering_billing_gate (sp.status active|confirmed, ct.status signed|active)',
    what: "The contract is terminated when the Z05 arrives; the TS gate then says contract_not_active for the remaining supply days and readiness says contract_not_approved, so the final invoice is never prepared. A value the TS gate accepts on an 'ended' period is refused by the DB gate (billing_gate_supply_contract_scope_mismatch), which meterValueBillingMatcher rethrows: the UTILTS file fails." },
  { id: 'H4', status: 'confirmed (unit) + fixed', severity: 'medium', where: 'lib/billing/billingGate.ts instant(endOfDate) = next midnight - 1 ms',
    what: 'The last quarter-hour of the last supplied day ends exactly at the next local midnight and was never covered: every ended period lost its last quarter (supply_period_does_not_cover_value).' },
  { id: 'H5', status: 'confirmed (native)', severity: 'high', where: 'gridex_onboard_customer_graph_core (metering_point_owned_by_another_customer), unique (company_id, metering_point_id) on metering_points',
    what: 'A new occupant can never become a customer of the same tenant at a facility whose previous occupant was our customer, even after that supply ended: no path re-assigns the metering point.' },
  { id: 'H6', status: 'confirmed (code)', severity: 'medium', where: 'gridex_supply_end_followup_v1',
    what: 'A break-fee review task is created for every end inside the binding period, also for a move-out (Z05 LK), although the platform\'s own manual end (gridex_end_customer_supply_v1) says moving out carries no break fee. The binding end is computed from contracts.starts_at (requested start), not the confirmed market start.' },
  { id: 'H7', status: 'confirmed (native) + fixed (20261022140000)', severity: 'critical', where: 'gridex_supply_rescission.apply_supply_before_rescission_v1 → gridex_bilateral_prodat.matched_closure_operation_v1',
    what: "Every Z05 with an LK object (CAV Z23) is routed to the bilateral closure owner, which requires our own sent Z08 LK; an ordinary move-out notice from the grid owner raises bilateral_closure_exact_sent_original_required, is rolled back and held. The period never ends, the contract stays signed, no final-invoice task, no APERAK to the grid owner; billing continues after the move-out." },
  { id: 'H8', status: 'confirmed (code)', severity: 'low', where: 'gridex_supply_end_followup_v1 description, customer_operation_tasks final_invoice_pending',
    what: "The final-invoice task says 'fakturera perioden till och med <end_date>' where end_date of a Z05 is the first day of the new supplier." },
  { id: 'H9', status: 'likely (code)', severity: 'low', where: 'supabase/migrations/20261022100000_customer_metering_access_windows.sql (market_start_at/market_end_at), lib/billing/underlayEngine.ts (local days)',
    what: 'In summer the Ediel instant 00:00 +01:00 is 01:00 CEST: Mina sidor opens/closes the window one hour after the civil midnight that billing uses, so the new customer does not see the first billed hour and the old one still sees it.' },
]
report.defects = DEFECTS

let established = false
function requireEstablished(step: string, context: TestContext) {
  if (established) return
  report[step] = 'skipped: S, M and K were not supplied on the grid owner\'s Z04 in H3'
  return context.skip()
}
const companyLiteral = () => literal(tenant.companyId)
const brpEdielId = () => sql<string>(`SELECT to_jsonb(brp_ediel_id) FROM public.ediel_brp_settings WHERE company_id=${companyLiteral()} AND environment='production' AND is_active ORDER BY valid_from DESC LIMIT 1`)
/** Like Vercel: inbound mail, then the Ediel outbox, then customer operations (deadline sweep), once a minute. */
async function receiveUntil(done: () => boolean, minutes: number) {
  const runs: unknown[] = []
  const deadline = Date.now() + minutes * 60_000
  for (;;) {
    const inbound = await cron('/api/internal/inbound-mail/cron?environment=test')
    const outbox = await cron('/api/ediel/outbox/process')
    const operations = await cron('/api/internal/customer-operations/cron')
    runs.push({ at: new Date().toISOString(), inbound: inbound.status, outbox: outbox.status, operations: operations.status })
    if (done() || Date.now() > deadline) break
    await pause(60_000)
  }
  return runs
}
async function establishCustomers(parties: Party[], supplyStart: string, signedAt: string, switchCreatedAt: string) {
  const grid = sql<{ id: string; ediel: string }>(`SELECT jsonb_build_object('id',id,'ediel',ediel_id) FROM public.grid_owners WHERE ediel_id=${literal(GRID_OWNER_EDIEL_ID)} AND company_id IS NULL`)
  for (const p of parties) {
    const one = await augustSupplyCustomer(tenant, { firstName: p.firstName, lastName: p.lastName, personalNumber: p.personalNumber, email: p.email, address: p.address,
      supplyStart, authorizedAt: signedAt, grid: { gridOwnerId: grid.id, gridOwnerEdielId: grid.ediel, gridAreaCode: GRID_AREA },
      facilities: [{ gsrn: p.gsrn, ...p.address, annualConsumptionKwh: 6_000 }] })
    p.customerId = one.customerId
    p.facility = one.facilities[0]
  }
  const readiness = () => sql<Array<{ facility: string; ready: boolean }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('facility',mp.metering_point_id,'ready',r.switch_ready,'blockers',r.blockers)),'[]')
    FROM public.customer_contract_lifecycle_readiness_v r JOIN public.metering_points mp ON mp.id=r.metering_point_id
    WHERE r.company_id=${companyLiteral()} AND mp.metering_point_id=ANY(${literal(`{${parties.map(p => p.gsrn).join(',')}}`)}::text[])`)
  for (let attempt = 0; attempt < 3 && !readiness().every(row => row.ready); attempt += 1) await processPendingContractConfirmations(50)
  const ready = readiness()
  expect(ready.filter(row => !row.ready), 'every contract is switch-ready (signed, PDF archived, power of attorney)').toEqual([])
  const built: Row[] = []
  for (const p of parties) {
    const created = await createSignedContractSwitch(tenant, { customerId: p.customerId!, facility: p.facility!, supplyStart, createdAt: switchCreatedAt })
    p.switchId = created.switchId
    try {
      // As automation does right before the builder (edielAutomation.ts:286), then the real Z03 builder.
      await deriveRequestedMethodBeforeSwitch({ actorUserId: LIVE.automationUserId, switchRequestId: created.switchId })
      const message = await prepareAndQueueEdielZ03({ actorUserId: LIVE.automationUserId, switchRequestId: created.switchId, environment: 'production' })
      built.push({ who: p.firstName, ok: true, message: message.id, start: created.start, window: created.window })
    } catch (error) { built.push({ who: p.firstName, ok: false, error: error instanceof Error ? error.message : String(error) }) }
  }
  return built
}
const periodOf = (p: Party) => supplyState(tenant.companyId, [p.gsrn])[0]
const latestPeriod = (p: Party) => { const periods = periodOf(p)?.periods ?? []; return periods[periods.length - 1] ?? null }

describe.sequential('reality H — the customer leaves', () => {
  afterAll(async () => {
    gridOwner?.stop()
    await closeOperatorConsole()
    report.finishedAt = new Date().toISOString()
    saveReport()
  })

  it('H1 the supplier goes live with a 12-month binding offer', async () => {
    expect(LIVE.cronSecret && LIVE.automationUserId).toBeTruthy()
    const live = await goLiveAlsSupplier(report, { terms: TERMS, brpValidFrom: '2026-08-01' })
    ;({ tenant, gridOwner } = live)
    expect(live.provisioned.readinessBlockers, JSON.stringify(live.provisioned.readinessBlockers)).toEqual([])
  })

  it('H2 three August customers sign and switch in for 1 September through the real Z03 builder', async () => {
    const built = await establishCustomers(LEAVING, SUPPLY_START, AUGUST_SIGNED_AT, AUGUST_SWITCH_CREATED_AT)
    report.augustZ03 = built
    expect(built.filter(b => !b.ok), 'the real Z03 builder refused a switch').toEqual([])
  }, 15 * 60_000)

  it('H3 the world runs on cron cadence until the grid owner\'s Z04 makes S, M and K supplied from 1 September', async () => {
    await gridOwner.profile({ contrlDelayMs: 20_000, aperakDelayMs: 40_000, z04DelayMs: 90_000 })
    const deadline = Date.now() + Number(process.env.GRIDEX_REALITY_H3_MINUTES ?? 30) * 60_000
    const slots: unknown[] = []
    let state = supplyState(tenant.companyId, LEAVING.map(p => p.gsrn))
    for (;;) {
      const ran = await runOperationalCronSlot()
      slots.push({ at: new Date().toISOString(), crons: ran.map(r => ({ path: r.path, status: r.status })) })
      state = supplyState(tenant.companyId, LEAVING.map(p => p.gsrn))
      saveReport({ worldSlots: slots, supply: state })
      if (state.every(row => row.periods.some(p => p.status === 'active')) || state.some(row => row.switch === 'failed') || Date.now() > deadline) break
      await pause(60_000)
    }
    report.supplyAfterZ04 = state
    established = state.length === LEAVING.length && state.every(row => row.periods.some(p => p.status === 'active' && p.start === SUPPLY_START))
    expect(established, JSON.stringify(state)).toBe(true)
  }, 40 * 60_000)

  it('H4 the grid owner ends supply: Z05 L for S (switch away 1 November), Z05 LK for M (moved out yesterday)', async (context) => {
    requireEstablished('H4', context)
    const ourZ03 = sql<string>(`SELECT to_jsonb(raw_payload) FROM public.ediel_messages WHERE id=(SELECT outbound_z03_message_id FROM public.supplier_switch_requests WHERE id=${literal(S.switchId!)})`)
    const qualifier = /UNB\+UNOC:3\+[^:+]+:([^+:']+)/.exec(ourZ03)?.[1] ?? '14'
    const common = { gridOwner: GRID_OWNER_EDIEL_ID, supplier: tenant.supplierEdielId, gridArea: GRID_AREA, brp: brpEdielId(), qualifier }
    const sent: Row[] = []
    for (const [p, endMinute, variant] of [[S, S_END, 'L'], [M, M_END, 'LK']] as const) {
      const z05 = buildZ05End({ ...common, point: p.gsrn, customerIdentity: p.personalNumber, customerName: `${p.firstName} ${p.lastName}`, endMinute, variant })
      await gridOwnerSendsLeavingFile({ from: gridOwner.email, kind: `PRODAT-Z05${variant}`, edifact: z05.raw, reference: z05.reference })
      sent.push({ who: p.firstName, reference: z05.reference, ...readLeavingWire(z05.raw) })
    }
    report.z05Sent = sent
    const z05s = () => inboundSources(tenant.companyId, ['Z05'])
    report.z05Reception = await receiveUntil(() => z05s().length >= 2 && z05s().every(m => !['received', 'processing'].includes(m.status)), Number(process.env.GRIDEX_REALITY_H4_MINUTES ?? 10))
    // A few more slots for the deadline sweep and the follow-up projections.
    for (let i = 0; i < 2; i += 1) await runOperationalCronSlot()
    const received = z05s()
    report.z05Received = received.map(m => ({ ...m, diagnosis: sourceDiagnosis(m.id) }))
    const sEnd = sql<string>(`SELECT to_jsonb(gridex_received_sources.permission_time_v1(${literal(S_END)}))`)
    const sPeriod = latestPeriod(S), mPeriod = latestPeriod(M)
    report.afterZ05 = { S: { period: sPeriod, followup: leavingFollowup(tenant.companyId, S.customerId!) }, M: { period: mPeriod, followup: leavingFollowup(tenant.companyId, M.customerId!) },
      K: { period: latestPeriod(K) } }
    saveReport()
    expect(received, 'both Z05 reached the tenant').toHaveLength(2)
    // S: the end is recorded on the grid owner's instant; supply continues until then ('ending').
    expect(sPeriod, JSON.stringify(report.afterZ05)).toMatchObject({ status: 'ending', end: '2026-11-01', start: SUPPLY_START })
    expect(Date.parse(String(sPeriod?.marketEnd))).toBe(Date.parse(sEnd))
    const sFollowup = leavingFollowup(tenant.companyId, S.customerId!) as { contracts: Row[]; tasks: Row[]; customer: Row }
    expect.soft(sFollowup.tasks.map(t => t.type), 'S: final invoice task').toContain('final_invoice_pending')
    expect.soft(sFollowup.tasks.map(t => t.type), 'S: break fee review (12-month binding, left after 2 months)').toContain('break_fee_review')
    expect.soft(sFollowup.contracts.map(c => c.status), 'S: contract ends with the supply (H3: today it is terminated when the Z05 arrives)').toEqual(['terminated'])
    // M: the move-out notice (H7: held as a bilateral closure without our own Z08 LK).
    expect(mPeriod, `H7 the move-out Z05 LK ends M's period: ${JSON.stringify(report.z05Received)}`).toMatchObject({ status: 'ended', end: M_END_DATE })
    const mFollowup = leavingFollowup(tenant.companyId, M.customerId!) as { tasks: Row[] }
    expect.soft(mFollowup.tasks.map(t => t.type), 'H6 no break-fee review for a move-out').not.toContain('break_fee_review')
    expect(latestPeriod(K)).toMatchObject({ status: 'active', end: null })
  }, 20 * 60_000)

  it('H5 the grid owner meters the last three days; the values land on the right customer and gate', async (context) => {
    requireEstablished('H5', context)
    registerUtiltsIssuer(sql as never, literal, GRID_OWNER_EDIEL_ID, tenant.adminUserId)
    const files = LEAVING.flatMap((p, c) => DAYS.map((day, i) => ({ meterId: p.gsrn, day, values: dayProfile(i + c * 3) })))
    const response = await fetch(`${gridOwner.url}/__sim/send-e66-batch`, { method: 'POST', body: JSON.stringify({ receiver: tenant.supplierEdielId, files }) })
    expect(response.ok).toBe(true)
    const e66 = () => inboundSources(tenant.companyId, ['E66'])
    report.e66Reception = await receiveUntil(() => e66().length >= files.length, Number(process.env.GRIDEX_REALITY_H5_MINUTES ?? 15))
    report.reprocess = await reprocessHeldUtilts(tenant, e66().map(m => m.id))
    const gates = Object.fromEntries(LEAVING.map(p => [p.firstName, gatedValues(p.facility!.meteringPointId)]))
    report.gates = gates
    saveReport()
    const day = (who: Party, date: string) => ((gates[who.firstName] as { days: Record<string, Row> }).days[date] ?? null) as Row | null
    for (const date of DAYS) {
      // Control: an ordinary supplied day is billable.
      expect.soft(day(K, date)?.gate, `K ${date}`).toEqual(['eligible'])
      // H2/H3: S is still supplied until 1 November.
      expect.soft(day(S, date)?.gate, `H2/H3 S ${date} (period 'ending', contract terminated): ${JSON.stringify(day(S, date))}`).toEqual(['eligible'])
      // Every value belongs to its own customer, never to another one.
      for (const p of LEAVING) if (day(p, date)) expect(day(p, date)!.customers, `${p.firstName} ${date}`).toEqual([p.customerId])
    }
    // M moved out yesterday: yesterday's values are not M's supply, the earlier ones are.
    // H7: if the move-out Z05 LK was held, M's period is still open and this day is billed to M after it moved out.
    expect.soft(day(M, M_END_DATE)?.gate ?? ['none'], `H7 M ${M_END_DATE} after the move-out: ${JSON.stringify(day(M, M_END_DATE))}`).not.toContain('eligible')
    expect.soft(day(M, DAYS[0])?.gate, `H3 M ${DAYS[0]} before the move-out`).toEqual(['eligible'])
  }, 60 * 60_000)

  it('H6 the monthly billing cron, run twice per month, bills nothing after an end and never twice', async (context) => {
    requireEstablished('H6', context)
    const months = [{ key: TODAY.slice(0, 7), year: Number(TODAY.slice(0, 4)), month: Number(TODAY.slice(5, 7)) }]
    const next = new Date(Date.UTC(months[0].year, months[0].month, 1))
    months.push({ key: next.toISOString().slice(0, 7), year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 })
    const runs: Row = {}
    for (const m of months) {
      const first = await cron(`/api/cron/billing/monthly?company_id=${tenant.companyId}&billing_month=${m.key}`)
      const after1 = billingMonth(tenant.companyId, m.year, m.month)
      const second = await cron(`/api/cron/billing/monthly?company_id=${tenant.companyId}&billing_month=${m.key}`)
      const after2 = billingMonth(tenant.companyId, m.year, m.month)
      runs[m.key] = { first: first.status, second: second.status, after1, after2 }
      expect(first.status, JSON.stringify(first.body).slice(0, 1000)).toBe(200)
      expect(second.status).toBe(200)
      // Idempotent: a repeated run prepares nothing new.
      expect(after2.underlays.map(u => u.id).sort()).toEqual(after1.underlays.map(u => u.id).sort())
      expect(after2.invoices.map(i => i.id).sort()).toEqual(after1.invoices.map(i => i.id).sort())
    }
    report.billing = runs
    saveReport()
    const current = (runs[months[0].key] as { after2: { underlays: Row[]; invoices: Row[] } }).after2
    const following = (runs[months[1].key] as { after2: { underlays: Row[]; invoices: Row[] } }).after2
    const forCustomer = (rows: Row[], p: Party) => rows.filter(row => row.customer === p.customerId)
    // Nothing is billed for S or M in the month after this one (S leaves 1 November, M left yesterday).
    expect(forCustomer(following.invoices, S).concat(forCustomer(following.invoices, M)), 'no invoice after the end').toEqual([])
    expect.soft(forCustomer(following.underlays, M), 'H1/H7 no underlay for M after the move-out').toEqual([])
    expect.soft(forCustomer(following.underlays, S), 'H1 no underlay for S in the month after the switch').toEqual([])
    // An underlay of the current month never runs past the customer's end.
    const mEndBoundary = sql<string>(`SELECT to_jsonb(${literal(M_END_DATE)}::timestamp AT TIME ZONE 'Europe/Stockholm')`)
    for (const u of forCustomer(current.underlays, M)) expect(Date.parse(String(u.end)), `M underlay ${JSON.stringify(u)}`).toBeLessThanOrEqual(Date.parse(mEndBoundary))
    expect.soft(forCustomer(current.underlays, S), `H2 S is still supplied in ${months[0].key}`).toHaveLength(1)
    // No Z13 history request was sent for a customer who left.
    report.outboundAfterBilling = { S: outboundFor(tenant.companyId, S.facility!.meteringPointId), M: outboundFor(tenant.companyId, M.facility!.meteringPointId) }
    for (const p of [S, M]) expect.soft((report.outboundAfterBilling as Record<string, Row[]>)[p.firstName].filter(m => m.code === 'Z13'), `${p.firstName}: no history request`).toEqual([])
  }, 30 * 60_000)

  it('H7 Mina sidor: each customer sees only its own supply period and keeps that history after it ends', async (context) => {
    requireEstablished('H7', context)
    const seen = async (p: Party) => {
      const { data, error } = await customerNormalizedMeteringValues({ companyId: tenant.companyId, customerIds: [p.customerId!] }).select('period_start,period_end,customer_id,metering_point_id')
      if (error) throw error
      return (data ?? []) as Array<{ period_start: string; period_end: string; customer_id: string; metering_point_id: string }>
    }
    const access: Row = {}
    for (const p of LEAVING) {
      const rows = await seen(p), period = latestPeriod(p)
      access[p.firstName] = { visible: rows.length, first: rows[rows.length - 1]?.period_start ?? null, last: rows[0]?.period_start ?? null, window: period }
      expect(rows.every(r => r.customer_id === p.customerId && r.metering_point_id === p.facility!.meteringPointId), `${p.firstName} sees only its own values`).toBe(true)
      if (period?.marketEnd) expect(rows.filter(r => Date.parse(r.period_end) > Date.parse(String(period.marketEnd))), `${p.firstName} sees nothing after its end`).toEqual([])
    }
    report.access = access
    // History is kept after the end: S (ending) and M (if its end applied) still see their own last days.
    expect.soft((access.S as Row).visible, 'S keeps its own history').toBeGreaterThan(0)
  })

  it('H8 a pending switch: W withdraws (ångerrätt) and C is cancelled by the supplier (Z03C → Z04C)', async (context) => {
    requireEstablished('H8', context)
    // The grid owner must not confirm before the withdrawal/cancellation: hold its Z04 (the simulator answers
    // every Z03 with an L confirmation, also a Z03C; see the proposed gridOwner.ts patch in the report).
    await gridOwner.profile({ z04DelayMs: 24 * 3_600_000 })
    const now = new Date().toISOString()
    report.pendingZ03 = await establishCustomers([W, C], PENDING_START, now, now)
    report.pendingSend = await receiveUntil(() => [W, C].every(p => sql<boolean>(`SELECT EXISTS(SELECT FROM public.ediel_messages WHERE id=(SELECT outbound_z03_message_id FROM public.supplier_switch_requests WHERE id=${literal(p.switchId!)}) AND status IN ('sent','acknowledged','delivered'))`)), 10)

    // W: the customer withdraws by phone; staff register it on the customer card (Ånger och avslut).
    const staff = await operatorSession(tenant.operatorEmail, tenant.operatorPassword)
    const page = await staff.newPage()
    await page.goto(`/admin/customers/${W.customerId}?tab=lifecycle-decisions`)
    const form = page.locator('form').filter({ has: page.locator('input[name="decision_type"][value="withdrawal"]') }).first()
    let withdrawal: Row = { form: false }
    if (await form.count().catch(() => 0)) {
      await form.locator('select[name="scope_target"]').selectOption(`contract:${W.facility!.contractId}`).catch(() => undefined)
      await form.locator('textarea[name="reason"]').fill('E2E: kunden ångrade avtalet via telefon inom ångerfristen.')
      await form.locator('input[name="confirmed"]').check()
      const status = await submitServerAction(page, () => form.getByRole('button', { name: 'Registrera ånger' }).click(), 120_000)
      withdrawal = { form: true, status }
    }
    await page.close()
    report.withdrawalAction = withdrawal
    report.withdrawalRuns = await receiveUntil(() => false, 3)
    const wState = { switch: sql<Row>(`SELECT jsonb_build_object('status',status,'blocked',lifecycle_blocked,'pause',pause_reason) FROM public.supplier_switch_requests WHERE id=${literal(W.switchId!)}`),
      cancellations: sql<Row[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('status',status,'process',process_type,'raw',raw_payload IS NOT NULL)),'[]') FROM public.ediel_messages
        WHERE company_id=${companyLiteral()} AND direction='outbound' AND message_code='Z03' AND (switch_request_id=${literal(W.switchId!)} OR metering_point_id=${literal(W.facility!.meteringPointId)}) AND (raw_payload LIKE '%Z24%' OR process_type='supplier_switch_cancellation')`),
      followup: leavingFollowup(tenant.companyId, W.customerId!), period: latestPeriod(W) }
    report.withdrawal = wState
    expect(withdrawal.form, 'the customer card offers "Registrera ånger"').toBe(true)
    expect.soft((wState.switch as Row).status, 'W: the sent switch is stopped at the grid owner').toMatch(/^(cancellation_requested|cancellation_sent|cancelled_before_start)$/)
    expect.soft(wState.cancellations.length, 'W: a Z03C is prepared for the grid owner').toBeGreaterThan(0)
    expect.soft((wState.followup as { emails: Row[] }).emails.map(e => e.type), 'W: the customer is told').toContain('withdrawal_received')
    expect(wState.period, 'W: no supply period arises').toBeNull()

    // C: the supplier withdraws its own pending switch (the staff action's command), then the grid owner confirms.
    const cancellation = await prepareAndQueueSwitchCancellation({ companyId: tenant.companyId, switchRequestId: C.switchId!, actorUserId: LIVE.automationUserId, environment: 'production' })
    report.cancellationCommand = 'status' in cancellation && cancellation.status === 'held' ? cancellation : { message: (cancellation as { id?: string }).id ?? null }
    const z03c = () => sql<string | null>(`SELECT to_jsonb(raw_payload) FROM public.ediel_messages WHERE company_id=${companyLiteral()} AND direction='outbound' AND message_code='Z03'
      AND switch_request_id=${literal(C.switchId!)} AND raw_payload LIKE '%Z24%' AND status IN ('sent','acknowledged','delivered') ORDER BY created_at DESC LIMIT 1`)
    report.cancellationSend = await receiveUntil(() => Boolean(z03c()), 5)
    const wire = z03c()
    expect(wire, `C: the Z03C reached the grid owner ${JSON.stringify(report.cancellationCommand)}`).toBeTruthy()
    const z04c = buildZ04CancellationFor(wire!, GRID_OWNER_EDIEL_ID)
    await gridOwnerSendsLeavingFile({ from: gridOwner.email, kind: 'PRODAT-Z04C', edifact: z04c.raw, reference: z04c.reference })
    const cSwitch = () => sql<Row>(`SELECT jsonb_build_object('status',status,'z04',inbound_z04_message_id) FROM public.supplier_switch_requests WHERE id=${literal(C.switchId!)}`)
    report.z04cReception = await receiveUntil(() => cSwitch().status === 'cancelled_before_start', 10)
    report.cancelled = { switch: cSwitch(), followup: leavingFollowup(tenant.companyId, C.customerId!), period: latestPeriod(C),
      z04c: inboundSources(tenant.companyId, ['Z04']).slice(-1).map(m => sourceDiagnosis(m.id)) }
    saveReport()
    expect(cSwitch().status, JSON.stringify(report.cancelled)).toBe('cancelled_before_start')
    expect(latestPeriod(C), 'C: no supply period').toBeNull()
  }, 40 * 60_000)

  it('H9 isolation: nothing crosses customers or tenants, no queue is stuck', (context) => {
    requireEstablished('H9', context)
    const mine = [...LEAVING, W, C].filter(p => p.facility)
    const uuids = (values: string[]) => `${literal(`{${values.join(',')}}`)}::uuid[]`
    const leaks = sql<Record<string, number>>(`SELECT jsonb_build_object(
      'valuesOnOtherCustomer',(SELECT count(*) FROM public.normalized_metering_values v JOIN public.metering_points mp ON mp.id=v.metering_point_id WHERE v.company_id=${companyLiteral()} AND v.customer_id<>mp.customer_id),
      'valuesElsewhere',(SELECT count(*) FROM public.normalized_metering_values WHERE company_id<>${companyLiteral()} AND metering_point_id=ANY(${uuids(mine.map(p => p.facility!.meteringPointId))})),
      'invoicesElsewhere',(SELECT count(*) FROM public.customer_invoices WHERE company_id<>${companyLiteral()} AND customer_id=ANY(${uuids(mine.map(p => p.customerId!))})))`)
    report.isolation = leaks
    expect(leaks).toEqual({ valuesOnOtherCustomer: 0, valuesElsewhere: 0, invoicesElsewhere: 0 })
    const stuck = detectStuckStates({ graceSeconds: 600, companyIds: [tenant.companyId] })
    report.stuck = stuck
    expect.soft(stuck.filter(row => row.kind === 'stuck')).toEqual([])
  })
})
