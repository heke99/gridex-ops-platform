// Reality scenario J2: inbound UTILTS from the grid owner — metering values, corrections, estimates replaced by
// measured values, settlement aggregates (E31) and what reconciliation compares, values for facilities we do not
// supply, and volume. The risk is wrong money: values billed to the wrong customer or period, corrections that
// never reach an invoice, settlement that never reconciles, values silently dropped or duplicated.
//
// Same world as scenarios A, F and G: the supplier goes live in ALS, the grid owner (16700) is simulated over
// SMTPS/IMAPS. As in F and G (coordinator decision 2026-10-22) the customer is an August customer: signed in
// August through the platform's signature path, switch requests created in August for supply from 1 September,
// Z03 from the real builder and NOT passed through the send-window scheduler (the one stand-in for "now is
// August"). Supply then rests on the grid owner's Z04; everything after the Z03 is the real code path.
//
// The grid owner's UTILTS files are mailed over SMTPS from its own mailbox (as scenario G): the running grid-owner
// simulator can only send whole measured days, while J2 needs estimated quarter-hours (STS+8+56), windows of a
// day (a partial-period correction), later registration times (U-04) and an E31 aggregate. The wire is built by
// scripts/helpers/reality/inboundUtilts.ts and checked against the platform's own runtime in
// __tests__/j2-inbound-utilts-wire.test.ts. Reception, matching, storage, gating, billing and reconciliation are
// the platform's: values, market state and gates are never inserted by this test.
//
// Time model (ENV-08, owner decision 2026-10-23, T15): every file is a grid owner's Ediel day 00:00–24:00 +0100
// (96 quarter-hours from 23:00Z the day before; 07:00–13:00 CEST is 06:00–12:00 +0100). Supply starts at the Z04's
// instant 2026-08-31T23:00Z and is billed per Ediel month: September = [2026-08-31T23:00Z, 2026-09-30T23:00Z).
// Stored values are therefore counted per Ediel day (Etc/GMT-1), by instant. Only the platform's settlement cron
// imports and locks spot prices (F109).
//
// Facilities (one customer, one contract each, supply from 1 September):
//   A "invoiced": the whole of September, invoiced by the monthly billing cron, then 10 September corrected
//     by the grid owner (J2-01, J2-02): the invoice must not change, re-running billing must not bill twice,
//     and the difference must reach the customer through the ordinary correction/credit path.
//   B "estimated": 1–3 September first estimated (STS+8+56), later replaced by measured values (J2-03).
//   C "partial": 12 September later corrected for 06:00–12:00 only, in a file covering just that window (J2-05).
//   A's 31 August (before our supply) and one day for a GSRN no tenant has: held, never billed, never shown.
//   GRIDEX_REALITY_J2_EXTRA more facilities with a whole September each (volume, default 0).
//
// Steps that depend on something the world cannot provide are soft checks with the exact reason in the report.
// Open product defects are soft checks named by their J2 id (report and FINDINGS), so later steps still run.
// Run only through scripts/reality/run.sh (owns the world). Synthetic data only (E2E-, example.invalid).
import { writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it, type TestContext } from 'vitest'
import { processPendingContractConfirmations } from '@/lib/customer-contracts/onlineSigning'
import { customerNormalizedMeteringValues } from '@/lib/metering/customerMeteringAccess'
import { LIVE, augustSupplyCustomer, cron, literal, sql, type AugustFacility, type LiveTenant } from '../helpers/live-chain-fixture'
import { closeOperatorConsole } from '../helpers/reality/operatorConsole'
import { runOperationalCronSlot, type GridOwnerSim } from '../helpers/reality/world'
import { clockSettings, cronTick } from '../helpers/reality/clock'
import { GRID_AREA, GRID_OWNER_EDIEL_ID, goLiveAlsSupplier } from '../helpers/reality/goLiveAls'
import { detectStuckStates } from '../helpers/reality/stuckDetector'
import { registerUtiltsIssuer } from '../helpers/utiltsConsumptionParties'
import { edielDayUtc, gs1 } from '../helpers/live-chain-wire'
import { edielDayProfile, kwhSum, monthDays } from '../helpers/reality/dst'
import { changedQuarters, correctedValues, hourlyFromQuarterValues, utiltsE31, utiltsE66, type UtiltsFile } from '../helpers/reality/inboundUtilts'
import { billingState, establishSwitch, gridOwnerMails, inboundUtilts, receiveUntil, reprocessAsOperator, sourceDiagnosis, storedDay, storedPerEdielDay,
  type InboundUtilts, type ReprocessOutcome } from '../helpers/reality/inboundUtiltsWorld'

const report: Record<string, unknown> = { scenario: 'J2 inbound UTILTS', startedAt: new Date().toISOString(), clock: clockSettings() }
const REPORT = process.env.GRIDEX_REALITY_REPORT ?? '/tmp/reality-j2-report.json'
const saveReport = (extra: Record<string, unknown> = {}) => writeFileSync(REPORT, JSON.stringify({ ...report, ...extra }, null, 2))
type Row = Record<string, unknown>
let tenant: LiveTenant
let gridOwner: GridOwnerSim

