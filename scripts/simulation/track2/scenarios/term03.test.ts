// simulation: TERM03.01, TERM03.02, TERM03.03, TERM03.04, TERM03.05
// executionScope: ISOLATED_NATIVE
// Delperioder, avslut, månadsskifte, uppsägningsfrist och leverantörsbyte mot oberoende orakel (lib/term-oracle.ts).
// Läsvägar: appens rutter via HTTP med admin-cookie-session (generate-underlay, pricing/preview, spot/lock-month,
// server action logContractEventAction) samt rader i stackens DB och adminsidan. Ingen webbläsare (Playwright).
// Mönster och backendersättningar B1-B5 från scenarios/term02.test.ts och lib/term-billing.ts (filhuvudet):
//  B1 leveransperiod som SQL, B2 mätvärden som SQL (underlaget blir needs_review på grund av ersättningsblockerare men
//  täckningsrent), B3/B4 spot som SQL + låsning via appens route, B5 estimering avstängd. TERM03.04 sätter dessutom
//  customer_contracts.actual_start_date med SQL (leveransstart; ersätter aktiveringsprocessen) eftersom appens härledning av
//  ended_at (db.ts addCustomerContractEvent) kräver faktisk startdag.
// Spotdata är global per (elområde, månad); samma serier som i term02 återanvänds (identiska => idempotent):
//   01 SE1 2026-09 (term0201Hourly) | 02 SE2 2026-09 (term0202Hourly) | 05 SE3 2026-09 (priser som term0203Hourly) | 03 SE1 2026-10.
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { loginSession, psql, psqlRows, removeAdminFixtureUser, SIM_HOME, type AppSession } from '../lib'
import { callServerAction } from '../lib/server-action'
import { createSignedContract, createTermTenant, type SignedContractFixture, type TermTenant } from '../lib/term-fixture'
import {
  appLinesOre, classifyUnderlayWarnings, createSupplyPeriod, disableConsumptionEstimates, generateUnderlay, insertMeteringValues,
  insertSpotIntervals, pricePreview, prepareAndLockSpotMonth, readContractTerms, readUnderlayItems, readUnderlaysForMonth, spotImportFootprint,
  type GenerateUnderlayData, type PriceAreaCode, type UnderlayDbRow, type UnderlayResult,
} from '../lib/term-billing'
import {
  daysFromCivil, daysInMonth, dec, decCmp, decMul, decToString, halfCaseLines, hoursInMonth, isoUtc, oracleInvoice, parseYmd, ratioRound,
  roundDec, sekNumberToOre, stockholmMidnightUtcMs, sumKwh, vatOnOre, ymd, type OracleTerms,
} from '../lib/term-oracle'
import { hourlyShapeWh, term0201Hourly, term0202Hourly, term0203Hourly, toMeterValues, toOracle, toSpotIntervals, whToKwh, type Point } from '../lib/term02-data'
import { readContractPage } from '../lib/term-page'

const PERMS = ['billing_underlay.read', 'billing_underlay.export', 'pricing.read', 'pricing.write', 'customers.read', 'contracts.read', 'masterdata.read']
const LONG = 1_800_000
const FEE = '49'

