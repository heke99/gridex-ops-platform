// simulation: TERM02.01, TERM02.02, TERM02.03, TERM02.04, TERM02.05, TERM02.06, TERM02.07, TERM02.08
// executionScope: ISOLATED_NATIVE
// Elfakturans belopp mot ett oberoende orakel (lib/term-oracle.ts: BigInt-aritmetik, egen DST-regel, tre avrundningslägen).
// Läsvägar: appens riktiga rutter via HTTP med admin-cookie-session (POST /api/internal/billing/generate-underlay,
// /api/internal/pricing/preview, /api/internal/spot/lock-month) samt rader i stackens databas. Ingen webbläsare
// (Playwright); executionScope är HTTP + psql. Auth/JWT = real tid; affärsdatum/månader är explicita.
//
// BACKENDERSÄTTNINGAR (detaljer och vad de inte verifierar: lib/term-billing.ts, filhuvudet B1-B5):
//  B1 leveransperiod som SQL-rad, B2 mätvärden som SQL-rader (kan inte bli "qualified" => underlag blir needs_review),
//  B3 spotintervall som SQL-rader, B4 dagssammanställningar som SQL + månadslåsning via appens route, B5 estimering av
//  saknad förbrukning avstängd per tenant. Därför bedöms underlaget som "täckningsrent" (inga täcknings-/överlapps-
//  varningar, exakta antal och summor) och inte som ready_for_pricing; se classifyUnderlayWarnings.
//
// Månader: 2026-09 och 2026-08 (inga DST-hopp), 2027-03 (vårhopp 2027-03-28, 92 kvartar) och 2027-10 (höstbyte
// 2027-10-31, 100 kvartar). Spotdata är global per (elområde, månad); varje ID har därför eget elområde/egen månad:
//   01 SE1 2026-09 | 02 SE2 2026-09 | 03 SE3 2026-09 | 08 SE4 2026-09 | 04 SE1+SE2 2026-08
//   05 SE3 2027-03 | 06 SE2 2027-10 | 07 SE4 2027-10
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loginSession, psqlRows, removeAdminFixtureUser, SIM_HOME, type AppSession } from '../lib'
import { createSignedContract, createTermTenant, type SignedContractFixture, type TermTenant } from '../lib/term-fixture'
import {
  appLineKind, appLinesOre, checkInvoiceArithmetic, classifyUnderlayWarnings, createSupplyPeriod, describeApp, diffAgainstOracle,
  disableConsumptionEstimates, generateUnderlay, insertMeteringValues, insertSpotIntervals, pricePreview, prepareAndLockSpotMonth,
  readContractTerms, readSourceBasisSummary, readUnderlay, readUnderlayItems, readUnderlaysForMonth, spotImportFootprint,
  type GenerateUnderlayData, type PreviewData, type PriceAreaCode, type UnderlayDbRow, type UnderlayResult,
} from '../lib/term-billing'
import {
  civilFromDays, dec, decAdd, decCmp, decMul, decToString, describeLocal, divRound, daysFromCivil, halfCaseLines, isoUtc,
  oracleAllModes, oracleInvoice, oreToSek, hoursInDay, hoursInMonth, quartersInDay, quartersInMonth, ratioRound, ROUND_MODES, roundDec, sekNumberToOre,
  stockholmDateOf, stockholmDayBoundsUtc, stockholmLocalToUtcCandidates, stockholmMonthBoundsUtc, stockholmOffsetMinutes,
  sumEnergy, sumKwh, vatOnOre, weightedPrice, ymd, type OracleInterval, type OracleTerms, type RoundMode,
} from '../lib/term-oracle'
import {
  DUP_HOUR_FIRST_UTC, DUP_HOUR_SECOND_UTC, HALF_CASES, dstHourlySeries, dstQuarterSeries, faultyDstDaySeries, faultyDstHourlySeries, quartersOnHourlyPrices, term0201Hourly,
  term0202Hourly, term0203Hourly, term0204HourlyPrices, term0204HourlyWh, term0204QuarterPrices, term0204QuarterWh, term0207Hourly,
  term0208Consumption, term0208Prices, term02OriginalExampleHourly, ORIGINAL_EXAMPLE_WH, ORIGINAL_EXAMPLE_P4, toMeterValues, toOracle, toSpotIntervals, whToKwh, p4ToSek, type Point,
} from '../lib/term02-data'

const PERMS = ['billing_underlay.read', 'billing_underlay.export', 'pricing.read', 'pricing.write', 'customers.read', 'contracts.read', 'masterdata.read']
const RUN_DIR = process.env.RUN_DIR ?? '/root/sim/track2'
const LONG = 1_800_000

// ---------------------------------------------------------------- gemensam uppsättning

const tenants: TermTenant[] = []
const observations: Array<{ id: string; data: unknown }> = []
let footprint0: { runs: number; jobs: number } | null = null
const ensureFootprint = () => { footprint0 ??= spotImportFootprint() }

/** Engångsuppställning per ID som körs första gången ett steg behöver den. Ett fel ger ett FAILED steg med orsaken
 * (inte skippade steg, som vitest rapporterar när en beforeAll kastar), och senare steg i samma ID får samma fel. */
function lazy(fn: () => Promise<void>): () => Promise<void> {
  let promise: Promise<void> | null = null
  return () => (promise ??= fn())
}

const json = (value: unknown): string => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
/** Registrering (logg, ingen assert): hamnar i körloggen och i SIM_HOME/reports/term02-observations-*.json. */
function observe(id: string, data: Record<string, unknown>): void {
  observations.push({ id, data })
  console.info(`[${id} OBS] ${json(data)}`)
}

afterAll(async () => {
  try {
    const dir = path.join(SIM_HOME, 'reports')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `term02-observations-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), json(observations))
  } catch (error) {
    console.info(`[TERM02 OBS] kunde inte skriva observationsfil: ${String(error)}`)
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

async function newContract(tenant: TermTenant, o: { type: 'variable_hourly' | 'variable_quarterly' | 'variable_monthly'; area: PriceAreaCode; fee?: number }): Promise<SignedContractFixture> {
  const contract = await createSignedContract(tenant, {
    contractType: o.type, bindingMonths: 0, noticeMonths: 1, startsAt: '2026-01-01', priceArea: o.area, monthlyFeeSek: o.fee,
  })
  createSupplyPeriod(contract, { startsOn: '2026-01-01', endsOn: null, status: 'active' })
  return contract
}

async function spot(area: PriceAreaCode, month: string, step: 'hourly' | 'quarter_hour', points: readonly Point[], session: AppSession) {
  insertSpotIntervals(area, toSpotIntervals(points, step))
  return prepareAndLockSpotMonth(area, month, session)
}

function underlayFor(companyId: string, month: string, contract: SignedContractFixture, gen: GenerateUnderlayData): { row: UnderlayDbRow; result: UnderlayResult } {
  const rows = readUnderlaysForMonth(companyId, month).filter((r) => r.metering_point_id === contract.meteringPointId)
  expect(rows, `underlag för mätpunkt ${contract.meteringPointId} i ${month}`).toHaveLength(1)
  const result = gen.results.find((r) => r.underlayId === rows[0].id)
  expect(result, `generate-underlay-resultat för underlag ${rows[0].id}`).toBeTruthy()
  return { row: rows[0], result: result! }
}

function expectGenerate(res: Awaited<ReturnType<typeof generateUnderlay>>): GenerateUnderlayData {
  expect(res.status, `generate-underlay HTTP ${res.status}: ${res.text}`).toBe(200)
  expect(res.data, `generate-underlay saknar data: ${res.text}`).toBeTruthy()
  return res.data!
}

/** Underlaget är "täckningsrent": exakta antal, inga täcknings-/överlappsvarningar, inga okända varningar. */
function expectCoverageClean(id: string, row: UnderlayDbRow, result: UnderlayResult, sourceRows: number): void {
  const cls = classifyUnderlayWarnings(result.warnings)
  observe(id, { underlayStatus: result.status, rowStatus: row.status, readiness: row.readiness_status, totalKwh: row.total_kwh, sourceRows: result.sourceRows, missing: row.missing_values_count, warnings: cls })
  expect(cls.coverage, `${id}: täcknings-/överlappsvarningar`).toEqual([])
  expect(cls.other, `${id}: andra varningar än ersättningsblockerare`).toEqual([])
  expect(result.sourceRows, `${id}: antal källrader`).toBe(sourceRows)
  expect(row.source_meter_value_count, `${id}: source_meter_value_count`).toBe(sourceRows)
  expect(row.missing_values_count ?? 0, `${id}: missing_values_count`).toBe(0)
  if (result.status !== 'ready_for_pricing') {
    expect(cls.substitute.length, `${id}: needs_review utan ersättningsblockerare (varningar: ${result.warnings.join(' | ')})`).toBeGreaterThan(0)
  }
}

function expectItemsMatch(id: string, underlayId: string, points: readonly Point[]): void {
  const items = readUnderlayItems(underlayId)
  expect(items, `${id}: antal underlagsrader`).toHaveLength(points.length)
  const bad: string[] = []
  items.forEach((it, i) => {
    const p = points[i]
    if (Date.parse(it.period_start) !== p.slot.startMs || Date.parse(it.period_end) !== p.slot.endMs || decCmp(dec(it.quantity_kwh), dec(whToKwh(p.wh))) !== 0) {
      bad.push(`#${i} app ${it.period_start}..${it.period_end} ${it.quantity_kwh} kWh; väntat ${isoUtc(p.slot.startMs)}..${isoUtc(p.slot.endMs)} ${whToKwh(p.wh)} kWh`)
    }
  })
  expect(bad.slice(0, 5), `${id}: underlagsrader avviker från mätserien (${bad.length} st)`).toEqual([])
}