const SUPPLY_START = '2026-09-01'
const MONTH = '2026-09'
const SEPTEMBER = monthDays(MONTH)
const AUGUST_SIGNED_AT = '2026-08-12T09:30:00+02:00'
const AUGUST_SWITCH_CREATED_AT = '2026-08-12T09:31:00+02:00'
const ESTIMATED_DAYS = ['2026-09-01', '2026-09-02', '2026-09-03']
const CORRECTED_DAY = '2026-09-10'
const PARTIAL = { day: '2026-09-12', from: 24, to: 48 } // 06:00–12:00 +0100 (07:00–13:00 CEST)
const BEFORE_SUPPLY_DAY = '2026-08-31'
const FOREIGN_DAY = '2026-09-05'
const EXTRA = Math.max(0, Math.min(200, Number(process.env.GRIDEX_REALITY_J2_EXTRA ?? 0)))

const RUN = Date.now().toString(36)
function personnummer(birth: string, serial: string) {
  const nine = birth.slice(2) + serial
  const total = [...nine].reduce((acc, digit, i) => { const v = Number(digit) * (i % 2 === 0 ? 2 : 1); return acc + (v > 9 ? v - 9 : v) }, 0)
  return `${birth}${serial}${(10 - (total % 10)) % 10}`
}
const CUSTOMER = { firstName: 'Matvarde', lastName: 'E2E-UTILTS', personalNumber: personnummer('19720914', '468'), email: `e2e-utilts-${RUN}@example.invalid`,
  address: { street: 'Kungsgatan 1', postalCode: '441 30', city: 'Alingsås' } }
const newGsrn = () => gs1(`735999${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`)
type Facility = { role: 'invoiced' | 'estimated' | 'partial' | 'extra'; gsrn: string; scale: number; street: string; annual: number }
const FACILITIES: Facility[] = [
  { role: 'invoiced', gsrn: newGsrn(), scale: 2.4, street: 'Kungsgatan 1', annual: 8_400 },
  { role: 'estimated', gsrn: newGsrn(), scale: 1.3, street: 'Drottninggatan 2', annual: 4_500 },
  { role: 'partial', gsrn: newGsrn(), scale: 0.4, street: 'Nygatan 3', annual: 1_200 },
  ...Array.from({ length: EXTRA }, (_, i) => ({ role: 'extra' as const, gsrn: newGsrn(), scale: 1 + (i % 5) / 10, street: `Storgatan ${i + 10}`, annual: 3_500 })),
]
const byRole = (role: Facility['role']) => FACILITIES.find(f => f.role === role)!
const FOREIGN_GSRN = newGsrn()
report.config = { facilities: FACILITIES.map(f => ({ role: f.role, gsrn: f.gsrn })), foreign: FOREIGN_GSRN, extra: EXTRA }

/** Everything the grid owner sent, with what each file should leave stored, for the independent checks. */
type Kind = 'regular' | 'before_supply' | 'foreign' | 'estimated' | 'measured_replacement' | 'correction_after_invoice' | 'partial_correction' | 'e31'
type Sent = UtiltsFile & { kind: Kind; gsrn: string | null; day: string; dayValues: number[]; expectedStored: number }
const sent: Sent[] = []
const dayValues = (f: Facility, day: string) => edielDayProfile(day, SEPTEMBER.indexOf(day) + 1, f.scale)
/** The values in force per day for one facility: a later file replaces the earlier one (whole day or window). */
function effective(gsrn: string) {
  const days = new Map<string, number[]>()
  for (const file of sent.filter(file => file.gsrn === gsrn && file.kind !== 'e31')) {
    if (file.kind === 'partial_correction') { const day = [...days.get(file.day)!]; file.values.forEach((value, i) => { day[PARTIAL.from + i] = value }); days.set(file.day, day) }
    else days.set(file.day, file.dayValues)
  }
  return days
}
const fileOf = (reference: string) => sent.filter(file => reference.includes(file.reference)).sort((a, b) => b.reference.length - a.reference.length)[0]
const notAfter = () => Date.now() - 2 * 60_000

type Ids = { mp: string; customer: string; contract: string; site: string }
const ids = new Map<string, Ids>()
const idOf = (f: Facility) => { const found = ids.get(f.gsrn); if (!found) throw Error(`facility_not_on_tenant:${f.gsrn}`); return found }
let customerId = ''
let established = false
let supplied = false
let stored = false
let invoiced = false
function requireStep(flag: boolean, step: string, why: string, context: TestContext) {
  if (flag) return
  report[step] = `skipped: ${why}`
  return context.skip()
}

/**
 * The grid owner mails one E66 per entry, in order, like its daily metering run. The tenant is live in production
 * (goLiveAlsSupplier, Z03 environment 'production'), so every file is a production interchange (FINDINGS T7).
 */
async function gridOwnerSendsE66(files: Array<{ f: Facility | null; gsrn?: string; day: string; kind: Kind; values: number[]; reference: string; window?: { from: number; to: number }
  estimated?: Set<number>; registeredAt?: number; expectedStored: number }>) {
  for (const file of files) {
    const gsrn = file.f?.gsrn ?? file.gsrn!
    const built = utiltsE66({ issuer: GRID_OWNER_EDIEL_ID, receiver: tenant.supplierEdielId, meterId: gsrn, day: file.day, values: file.values, reference: file.reference,
      window: file.window, estimated: file.estimated, registeredAt: file.registeredAt, notAfter: notAfter(), environment: 'production' })
    await gridOwnerMails(gridOwner.email, 'UTILTS-E66', built)
    sent.push({ ...built, kind: file.kind, gsrn, day: file.day, dayValues: file.values, expectedStored: file.expectedStored })
  }
}
const ref = (prefix: string, f: Facility | null, day: string) => `${prefix}${day.replaceAll('-', '').slice(2)}${(f?.gsrn ?? FOREIGN_GSRN).slice(-6)}`
const tenantUtilts = () => inboundUtilts(tenant.companyId)
const arrived = (kinds: Kind[]) => { const got = new Set(tenantUtilts().map(m => fileOf(m.reference)?.reference)); return sent.filter(file => kinds.includes(file.kind) && !got.has(file.reference)) }
const sourcesOf = (kinds: Kind[]) => tenantUtilts().filter(m => kinds.includes(fileOf(m.reference)?.kind as Kind))
const expectedFor = (source: InboundUtilts) => fileOf(source.reference)?.expectedStored ?? 0
const progress = (key: string) => (outcomes: ReprocessOutcome[]) => saveReport({ [key]: outcomes })
const notStored = (outcomes: ReprocessOutcome[]) => outcomes.filter(o => o.stored !== o.expected).map(o => `${fileOf(o.reference)?.kind} ${fileOf(o.reference)?.gsrn} ${fileOf(o.reference)?.day}: ${o.stored}/${o.expected}`)