const tenants: TermTenant[] = []
const observations: Array<{ id: string; data: unknown }> = []
const json = (value: unknown): string => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
function observe(id: string, data: Record<string, unknown>): void {
  observations.push({ id, data })
  console.info(`[${id} OBS] ${json(data)}`)
}
function lazy<T>(fn: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null
  return () => (promise ??= fn())
}
afterAll(async () => {
  try {
    const dir = path.join(SIM_HOME, 'reports')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `term03-observations-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), json(observations))
  } catch (error) {
    console.info(`[TERM03 OBS] kunde inte skriva observationsfil: ${String(error)}`)
  }
  for (const t of tenants) await removeAdminFixtureUser(t.admin)
})

async function setupTenant(): Promise<{ tenant: TermTenant; session: AppSession }> {
  const tenant = await createTermTenant({ permissionKeys: PERMS })
  tenants.push(tenant)
  disableConsumptionEstimates(tenant.companyId)
  const session = await loginSession(tenant.admin.email, tenant.admin.password, { companyId: tenant.companyId })
  return { tenant, session }
}

async function lockedSpot(area: PriceAreaCode, month: string, points: readonly Point[], session: AppSession) {
  insertSpotIntervals(area, toSpotIntervals(points, 'hourly'))
  return prepareAndLockSpotMonth(area, month, session)
}

function expectGenerate(res: Awaited<ReturnType<typeof generateUnderlay>>): GenerateUnderlayData {
  expect(res.status, `generate-underlay HTTP ${res.status}: ${res.text}`).toBe(200)
  expect(res.data, `generate-underlay saknar data: ${res.text}`).toBeTruthy()
  return res.data!
}
function underlayFor(companyId: string, month: string, c: SignedContractFixture, gen: GenerateUnderlayData): { row: UnderlayDbRow; result: UnderlayResult } {
  const rows = readUnderlaysForMonth(companyId, month).filter((r) => r.metering_point_id === c.meteringPointId)
  expect(rows, `underlag för mätpunkt ${c.meteringPointId} i ${month}`).toHaveLength(1)
  const result = gen.results.find((r) => r.underlayId === rows[0].id)
  expect(result, `generate-underlay-resultat för underlag ${rows[0].id}`).toBeTruthy()
  return { row: rows[0], result: result! }
}

// ---------------------------------------------------------------- delperiod: gemensam körning (TERM03.01, .02, .03, .05a, .05c)

type Variant = { policy?: 'prorated_by_days' }
type PartialSpec = {
  id: string
  area: PriceAreaCode
  month: string
  /** Hela månadens punkter (mätvärden och spotpris); oraklet tar delmängden. */
  allPoints: Point[]
  /** Avtalsstart (affärsdatum) och leveransperiod (end_date inklusivt, null = pågående). */
  startsAt: string
  supplyStart: string
  supplyEnd: string | null
  /** Förväntad levererad dag (första) och första dag efter leveransen (exklusiv), räknade oberoende av appen. */
  firstDay: string
  endExclusiveDay: string
  variants: Variant[]
  /** Extra mätvärden utanför månaden (bara TERM03.03). */
  extraValues?: Point[]
}

type PartialCtx = {
  tenant: TermTenant; session: AppSession; gen: GenerateUnderlayData
  runs: Array<{ variant: Variant; contract: SignedContractFixture }>
  subset: Point[]
}

function subsetOf(spec: PartialSpec): Point[] {
  const { y: fy, m: fm, d: fd } = parseYmd(spec.firstDay)
  const { y: ey, m: em, d: ed } = parseYmd(spec.endExclusiveDay)
  const startMs = stockholmMidnightUtcMs(fy, fm, fd)
  const endMs = stockholmMidnightUtcMs(ey, em, ed)
  return spec.allPoints.filter((p) => p.slot.startMs >= startMs && p.slot.endMs <= endMs)
}

const dayDiff = (a: string, b: string): number => { const x = parseYmd(a); const y = parseYmd(b); return daysFromCivil(y.y, y.m, y.d) - daysFromCivil(x.y, x.m, x.d) }

async function setupPartial(spec: PartialSpec): Promise<PartialCtx> {
  const before = spotImportFootprint()
  void before
  const { tenant, session } = await setupTenant()
  await lockedSpot(spec.area, spec.month, spec.allPoints, session)
  const runs: PartialCtx['runs'] = []
  for (const variant of spec.variants) {
    const contract = await createSignedContract(tenant, {
      contractType: 'variable_hourly', bindingMonths: 0, noticeMonths: 1, startsAt: spec.startsAt, priceArea: spec.area, monthlyFeeSek: Number(FEE), prorationPolicy: variant.policy,
    })
    createSupplyPeriod(contract, { startsOn: spec.supplyStart, endsOn: spec.supplyEnd, status: spec.supplyEnd ? 'ended' : 'active' })
    insertMeteringValues(contract, toMeterValues(spec.allPoints, 'PT60M'))
    if (spec.extraValues?.length) insertMeteringValues(contract, toMeterValues(spec.extraValues, 'PT60M'), { tag: 'sim-term03-extra' })
    runs.push({ variant, contract })
  }
  const gen = expectGenerate(await generateUnderlay(session, spec.month))
  return { tenant, session, gen, runs, subset: subsetOf(spec) }
}

/** Underlag och prissättning för ett avtal i en delperiod, mot oraklet. */
async function checkPartial(spec: PartialSpec, ctx: PartialCtx, run: PartialCtx['runs'][number]): Promise<{ row: UnderlayDbRow; feeKind: string }> {
  const label = `${spec.id}${run.variant.policy ? ' med proration_policy' : ' utan proration_policy'}`
  const { row, result } = underlayFor(ctx.tenant.companyId, spec.month, run.contract, ctx.gen)
  const cls = classifyUnderlayWarnings(result.warnings)
  observe(label, { underlayStatus: result.status, readiness: row.readiness_status, totalKwh: row.total_kwh, periodStart: row.billing_period_start, periodEnd: row.billing_period_end, sourceRows: result.sourceRows, sourceMeterValueCount: row.source_meter_value_count, warnings: cls })
  expect(cls.coverage, `${label}: täcknings-/överlappsvarningar`).toEqual([])

  // Underlagets kWh och intervall = bara levererade intervall (oraklets delmängd).
  const subset = ctx.subset
  expect(subset.length, `${label}: oraklets antal intervall`).toBeGreaterThan(0)
  expect(row.total_kwh, `${label}: total_kwh saknas`).not.toBeNull()
  expect(decToString(dec(row.total_kwh!)), `${label}: total_kwh (bara levererad del)`).toBe(decToString(sumKwh(toOracle(subset))))
  const items = readUnderlayItems(row.id)
  expect(items, `${label}: antal underlagsrader`).toHaveLength(subset.length)
  const bad: string[] = []
  items.forEach((it, i) => {
    const p = subset[i]
    if (Date.parse(it.period_start) !== p.slot.startMs || Date.parse(it.period_end) !== p.slot.endMs || decCmp(dec(it.quantity_kwh), dec(whToKwh(p.wh))) !== 0) {
      bad.push(`#${i} app ${it.period_start}..${it.period_end} ${it.quantity_kwh}; väntat ${isoUtc(p.slot.startMs)}..${isoUtc(p.slot.endMs)} ${whToKwh(p.wh)}`)
    }
  })
  expect(bad.slice(0, 5), `${label}: underlagsrader avviker (${bad.length} st)`).toEqual([])
  expect(Date.parse(items[0].period_start), `${label}: första intervallets start`).toBe(subset[0].slot.startMs)
  expect(Date.parse(items[items.length - 1].period_end), `${label}: sista intervallets slut`).toBe(subset[subset.length - 1].slot.endMs)

  // Prissättning
  const terms = readContractTerms(run.contract)
  const energyTerms: OracleTerms = { ...terms, monthlyFeeSek: null, invoiceFeeSek: null }
  const energy = oracleInvoice({ intervals: toOracle(subset), terms: energyTerms }, 'half_away')
  expect(halfCaseLines(energy, 0.001), `${label}: datat ligger nära/på ett halvt öre`).toEqual([])
  const res = await pricePreview(ctx.session, { underlayId: row.id })
  expect(res.status, `${label}: preview HTTP ${res.status}: ${res.text}`).toBe(200)
  const data = res.data!
  expect(data.status, `${label}: preview-status; fel: ${data.errors.join(' | ')}`).toBe('success')
  const lines = appLinesOre(data)
  const diffs: string[] = []
  for (const o of energy.lines) {
    const m = lines.filter((l) => l.kind === o.code)
    if (m.length !== 1) { diffs.push(`${o.code}: ${m.length} rader (väntade 1)`); continue }
    if (m[0].exVatOre !== o.exVatOre) diffs.push(`${o.code} exkl: app ${m[0].exVatOre} orakel ${o.exVatOre} (exakt ${o.exVatExactSek})`)
    if (m[0].vatOre !== o.vatOre) diffs.push(`${o.code} moms: app ${m[0].vatOre} orakel ${o.vatOre}`)
  }
  for (const l of lines) if (!['spot', 'markup', 'monthly_fee'].includes(l.kind)) diffs.push(`extra rad ${l.kind} "${l.description}"`)
  expect(diffs, `${label}: energirader mot oraklet`).toEqual([])

  // Månadsavgift: oraklets pro rata = levererade dagar / dagar i månaden (ren kalender), ören halv-bort-från-noll.
  const deliveredDays = dayDiff(spec.firstDay, spec.endExclusiveDay)
  const { y, m } = parseYmd(spec.firstDay)
  const monthDays = daysInMonth(y, m)
  const fullOre = roundDec(dec(FEE), 2, 'half_away')
  const proOre = ratioRound(decMul(dec(FEE), dec(deliveredDays)), dec(monthDays), 2, 'half_away')
  const fee = lines.filter((l) => l.kind === 'monthly_fee')
  expect(fee, `${label}: antal månadsavgiftsrader`).toHaveLength(1)
  const feeKind = fee[0].exVatOre === fullOre ? 'hel månad' : fee[0].exVatOre === proOre ? `pro rata ${deliveredDays}/${monthDays}` : 'annat'
  observe(`${label} månadsavgift`, { appFeeExVatOre: fee[0].exVatOre, fullMonthOre: fullOre, proRataOre: proOre, fraction: `${deliveredDays}/${monthDays}`, appChose: feeKind, appVatOre: fee[0].vatOre })
  let expectedFee = fee[0].exVatOre
  if (run.variant.policy) {
    expect(fee[0].exVatOre, `${label}: med proration_policy ska avgiften vara ${deliveredDays}/${monthDays} av ${FEE} = ${proOre} öre; appen valde "${feeKind}" (${fee[0].exVatOre} öre)`).toBe(proOre)
    expectedFee = proOre
  } else {
    // Produktregel (ägarbeslut 013(a), samordningen 2026-10-30): proration kräver explicit opt-in i komponentens metadata
    // (lib/pricing/priceComponentCalculator.ts:114-138). Utan policy ska en delperiod debiteras exakt hel månad.
    expect(fee[0].exVatOre, `${label}: utan proration_policy ska avgiften vara hel månad = ${fullOre} öre; appen valde "${feeKind}" (${fee[0].exVatOre} öre)`).toBe(fullOre)
    expectedFee = fullOre
  }
  expect(fee[0].vatOre, `${label}: moms på månadsavgiften`).toBe(vatOnOre(expectedFee, terms.vatPercent, 'half_away'))
  const wantEx = energy.totalExVatOre + expectedFee
  const wantVat = energy.totalVatOre + vatOnOre(expectedFee, terms.vatPercent, 'half_away')
  expect({ ex: sekNumberToOre(data.totalExVat), vat: sekNumberToOre(data.vatAmount), inc: sekNumberToOre(data.totalIncVat) }, `${label}: totaler`).toEqual({ ex: wantEx, vat: wantVat, inc: wantEx + wantVat })
  return { row, feeKind }
}