function expectTotalKwh(id: string, row: UnderlayDbRow, points: readonly Point[]): void {
  expect(row.total_kwh, `${id}: total_kwh saknas`).not.toBeNull()
  expect(decToString(dec(row.total_kwh!)), `${id}: total_kwh`).toBe(decToString(sumKwh(toOracle(points))))
}

/** Prissätter via appens route och jämför varje rad och totalerna mot oraklet (data får inte ligga nära ett halvt öre). */
async function priceAndCompare(session: AppSession, underlayId: string, points: readonly Point[], terms: OracleTerms, label: string): Promise<PreviewData> {
  const intervals = toOracle(points)
  const oracle = oracleAllModes({ intervals, terms })
  expect(halfCaseLines(oracle.half_away, 0.001), `${label}: datat ligger nära/på ett halvt öre; välj annat data`).toEqual([])
  const res = await pricePreview(session, { underlayId })
  expect(res.status, `${label}: preview HTTP ${res.status}: ${res.text}`).toBe(200)
  const data = res.data!
  observe(label, { app: describeApp(data), oracle: oracle.half_away.lines.map((l) => `${l.code}[ex ${l.exVatOre} moms ${l.vatOre}]`).join(' ') + ` | totals ex ${oracle.half_away.totalExVatOre} moms ${oracle.half_away.totalVatOre} inkl ${oracle.half_away.totalIncVatOre}`, warnings: data.warnings, errors: data.errors })
  expect(diffAgainstOracle(data, oracle.half_away), `${label}: appens belopp avviker från oraklet`).toEqual([])
  expect(checkInvoiceArithmetic(data, terms.vatPercent), `${label}: appens egen räkneregel`).toEqual([])
  return data
}

/** Månadsavtal: appens valda spotpris REGISTRERAS (öppen orakelfråga); räkneregler och övriga rader kontrolleras. */
async function checkMonthlyContract(session: AppSession, underlayId: string, points: readonly Point[], terms: OracleTerms, label: string): Promise<PreviewData> {
  const intervals = toOracle(points)
  const w = weightedPrice(intervals)
  const res = await pricePreview(session, { underlayId })
  expect(res.status, `${label}: preview HTTP ${res.status}: ${res.text}`).toBe(200)
  const data = res.data!
  expect(data.status, `${label}: preview-status; fel: ${data.errors.join(' | ')}`).toBe('success')
  const base = data.lines.find((l) => appLineKind(l) === 'spot')!
  expect(base, `${label}: spotrad saknas`).toBeTruthy()
  const appPrice = Number(base.metadata?.source_price_sek_per_kwh)
  const priceSum = intervals.reduce((acc, i) => decAdd(acc, dec(i.price)), dec(0))
  const simple = Number(ratioRound(priceSum, dec(intervals.length), 6, 'half_away')) / 1e6
  const candidates = { simpleAverageOfIntervals: simple, kwhWeighted: w.weightedAsNumber }
  const matches = Object.entries(candidates).filter(([, v]) => Math.abs(v - appPrice) <= 1.5e-6).map(([k]) => k)
  observe(label, {
    note: 'ÖPPEN ORAKELFRÅGA: vilket spotpris ska ett månadsavtal använda? Appen tar månadssammanställningens average_sek_per_kwh (databasens trigger = enkelt medelvärde av intervallpriserna).',
    appSpotPriceSekPerKwh: appPrice, candidates, appMatches: matches.length ? matches : ['ingen'], app: describeApp(data),
    differenceKwhWeightedVsApp: w.weightedAsNumber - appPrice,
  })
  // Konsistens (ej öppen fråga): basraden = ΣkWh × appens pris; övriga rader exakt mot oraklet; räkneregler.
  const appBaseExact = decMul(sumKwh(intervals), dec(String(appPrice)))
  const wantBase = roundDec(appBaseExact, 2, 'half_away')
  const gotBase = sekNumberToOre(base.amountExVat)
  expect(gotBase - wantBase >= -1n && gotBase - wantBase <= 1n, `${label}: basrad ${gotBase} öre mot ΣkWh × appens pris = ${wantBase} öre`).toBe(true)
  const oracle = oracleInvoice({ intervals, terms }, 'half_away')
  const diffs = diffAgainstOracle(data, oracle).filter((d) => !/^(spot|totalExVat|vatAmount|totalIncVat)/.test(d))
  expect(diffs, `${label}: övriga rader mot oraklet`).toEqual([])
  expect(checkInvoiceArithmetic(data, terms.vatPercent), `${label}: appens egen räkneregel`).toEqual([])
  return data
}

// ---------------------------------------------------------------- offline: orakel och data (kräver inte stacken)