describe.sequential('reality J2 — inbound UTILTS: metering, corrections, settlement and errors from the grid owner', () => {
  afterAll(async () => {
    gridOwner?.stop()
    await closeOperatorConsole()
    report.finishedAt = new Date().toISOString()
    saveReport()
  })

  it('J2-1 the supplier goes live in ALS with its BRP from 1 August', async () => {
    expect(LIVE.cronSecret && LIVE.automationUserId).toBeTruthy()
    const live = await goLiveAlsSupplier(report, { brpValidFrom: '2026-08-01' })
    ;({ tenant, gridOwner } = live)
    expect(live.provisioned.readinessBlockers, JSON.stringify(live.provisioned.readinessBlockers)).toEqual([])
  })

  it('J2-2 the August customer: signed contracts, switch requests created in August, Z03 from the real builder', async () => {
    const company = literal(tenant.companyId)
    const grid = sql<{ id: string; ediel: string }>(`SELECT jsonb_build_object('id',id,'ediel',ediel_id) FROM public.grid_owners WHERE ediel_id=${literal(GRID_OWNER_EDIEL_ID)} AND company_id IS NULL`)
    const customer = await augustSupplyCustomer(tenant, { ...CUSTOMER, supplyStart: SUPPLY_START, authorizedAt: AUGUST_SIGNED_AT,
      grid: { gridOwnerId: grid.id, gridOwnerEdielId: grid.ediel, gridAreaCode: GRID_AREA },
      facilities: FACILITIES.map(f => ({ gsrn: f.gsrn, street: f.street, postalCode: '441 30', city: 'Alingsås', annualConsumptionKwh: f.annual })) })
    customerId = customer.customerId
    for (const facility of customer.facilities) ids.set(facility.gsrn, { mp: facility.meteringPointId, customer: customerId, contract: facility.contractId, site: facility.siteId })
    const readiness = () => sql<Array<{ ready: boolean; blockers: unknown }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('ready',switch_ready,'blockers',blockers)),'[]')
      FROM public.customer_contract_lifecycle_readiness_v WHERE company_id=${company} AND customer_id=${literal(customerId)}`)
    const deliveries: unknown[] = []
    for (let attempt = 0; attempt < 3 && !readiness().every(row => row.ready); attempt += 1) deliveries.push(await processPendingContractConfirmations(50))
    report.augustReadiness = { deliveries, readiness: readiness() }
    expect(readiness().filter(row => !row.ready), 'every August contract is switch-ready').toEqual([])
    const switches: Array<Awaited<ReturnType<typeof establishSwitch>>> = []
    for (const facility of customer.facilities as AugustFacility[]) switches.push(await establishSwitch(tenant, { customerId, facility, supplyStart: SUPPLY_START, createdAt: AUGUST_SWITCH_CREATED_AT }))
    report.augustSwitches = switches
    established = switches.every(row => row.built.ok && row.z03Start === '20260901')
    expect(switches.filter(row => !row.built.ok), 'the real Z03 builder accepted every August switch').toEqual([])
    expect(switches.map(row => row.z03Start)).toEqual(FACILITIES.map(() => '20260901'))
  }, 20 * 60_000)

  it('J2-3 the world runs on cron cadence until supply rests on the Z04 from 1 September', async (context) => {
    requireStep(established, 'J2-3', 'no Z03 for 2026-09-01 was established (J2-2)', context)
    await gridOwner.profile({ contrlDelayMs: 20_000, aperakDelayMs: 40_000, z04DelayMs: 90_000 })
    const supply = () => sql<Array<{ gsrn: string; switch: string | null; period: Row | null }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('gsrn',mp.metering_point_id,'switch',s.status,
        'period',(SELECT jsonb_build_object('status',p.status,'start',p.start_date,'customer',p.customer_id,'message',p.source_message_id,'z04',s.inbound_z04_message_id,
          'atSupplyStart',p.market_start_at=(TIMESTAMP '2026-09-01 00:00' AT TIME ZONE 'Etc/GMT-1'))
          FROM public.customer_supply_periods p WHERE p.company_id=mp.company_id AND p.metering_point_id=mp.id ORDER BY p.created_at DESC LIMIT 1))),'[]')
      FROM public.metering_points mp LEFT JOIN LATERAL (SELECT * FROM public.supplier_switch_requests x WHERE x.company_id=mp.company_id AND x.metering_point_id=mp.id ORDER BY x.created_at DESC LIMIT 1) s ON true
      WHERE mp.company_id=${literal(tenant.companyId)} AND mp.customer_id=${literal(customerId)}`)
    const deadline = Date.now() + Number(process.env.GRIDEX_REALITY_J2_3_MINUTES ?? 30) * 60_000
    const slots: unknown[] = []
    let state = supply()
    for (;;) {
      const ran = await runOperationalCronSlot()
      slots.push({ at: new Date().toISOString(), crons: ran.map(r => ({ path: r.path, status: r.status, ms: r.ms })) })
      state = supply()
      saveReport({ worldSlots: slots, supply: state })
      if (state.every(row => row.period?.status === 'active') || state.some(row => row.switch === 'failed') || Date.now() > deadline) break
      await cronTick()
    }
    report.supply = state
    for (const f of FACILITIES) {
      const row = state.find(r => r.gsrn === f.gsrn)
      expect(row?.switch, `${f.role} ${JSON.stringify(row)}`).toMatch(/^(accepted|active|completed)$/)
      expect(row?.period, `${f.role} rests on the grid owner's Z04: ${JSON.stringify(row)}`).toMatchObject({ status: 'active', start: SUPPLY_START, atSupplyStart: true, customer: customerId })
      expect(row?.period?.message).toBe(row?.period?.z04)
    }
    supplied = true
  }, 40 * 60_000)

  it('J2-4 the grid owner sends September (1–3 September estimated for B), A\'s 31 August and one day of a GSRN no tenant has', async (context) => {
    requireStep(supplied, 'J2-4', 'supply does not rest on a Z04 from 1 September (J2-3)', context)
    // SYNTHETIC stand-in for EXT-ISSUER-01, exactly as scenarios E, F and G register the ALS grid owner.
    registerUtiltsIssuer(sql as never, literal, GRID_OWNER_EDIEL_ID, tenant.adminUserId)
    const B = byRole('estimated'), A = byRole('invoiced')
    await gridOwnerSendsE66([
      ...FACILITIES.flatMap(f => SEPTEMBER.map(day => ({ f, day, values: dayValues(f, day), reference: ref('J', f, day),
        kind: (f === B && ESTIMATED_DAYS.includes(day) ? 'estimated' : 'regular') as Kind,
        estimated: f === B && ESTIMATED_DAYS.includes(day) ? new Set(Array.from({ length: 96 }, (_, q) => q)) : undefined, expectedStored: 96 }))),
      // 31 August 00:00–24:00 +0100 ends exactly at the supply start (2026-08-31T23:00Z): wholly before our supply.
      { f: A, day: BEFORE_SUPPLY_DAY, values: edielDayProfile(BEFORE_SUPPLY_DAY, 0, A.scale), reference: ref('J', A, BEFORE_SUPPLY_DAY), kind: 'before_supply', expectedStored: 96 },
      // A file addressed to us for a facility that is not ours: rejected or held, never stored on this tenant.
      { f: null, gsrn: FOREIGN_GSRN, day: FOREIGN_DAY, values: edielDayProfile(FOREIGN_DAY, 4, 1), reference: ref('J', null, FOREIGN_DAY), kind: 'foreign', expectedStored: 0 },
    ])
    report.sent = sent.map(({ edifact, starts, values, dayValues: _, ...file }) => ({ ...file, quarters: values.length, kwh: kwhSum(values) }))
    expect(sent).toHaveLength(FACILITIES.length * SEPTEMBER.length + 2)
  }, 30 * 60_000)

  it('J2-5 the inbound cron receives every file on the tenant', async (context) => {
    requireStep(sent.length > 0, 'J2-5', 'nothing was sent (J2-4)', context)
    report.receptionRuns = await receiveUntil(() => arrived(['regular', 'estimated', 'before_supply', 'foreign']).length === 0, Number(process.env.GRIDEX_REALITY_J2_5_MINUTES ?? 30))
    expect(arrived(['regular', 'estimated', 'before_supply', 'foreign']).map(file => `${file.kind} ${file.gsrn} ${file.day}`), 'files never received on the tenant').toEqual([])
  }, 40 * 60_000)

  it('J2-6 after issuer evidence and operator reprocessing: every value on the right customer; estimates held; outside our supply held and invisible', async (context) => {
    requireStep(tenantUtilts().length > 0, 'J2-6', 'no inbound UTILTS on the tenant (J2-5)', context)
    const outcomes = await reprocessAsOperator(tenant, sourcesOf(['regular', 'estimated', 'before_supply', 'foreign']), expectedFor, progress('reprocessProgress'))
    report.reprocess = { outcomes, slowestMs: Math.max(...outcomes.map(o => o.ms)), medianMs: outcomes.map(o => o.ms).sort((a, b) => a - b)[Math.floor(outcomes.length / 2)] }
    expect(notStored(outcomes), 'values not stored as sent').toEqual([])
    const perFacility: Record<string, unknown> = {}
    for (const f of FACILITIES) {
      // Per Ediel day (00:00–24:00 +0100), i.e. per sent file, by instant.
      const days = storedPerEdielDay(tenant.companyId, idOf(f).mp), effectiveDays = effective(f.gsrn)
      perFacility[f.role === 'extra' ? f.gsrn : f.role] = days
      for (const day of SEPTEMBER) {
        const estimated = f.role === 'estimated' && ESTIMATED_DAYS.includes(day)
        expect(days[day], `${f.role} ${day}`).toMatchObject({ normalized: 96, metering: 96, eligible: estimated ? 0 : 96, estimated: estimated ? 96 : 0 })
        expect(Number(days[day].kwh), `${f.role} ${day} kWh`).toBeCloseTo(kwhSum(effectiveDays.get(day)!), 6)
      }
    }
    // Before our supply (A, 31 August): stored for operations, never billable, not shown to the customer (F79).
    const A = byRole('invoiced'), before = storedPerEdielDay(tenant.companyId, idOf(A).mp)[BEFORE_SUPPLY_DAY]
    perFacility.beforeSupply = before
    expect(before, 'A 31 August stored but not billable').toMatchObject({ normalized: 96, eligible: 0 })
    const scope = { companyId: tenant.companyId, customerIds: [customerId] }
    // The whole 31 August Ediel day [2026-08-30T23:00Z, 2026-08-31T23:00Z) lies before the supply start.
    const beforeSupply = edielDayUtc(BEFORE_SUPPLY_DAY)
    const visible = await customerNormalizedMeteringValues(scope, { periodStartFrom: new Date(beforeSupply.start).toISOString(), periodStartBefore: new Date(beforeSupply.end).toISOString() }).select('id')
    expect(visible.error).toBeNull()
    expect(visible.data ?? [], 'Mina sidor/customer API show nothing from before the supply start (F79)').toEqual([])
    // A GSRN that is not ours: nothing stored anywhere for it, on any tenant.
    const foreign = sql<Row>(`SELECT jsonb_build_object('values',(SELECT count(*) FROM public.normalized_metering_values WHERE facility_id=${literal(FOREIGN_GSRN)}),
      'meteringValues',(SELECT count(*) FROM public.metering_values m JOIN public.metering_points mp ON mp.id=m.metering_point_id WHERE mp.metering_point_id=${literal(FOREIGN_GSRN)}))`)
    const foreignSource = sourcesOf(['foreign'])[0]
    perFacility.foreign = { stored: foreign, outcome: foreignSource ? sourceDiagnosis(foreignSource.id) : null }
    expect(foreign).toEqual({ values: 0, meteringValues: 0 })
    // J2-08: values outside our supply leave one operator item per file, not one per quarter-hour.
    const items = sql<Row[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('type',issue_type,'n',n,'point',p)),'[]') FROM (SELECT issue_type,extracted_identifiers->>'meteringPointId' p,count(*) n
      FROM public.ediel_unresolved_items WHERE company_id=${literal(tenant.companyId)} AND status='open' GROUP BY 1,2) x`)
    perFacility.operatorItems = items
    report.storedAfterSeptember = perFacility
    expect.soft(items.filter(item => item.type === 'billing_period_missing' && Number(item.n) > 1), 'J2-08: one open item per received file, not 96').toEqual([])
    stored = true
  }, 240 * 60_000)

  it('J2-7 the grid owner replaces B\'s estimated 1–3 September by measured values (later registration)', async (context) => {
    requireStep(stored, 'J2-7', 'September was not stored (J2-6)', context)
    const B = byRole('estimated')
    await gridOwnerSendsE66(ESTIMATED_DAYS.map(day => {
      // The meter was read: the measured values differ from the estimate in every 3rd quarter-hour.
      const measured = correctedValues(dayValues(B, day), { every: 3, deltaKwh: 0.021 })
      return { f: B, day, values: measured, reference: ref('JM', B, day), kind: 'measured_replacement' as Kind,
        registeredAt: edielDayUtc(day).end + 72 * 3_600_000, expectedStored: 96 }
    }))
    report.measuredReceptionRuns = await receiveUntil(() => arrived(['measured_replacement']).length === 0, 15)
    const outcomes = await reprocessAsOperator(tenant, sourcesOf(['measured_replacement']), expectedFor)
    const days = storedPerEdielDay(tenant.companyId, idOf(B).mp)
    report.measuredReplacement = { outcomes, days: Object.fromEntries(ESTIMATED_DAYS.map(day => [day, days[day]])),
      diagnosis: outcomes.filter(o => o.stored !== o.expected).map(o => ({ reference: o.reference, diagnosis: o.diagnosis })) }
    for (const day of ESTIMATED_DAYS) {
      expect.soft(days[day], `J2-03: B ${day} measured values replace the estimate (open: gridex_consume_utilts_metering_v1 refuses a quality change)`)
        .toMatchObject({ normalized: 96, estimated: 0, eligible: 96 })
      expect.soft(Number(days[day]?.kwh), `J2-03: B ${day} kWh`).toBeCloseTo(kwhSum(effective(B.gsrn).get(day)!), 6)
    }
    // Whatever happened, the measured file never leaves both versions current or a value without a gate.
    for (const day of ESTIMATED_DAYS) expect(days[day]?.normalized, `B ${day} exactly one current value per quarter-hour`).toBe(96)
  }, 60 * 60_000)

  it('J2-8 the nightly settlement cron imports and locks the September SE3 spot prices (platform path, no tenant user)', async (context) => {
    requireStep(stored, 'J2-8', 'September was not stored (J2-6)', context)
    // Only the platform and the nightly settlement cron import and lock spot prices (owner decision 2026-10-23, F109).
    const settlement = await cron(`/api/cron/pricing/spot-settlement?billing_month=${MONTH}&price_areas=SE3`)
    const summaries = sql<Row[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('source',source,'status',status,'lockedAt',locked_at)),'[]')
      FROM public.spot_price_monthly_summaries WHERE price_area='SE3' AND billing_month=${literal(MONTH)}`)
    // Civil September (spot prices are civil delivery days).
    const intervals = sql<number>(`SELECT to_jsonb(count(*)) FROM public.spot_price_intervals WHERE price_area='SE3' AND resolution='quarter_hour' AND time_start>='2026-08-31T22:00:00Z' AND time_start<'2026-09-30T22:00:00Z'`)
    report.spot = { cron: { status: settlement.status, body: settlement.body }, summaries, intervals,
      // The last hour of the Ediel month (civil 1 October 00:00–01:00 CEST): pending billing agent.
      edielTail: sql<number>(`SELECT to_jsonb(count(*)) FROM public.spot_price_intervals WHERE price_area='SE3' AND resolution='quarter_hour' AND time_start>='2026-09-30T22:00:00Z' AND time_start<'2026-09-30T23:00:00Z'`) }
    expect(settlement.status, JSON.stringify(report.spot).slice(0, 2000)).toBe(200)
    expect(settlement.body).toMatchObject({ ok: true, mode: 'settlement_lock', settlement_locked: true })
    expect(summaries.filter(row => row.status === 'locked'), JSON.stringify(summaries)).toHaveLength(1)
    expect(intervals).toBe(30 * 96)
  })

  let beforeCorrection: ReturnType<typeof billingState> | null = null
  it('J2-9 the monthly billing cron prepares September: A and C invoiced, B only with measured values', async (context) => {
    requireStep(stored, 'J2-9', 'September was not stored (J2-6)', context)
    const started = Date.now()
    const result = await cron(`/api/cron/billing/monthly?company_id=${tenant.companyId}&billing_month=${MONTH}`)
    const state = billingState(tenant.companyId, 2026, 9)
    report.billingFirst = { status: result.status, ms: Date.now() - started, body: result.body, state }
    expect(result.status, JSON.stringify(result.body).slice(0, 2000)).toBe(200)
    const underlayOf = (f: Facility) => state.underlays.find(u => u.facility === f.gsrn && u.direction === 'consumption')
    for (const f of FACILITIES.filter(f => f.role !== 'estimated')) {
      expect(underlayOf(f), `${f.role} underlay`).toMatchObject({ readiness: 'ready', values: SEPTEMBER.length * 96, missing: 0 })
      expect(Number(underlayOf(f)!.kwh), `${f.role} underlay kWh = all sent September values`).toBeCloseTo(kwhSum(SEPTEMBER.flatMap(day => effective(f.gsrn).get(day)!)), 3)
      expect(state.invoices.filter(i => i.underlay === underlayOf(f)!.id), `${f.role}: exactly one invoice draft`).toHaveLength(1)
    }
    // B: with the estimates still current the month is not billable; with measured values it is.
    const b = underlayOf(byRole('estimated'))
    report.estimatedUnderlay = b ?? null
    expect.soft(b, 'J2-03: B is invoiced for September on measured values').toMatchObject({ readiness: 'ready' })
    beforeCorrection = state
    invoiced = Boolean(underlayOf(byRole('invoiced')) && state.invoices.some(i => i.underlay === underlayOf(byRole('invoiced'))!.id))
  }, 60 * 60_000)

  it('J2-10 a correction for the invoiced month: the invoice is not touched, nothing is billed twice, the difference is surfaced', async (context) => {
    requireStep(invoiced, 'J2-10', 'A was not invoiced for September (J2-9)', context)
    const A = byRole('invoiced'), original = effective(A.gsrn).get(CORRECTED_DAY)!
    const corrected = correctedValues(original, { every: 4, deltaKwh: 0.012 })
    const changed = changedQuarters(original, corrected)
    await gridOwnerSendsE66([{ f: A, day: CORRECTED_DAY, values: corrected, reference: ref('JC', A, CORRECTED_DAY), kind: 'correction_after_invoice',
      registeredAt: Date.parse('2026-10-15T06:00:00Z'), expectedStored: changed.length }])
    report.correctionReceptionRuns = await receiveUntil(() => arrived(['correction_after_invoice']).length === 0, 15)
    const outcomes = await reprocessAsOperator(tenant, sourcesOf(['correction_after_invoice']), expectedFor)
    const day = storedDay(tenant.companyId, idOf(A).mp, CORRECTED_DAY)
    report.correctionAfterInvoice = { changed: changed.length, deltaKwh: kwhSum(corrected) - kwhSum(original), outcomes, day: { revised: day.filter(v => v.revision > 1).length, kwh: kwhSum(day.map(v => Number(v.kwh))) } }
    // The corrected values are in force for the day (FINDINGS F78: exactly the changed quarter-hours get a new revision).
    expect(notStored(outcomes)).toEqual([])
    expect(day.filter(v => v.revision > 1)).toHaveLength(changed.length)
    expect(kwhSum(day.map(v => Number(v.kwh)))).toBeCloseTo(kwhSum(corrected), 6)

    // The monthly cron runs again (every 6 hours in production).
    const rerun = await cron(`/api/cron/billing/monthly?company_id=${tenant.companyId}&billing_month=${MONTH}`)
    const after = billingState(tenant.companyId, 2026, 9), before = beforeCorrection!
    const lastRun = after.runs[after.runs.length - 1] ?? null
    report.billingAfterCorrection = { status: rerun.status, body: rerun.body, lastRun, after }
    expect(rerun.status).toBe(200)
    // J2-01: one corrected facility must not fail the tenant's whole month.
    expect(lastRun?.status, `J2-01: the tenant month after a correction: ${JSON.stringify(lastRun)}`).not.toBe('failed')
    // Never mutate an issued invoice, never bill twice.
    const invoiceA = (state: typeof after) => { const u = state.underlays.find(x => x.facility === A.gsrn && x.direction === 'consumption'); return state.invoices.filter(i => i.underlay === u?.id) }
    expect(invoiceA(after).map(({ updated: _, ...i }) => i), 'A\'s invoice draft is unchanged').toEqual(invoiceA(before).map(({ updated: _, ...i }) => i))
    expect(after.invoices.length, 'no second invoice for any customer').toBe(before.invoices.length)
    expect(after.exportItems.length, 'no second export item').toBe(before.exportItems.length)
    expect(after.underlays.find(u => u.facility === A.gsrn && u.direction === 'consumption')?.kwh, 'A\'s finalized underlay keeps its kWh').toBe(before.underlays.find(u => u.facility === A.gsrn && u.direction === 'consumption')?.kwh)
    // The correction is surfaced to operations (daily reconciliation cron, /admin/system-health).
    const daily = await cron(`/api/cron/reconciliation/daily?company_id=${tenant.companyId}`)
    const checks = ((daily.body.result as Row | undefined)?.applicationChecks as { checks?: Array<Row> } | undefined)?.checks ?? []
    const correctionCheck = checks.find(check => check.key === 'metering_corrections_after_billing') ?? null
    const endToEnd = await cron(`/api/cron/reconciliation/end-to-end?company_id=${tenant.companyId}`)
    report.reconciliationAfterCorrection = { daily: { status: daily.status, correctionCheck, duplicate: checks.find(check => check.key === 'duplicate_billing_per_contract_period') ?? null },
      endToEnd: { status: endToEnd.status, body: endToEnd.body } }
    expect(daily.status).toBe(200)
    const underlayA = after.underlays.find(u => u.facility === A.gsrn && u.direction === 'consumption')!
    expect(correctionCheck, 'J2-02: the daily reconciliation names the corrected invoiced underlay').toMatchObject({ count: 1, sampleIds: [underlayA.id] })
    // J2-02 (open, product decision): no path bills or credits the difference. Soft so the run states it every time.
    const credit = after.underlays.filter(u => u.facility === A.gsrn && u.direction === 'consumption_correction')
    expect.soft(credit.length + after.invoices.length - before.invoices.length, `J2-02: the corrected ${kwhSum(corrected) - kwhSum(original)} kWh reach A through a credit/re-invoice (no such path exists)`).toBeGreaterThan(0)
  }, 60 * 60_000)

  it('J2-11 a correction for part of a day (12 September 06:00–12:00) in a file covering only that window', async (context) => {
    requireStep(stored, 'J2-11', 'September was not stored (J2-6)', context)
    const C = byRole('partial'), original = effective(C.gsrn).get(PARTIAL.day)!
    const corrected = correctedValues(original, { every: 1, deltaKwh: 0.05, from: PARTIAL.from, to: PARTIAL.to })
    await gridOwnerSendsE66([{ f: C, day: PARTIAL.day, values: corrected, window: { from: PARTIAL.from, to: PARTIAL.to }, reference: ref('JP', C, PARTIAL.day),
      kind: 'partial_correction', registeredAt: Date.parse('2026-10-15T07:00:00Z'), expectedStored: PARTIAL.to - PARTIAL.from }])
    report.partialReceptionRuns = await receiveUntil(() => arrived(['partial_correction']).length === 0, 15)
    const outcomes = await reprocessAsOperator(tenant, sourcesOf(['partial_correction']), expectedFor)
    const day = storedDay(tenant.companyId, idOf(C).mp, PARTIAL.day)
    report.partialCorrection = { outcomes, revised: day.filter(v => v.revision > 1).length, kwh: kwhSum(day.map(v => Number(v.kwh))), expectedKwh: kwhSum(corrected) }
    expect(day, 'C 12 September: still exactly one current value per quarter-hour').toHaveLength(96)
    expect.soft(day.filter(v => v.revision > 1).map(v => v.start), 'J2-05: exactly the 24 corrected quarter-hours get a new revision (open: refused as correction_binding_invalid)')
      .toEqual(day.slice(PARTIAL.from, PARTIAL.to).map(v => v.start))
    expect.soft(kwhSum(day.map(v => Number(v.kwh))), 'J2-05: C 12 September kWh after the partial correction').toBeCloseTo(kwhSum(corrected), 6)
  }, 40 * 60_000)

  it('J2-12 settlement: an E31 aggregate for ALS is received at grid-area level and reconciliation compares nothing with it (soft)', async (context) => {
    requireStep(stored, 'J2-12', 'September was not stored (J2-6)', context)
    // The grid area's hourly total for 10 September: our facilities plus the rest of the area (synthetic).
    const ours = FACILITIES.map(f => effective(f.gsrn).get(CORRECTED_DAY)!).reduce((sum, values) => sum.map((v, q) => v + values[q]), new Array(96).fill(0))
    const area = hourlyFromQuarterValues(ours).map(kwh => Math.round((kwh * 40) * 1000) / 1000)
    const file = utiltsE31({ issuer: GRID_OWNER_EDIEL_ID, receiver: tenant.supplierEdielId, gridArea: GRID_AREA, day: CORRECTED_DAY, hourlyKwh: area, reference: `JE31${RUN.slice(-6)}`, notAfter: notAfter(),
      environment: 'production' })
    await gridOwnerMails(gridOwner.email, 'UTILTS-E31', file)
    sent.push({ ...file, kind: 'e31', gsrn: null, day: CORRECTED_DAY, dayValues: area, expectedStored: 0 })
    report.e31ReceptionRuns = await receiveUntil(() => arrived(['e31']).length === 0, 10)
    const source = sourcesOf(['e31'])[0] ?? null
    const outcomes = source ? await reprocessAsOperator(tenant, [source], () => 0) : []
    const effects = source ? sql<Row>(`SELECT jsonb_build_object('normalized',(SELECT count(*) FROM public.normalized_metering_values WHERE source_message_id=${literal(source.id)}),
      'series',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind',series_kind,'point',external_metering_point_id,'area',grid_area_id)),'[]') FROM public.meter_reading_series WHERE source_ediel_message_id=${literal(source.id)}),
      'underlays',(SELECT count(*) FROM public.billing_underlays WHERE company_id=${literal(tenant.companyId)} AND payload->>'edielMessageId'=${literal(source.id)}))`) : null
    const daily = await cron(`/api/cron/reconciliation/daily?company_id=${tenant.companyId}`)
    const keys = (((daily.body.result as Row | undefined)?.applicationChecks as { checks?: Row[] } | undefined)?.checks ?? []).map(check => check.key)
    report.settlement = { received: Boolean(source), outcomes, effects, diagnosis: source ? sourceDiagnosis(source.id) : null, reconciliationChecks: keys,
      finding: 'J2-13: neither /api/cron/reconciliation/daily nor /end-to-end compares E31/S03 aggregates or metered kWh with billed kWh (lib/ops/reconciliation.ts, gridex_run_end_to_end_reconciliation)' }
    expect.soft(source, 'the E31 reaches the tenant').not.toBeNull()
    if (effects) expect(effects.normalized, 'an aggregate never becomes an individual customer value (DB-06)').toBe(0)
    expect.soft(keys.filter(key => /settlement|aggregate|e31|metered_vs_billed/i.test(String(key))), 'J2-13: a reconciliation check compares the E31 aggregate or metered with billed kWh').not.toEqual([])
  }, 30 * 60_000)

  it('J2-13 negative answers to our own UTILTS/PRODAT requests: E73 and Z13 (soft, observed)', async () => {
    const requests = sql<Row>(`SELECT jsonb_build_object(
      'e73',(SELECT coalesce(jsonb_agg(jsonb_build_object('status',m.status,'created',m.created_at)),'[]') FROM public.ediel_messages m WHERE m.company_id=${literal(tenant.companyId)} AND m.direction='outbound' AND m.message_code='E73'),
      'dataRequests',(SELECT coalesce(jsonb_agg(jsonb_build_object('scope',r.request_scope,'status',r.status)),'[]') FROM public.grid_owner_data_requests r WHERE r.company_id=${literal(tenant.companyId)}),
      'z13',(SELECT coalesce(jsonb_agg(jsonb_build_object('status',p.status)),'[]') FROM public.metering_permissions p WHERE p.company_id=${literal(tenant.companyId)}),
      'utiltsErr',(SELECT count(*) FROM public.ediel_messages m WHERE m.company_id=${literal(tenant.companyId)} AND m.direction='inbound' AND m.message_family='UTILTS_ERR'))`)
    report.ownRequests = { ...requests,
      unreachable: 'The grid-owner simulator answers PRODAT Z03 only. No E73 can be sent in this world (a tenant UTILTS route is never materialized: FINDINGS F35/F48), and every facility here has complete values, so the billing engine never asks for history (Z13). The Z13 repeat after a rejection (J2-10) and an E73 answered by UTILTS-ERR are covered by __tests__/j2-history-request-answered.test.ts and the report.' }
    expect.soft((requests.e73 as unknown[]).length, 'an E73 request was sent (unreachable: F35/F48)').toBeGreaterThan(0)
  })

  it('J2-14 isolation, queues and volume: values only on this tenant and customer, nothing stuck', (context) => {
    requireStep(ids.size > 0, 'J2-14', 'no customer was established (J2-2)', context)
    const mps = literal(`{${[...ids.values()].map(id => id.mp).join(',')}}`)
    const leaks = sql<Record<string, number>>(`SELECT jsonb_build_object(
      'valuesElsewhere',(SELECT count(*) FROM public.normalized_metering_values WHERE company_id<>${literal(tenant.companyId)} AND metering_point_id=ANY(${mps}::uuid[])),
      'otherCustomersHere',(SELECT count(*) FROM public.normalized_metering_values WHERE company_id=${literal(tenant.companyId)} AND metering_point_id=ANY(${mps}::uuid[]) AND customer_id IS DISTINCT FROM ${literal(customerId)}),
      'duplicateCurrent',(SELECT count(*) FROM (SELECT metering_point_id,period_start FROM public.normalized_metering_values WHERE company_id=${literal(tenant.companyId)} AND revision_status='current' GROUP BY 1,2 HAVING count(*)>1) d))`)
    report.isolation = leaks
    expect(leaks).toEqual({ valuesElsewhere: 0, otherCustomersHere: 0, duplicateCurrent: 0 })
    const reprocess = report.reprocess as { outcomes?: ReprocessOutcome[] } | undefined
    const timings = (reprocess?.outcomes ?? []).map(o => o.ms)
    report.volume = { facilities: FACILITIES.length, files: sent.length, operatorMsPerFile: timings.length ? Math.round(timings.reduce((a, b) => a + b, 0) / timings.length) : null,
      billingRunMs: (report.billingFirst as Row | undefined)?.ms ?? null,
      note: 'Per value the billing source basis costs ≈130 ms in the database (J2-06, measured): a quarter-hour facility-month is ≈2 976 values.' }
    const stuck = detectStuckStates({ graceSeconds: 600, companyIds: [tenant.companyId] })
    report.stuck = stuck
    expect(stuck.filter(row => row.kind === 'stuck')).toEqual([])
  })
})