const ENERGY_TERMS: OracleTerms = { markupOrePerKwh: '4', monthlyFeeSek: null, invoiceFeeSek: null, vatPercent: 25 }

/**
 * Justerar förbrukningen i delperiodens sista intervall (+k Wh) tills inga energirader eller momsbelopp ligger nära ett halvt öre
 * i delperioden. Datakontrollen i checkPartial (halfCaseLines) är kvar. Spotpriserna ändras inte (delas med term02).
 */
function untied(spec: PartialSpec): PartialSpec {
  const sub = subsetOf(spec)
  const idx = spec.allPoints.indexOf(sub[sub.length - 1])
  for (let k = 0; k < 400; k += 1) {
    const pts = spec.allPoints.map((p, i) => (i === idx ? { ...p, wh: p.wh + k } : p))
    const trial = { ...spec, allPoints: pts }
    if (halfCaseLines(oracleInvoice({ intervals: toOracle(subsetOf(trial)), terms: ENERGY_TERMS }, 'half_away'), 0.001).length === 0) return trial
  }
  throw new Error(`${spec.id}: hittade ingen förbrukningsjustering utan halva ören`)
}

function partialDescribe(spec0: PartialSpec, title: string, extra?: (get: () => Promise<PartialCtx>) => void) {
  const spec = untied(spec0)
  describe(title, () => {
    const setup = lazy(() => setupPartial(spec))
    for (const [i, variant] of spec.variants.entries()) {
      it(`${spec.id} ${variant.policy ? 'månadsavgift MED proration_policy' : 'månadsavgift UTAN proration_policy (appens val registreras)'}`, async () => {
        const ctx = await setup()
        await checkPartial(spec, ctx, ctx.runs[i])
      }, LONG)
    }
    extra?.(setup)
  })
}