describe('TERM02 orakel (offline)', () => {
  it('TERM02.05 COMPONENT orakel: egen DST-regel mot Intl/tzdata (2026-2028) och kvartsantal', () => {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const local = (ms: number) => {
      const p: Record<string, string> = {}
      for (const part of fmt.formatToParts(new Date(ms))) if (part.type !== 'literal') p[part.type] = part.value
      return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` }
    }
    const problems: string[] = []
    const first = daysFromCivil(2026, 1, 1)
    const last = daysFromCivil(2028, 12, 31)
    const counts = new Map<number, number>()
    for (let z = first; z <= last; z += 1) {
      const c = civilFromDays(z)
      const day = ymd(c.y, c.m, c.d)
      const b = stockholmDayBoundsUtc(day)
      const s = local(b.startMs)
      const before = local(b.startMs - 1000)
      const e = local(b.endMs)
      if (s.date !== day || s.time !== '00:00:00') problems.push(`${day}: start ${isoUtc(b.startMs)} är lokalt ${s.date} ${s.time}`)
      if (before.date === day) problems.push(`${day}: ögonblicket före start är fortfarande ${day}`)
      const next = civilFromDays(z + 1)
      if (e.date !== ymd(next.y, next.m, next.d) || e.time !== '00:00:00') problems.push(`${day}: slut ${isoUtc(b.endMs)} är lokalt ${e.date} ${e.time}`)
      let n = 0
      for (let t = b.startMs; t < b.endMs; t += 15 * 60_000) if (local(t).date === day) n += 1
      if (n !== b.minutes / 15) problems.push(`${day}: Intl ger ${n} kvartar, oraklet ${b.minutes / 15}`)
      counts.set(b.minutes / 15, (counts.get(b.minutes / 15) ?? 0) + 1)
      const offset = stockholmOffsetMinutes(b.startMs)
      const fromIntl = Date.parse(`${day}T00:00:00Z`) - b.startMs
      if (fromIntl !== offset * 60_000) problems.push(`${day}: offset vid midnatt ${offset} min, Intl-differens ${fromIntl / 60_000} min`)
    }
    expect(problems.slice(0, 8), `${problems.length} avvikelser mellan oraklets DST-regel och Intl`).toEqual([])
    expect([...counts.keys()].sort((a, b) => a - b)).toEqual([92, 96, 100])
    expect(counts.get(92)).toBe(3)
    expect(counts.get(100)).toBe(3)
    // Användarens fasta siffror
    expect(quartersInDay('2027-03-28')).toBe(92)
    expect(quartersInDay('2027-10-31')).toBe(100)
    expect(quartersInMonth('2027-03')).toBe(31 * 96 - 4)
    expect(quartersInMonth('2027-10')).toBe(31 * 96 + 4)
    expect(quartersInMonth('2026-09')).toBe(30 * 96)
    expect([hoursInDay('2027-03-28'), hoursInMonth('2027-03'), hoursInDay('2027-10-31'), hoursInMonth('2027-10')]).toEqual([23, 743, 25, 745])
    // Lokal tid: dubblerad och saknad timme
    const fold = stockholmLocalToUtcCandidates(2027, 10, 31, 2, 30)
    expect(fold.map(isoUtc)).toEqual(['2027-10-31T00:30:00.000Z', '2027-10-31T01:30:00.000Z'])
    expect(fold.map((ms) => local(ms).time)).toEqual(['02:30:00', '02:30:00'])
    expect(stockholmLocalToUtcCandidates(2027, 3, 28, 2, 30)).toEqual([])
    expect(describeLocal(Date.parse(DUP_HOUR_FIRST_UTC))).toBe('2027-10-31 02:00 +02:00')
    expect(describeLocal(Date.parse(DUP_HOUR_SECOND_UTC))).toBe('2027-10-31 02:00 +01:00')
    expect(stockholmMonthBoundsUtc('2027-03').startMs).toBe(Date.parse('2027-02-28T23:00:00Z'))
    expect(stockholmMonthBoundsUtc('2027-03').endMs).toBe(Date.parse('2027-03-31T22:00:00Z'))
    expect(stockholmMonthBoundsUtc('2027-10').endMs).toBe(Date.parse('2027-10-31T23:00:00Z'))
  })

  it('TERM02.08 COMPONENT orakel: avrundningslägen, exakta kvoter och JavaScripts Math.round (självtest)', () => {
    const table: Array<[string, bigint, bigint, bigint]> = [
      ['4.5', 5n, 4n, 5n], ['5.5', 6n, 6n, 6n], ['-4.5', -5n, -4n, -4n], ['-5.5', -6n, -6n, -5n],
      ['2.5', 3n, 2n, 3n], ['-2.5', -3n, -2n, -2n], ['0.5', 1n, 0n, 1n], ['-0.5', -1n, 0n, 0n], ['4.4', 4n, 4n, 4n], ['-4.6', -5n, -5n, -5n],
    ]
    for (const [text, away, even, up] of table) {
      const d = dec(text)
      expect([roundDec(d, 0, 'half_away'), roundDec(d, 0, 'half_even'), roundDec(d, 0, 'half_up')], `avrundning av ${text}`).toEqual([away, even, up])
    }
    // Binärt exakta belopp n/8 SEK: Math.round(x*100) ska följa half_up (mot +oändligheten) för alla n.
    for (let n = -80; n <= 80; n += 1) {
      const x = n / 8
      const sek = decToString({ n: BigInt(n) * 125n, s: 3 })
      expect(roundDec(dec(sek), 2, 'half_up'), `n=${n} x=${x}`).toBe(BigInt(Math.round(x * 100)))
    }
    // Viktat pris: exakt kvot
    const w = weightedPrice([{ kwh: '1', price: '0.1' }, { kwh: '3', price: '0.5' }])
    expect(decToString(w.energy)).toBe('1.6')
    expect(decToString(w.kwh)).toBe('4')
    expect(w.micro.half_away).toBe(400000n)
    expect(w.simpleAverageMicro).toBe(300000n)
    // Moms 25 % på tie
    expect(ROUND_MODES.map((m) => vatOnOre(2n, 25, m))).toEqual([1n, 0n, 1n])
    expect(ROUND_MODES.map((m) => vatOnOre(-2n, 25, m))).toEqual([-1n, 0n, 0n])
    expect(ROUND_MODES.map((m) => divRound(-15n, 10n, m))).toEqual([-2n, -2n, -1n])
    expect(oreToSek(1234n)).toBe('12.34')
    expect(oreToSek(-5n)).toBe('-0.05')
    expect(sekNumberToOre(0.29)).toBe(29n)
    expect(() => sekNumberToOre(0.285)).toThrow()
  })

  it('TERM02.01-08 COMPONENT data: serierna har rätt antal och inga rader nära halvt öre (utom TERM02.08)', () => {
    const terms: OracleTerms = { markupOrePerKwh: '4', monthlyFeeSek: '49', invoiceFeeSek: '19', vatPercent: 25 }
    const check = (name: string, points: Point[], t: OracleTerms = terms) => {
      const o = oracleAllModes({ intervals: toOracle(points), terms: t })
      expect(halfCaseLines(o.half_away, 0.001), `${name}: nära halvt öre`).toEqual([])
      expect(o.half_away.totalIncVatOre === o.half_even.totalIncVatOre && o.half_even.totalIncVatOre === o.half_up.totalIncVatOre, `${name}: lägena skiljer`).toBe(true)
    }
    const d01 = term0201Hourly('2026-09')
    expect(d01).toHaveLength(720)
    check('01', d01)
    const w01 = weightedPrice(toOracle(d01))
    expect(Math.abs(w01.weightedAsNumber - w01.simpleAverageAsNumber), 'viktat pris ska skilja sig mätbart från enkelt snitt').toBeGreaterThan(0.05)
    const d02 = term0202Hourly('2026-09')
    check('02', d02)
    expect(d02.some((p) => p.p4 < 0) && d02.some((p) => p.p4 === 0) && d02.some((p) => p.p4 > 0)).toBe(true)
    expect(decCmp(sumEnergy(toOracle(d02)), dec(0))).toBe(1)
    check('03', term0203Hourly('2026-09'), { ...terms, monthlyFeeSek: '39' })
    const hp = term0204HourlyPrices('2026-08')
    expect(hp).toHaveLength(744)
    check('04a', hp.map((p) => ({ ...p, wh: term0204HourlyWh(p.slot.index) })))
    check('04b', quartersOnHourlyPrices(term0204QuarterWh, hp, '2026-08'))
    check('04c', term0204QuarterPrices('2026-08').map((p) => ({ ...p, wh: term0204QuarterWh(p.slot.index) })))
    const d05 = dstQuarterSeries('2027-03', 'mar')
    expect(d05).toHaveLength(2972)
    check('05', d05)
    const d06 = dstQuarterSeries('2027-10', 'oct')
    expect(d06).toHaveLength(2980)
    check('06', d06)
    const h05 = dstHourlySeries('2027-03', 'mar')
    expect(h05).toHaveLength(743)
    check('05 tim', h05)
    const h06 = dstHourlySeries('2027-10', 'oct')
    expect(h06).toHaveLength(745)
    check('06 tim', h06)
    expect(faultyDstHourlySeries('2027-03', '2027-03-28')).toHaveLength(31 * 24)
    expect(faultyDstHourlySeries('2027-10', '2027-10-31')).toHaveLength(31 * 24)
    const d07 = term0207Hourly('2027-10')
    expect(d07).toHaveLength(745)
    check('07', d07)
    expect(faultyDstDaySeries('2027-03', '2027-03-28', 'mar')).toHaveLength(31 * 96)
    expect(faultyDstDaySeries('2027-10', '2027-10-31', 'oct')).toHaveLength(31 * 96)
    for (const c of HALF_CASES) {
      const o = oracleAllModes({ intervals: toOracle(term0208Consumption('2026-09', c.key)), terms })
      const half = halfCaseLines(o.half_away, 0)
      if (c.key === 'ORD') expect(half).toEqual([])
      else expect(half.length, `${c.key} ska ha halva ören`).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------- TERM02.01

describe('TERM02.01 timavtal och månadsavtal med icke-uniform förbrukning (2026-09, SE1)', () => {
  const MONTH = '2026-09'
  let ctx!: { tenant: TermTenant; session: AppSession; ch: SignedContractFixture; cm: SignedContractFixture; pts: Point[]; gen: GenerateUnderlayData; normalizedH: string[] }
  const setup = lazy(async () => {
    ensureFootprint()
    const { tenant, session } = await setupTenant()
    const ch = await newContract(tenant, { type: 'variable_hourly', area: 'SE1' })
    const cm = await newContract(tenant, { type: 'variable_monthly', area: 'SE1' })
    const pts = term0201Hourly(MONTH)
    await spot('SE1', MONTH, 'hourly', pts, session)
    const mvH = insertMeteringValues(ch, toMeterValues(pts, 'PT60M'))
    insertMeteringValues(cm, toMeterValues(pts, 'PT60M'))
    const gen = expectGenerate(await generateUnderlay(session, MONTH))
    ctx = { tenant, session, ch, cm, pts, gen, normalizedH: mvH.normalizedIds }
  })

  it('TERM02.01 variable_hourly: belopp = Σ kWh·(spot+påslag) per intervall; effektivt pris = viktat och skiljer från enkelt snitt', async () => {
    await setup()
    const id = 'TERM02.01 hourly'
    const { row, result } = underlayFor(ctx.tenant.companyId, MONTH, ctx.ch, ctx.gen)
    expectCoverageClean(id, row, result, 720)
    expectTotalKwh(id, row, ctx.pts)
    expectItemsMatch(id, row.id, ctx.pts)
    observe(`${id} källbevis`, { note: 'B2: värdena kan inte kvalificeras (ingen UTILTS-original/leveransperiodsbevis)', basis: await readSourceBasisSummary(ctx.tenant.companyId, ctx.normalizedH) })

    const terms = readContractTerms(ctx.ch)
    const intervals = toOracle(ctx.pts)
    const w = weightedPrice(intervals)
    expect(Math.abs(w.weightedAsNumber - w.simpleAverageAsNumber), 'viktat pris vs enkelt snitt (SEK/kWh)').toBeGreaterThan(0.05)
    const data = await priceAndCompare(ctx.session, row.id, ctx.pts, terms, id)

    const base = data.lines.find((l) => appLineKind(l) === 'spot')!
    expect(Math.abs(base.unitPriceExVat! - w.weightedAsNumber), 'appens spotpris/kWh = viktat pris').toBeLessThanOrEqual(1.5e-6)
    expect(Math.abs(base.unitPriceExVat! - w.simpleAverageAsNumber), 'appens spotpris/kWh är inte enkelt snitt').toBeGreaterThan(0.01)
    // Σ kWh·(spot + påslag) per intervall, exakt
    const plusMarkup = intervals.map((i) => ({ kwh: i.kwh, price: decToString(decAdd(dec(i.price), dec('0.04'))) }))
    const exact = sumEnergy(plusMarkup)
    const appEnergyOre = appLinesOre(data).filter((l) => l.kind === 'spot' || l.kind === 'markup').reduce((s, l) => s + l.exVatOre, 0n)
    const exactOre = roundDec(exact, 2, 'half_away')
    expect(appEnergyOre - exactOre >= -1n && appEnergyOre - exactOre <= 1n, `energi (spot+påslag) app ${appEnergyOre} öre mot Σ kWh·(p+0,04) = ${exactOre} öre`).toBe(true)
    observe(`${id} effektivt pris`, { weighted: w.weightedAsNumber, simple: w.simpleAverageAsNumber, effectiveInclMarkup: w.weightedAsNumber + 0.04, appUnitPrice: base.unitPriceExVat })
  }, LONG)

  it('TERM02.01 variable_monthly: registrerar vilket spotpris appen använder (öppen orakelfråga); övriga rader och räkneregler kontrolleras', async () => {
    await setup()
    const id = 'TERM02.01 monthly'
    const { row, result } = underlayFor(ctx.tenant.companyId, MONTH, ctx.cm, ctx.gen)
    expectCoverageClean(id, row, result, 720)
    expectTotalKwh(id, row, ctx.pts)
    await checkMonthlyContract(ctx.session, row.id, ctx.pts, readContractTerms(ctx.cm), id)
  }, LONG)
})

// ---------------------------------------------------------------- TERM02.02

describe('TERM02.02 timavtal med negativa och nollpriser (2026-09, SE2)', () => {
  const MONTH = '2026-09'
  let ctx!: { tenant: TermTenant; session: AppSession; c: SignedContractFixture; pts: Point[]; gen: GenerateUnderlayData }
  const setup = lazy(async () => {
    ensureFootprint()
    const { tenant, session } = await setupTenant()
    const c = await newContract(tenant, { type: 'variable_hourly', area: 'SE2' })
    const pts = term0202Hourly(MONTH)
    await spot('SE2', MONTH, 'hourly', pts, session)
    insertMeteringValues(c, toMeterValues(pts, 'PT60M'))
    ctx = { tenant, session, c, pts, gen: expectGenerate(await generateUnderlay(session, MONTH)) }
  })

  it('TERM02.02 belopp = Σ kWh·p med negativa bidrag avdragna (ingen klampning); momspolicy registreras', async () => {
    await setup()
    const id = 'TERM02.02'
    const { row, result } = underlayFor(ctx.tenant.companyId, MONTH, ctx.c, ctx.gen)
    expectCoverageClean(id, row, result, 720)
    expectTotalKwh(id, row, ctx.pts)
    const terms = readContractTerms(ctx.c)
    const intervals = toOracle(ctx.pts)
    const energy = sumEnergy(intervals)
    const clamped = roundDec(sumEnergy(intervals.map((i) => ({ kwh: i.kwh, price: decCmp(dec(i.price), dec(0)) < 0 ? '0' : i.price }))), 2, 'half_away')
    const exactOre = roundDec(energy, 2, 'half_away')
    expect(clamped - exactOre > 100n, `klampat belopp ${clamped} öre ska skilja sig från exakt ${exactOre} öre med minst 1 SEK`).toBe(true)

    const data = await priceAndCompare(ctx.session, row.id, ctx.pts, terms, id)
    const base = appLinesOre(data).find((l) => l.kind === 'spot')!
    expect(base.exVatOre, 'basraden = Σ kWh·p inkl. negativa bidrag').toBe(exactOre)
    expect(base.exVatOre < clamped, 'basraden är lägre än klampad summa').toBe(true)

    const oracle = oracleInvoice({ intervals, terms }, 'half_away')
    const appVat = sekNumberToOre(data.vatAmount)
    observe(`${id} momspolicy`, {
      appTotalVatOre: appVat, oraclePerLineVatOre: oracle.totalVatOre, oracleVatOnTotalOre: oracle.vatOnTotalOre,
      appFollows: appVat === oracle.totalVatOre ? 'moms per rad (summan av radernas avrundade moms)' : appVat === oracle.vatOnTotalOre ? 'moms på summan' : 'ingen av dem',
      negativeContributionOre: (exactOre - clamped).toString(),
    })
  }, LONG)
})

// ---------------------------------------------------------------- TERM02.01/.02 originalorakelts exempelvärden

describe('TERM02.01 TERM02.02 originalorakelts exempelvärden: 16 kombinationer av kWh 0/0,25/1,5/2 och pris -0,50/0/0,75/1,20 (2026-06, SE3)', () => {
  const MONTH = '2026-06'
  let ctx!: { tenant: TermTenant; session: AppSession; c: SignedContractFixture; pts: Point[]; gen: GenerateUnderlayData }
  const setup = lazy(async () => {
    ensureFootprint()
    const { tenant, session } = await setupTenant()
    const c = await newContract(tenant, { type: 'variable_hourly', area: 'SE3' })
    const pts = term02OriginalExampleHourly(MONTH)
    await spot('SE3', MONTH, 'hourly', pts, session)
    insertMeteringValues(c, toMeterValues(pts, 'PT60M'))
    ctx = { tenant, session, c, pts, gen: expectGenerate(await generateUnderlay(session, MONTH)) }
  })

  it('TERM02.01 TERM02.02 original exempelvärden: alla 16 kombinationer förekommer; energirad ex/moms/inkl exakt mot oraklet och mot handräknad Σ(q·p) i BigInt', async () => {
    await setup()
    const id = 'TERM02.01/.02 original'
    // Handräknad Σ(q·p): Wh (heltal) × p4 (tiondels öre/kWh) = enhet 1e-7 kWh·SEK/kWh = 1e-7 SEK. Antal förekomster per kombination räknas oberoende av datafunktionen.
    const hours = 24 * 30
    const counts = new Map<string, bigint>()
    let manual = 0n
    for (let i = 0; i < hours; i++) {
      const wh = BigInt(ORIGINAL_EXAMPLE_WH[i % 4]), p4 = BigInt(ORIGINAL_EXAMPLE_P4[(i >> 2) % 4])
      manual += wh * p4
      counts.set(`${wh}/${p4}`, (counts.get(`${wh}/${p4}`) ?? 0n) + 1n)
    }
    expect(counts.size, 'antal olika kombinationer').toBe(16)
    expect(ctx.pts, 'antal timslotar').toHaveLength(hours)
    const seen = new Map<string, bigint>()
    for (const p of ctx.pts) seen.set(`${p.wh}/${p.p4}`, (seen.get(`${p.wh}/${p.p4}`) ?? 0n) + 1n)
    expect([...seen.entries()].sort(), 'förekomster per kombination i datat').toEqual([...counts.entries()].sort())
    for (const n of counts.values()) expect(n === 45n, 'förekomster per kombination (720 = 45 x 16)').toBe(true)
    const intervals = toOracle(ctx.pts)
    expect(decToString(sumEnergy(intervals)), 'orakelfunktionen sumEnergy = handräknad Σ(q·p)').toBe(decToString({ n: manual, s: 7 }))
    const manualOre = roundDec({ n: manual, s: 7 }, 2, 'half_away')

    const { row, result } = underlayFor(ctx.tenant.companyId, MONTH, ctx.c, ctx.gen)
    expectCoverageClean(id, row, result, hours)
    expectTotalKwh(id, row, ctx.pts)
    expectItemsMatch(id, row.id, ctx.pts)
    const terms = readContractTerms(ctx.c)
    const data = await priceAndCompare(ctx.session, row.id, ctx.pts, terms, id)
    const base = appLinesOre(data).find((l) => l.kind === 'spot')!
    expect(base.exVatOre, 'basraden (ex moms, öre) = handräknad Σ(q·p) avrundad').toBe(manualOre)
    const oracle = oracleInvoice({ intervals, terms }, 'half_away')
    const oSpot = oracle.lines.find((l) => l.code === 'spot')
    observe(`${id} orakel`, { manualOre: manualOre.toString(), oracleSpot: oSpot ? `ex ${oSpot.exVatOre} moms ${oSpot.vatOre}` : null, appSpot: `ex ${base.exVatOre}` })
  }, LONG)
})

// ---------------------------------------------------------------- TERM02.03

describe('TERM02.03 noll kWh hela månaden med avtalad månadsavgift (2026-09, SE3)', () => {
  const MONTH = '2026-09'
  let ctx!: { tenant: TermTenant; session: AppSession; c: SignedContractFixture; pts: Point[]; gen: GenerateUnderlayData }
  const setup = lazy(async () => {
    ensureFootprint()
    const { tenant, session } = await setupTenant()
    const c = await newContract(tenant, { type: 'variable_hourly', area: 'SE3', fee: 39 })
    const pts = term0203Hourly(MONTH)
    await spot('SE3', MONTH, 'hourly', pts, session)
    insertMeteringValues(c, toMeterValues(pts, 'PT60M'))
    ctx = { tenant, session, c, pts, gen: expectGenerate(await generateUnderlay(session, MONTH)) }
  })

  it('TERM02.03 noll kWh: prisberäkningen ger månadsavgiften (+moms) och ingen energirad > 0; exakt utfall registreras', async () => {
    await setup()
    const id = 'TERM02.03'
    const { row, result } = underlayFor(ctx.tenant.companyId, MONTH, ctx.c, ctx.gen)
    const items = readUnderlayItems(row.id)
    const cls = classifyUnderlayWarnings(result.warnings)
    observe(`${id} underlag`, { status: result.status, rowStatus: row.status, readiness: row.readiness_status, totalKwh: row.total_kwh, items: items.length, warnings: cls, blockReason: row.billing_block_reason })
    expect(items, 'alla 720 intervall finns med 0 kWh').toHaveLength(720)
    expect(items.every((i) => decCmp(dec(i.quantity_kwh), dec(0)) === 0)).toBe(true)
    expect(decCmp(dec(row.total_kwh ?? '0'), dec(0))).toBe(0)

    const terms = readContractTerms(ctx.c)
    expect(terms.monthlyFeeSek).toBe('39')
    const oracle = oracleInvoice({ intervals: toOracle(ctx.pts), terms }, 'half_away')
    const fee = oracle.lines.find((l) => l.code === 'monthly_fee')!
    expect([fee.exVatOre, fee.vatOre, fee.incVatOre]).toEqual([3900n, 975n, 4875n])

    const res = await pricePreview(ctx.session, { underlayId: row.id })
    expect(res.status, `preview HTTP ${res.status}: ${res.text}`).toBe(200)
    const data = res.data!
    observe(`${id} prisberäkning`, {
      status: data.status, errors: data.errors, warnings: data.warnings, lines: data.lines.map((l) => `${appLineKind(l)}:${l.amountExVat}`),
      totals: [data.totalExVat, data.vatAmount, data.totalIncVat],
      candidateDefect: data.errors.some((e) => /Energimängden är noll/.test(e)) ? "förväntat kandidatfel: 'Energimängden är noll för fakturaperioden.' (lib/pricing/engine.ts) stoppar fakturan trots avtalad månadsavgift" : null,
    })
    expect(data.status, `0 kWh men avtalad månadsavgift: preview-status ${data.status}; fel: ${data.errors.join(' | ')}`).toBe('success')
    const lines = appLinesOre(data)
    const monthly = lines.filter((l) => l.kind === 'monthly_fee')
    expect(monthly, 'exakt en månadsavgiftsrad').toHaveLength(1)
    expect([monthly[0].exVatOre, monthly[0].vatOre, monthly[0].incVatOre], 'månadsavgift 39 SEK + 25 % moms').toEqual([fee.exVatOre, fee.vatOre, fee.incVatOre])
    expect(lines.filter((l) => (l.kind === 'spot' || l.kind === 'markup') && l.exVatOre !== 0n), 'ingen energirad > 0').toEqual([])
    expect(checkInvoiceArithmetic(data, terms.vatPercent)).toEqual([])
  }, LONG)
})

// ---------------------------------------------------------------- TERM02.04

describe('TERM02.04 matris: avtalsupplösning och mätupplösning (2026-08, SE1 timpris, SE2 kvartspris)', () => {
  const MONTH = '2026-08'
  type Combo = { key: string; tenant: TermTenant; session: AppSession; gen: GenerateUnderlayData; contract: SignedContractFixture; points: Point[] }
  let ctx!: { combos: Record<'a' | 'b' | 'c' | 'd' | 'e', Combo> }
  // Ett eget bolag per kombination: generate-underlay körs per bolag, och lasten per anrop hålls nere (stackens statement timeout).
  const setup = lazy(async () => {
    ensureFootprint()
    const first = await setupTenant()
    const hourPrices = term0204HourlyPrices(MONTH)
    const quarterPrices = term0204QuarterPrices(MONTH)
    await spot('SE1', MONTH, 'hourly', hourPrices, first.session)
    await spot('SE2', MONTH, 'quarter_hour', quarterPrices, first.session)
    const hourlyMeter = hourPrices.map((p) => ({ ...p, wh: term0204HourlyWh(p.slot.index) }))
    const mk = async (key: string, type: 'variable_hourly' | 'variable_quarterly' | 'variable_monthly', area: PriceAreaCode, points: Point[], reuse?: { tenant: TermTenant; session: AppSession }): Promise<Combo> => {
      const { tenant, session } = reuse ?? await setupTenant()
      const contract = await newContract(tenant, { type, area })
      insertMeteringValues(contract, toMeterValues(points, points.length === 744 ? 'PT60M' : 'PT15M'))
      return { key, tenant, session, contract, points, gen: expectGenerate(await generateUnderlay(session, MONTH)) }
    }
    ctx = { combos: {
      a: await mk('timavtal + timmätning', 'variable_hourly', 'SE1', hourlyMeter, first),
      b: await mk('timavtal + kvartsmätning', 'variable_hourly', 'SE1', quartersOnHourlyPrices(term0204QuarterWh, hourPrices, MONTH)),
      c: await mk('kvartsavtal + kvartsmätning', 'variable_quarterly', 'SE2', quarterPrices.map((p) => ({ ...p, wh: term0204QuarterWh(p.slot.index) }))),
      d: await mk('kvartsavtal + timmätning', 'variable_quarterly', 'SE2', hourlyMeter),
      e: await mk('månadsavtal + timmätning', 'variable_monthly', 'SE1', hourlyMeter),
    } }
  })

  const supported = (letter: 'a' | 'b' | 'c') => async () => {
    await setup()
    const combo = ctx.combos[letter]
    const id = `TERM02.04 ${letter}) ${combo.key}`
    const { row, result } = underlayFor(combo.tenant.companyId, MONTH, combo.contract, combo.gen)
    expectCoverageClean(id, row, result, combo.points.length)
    expectTotalKwh(id, row, combo.points)
    expectItemsMatch(id, row.id, combo.points)
    await priceAndCompare(combo.session, row.id, combo.points, readContractTerms(combo.contract), id)
  }
  it('TERM02.04 a) timavtal + timmätning: korrekt belopp', supported('a'), LONG)
  it('TERM02.04 b) timavtal + kvartsmätning: korrekt belopp (varje kvart prissätts med timpriset)', supported('b'), LONG)
  it('TERM02.04 c) kvartsavtal + kvartsmätning: korrekt belopp', supported('c'), LONG)

  it('TERM02.04 d) kvartsavtal + timmätning: ostödd kombination nekas kontrollerat (inget tyst fel belopp, inget 500)', async () => {
    await setup()
    const combo = ctx.combos.d
    const id = 'TERM02.04 d) kvartsavtal + timmätning'
    const { row, result } = underlayFor(combo.tenant.companyId, MONTH, combo.contract, combo.gen)
    observe(`${id} underlag`, { status: result.status, warnings: classifyUnderlayWarnings(result.warnings), totalKwh: row.total_kwh })
    const res = await pricePreview(combo.session, { underlayId: row.id })
    observe(`${id} prisberäkning`, { http: res.status, status: res.data?.status, errors: res.data?.errors, lines: res.data?.lines.map((l) => `${appLineKind(l)}:${l.amountExVat}`), totals: res.data ? [res.data.totalExVat, res.data.vatAmount, res.data.totalIncVat] : null })
    expect(res.status, `HTTP ${res.status}: ${res.text}`).toBeLessThan(500)
    const refusedAtUnderlay = result.status === 'needs_review' && classifyUnderlayWarnings(result.warnings).other.length > 0
    const refusedAtPricing = res.status >= 400 || (res.data !== null && res.data.status !== 'success' && res.data.errors.length > 0)
    expect(refusedAtUnderlay || refusedAtPricing, `kombinationen gav inget kontrollerat nekande: preview ${res.data?.status}, totalt ${res.data?.totalIncVat}`).toBe(true)
    if (res.data && res.data.status === 'success') {
      // Om appen ändå prissätter får beloppet inte vara tyst fel: det måste motsvara kvartspris på timdata, vilket inte finns.
      throw new Error('kvartsavtal + timmätning prissattes med status success; ett belopp utan kvartspris är tyst fel')
    }
    expect(res.data?.errors.join(' ') ?? '', 'felet ska peka på kvartsmätning').toMatch(/kvart/i)
  }, LONG)

  it('TERM02.04 e) månadsavtal + timmätning: registrerar spotprisval; räkneregler och övriga rader kontrolleras', async () => {
    await setup()
    const combo = ctx.combos.e
    const id = 'TERM02.04 e) månadsavtal + timmätning'
    const { row, result } = underlayFor(combo.tenant.companyId, MONTH, combo.contract, combo.gen)
    expectCoverageClean(id, row, result, combo.points.length)
    expectTotalKwh(id, row, combo.points)
    await checkMonthlyContract(combo.session, row.id, combo.points, readContractTerms(combo.contract), id)
  }, LONG)
})


let matrixF: Promise<{ tenant: TermTenant; session: AppSession; contract: SignedContractFixture; points: Point[]; gen: GenerateUnderlayData }> | null = null
/** TERM02.04 f): eget bolag; spotmånaden SE1 2026-08 är idempotent (samma data som matrisen). */
function matrixSetupF() {
  return (matrixF ??= (async () => {
    ensureFootprint()
    const { tenant, session } = await setupTenant()
    const hourPrices = term0204HourlyPrices('2026-08')
    await spot('SE1', '2026-08', 'hourly', hourPrices, session)
    const points = quartersOnHourlyPrices(term0204QuarterWh, hourPrices, '2026-08')
    const contract = await newContract(tenant, { type: 'variable_monthly', area: 'SE1' })
    insertMeteringValues(contract, toMeterValues(points, 'PT15M'))
    return { tenant, session, contract, points, gen: expectGenerate(await generateUnderlay(session, '2026-08')) }
  })())
}

describe('TERM02.04 f) månadsavtal + kvartsmätning (egen uppställning, delar spotmånad 2026-08 SE1 med matrisen)', () => {
  it('TERM02.04 f) månadsavtal + kvartsmätning: lyckad prissättning krävs; täckning och belopp kontrolleras', async () => {
    const combo = await matrixSetupF()
    const id = 'TERM02.04 f) månadsavtal + kvartsmätning'
    const { row, result } = underlayFor(combo.tenant.companyId, '2026-08', combo.contract, combo.gen)
    const res = await pricePreview(combo.session, { underlayId: row.id })
    // Auth-, transport- och setupfel är inget styrkt domännekande för denna kombination.
    expect(res.status, `HTTP ${res.status}: ${res.text}`).toBe(200)
    expect(res.data?.status, `preview-status: ${res.data?.status}; fel: ${res.data?.errors?.join(' | ')}`).toBe('success')
    observe(id, { utfall: 'stödd', underlayStatus: result.status, http: res.status, previewStatus: res.data?.status, errors: res.data?.errors, app: describeApp(res.data!) })
    expectCoverageClean(id, row, result, combo.points.length)
    expectTotalKwh(id, row, combo.points)
    await checkMonthlyContract(combo.session, row.id, combo.points, readContractTerms(combo.contract), id)
  }, LONG)
})

// ---------------------------------------------------------------- TERM02.05 / TERM02.06 (DST-månader)

function describeDstMonth(cfg: {
  id: 'TERM02.05' | 'TERM02.06'; month: string; area: PriceAreaCode; seed: 'mar' | 'oct'; dstDay: string; dayQuarters: number; monthQuarters: number
  step?: 15 | 60 // 60 = timserie (dayQuarters/monthQuarters är då antal timmar)
  faultKind: 'overlap' | 'gap'; faultText: string
}) {
  const hourly = cfg.step === 60
  const unitName = hourly ? 'timmar' : 'kvartar'
  const perDayNormal = hourly ? 24 : 96
  const intervalsInDay = (d: string) => (hourly ? hoursInDay(d) : quartersInDay(d))
  const contractType = hourly ? 'variable_hourly' : 'variable_quarterly'
  const resolutionText = hourly ? 'PT60M' : 'PT15M'
  describe(`${cfg.id} ${cfg.month} ${hourly ? 'TIMSERIE' : 'kvartsserie'} (${cfg.dstDay}: ${cfg.dayQuarters} ${unitName}; månaden ${cfg.monthQuarters}), ${cfg.area}`, () => {
    let ctx!: { tenant: TermTenant; session: AppSession; badTenant: TermTenant; badGen: GenerateUnderlayData; good: SignedContractFixture; bad: SignedContractFixture; goodPts: Point[]; badPts: Point[]; gen: GenerateUnderlayData; goodNormalized: string[] }
    const setup = lazy(async () => {
      ensureFootprint()
      const { tenant, session } = await setupTenant()
      const bt = await setupTenant()
      const good = await newContract(tenant, { type: contractType, area: cfg.area })
      const bad = await newContract(bt.tenant, { type: contractType, area: cfg.area })
      const goodPts = hourly ? dstHourlySeries(cfg.month, cfg.seed) : dstQuarterSeries(cfg.month, cfg.seed)
      expect(goodPts).toHaveLength(cfg.monthQuarters)
      await spot(cfg.area, cfg.month, hourly ? 'hourly' : 'quarter_hour', goodPts, session)
      const badPts = hourly ? faultyDstHourlySeries(cfg.month, cfg.dstDay) : faultyDstDaySeries(cfg.month, cfg.dstDay, cfg.seed)
      const mvGood = insertMeteringValues(good, toMeterValues(goodPts, resolutionText))
      insertMeteringValues(bad, toMeterValues(badPts, resolutionText))
      const gen = expectGenerate(await generateUnderlay(session, cfg.month))
      const badGen = expectGenerate(await generateUnderlay(bt.session, cfg.month))
      ctx = { tenant, session, badTenant: bt.tenant, badGen, good, bad, goodPts, badPts, gen, goodNormalized: mvGood.normalizedIds }
    })

    it(`${cfg.id} spotdata${hourly ? ' (timpris)' : ''}: exakt ${cfg.dayQuarters} ${unitName} för ${cfg.dstDay} och ${cfg.monthQuarters} för månaden (verifierad och låst)`, async () => {
      await setup()
      const day = stockholmDayBoundsUtc(cfg.dstDay)
      const perDay = psqlRows<{ price_date: string; interval_count: number; expected_interval_count: number; expected_duration_minutes: number; status: string }>(`
        SELECT price_date::text AS price_date,interval_count,expected_interval_count,expected_duration_minutes,status FROM public.spot_price_daily_summaries
        WHERE source='elprisetjustnu' AND price_area='${cfg.area}' AND price_date>='${cfg.month}-01'::date AND price_date<('${cfg.month}-01'::date + interval '1 month')::date ORDER BY price_date`)
      expect(perDay).toHaveLength(stockholmMonthBoundsUtc(cfg.month).days.length)
      const dstRow = perDay.find((r) => r.price_date === cfg.dstDay)!
      expect([dstRow.interval_count, dstRow.expected_interval_count, dstRow.expected_duration_minutes, dstRow.status]).toEqual([cfg.dayQuarters, cfg.dayQuarters, day.minutes, 'verified'])
      const inDay = Number(psqlRows<{ n: string }>(`SELECT count(*)::text AS n FROM public.spot_price_intervals WHERE source='elprisetjustnu' AND price_area='${cfg.area}'
        AND time_start>='${isoUtc(day.startMs)}'::timestamptz AND time_start<'${isoUtc(day.endMs)}'::timestamptz`)[0].n)
      expect(inDay, `spotkvartar ${cfg.dstDay}`).toBe(cfg.dayQuarters)
      const month = psqlRows<{ status: string; interval_count: number; expected_interval_count: number }>(`SELECT status,interval_count,expected_interval_count FROM public.spot_price_monthly_summaries
        WHERE source='elprisetjustnu' AND price_area='${cfg.area}' AND billing_month='${cfg.month}'`)[0]
      expect([month.status, month.interval_count, month.expected_interval_count]).toEqual(['locked', cfg.monthQuarters, cfg.monthQuarters])
    })

    it(`${cfg.id} A${hourly ? ' timserie' : ''}: korrekt serie (${cfg.dayQuarters} ${unitName} ${cfg.dstDay}, ${cfg.monthQuarters} i månaden) ger täckningsrent underlag och rätt belopp`, async () => {
      await setup()
      const id = `${cfg.id} A${hourly ? ' timserie' : ''}`
      const { row, result } = underlayFor(ctx.tenant.companyId, cfg.month, ctx.good, ctx.gen)
      expectCoverageClean(id, row, result, cfg.monthQuarters)
      expectTotalKwh(id, row, ctx.goodPts)
      expectItemsMatch(id, row.id, ctx.goodPts)
      const bounds = stockholmMonthBoundsUtc(cfg.month)
      const payload = row.payload as Record<string, unknown>
      expect(Date.parse(String(payload.billing_period_start_instant)), 'periodens start (instant)').toBe(bounds.startMs)
      expect(Date.parse(String(payload.billing_period_end_instant)), 'periodens slut (instant)').toBe(bounds.endMs)
      // Antal kvartar per Stockholm-dag enligt oraklets egen kalender
      const perDay = new Map<string, number>()
      for (const it of readUnderlayItems(row.id)) perDay.set(stockholmDateOf(Date.parse(it.period_start)), (perDay.get(stockholmDateOf(Date.parse(it.period_start))) ?? 0) + 1)
      const wrong = bounds.days.filter((d) => perDay.get(d) !== intervalsInDay(d)).map((d) => `${d}: ${perDay.get(d) ?? 0} (väntat ${intervalsInDay(d)})`)
      expect(wrong, 'kvartar per dag i underlaget').toEqual([])
      expect(perDay.get(cfg.dstDay)).toBe(cfg.dayQuarters)
      observe(`${id} källbevis`, { note: 'B2: kan inte kvalificeras; ready_for_pricing kan därför inte uppnås i harnessen', status: result.status, basis: await readSourceBasisSummary(ctx.tenant.companyId, ctx.goodNormalized.slice(0, 50)) })
      await priceAndCompare(ctx.session, row.id, ctx.goodPts, readContractTerms(ctx.good), id)
    }, LONG)

    it(`${cfg.id} B${hourly ? ' timserie' : ''}: ${cfg.faultText} avvisas (needs_review med ${cfg.faultKind === 'overlap' ? 'överlapp/dubbletter' : 'lucka'})`, async () => {
      await setup()
      const id = `${cfg.id} B${hourly ? ' timserie' : ''}`
      const { row, result } = underlayFor(ctx.badTenant.companyId, cfg.month, ctx.bad, ctx.badGen)
      const cls = classifyUnderlayWarnings(result.warnings)
      const perDay = new Map<string, number>()
      for (const p of ctx.badPts) perDay.set(stockholmDateOf(p.slot.startMs), (perDay.get(stockholmDateOf(p.slot.startMs)) ?? 0) + 1)
      observe(id, { status: result.status, rowStatus: row.status, readiness: row.readiness_status, sourceRows: result.sourceRows, missing: row.missing_values_count, warnings: cls, rowsOnDstDayByLocalDate: perDay.get(cfg.dstDay) })
      expect(result.status, `${id}: felaktig serie får inte bli ready_for_pricing`).toBe('needs_review')
      expect(result.sourceRows).toBe(31 * perDayNormal)
      const pattern = cfg.faultKind === 'overlap' ? /Överlappande mätintervall|Dubbla aktuella mätvärden/ : /Mätvärdeslucka/
      expect(cls.coverage.some((w) => pattern.test(w)), `${id}: väntade ${cfg.faultKind}-varning; varningar: ${result.warnings.join(' | ')}`).toBe(true)
      if (cfg.faultKind === 'gap') expect(row.missing_values_count ?? 0, 'missing_values_count').toBeGreaterThan(0)
      expect(row.status, 'underlaget ska inte vara validated').not.toBe('validated')
    })
  })
}

describeDstMonth({
  id: 'TERM02.05', month: '2027-03', area: 'SE3', seed: 'mar', dstDay: '2027-03-28', dayQuarters: 92, monthQuarters: 2972,
  faultKind: 'overlap', faultText: '96 kvartar för 2027-03-28 (lokala 02:00-03:00 som inte finns)',
})
describeDstMonth({
  id: 'TERM02.06', month: '2027-10', area: 'SE2', seed: 'oct', dstDay: '2027-10-31', dayQuarters: 100, monthQuarters: 2980,
  faultKind: 'gap', faultText: '96 kvartar för 2027-10-31 (den dubblerade timmen saknas)',
})

describeDstMonth({
  id: 'TERM02.05', month: '2027-03', area: 'SE1', seed: 'mar', dstDay: '2027-03-28', dayQuarters: 23, monthQuarters: 743, step: 60,
  faultKind: 'overlap', faultText: '24 timmar för 2027-03-28 (lokala 02:00-03:00 som inte finns)',
})
describeDstMonth({
  id: 'TERM02.06', month: '2027-10', area: 'SE1', seed: 'oct', dstDay: '2027-10-31', dayQuarters: 25, monthQuarters: 745, step: 60,
  faultKind: 'gap', faultText: '24 timmar för 2027-10-31 (den dubblerade timmen saknas)',
})

// ---------------------------------------------------------------- TERM02.07

describe('TERM02.07 dubblerad lokal timme 02:00-03:00 den 2027-10-31 (2027-10, SE4)', () => {
  const MONTH = '2027-10'
  let ctx!: { tenant: TermTenant; session: AppSession; c: SignedContractFixture; pts: Point[]; gen: GenerateUnderlayData }
  const setup = lazy(async () => {
    ensureFootprint()
    const { tenant, session } = await setupTenant()
    const c = await newContract(tenant, { type: 'variable_hourly', area: 'SE4' })
    const pts = term0207Hourly(MONTH)
    await spot('SE4', MONTH, 'hourly', pts, session)
    insertMeteringValues(c, toMeterValues(pts, 'PT60M'))
    ctx = { tenant, session, c, pts, gen: expectGenerate(await generateUnderlay(session, MONTH)) }
  })

  it('TERM02.07 båda instanserna (+02:00 och +01:00) finns som skilda UTC-instanser och prissätts med eget pris', async () => {
    await setup()
    const id = 'TERM02.07'
    const { row, result } = underlayFor(ctx.tenant.companyId, MONTH, ctx.c, ctx.gen)
    expectCoverageClean(id, row, result, 745)
    expectTotalKwh(id, row, ctx.pts)
    expectItemsMatch(id, row.id, ctx.pts)

    const first = Date.parse(DUP_HOUR_FIRST_UTC)
    const second = Date.parse(DUP_HOUR_SECOND_UTC)
    expect(describeLocal(first)).toBe('2027-10-31 02:00 +02:00')
    expect(describeLocal(second)).toBe('2027-10-31 02:00 +01:00')
    const items = readUnderlayItems(row.id)
    const a = items.filter((i) => Date.parse(i.period_start) === first)
    const b = items.filter((i) => Date.parse(i.period_start) === second)
    expect([a.length, b.length], 'en underlagsrad per instans').toEqual([1, 1])
    expect(decToString(dec(a[0].quantity_kwh)), 'förbrukning +02:00-instansen').toBe('2')
    expect(decToString(dec(b[0].quantity_kwh)), 'förbrukning +01:00-instansen').toBe('5')
    const spotRows = psqlRows<{ time_start: string; sek: string }>(`SELECT time_start,sek_per_kwh::text AS sek FROM public.spot_price_intervals WHERE source='elprisetjustnu' AND price_area='SE4'
      AND time_start IN ('${DUP_HOUR_FIRST_UTC}'::timestamptz,'${DUP_HOUR_SECOND_UTC}'::timestamptz) ORDER BY time_start`)
    expect(spotRows.map((r) => decToString(dec(r.sek))), 'två skilda spotpriser').toEqual([p4ToSek(4000), p4ToSek(19000)])

    const terms = readContractTerms(ctx.c)
    const data = await priceAndCompare(ctx.session, row.id, ctx.pts, terms, id)
    // Maktkontroll: ett felaktigt val av pris för någon instans ger ett helt annat belopp än det app och orakel enades om.
    const withPrice = (instant: number, p4: number): Point[] => ctx.pts.map((p) => (p.slot.startMs === instant ? { ...p, p4 } : p))
    const altFirstPriceForBoth = oracleInvoice({ intervals: toOracle(withPrice(second, 4000)), terms }, 'half_away').totalExVatOre
    const altSecondPriceForBoth = oracleInvoice({ intervals: toOracle(withPrice(first, 19000)), terms }, 'half_away').totalExVatOre
    const appTotal = sekNumberToOre(data.totalExVat)
    expect(appTotal !== altFirstPriceForBoth && appTotal !== altSecondPriceForBoth, 'appens total skiljer sig från varianterna med samma pris för båda instanserna').toBe(true)
    expect(altFirstPriceForBoth - appTotal < -700n || altFirstPriceForBoth - appTotal > 700n).toBe(true)
    observe(`${id} instanser`, { first: describeLocal(first), second: describeLocal(second), appTotalExVatOre: appTotal, altFirstPriceForBothOre: altFirstPriceForBoth, altSecondPriceForBothOre: altSecondPriceForBoth })
  }, LONG)
})

// ---------------------------------------------------------------- TERM02.07 COMPONENT (kräver inte stacken)

describe('TERM02.07 COMPONENT stockholmLocalToUtc (offline)', () => {
  it('TERM02.07 COMPONENT lib/time/stockholm.ts stockholmLocalToUtc: dubblerad och saknad lokal tid registreras (nekar eller väljer tyst offset)', async () => {
    const modulePath = path.join(RUN_DIR, 'lib/time/stockholm.ts')
    const mod = await import(/* @vite-ignore */ modulePath) as { stockholmLocalToUtc: (input: { year: number; month: number; day: number; hour?: number; minute?: number }) => Date }
    const cases: Array<{ label: string; y: number; m: number; d: number; hh: number; mm: number }> = [
      { label: '2027-10-31T02:30 (dubblerad timme)', y: 2027, m: 10, d: 31, hh: 2, mm: 30 },
      { label: '2027-03-28T02:30 (saknad timme)', y: 2027, m: 3, d: 28, hh: 2, mm: 30 },
      { label: '2027-10-31T01:30 (entydig, +02:00)', y: 2027, m: 10, d: 31, hh: 1, mm: 30 },
      { label: '2027-10-31T03:30 (entydig, +01:00)', y: 2027, m: 10, d: 31, hh: 3, mm: 30 },
    ]
    const out: Array<Record<string, unknown>> = []
    for (const c of cases) {
      const candidates = stockholmLocalToUtcCandidates(c.y, c.m, c.d, c.hh, c.mm).map(isoUtc)
      let appResult: string
      try { appResult = `returnerar ${mod.stockholmLocalToUtc({ year: c.y, month: c.m, day: c.d, hour: c.hh, minute: c.mm }).toISOString()}` } catch (error) { appResult = `nekar: ${(error as Error).message}` }
      const behaviour = candidates.length === 2 ? (appResult.startsWith('nekar') ? 'nekar tvetydig tid' : 'väljer tyst en av två offsets') : candidates.length === 0 ? (appResult.startsWith('nekar') ? 'nekar saknad tid' : 'accepterar tyst en lokal tid som inte finns') : (appResult.endsWith(candidates[0]) ? 'korrekt' : 'FEL på entydig tid')
      out.push({ label: c.label, oracleCandidatesUtc: candidates, app: appResult, behaviour })
      if (candidates.length === 1) expect(appResult, `kontrollfall ${c.label}`).toBe(`returnerar ${candidates[0]}`)
    }
    observe('TERM02.07 COMPONENT stockholmLocalToUtc', { cases: out })
  })
})

// ---------------------------------------------------------------- TERM02.08

/** Rundades beloppet bort från noll (up) eller mot noll (down) jämfört med det exakta beloppet (i öre)? */
function magnitudeDirection(appOre: bigint, exactOre: { n: bigint; s: number }): 'up' | 'down' {
  const appAbs = decMul(dec(appOre < 0n ? -appOre : appOre), dec(1))
  const exactAbs = { n: exactOre.n < 0n ? -exactOre.n : exactOre.n, s: exactOre.s }
  return decCmp(appAbs, exactAbs) > 0 ? 'up' : 'down'
}

describe('TERM02.08 avrundning till öre: halva ören och vanliga fall (2026-09, SE4)', () => {
  const MONTH = '2026-09'
  type HalfObs = { negative: boolean; magnitude: 'up' | 'down'; modes: RoundMode[] }
  type Seen = { key: string; halves: HalfObs[]; detail: unknown[] }
  const seen: Seen[] = []
  type Unit = { tenant: TermTenant; session: AppSession; contract: SignedContractFixture; gen: GenerateUnderlayData }
  let units!: Record<string, Unit>
  const setup = lazy(async () => {
    ensureFootprint()
    const out: Record<string, Unit> = {}
    let lockSession: AppSession | null = null
    for (const c of HALF_CASES) {
      const { tenant, session } = await setupTenant()
      if (!lockSession) { lockSession = session; await spot('SE4', MONTH, 'hourly', term0208Prices(MONTH), session) }
      const contract = await newContract(tenant, { type: 'variable_hourly', area: 'SE4' })
      insertMeteringValues(contract, toMeterValues(term0208Consumption(MONTH, c.key), 'PT60M'))
      out[c.key] = { tenant, session, contract, gen: expectGenerate(await generateUnderlay(session, MONTH)) }
    }
    units = out
  })

  for (const hc of HALF_CASES) {
    it(`TERM02.08 ${hc.key}: ${hc.key === 'ORD' ? 'vanligt fall, exakt likhet med oraklet' : 'halva ören, appens avrundningsläge registreras'}`, async () => {
      await setup()
      const unit = units[hc.key]
      const id = `TERM02.08 ${hc.key}`
      const contract = unit.contract
      const pts = term0208Consumption(MONTH, hc.key)
      const { row, result } = underlayFor(unit.tenant.companyId, MONTH, contract, unit.gen)
      expectCoverageClean(id, row, result, 720)
      expectTotalKwh(id, row, pts)
      const terms = readContractTerms(contract)
      const oracle = oracleAllModes({ intervals: toOracle(pts), terms })
      const res = await pricePreview(unit.session, { underlayId: row.id })
      expect(res.status, `preview HTTP ${res.status}: ${res.text}`).toBe(200)
      const data = res.data!
      expect(data.status, `preview-status; fel: ${data.errors.join(' | ')}`).toBe('success')
      const lines = appLinesOre(data)
      const record: Seen = { key: hc.key, halves: [], detail: [] }
      const problems: string[] = []
      for (const o of oracle.half_away.lines) {
        const app = lines.filter((l) => l.kind === o.code)
        if (app.length !== 1) { problems.push(`${o.code}: ${app.length} rader i appen`); continue }
        const a = app[0]
        // Exkl. moms
        if (o.exVatTie > 0.001) {
          if (a.exVatOre !== o.exVatOre) problems.push(`${o.code} exkl. moms: app ${a.exVatOre} öre, orakel ${o.exVatOre} öre (inte halvt; exakt likhet krävs)`)
        } else {
          const modes = ROUND_MODES.filter((m) => oracle[m].lines.find((l) => l.code === o.code)!.exVatOre === a.exVatOre)
          if (modes.length === 0) problems.push(`${o.code} exkl. moms: app ${a.exVatOre} öre matchar inget avrundningsläge (halvt öre ${o.exVatExactSek} SEK)`)
          const exactOre = decMul(dec(o.exVatExactSek), dec(100))
          const obs: HalfObs = { negative: exactOre.n < 0n, magnitude: magnitudeDirection(a.exVatOre, exactOre), modes }
          record.halves.push(obs)
          record.detail.push({ line: o.code, kind: 'exVat', exactSek: o.exVatExactSek, appOre: a.exVatOre, ...obs })
        }
        // Moms räknas på appens egen avrundade rad exkl. moms (så som appen gör), i tre lägen
        const vatTie = (a.exVatOre * 25n) % 100n === 50n || (a.exVatOre * 25n) % 100n === -50n
        const vatByMode = ROUND_MODES.map((m) => [m, vatOnOre(a.exVatOre, terms.vatPercent, m)] as const)
        if (!vatTie) {
          if (a.vatOre !== vatByMode[0][1]) problems.push(`${o.code} moms: app ${a.vatOre} öre, väntat ${vatByMode[0][1]} öre på ${a.exVatOre} öre (inte halvt)`)
        } else {
          const modes = vatByMode.filter(([, v]) => v === a.vatOre).map(([m]) => m)
          if (modes.length === 0) problems.push(`${o.code} moms: app ${a.vatOre} öre matchar inget läge på ${a.exVatOre} öre`)
          const exactVatOre = { n: a.exVatOre * 25n, s: 2 }
          const obs: HalfObs = { negative: a.exVatOre < 0n, magnitude: magnitudeDirection(a.vatOre, exactVatOre), modes }
          record.halves.push(obs)
          record.detail.push({ line: o.code, kind: 'vat', exVatOre: a.exVatOre, appVatOre: a.vatOre, ...obs })
        }
        if (a.incVatOre !== a.exVatOre + a.vatOre) problems.push(`${o.code} inkl. moms ${a.incVatOre} != ${a.exVatOre}+${a.vatOre}`)
      }
      const extras = lines.filter((l) => !oracle.half_away.lines.some((o) => o.code === l.kind))
      if (extras.length) problems.push(`extra rader: ${extras.map((e) => e.description).join(', ')}`)
      problems.push(...checkInvoiceArithmetic(data, terms.vatPercent))
      seen.push(record)
      observe(id, { app: describeApp(data), oracleHalfAway: oracle.half_away.lines.map((l) => `${l.code}[ex ${l.exVatOre} (${l.exVatExactSek}) moms ${l.vatOre}]`).join(' '), halfLines: record.detail, problems })
      if (hc.key !== 'ORD') {
        expect(halfCaseLines(oracle.half_away, 0).length, 'fallet ska innehålla exakta halva ören').toBeGreaterThan(0)
      } else {
        expect(halfCaseLines(oracle.half_away, 0.001), 'vanligt fall får inte ligga på halvt öre').toEqual([])
        expect(diffAgainstOracle(data, oracle.half_away), 'vanligt fall: exakt likhet med oraklet').toEqual([])
      }
      expect(problems, `${id}: avvikelser mot oraklet`).toEqual([])
    }, LONG)
  }

  it('TERM02.08 sammanställning: appens halvöresläge och om det är konsekvent för negativa belopp (registreras)', () => {
    const halves = seen.flatMap((x) => x.halves)
    const side = (negative: boolean) => halves.filter((h) => h.negative === negative)
    const modesFor = (list: HalfObs[]): RoundMode[] => (list.length === 0 ? [] : ROUND_MODES.filter((m) => list.every((h) => h.modes.includes(m))))
    const magnitudes = (list: HalfObs[]) => [...new Set(list.map((h) => h.magnitude))].sort()
    const pos = side(false)
    const neg = side(true)
    const posModes = modesFor(pos)
    const negModes = modesFor(neg)
    const posMag = magnitudes(pos)
    const negMag = magnitudes(neg)
    observe('TERM02.08 sammanställning', {
      positiveHalves: pos.length, negativeHalves: neg.length,
      positiveHalfConsistentWithModes: posModes, negativeHalfConsistentWithModes: negModes,
      positiveMagnitudeAtHalf: posMag, negativeMagnitudeAtHalf: negMag,
      consistentForBothSigns: posModes.filter((m) => negModes.includes(m)),
      asymmetricMagnitude: posMag.join() !== negMag.join(),
      interpretation: posMag.join() === 'up' && negMag.join() === 'down'
        ? 'asymmetri: positiva halva ören avrundas bort från noll men negativa mot noll (Math.round, half_up mot +oändligheten); half_away och half_even är symmetriska och följs inte'
        : posMag.join() === negMag.join() ? 'symmetriskt: samma storleksriktning för positiva och negativa halva ören' : 'blandat utfall, se detail per fall',
      note: 'Registrering, ingen assert: orakelfrågan är vilket läge som SKA gälla. Math.round(-x.5) avrundar mot noll medan half_away avrundar bort från noll.',
      cases: seen.map((x) => x.key),
    })
    expect(seen.length, 'alla fall måste ha körts före sammanställningen').toBe(HALF_CASES.length)
  })
})

// ---------------------------------------------------------------- alla ID: ingen extern spotimport

describe('TERM02 ingen spotimport', () => {
  it('TERM02.01-08 spotimportens körlogg och köer är oförändrade och ingen import-varning gavs (ingen extern hämtning)', () => {
    if (!footprint0) throw new Error('ingen spotimport-kontroll möjlig: inget scenariosteg hann köra uppställningen (ingen mätpunkt för jämförelsen)')
    const now = spotImportFootprint()
    const warned = observations.filter((o) => json(o.data).includes('importerades för verifiering')).map((o) => o.id)
    const imported = now.runs !== footprint0.runs || now.jobs !== footprint0.jobs || warned.length > 0
    console.info(`[TERM02 spotimport] extern import: ${imported ? 'JA' : 'NEJ'} (runs ${footprint0.runs}->${now.runs}, jobs ${footprint0.jobs}->${now.jobs}, import-varningar: ${warned.length})`)
    expect(imported, `extern spotimport skedde: runs ${footprint0.runs}->${now.runs}, jobs ${footprint0.jobs}->${now.jobs}, varningar i ${warned.join(', ') || '-'}`).toBe(false)
  })
})