// ---------------------------------------------------------------- TERM03.01

const SEP = '2026-09'
partialDescribe({
  id: 'TERM03.01 start mitt i månaden', area: 'SE1', month: SEP, allPoints: term0201Hourly(SEP), startsAt: '2026-09-15', supplyStart: '2026-09-15', supplyEnd: null,
  firstDay: '2026-09-15', endExclusiveDay: '2026-10-01', variants: [{}, { policy: 'prorated_by_days' }],
}, 'TERM03.01 timavtal med leveransstart 2026-09-15 (mätvärden hela september, SE1)', (get) => {
  it('TERM03.01 orakelfakta: 384 timmar från 2026-09-14T22:00Z och ingen kWh före leveransstart', async () => {
    const ctx = await get()
    expect(ctx.subset).toHaveLength(384)
    expect(isoUtc(ctx.subset[0].slot.startMs)).toBe('2026-09-14T22:00:00.000Z')
    const { row } = underlayFor(ctx.tenant.companyId, SEP, ctx.runs[0].contract, ctx.gen)
    const all = sumKwh(toOracle(term0201Hourly(SEP)))
    expect(decCmp(dec(row.total_kwh!), all), 'underlagets kWh är mindre än hela månadens').toBe(-1)
    expect(readUnderlayItems(row.id).every((it) => Date.parse(it.period_start) >= Date.parse('2026-09-14T22:00:00Z'))).toBe(true)
  }, LONG)
})

// ---------------------------------------------------------------- TERM03.02

partialDescribe({
  id: 'TERM03.02 avslut mitt i månaden', area: 'SE2', month: SEP, allPoints: term0202Hourly(SEP), startsAt: '2026-09-01', supplyStart: '2026-09-01', supplyEnd: '2026-09-15',
  firstDay: '2026-09-01', endExclusiveDay: '2026-09-16', variants: [{}, { policy: 'prorated_by_days' }],
}, 'TERM03.02 leveransperiod som slutar 2026-09-15 (SE2)', (get) => {
  it('TERM03.02 slutdatumets konvention fastställs och loggas; sista intervallet slutar 2026-09-15T22:00Z', async () => {
    const ctx = await get()
    const { row } = underlayFor(ctx.tenant.companyId, SEP, ctx.runs[0].contract, ctx.gen)
    const items = readUnderlayItems(row.id)
    const lastEnd = isoUtc(Date.parse(items[items.length - 1].period_end))
    const convention = lastEnd === '2026-09-15T22:00:00.000Z' ? 'inklusivt (hela den 15:e levereras)' : lastEnd === '2026-09-14T22:00:00.000Z' ? 'exklusivt (den 15:e levereras inte)' : `annat (${lastEnd})`
    console.info(`[TERM03.02] KONVENTION: leveransperiodens end_date är ${convention}. Kod: underlayEngine.ts:344-346 (segment slutar vid end_date+1); avtalets ends_at/ended_at: contractCoversSegment underlayEngine.ts:329-331 (end+1, dvs inklusivt). Observerat sista intervallslut ${lastEnd}.`)
    observe('TERM03.02 konvention', { lastItemEnd: lastEnd, convention })
    expect(lastEnd).toBe('2026-09-15T22:00:00.000Z')
    expect(ctx.subset).toHaveLength(360)
  }, LONG)
})

// ---------------------------------------------------------------- TERM03.03

const OCT = '2026-10'
const octPoints = term0201Hourly(OCT)
const edgeBefore: Point = { slot: { startMs: Date.parse('2026-09-30T21:00:00Z'), endMs: Date.parse('2026-09-30T22:00:00Z'), index: -1 }, wh: 777, p4: 0 }
const edgeAfter: Point = { slot: { startMs: Date.parse('2026-10-31T23:00:00Z'), endMs: Date.parse('2026-11-01T00:00:00Z'), index: -2 }, wh: 888, p4: 0 }
partialDescribe({
  id: 'TERM03.03 start och slut vid månadsskifte', area: 'SE1', month: OCT, allPoints: octPoints, startsAt: '2026-10-01', supplyStart: '2026-10-01', supplyEnd: '2026-10-31',
  firstDay: '2026-10-01', endExclusiveDay: '2026-11-01', variants: [{}, { policy: 'prorated_by_days' }], extraValues: [edgeBefore, edgeAfter],
}, 'TERM03.03 period 2026-10-01 till 2026-10-31 (oktober med sommartidens slut, SE1)', (get) => {
  it('TERM03.03 exakt 745 timmar; 2026-09-30T22:00Z med, 2026-10-31T23:00Z utanför; full månadsavgift', async () => {
    const ctx = await get()
    expect(hoursInMonth(OCT), 'oraklets timmar i oktober').toBe(745)
    expect(ctx.subset).toHaveLength(745)
    for (const run of ctx.runs) {
      const { row } = underlayFor(ctx.tenant.companyId, OCT, run.contract, ctx.gen)
      const items = readUnderlayItems(row.id)
      expect(items, 'antal underlagsrader').toHaveLength(745)
      expect(isoUtc(Date.parse(items[0].period_start)), 'första intervallet ingår').toBe('2026-09-30T22:00:00.000Z')
      expect(isoUtc(Date.parse(items[items.length - 1].period_end)), 'sista intervallet slutar vid månadsskiftet').toBe('2026-10-31T23:00:00.000Z')
      expect(items.some((it) => Date.parse(it.period_start) === edgeBefore.slot.startMs), 'septemberintervallet 21:00Z ingår inte').toBe(false)
      expect(items.some((it) => Date.parse(it.period_start) === edgeAfter.slot.startMs), 'novemberintervallet 2026-10-31T23:00Z ingår inte').toBe(false)
      expect(decToString(dec(row.total_kwh!)), 'kWh exkl. kantintervallen').toBe(decToString(sumKwh(toOracle(octPoints))))
    }
  }, LONG)
})

// ---------------------------------------------------------------- TERM03.04

function addMonthsClamp(day: string, months: number): string {
  const { y, m, d } = parseYmd(day)
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return ymd(ny, nm, Math.min(d, daysInMonth(ny, nm)))
}

describe('TERM03.04 uppsägning före och efter verklig frist', () => {
  const cases = [
    { key: 'A binding 12, mottagning 2026-11-30', binding: 12, receive: '2026-11-30' },
    { key: 'B binding 12, mottagning 2026-12-02', binding: 12, receive: '2026-12-02' },
    { key: 'C binding 0, mottagning 2026-11-30', binding: 0, receive: '2026-11-30' },
    { key: 'D binding 0, mottagning 2027-01-31 (klampat)', binding: 0, receive: '2027-01-31' },
  ]
  const setup = lazy(async () => {
    const { tenant, session } = await setupTenant()
    return { tenant, session }
  })
  for (const c of cases) {
    it(`TERM03.04 ${c.key}: ended_at = max(bindningsslut exklusivt, mottagning + 1 månad)`, async () => {
      const { tenant, session } = await setup()
      const contract = await createSignedContract(tenant, { contractType: 'variable_hourly', bindingMonths: c.binding, noticeMonths: 1, startsAt: '2026-01-01', priceArea: 'SE3' })
      // BACKENDERSÄTTNING: leveransstart (actual_start_date) sätts med SQL; appens härledning av ended_at kräver den (db.ts addCustomerContractEvent).
      psql(`UPDATE public.customer_contracts SET actual_start_date='2026-01-01' WHERE id='${contract.contractId}';`)
      const form = new FormData()
      form.append('customer_id', contract.customerId); form.append('customer_contract_id', contract.contractId)
      form.append('event_type', 'termination_notice_received'); form.append('happened_at', c.receive); form.append('note', 'sim TERM03.04')
      const r = await callServerAction(session, {
        route: `/admin/customers/${contract.customerId}`, filename: 'components/admin/customers/contracts/actions.ts', exportedName: 'logContractEventAction',
        args: [form], worker: 'app/admin/customers/[id]/page',
      })
      expect(r.httpStatus >= 400 || r.threw, `logContractEventAction HTTP ${r.httpStatus} kastade=${r.threw} ${r.errorRows.join(' | ')} (se app.log)`).toBe(false)

      const bindEnd = c.binding > 0 ? addMonthsClamp('2026-01-01', c.binding) : null
      const noticeEnd = addMonthsClamp(c.receive, 1)
      const expected = bindEnd !== null && bindEnd > noticeEnd ? bindEnd : noticeEnd
      const [row] = psqlRows<{ ended_at: string | null; termination_notice_date: string | null; ends_at: string | null; status: string; binding_months: number | null; notice_months: number | null }>(
        `select ended_at,termination_notice_date,ends_at,status,binding_months,notice_months from public.customer_contracts where id='${contract.contractId}'`)
      const page = await readContractPage(session, contract.customerId)
      console.info(`[TERM03.04 ${c.key}] KONVENTION ended_at: lagras som härlett datum kl 00:00 UTC (db.ts addCustomerContractEvent + gridex_record_customer_contract_event_v1: ended_at = p_derived_ends_at), dvs bindningsslut EXKLUSIVT; underlayEngine contractCoversSegment (underlayEngine.ts:329-331) läser ended_at som INKLUSIVT (+1 dag). Oraklet: max(${bindEnd ?? '-'}, ${noticeEnd}) = ${expected}.`)
      console.info(`[TERM03.04 ${c.key}] DB ended_at=${row.ended_at} termination_notice_date=${row.termination_notice_date} ends_at=${row.ends_at} status=${row.status}; adminsidan: Aktuellt slutdatum=${page.aktuelltSlutdatum} Uppsägning mottagen=${page.uppsagningMottagen} Explicit slut=${page.explicitSlut} Start=${page.start}`)
      observe(`TERM03.04 ${c.key}`, { expected, bindEnd, noticeEnd, endedAt: row.ended_at, noticeDate: row.termination_notice_date, page })
      expect(row.ended_at, 'ended_at sparades inte (null)').not.toBeNull()
      expect(new Date(row.ended_at!).toISOString(), `ended_at: väntat ${expected}T00:00:00.000Z`).toBe(`${expected}T00:00:00.000Z`)
      expect(new Date(row.termination_notice_date!).toISOString(), 'termination_notice_date = mottagningsdatum').toBe(`${c.receive}T00:00:00.000Z`)
      expect(page.start, 'visad start = DB-start (ingen tidszonsförskjutning)').toBe('2026-01-01')
      expect(page.uppsagningMottagen, 'adminsidans Uppsägning mottagen').toBe(c.receive)
      expect(page.aktuelltSlutdatum, 'adminsidans Aktuellt slutdatum').toBe(expected)
    }, LONG)
  }
})

describe('TERM03.04 negativt kontrollfall (observation, inget krav)', () => {
  it('TERM03.04 uppsägningsmottagning två gånger och före avtalets start: ended_at ändras inte tyst (registreras)', async () => {
    const { tenant, session } = await setupTenant()
    const c = await createSignedContract(tenant, { contractType: 'variable_hourly', bindingMonths: 0, noticeMonths: 1, startsAt: '2026-01-01', priceArea: 'SE3' })
    psql(`UPDATE public.customer_contracts SET actual_start_date='2026-01-01' WHERE id='${c.contractId}';`)
    const send = async (receive: string) => {
      const form = new FormData()
      form.append('customer_id', c.customerId); form.append('customer_contract_id', c.contractId)
      form.append('event_type', 'termination_notice_received'); form.append('happened_at', receive); form.append('note', 'sim TERM03.04 kontroll')
      const r = await callServerAction(session, { route: `/admin/customers/${c.customerId}`, filename: 'components/admin/customers/contracts/actions.ts', exportedName: 'logContractEventAction', args: [form], worker: 'app/admin/customers/[id]/page' })
      const [row] = psqlRows<{ ended_at: string | null; termination_notice_date: string | null }>(`select ended_at,termination_notice_date from public.customer_contracts where id='${c.contractId}'`)
      const events = Number(psql(`select count(*) from public.customer_contract_events where customer_contract_id='${c.contractId}' and event_type='termination_notice_received'`))
      return { receive, http: r.httpStatus, threw: r.threw, endedAt: row.ended_at, noticeDate: row.termination_notice_date, noticeEvents: events }
    }
    const first = await send('2026-11-30')
    const same = await send('2026-11-30')
    const later = await send('2026-12-15')
    const beforeStart = await send('2025-12-31')
    observe('TERM03.04 negativ kontroll', { first, sameAgain: same, later, beforeContractStart: beforeStart,
      note: 'Observation: första mottagningen ger ended_at 2026-12-30. Se om upprepning/senare/före-start ändrar ended_at eller termination_notice_date (RPC sätter ended_at = coalesce(härlett, ended_at) och termination_notice_date = happened_at utan villkor).' })
    console.info(`[TERM03.04 negativ kontroll] ${json({ first, same, later, beforeStart })}`)
    expect(first.http).toBeLessThan(400)
    expect(new Date(first.endedAt!).toISOString()).toBe('2026-12-30T00:00:00.000Z')
  }, LONG)
})

// ---------------------------------------------------------------- TERM03.05

const sepSe3 = term0203Hourly(SEP).map((p) => ({ ...p, wh: hourlyShapeWh(p.slot.startMs) }))

partialDescribe({
  id: 'TERM03.05a leverantörsbyte: vårt avtal startar vid bytesdatum', area: 'SE3', month: SEP, allPoints: sepSe3, startsAt: '2026-09-15', supplyStart: '2026-09-15', supplyEnd: null,
  firstDay: '2026-09-15', endExclusiveDay: '2026-10-01', variants: [{}],
}, 'TERM03.05(a) bytesdatum 2026-09-15, mätvärden från 1 september (SE3): ingen kWh före bytet', (get) => {
  it('TERM03.05a underlaget tar inte med kWh före bytet', async () => {
    const ctx = await get()
    const { row } = underlayFor(ctx.tenant.companyId, SEP, ctx.runs[0].contract, ctx.gen)
    const all = sumKwh(toOracle(sepSe3))
    const sinceSwitch = sumKwh(toOracle(ctx.subset))
    expect(decCmp(sinceSwitch, all)).toBe(-1)
    expect(decToString(dec(row.total_kwh!))).toBe(decToString(sinceSwitch))
    expect(readUnderlayItems(row.id).filter((it) => Date.parse(it.period_start) < Date.parse('2026-09-14T22:00:00Z'))).toHaveLength(0)
  }, LONG)
})

describe('TERM03.05(b) två av våra avtal på samma mätpunkt med överlappande perioder 10-20 september (SE3)', () => {
  it('TERM03.05b appen flaggar överlapp och debiterar inte samma kWh två gånger (exakt utfall registreras)', async () => {
    const { tenant, session } = await setupTenant()
    await lockedSpot('SE3', SEP, sepSe3, session)
    const c1 = await createSignedContract(tenant, { contractType: 'variable_hourly', bindingMonths: 0, noticeMonths: 1, startsAt: '2026-09-01', priceArea: 'SE3', monthlyFeeSek: Number(FEE) })
    createSupplyPeriod(c1, { startsOn: '2026-09-01', endsOn: '2026-09-20', status: 'active' })
    insertMeteringValues(c1, toMeterValues(sepSe3, 'PT60M'))
    // Ett generiskt action-/SQL-fel bevisar inte avvisad överlappning eller frånvaro av commit.
    // Låt alla setupfel fortplantas; endast det faktiskt skapade överlappsfallet prövas nedan.
    const c2 = await createSignedContract(tenant, { contractType: 'variable_hourly', bindingMonths: 0, noticeMonths: 1, startsAt: '2026-09-10', priceArea: 'SE3', monthlyFeeSek: Number(FEE),
      existing: { customerId: c1.customerId, siteId: c1.siteId, meteringPointId: c1.meteringPointId, gsrn: c1.gsrn } })
    createSupplyPeriod(c2, { startsOn: '2026-09-10', endsOn: null, status: 'active' })
    const gen = expectGenerate(await generateUnderlay(session, SEP))
    const underlays = readUnderlaysForMonth(tenant.companyId, SEP).filter((r) => r.metering_point_id === c1.meteringPointId)
    expect(underlays.length, 'överlappsfallet ska ha faktiska underlag att kontrollera').toBeGreaterThan(0)
    const billed = underlays.reduce((acc, r) => acc + Number(dec(r.total_kwh ?? '0').n) / 10 ** dec(r.total_kwh ?? '0').s, 0)
    const measured = Number(decToString(sumKwh(toOracle(sepSe3))))
    const overlapWarnings = gen.results.filter((r) => r.warnings.some((w) => /Överlappande leveransperioder/i.test(w)))
    observe('TERM03.05b', {
      outcome: 'generate-underlay klart', results: gen.results.map((r) => ({ status: r.status, underlayId: r.underlayId, warnings: r.warnings })),
      underlays: underlays.map((r) => ({ id: r.id, status: r.status, totalKwh: r.total_kwh, supplyPeriodId: r.supply_period_id, contractId: r.contract_id })), billedKwh: billed, measuredKwh: measured,
    })
    console.info(`[TERM03.05b] UTFALL: ${overlapWarnings.length} överlappsvarning(ar); ${underlays.length} underlag på mätpunkten; debiterad kWh ${billed} av uppmätt ${measured}.`)
    expect(overlapWarnings.length, 'appen ska markera needs_review/överlappsvarning (Överlappande leveransperioder)').toBeGreaterThan(0)
    expect(overlapWarnings.every((r) => r.status === 'needs_review')).toBe(true)
    expect(billed, 'debiterad kWh över båda avtalen får inte överstiga uppmätt').toBeLessThanOrEqual(measured + 1e-9)
  }, LONG)
})

partialDescribe({
  id: 'TERM03.05c leverantörsbyte bort från oss 2026-09-20', area: 'SE3', month: SEP, allPoints: sepSe3, startsAt: '2026-09-01', supplyStart: '2026-09-01', supplyEnd: '2026-09-20',
  firstDay: '2026-09-01', endExclusiveDay: '2026-09-21', variants: [{}],
}, 'TERM03.05(c) bytet bort 2026-09-20: perioden slutar och inga kWh efter den (SE3)', (get) => {
  it('TERM03.05c inga kWh efter 2026-09-20', async () => {
    const ctx = await get()
    const { row } = underlayFor(ctx.tenant.companyId, SEP, ctx.runs[0].contract, ctx.gen)
    expect(ctx.subset).toHaveLength(480)
    const items = readUnderlayItems(row.id)
    expect(items.filter((it) => Date.parse(it.period_end) > Date.parse('2026-09-20T22:00:00Z'))).toHaveLength(0)
    expect(decToString(dec(row.total_kwh!))).toBe(decToString(sumKwh(toOracle(ctx.subset))))
  }, LONG)
})
