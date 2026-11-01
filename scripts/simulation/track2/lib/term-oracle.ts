// TERM-orakel: ren heltalsaritmetik (BigInt) för elfakturans belopp samt egen Stockholm-kalender (DST-regel).
//
// OBEROENDE AV APPEN: ingen import från appens kod, ingen Math.round på flyttal, ingen Intl i själva oraklet
// (Intl används bara i testet som korskontrollerar DST-regeln mot tzdata). Decimaltal är strängar eller heltal
// (aldrig flyttal), eftersom ett binärt flyttal inte kan bära ett exakt halvt öre.
//
// ORAKLETS REGLER (inget av detta är hämtat ur appens kod; appens utfall jämförs mot dem i scenariot):
//  - energibelopp per intervall = kWh * pris (SEK/kWh, exkl. moms), summerat exakt: Σ kWh·p. Negativa och noll-priser
//    bidrar med sitt tecken, ingen klampning.
//  - viktat pris = Σ(kWh·p) / ΣkWh (exakt kvot, rapporteras avrundat till 6 decimaler).
//  - radbelopp avrundas till hela öre. Tre lägen rapporteras alltid: half_away (bort från noll), half_even
//    (bankiers), samt half_up (mot +oändligheten; så beter sig Math.round i JavaScript, inkl. negativa tal).
//  - moms 25 % räknas per rad på radens redan avrundade belopp exkl. moms och avrundas till öre i samma läge.
//    Alternativet "moms på summan" rapporteras separat (vatOnTotalOre).
import { createHash } from 'node:crypto'

// ---------------------------------------------------------------- exakta decimaltal

/** Värde = n / 10^s. */
export type Dec = { readonly n: bigint; readonly s: number }

export type RoundMode = 'half_away' | 'half_even' | 'half_up'
export const ROUND_MODES: readonly RoundMode[] = ['half_away', 'half_even', 'half_up']

const pow10 = (k: number): bigint => BigInt("10") ** BigInt(k)

/** Parsar en decimalsträng ('-0.0900', '12') eller ett heltal. Flyttal med decimaler nekas medvetet. */
export function dec(input: string | number | bigint): Dec {
  if (typeof input === 'bigint') return { n: input, s: 0 }
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input)) throw new Error(`dec: flyttal ${input} nekas; ange decimaler som sträng`)
    return { n: BigInt(input), s: 0 }
  }
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(input.trim())
  if (!m) throw new Error(`dec: ogiltigt decimaltal "${input}"`)
  const frac = m[3] ?? ''
  const n = BigInt(m[2] + frac)
  return { n: m[1] === '-' ? -n : n, s: frac.length }
}

function align(a: Dec, b: Dec): { a: bigint; b: bigint; s: number } {
  const s = Math.max(a.s, b.s)
  return { a: a.n * pow10(s - a.s), b: b.n * pow10(s - b.s), s }
}
export const decAdd = (a: Dec, b: Dec): Dec => { const x = align(a, b); return { n: x.a + x.b, s: x.s } }
export const decSub = (a: Dec, b: Dec): Dec => { const x = align(a, b); return { n: x.a - x.b, s: x.s } }
export const decMul = (a: Dec, b: Dec): Dec => ({ n: a.n * b.n, s: a.s + b.s })
export const decNeg = (a: Dec): Dec => ({ n: -a.n, s: a.s })
export const decCmp = (a: Dec, b: Dec): -1 | 0 | 1 => { const x = align(a, b); return x.a < x.b ? -1 : x.a > x.b ? 1 : 0 }
export const decIsZero = (a: Dec): boolean => a.n === BigInt("0")
export const decMax0 = (a: Dec): Dec => (a.n < BigInt("0") ? { n: BigInt("0"), s: a.s } : a)

/** Exakt decimalsträng utan avslutande nollor (eller med exakt `scale` decimaler, avhuggna, om angivet). */
export function decToString(d: Dec, scale?: number): string {
  const neg = d.n < BigInt("0")
  const digits = (neg ? -d.n : d.n).toString().padStart(d.s + 1, '0')
  const whole = d.s === 0 ? digits : digits.slice(0, digits.length - d.s)
  let frac = d.s === 0 ? '' : digits.slice(digits.length - d.s)
  if (scale === undefined) frac = frac.replace(/0+$/, '')
  else frac = frac.padEnd(scale, '0').slice(0, Math.max(scale, 0))
  const body = frac ? `${whole}.${frac}` : whole
  return neg && /[1-9]/.test(body) ? `-${body}` : body
}

/** Dec -> Number (endast för diagnostik/logg, aldrig för jämförelse av belopp). */
export const decToNumber = (d: Dec): number => Number(decToString(d))

/** num/den med heltalsdivision och valt avrundningsläge (den > 0). */
export function divRound(num: bigint, den: bigint, mode: RoundMode): bigint {
  if (den <= BigInt("0")) throw new Error('divRound: nämnaren måste vara positiv')
  const neg = num < BigInt("0")
  const a = neg ? -num : num
  let q = a / den
  const twice = (a % den) * BigInt("2")
  if (twice > den) q += BigInt("1")
  else if (twice === den) {
    if (mode === 'half_away') q += BigInt("1")
    else if (mode === 'half_even') { if (q % BigInt("2") === BigInt("1")) q += BigInt("1") }
    else if (!neg) q += BigInt("1") // half_up: positivt tal avrundas uppåt, negativt mot noll
  }
  return neg ? -q : q
}

/** Avrundar d till `scale` decimaler; returnerar heltalet d*10^scale (t.ex. öre för scale=2 på SEK). */
export function roundDec(d: Dec, scale: number, mode: RoundMode): bigint {
  if (d.s <= scale) return d.n * pow10(scale - d.s)
  return divRound(d.n, pow10(d.s - scale), mode)
}

/** round(num/den) vid `scale` decimaler. */
export function ratioRound(num: Dec, den: Dec, scale: number, mode: RoundMode): bigint {
  if (den.n === BigInt("0")) throw new Error('ratioRound: division med noll')
  let n = num.n * pow10(den.s + scale)
  let d = den.n * pow10(num.s)
  if (d < BigInt("0")) { n = -n; d = -d }
  return divRound(n, d, mode)
}

/** |bråkdel − 0,5| vid `scale` decimaler (0 = exakt halvt, 0,5 = heltal). För att välja data som inte ligger nära ett tie. */
export function tieDistance(d: Dec, scale: number): number {
  if (d.s <= scale) return 0.5
  const div = pow10(d.s - scale)
  const r = (d.n < BigInt("0") ? -d.n : d.n) % div
  return Math.abs(Number(r) / Number(div) - 0.5)
}
export const isExactHalf = (d: Dec, scale: number): boolean => d.s > scale && tieDistance(d, scale) === 0

// ---------------------------------------------------------------- belopp

export type OracleInterval = {
  /** kWh som decimalsträng (kan vara '0'). */
  kwh: string
  /** SEK/kWh exkl. moms som decimalsträng (kan vara negativ eller '0'). */
  price: string
}

export type OracleTerms = {
  /** Påslag i öre/kWh (t.ex. '4'), eller null om avtalet saknar påslag. */
  markupOrePerKwh: string | null
  /** Månadsavgift i SEK exkl. moms, eller null. */
  monthlyFeeSek: string | null
  /** Fakturaavgift i SEK exkl. moms, eller null. */
  invoiceFeeSek: string | null
  /** Momssats i hela procent (25). */
  vatPercent: number
}

export type OracleLineCode = 'spot' | 'markup' | 'monthly_fee' | 'invoice_fee'

export type OracleLine = {
  code: OracleLineCode
  /** Exakt belopp exkl. moms i SEK före avrundning (decimalsträng). */
  exVatExactSek: string
  /** Avstånd från exakt halvt öre för exkl.-moms-beloppet (0 = exakt halvt). */
  exVatTie: number
  exVatOre: bigint
  vatOre: bigint
  incVatOre: bigint
  /** Avstånd från exakt halvt öre för momsbeloppet (beräknat på det avrundade exkl.-moms-beloppet). */
  vatTie: number
}

export type OracleInvoice = {
  mode: RoundMode
  lines: OracleLine[]
  totalExVatOre: bigint
  totalVatOre: bigint
  totalIncVatOre: bigint
  /** Alternativ momspolicy: moms på summan av raderna exkl. moms. */
  vatOnTotalOre: bigint
}

export function sumKwh(intervals: readonly OracleInterval[]): Dec {
  return intervals.reduce<Dec>((acc, it) => decAdd(acc, dec(it.kwh)), dec(0))
}

/** Σ kWh·p, exakt. */
export function sumEnergy(intervals: readonly OracleInterval[]): Dec {
  const sk = Math.max(0, ...intervals.map((it) => dec(it.kwh).s))
  const sp = Math.max(0, ...intervals.map((it) => dec(it.price).s))
  let total = BigInt("0")
  for (const it of intervals) {
    const k = dec(it.kwh)
    const p = dec(it.price)
    total += k.n * pow10(sk - k.s) * p.n * pow10(sp - p.s)
  }
  return { n: total, s: sk + sp }
}

/** Σ kWh·max(p,0): vad en (felaktig) klampning av negativa priser skulle ge. */
export function sumEnergyClamped(intervals: readonly OracleInterval[]): Dec {
  return sumEnergy(intervals.map((it) => ({ kwh: it.kwh, price: decToString(decMax0(dec(it.price))) })))
}

export type WeightedPrice = {
  /** Exakt Σ(kWh·p). */
  energy: Dec
  kwh: Dec
  /** Viktat pris avrundat till 6 decimaler (mikro-SEK/kWh) per läge. */
  micro: Record<RoundMode, bigint>
  /** Enkelt aritmetiskt medelvärde av priserna (alla intervall lika vikt), 6 decimaler, half_away. */
  simpleAverageMicro: bigint
  weightedAsNumber: number
  simpleAverageAsNumber: number
}

export function weightedPrice(intervals: readonly OracleInterval[]): WeightedPrice {
  const energy = sumEnergy(intervals)
  const kwh = sumKwh(intervals)
  if (kwh.n === BigInt("0")) throw new Error('weightedPrice: ΣkWh är noll, viktat pris är odefinierat')
  const micro = Object.fromEntries(ROUND_MODES.map((m) => [m, ratioRound(energy, kwh, 6, m)])) as Record<RoundMode, bigint>
  const priceSum = intervals.reduce<Dec>((acc, it) => decAdd(acc, dec(it.price)), dec(0))
  const simpleAverageMicro = ratioRound(priceSum, dec(intervals.length), 6, 'half_away')
  return {
    energy, kwh, micro, simpleAverageMicro,
    weightedAsNumber: Number(micro.half_away) / 1e6,
    simpleAverageAsNumber: Number(simpleAverageMicro) / 1e6,
  }
}

/** Momsen för ett (redan avrundat) belopp exkl. moms i hela öre. */
export function vatOnOre(exVatOre: bigint, vatPercent: number, mode: RoundMode): bigint {
  return divRound(exVatOre * BigInt(vatPercent), BigInt("100"), mode)
}

function line(code: OracleLineCode, exact: Dec, vatPercent: number, mode: RoundMode): OracleLine {
  const exVatOre = roundDec(exact, 2, mode)
  const vatOre = vatOnOre(exVatOre, vatPercent, mode)
  return {
    code,
    exVatExactSek: decToString(exact),
    exVatTie: tieDistance(exact, 2),
    exVatOre,
    vatOre,
    incVatOre: exVatOre + vatOre,
    vatTie: tieDistance({ n: exVatOre * BigInt(vatPercent), s: 2 }, 0),
  }
}

/** Hela fakturan enligt oraklets regler i ett avrundningsläge. Raderna i fast ordning: spot, markup, monthly_fee, invoice_fee. */
export function oracleInvoice(input: { intervals: readonly OracleInterval[]; terms: OracleTerms }, mode: RoundMode): OracleInvoice {
  const { terms } = input
  const lines: OracleLine[] = []
  const energy = sumEnergy(input.intervals)
  lines.push(line('spot', energy, terms.vatPercent, mode))
  if (terms.markupOrePerKwh !== null) {
    const exact = decMul(sumKwh(input.intervals), dec(terms.markupOrePerKwh))
    lines.push(line('markup', { n: exact.n, s: exact.s + 2 }, terms.vatPercent, mode))
  }
  if (terms.monthlyFeeSek !== null) lines.push(line('monthly_fee', dec(terms.monthlyFeeSek), terms.vatPercent, mode))
  if (terms.invoiceFeeSek !== null) lines.push(line('invoice_fee', dec(terms.invoiceFeeSek), terms.vatPercent, mode))
  const totalExVatOre = lines.reduce((s, l) => s + l.exVatOre, BigInt("0"))
  const totalVatOre = lines.reduce((s, l) => s + l.vatOre, BigInt("0"))
  return {
    mode, lines, totalExVatOre, totalVatOre, totalIncVatOre: totalExVatOre + totalVatOre,
    vatOnTotalOre: vatOnOre(totalExVatOre, terms.vatPercent, mode),
  }
}

export function oracleAllModes(input: { intervals: readonly OracleInterval[]; terms: OracleTerms }): Record<RoundMode, OracleInvoice> {
  return Object.fromEntries(ROUND_MODES.map((m) => [m, oracleInvoice(input, m)])) as Record<RoundMode, OracleInvoice>
}

/** Sant om någon rad (exkl. moms eller moms) ligger exakt på ett halvt öre i något läge, eller nära det (< eps). */
export function halfCaseLines(invoice: OracleInvoice, eps = 0): Array<{ code: OracleLineCode; kind: 'exVat' | 'vat'; tie: number }> {
  const out: Array<{ code: OracleLineCode; kind: 'exVat' | 'vat'; tie: number }> = []
  for (const l of invoice.lines) {
    if (l.exVatTie <= eps) out.push({ code: l.code, kind: 'exVat', tie: l.exVatTie })
    if (l.vatTie <= eps) out.push({ code: l.code, kind: 'vat', tie: l.vatTie })
  }
  return out
}

export const oreToSek = (ore: bigint): string => decToString({ n: ore, s: 2 }, 2)
/** Appens flyttalsbelopp -> hela öre. Kastar om talet inte ligger på exakt två decimaler (inom 1e-6 öre). */
export function sekNumberToOre(value: number): bigint {
  const scaled = value * 100
  const rounded = Math.round(scaled)
  if (Math.abs(scaled - rounded) > 1e-6) throw new Error(`belopp ${value} ligger inte på hela öre`)
  return BigInt(rounded)
}

// ---------------------------------------------------------------- kalender och Stockholms DST

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const MIN_MS = 60_000

/** Dagar sedan 1970-01-01 (Hinnants days_from_civil, proleptisk gregoriansk). */
export function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y
  const era = Math.floor(yy / 400)
  const yoe = yy - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

export function civilFromDays(z0: number): { y: number; m: number; d: number } {
  const z = z0 + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp < 10 ? mp + 3 : mp - 9
  return { y: m <= 2 ? y + 1 : y, m, d }
}

/** 0 = söndag ... 6 = lördag. 1970-01-01 var en torsdag. */
export const weekdayOfDays = (days: number): number => (((days + 4) % 7) + 7) % 7

export function daysInMonth(y: number, m: number): number {
  return daysFromCivil(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - daysFromCivil(y, m, 1)
}

/** Dagnummer (sedan epoch) för sista söndagen i månaden. */
export function lastSundayDays(y: number, m: number): number {
  const last = daysFromCivil(y, m, daysInMonth(y, m))
  return last - weekdayOfDays(last)
}

/** EU-regel: sommartid börjar sista söndagen i mars 01:00 UTC och slutar sista söndagen i oktober 01:00 UTC. */
export const dstStartUtcMs = (y: number): number => lastSundayDays(y, 3) * DAY_MS + HOUR_MS
export const dstEndUtcMs = (y: number): number => lastSundayDays(y, 10) * DAY_MS + HOUR_MS

function yearOfUtcMs(ms: number): number { return civilFromDays(Math.floor(ms / DAY_MS)).y }

/** Stockholms UTC-offset i minuter (60 eller 120) vid ett UTC-ögonblick. */
export function stockholmOffsetMinutes(utcMs: number): 60 | 120 {
  const y = yearOfUtcMs(utcMs)
  return utcMs >= dstStartUtcMs(y) && utcMs < dstEndUtcMs(y) ? 120 : 60
}

export type LocalParts = { y: number; m: number; d: number; hh: number; mm: number; offsetMinutes: 60 | 120 }

export function stockholmLocalParts(utcMs: number): LocalParts {
  const offsetMinutes = stockholmOffsetMinutes(utcMs)
  const local = utcMs + offsetMinutes * MIN_MS
  const days = Math.floor(local / DAY_MS)
  const rem = local - days * DAY_MS
  return { ...civilFromDays(days), hh: Math.floor(rem / HOUR_MS), mm: Math.floor((rem % HOUR_MS) / MIN_MS), offsetMinutes }
}

/**
 * Alla UTC-ögonblick vars svenska lokaltid är exakt (y-m-d hh:mm): 0 st (lokal tid saknas, vårens hopp),
 * 1 st (vanligt) eller 2 st (dubblerad timme på hösten; tidigast först = +02:00).
 */
export function stockholmLocalToUtcCandidates(y: number, m: number, d: number, hh = 0, mm = 0): number[] {
  const asUtc = daysFromCivil(y, m, d) * DAY_MS + hh * HOUR_MS + mm * MIN_MS
  const out: number[] = []
  for (const offset of [120, 60] as const) {
    const utc = asUtc - offset * MIN_MS
    if (stockholmOffsetMinutes(utc) === offset) out.push(utc)
  }
  return out.sort((a, b) => a - b)
}

const pad2 = (n: number): string => String(n).padStart(2, '0')
export const ymd = (y: number, m: number, d: number): string => `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`
export function parseYmd(value: string): { y: number; m: number; d: number } {
  const x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!x) throw new Error(`ogiltigt datum ${value}`)
  return { y: Number(x[1]), m: Number(x[2]), d: Number(x[3]) }
}
export function parseYm(value: string): { y: number; m: number } {
  const x = /^(\d{4})-(\d{2})$/.exec(value)
  if (!x) throw new Error(`ogiltig månad ${value}`)
  return { y: Number(x[1]), m: Number(x[2]) }
}
export function addDaysYmd(value: string, delta: number): string {
  const { y, m, d } = parseYmd(value)
  const c = civilFromDays(daysFromCivil(y, m, d) + delta)
  return ymd(c.y, c.m, c.d)
}

/** Stockholms lokala midnatt för ett datum, som UTC-ms. Midnatt är aldrig tvetydig eller saknad. */
export function stockholmMidnightUtcMs(y: number, m: number, d: number): number {
  const c = stockholmLocalToUtcCandidates(y, m, d, 0, 0)
  if (c.length !== 1) throw new Error(`lokal midnatt ${ymd(y, m, d)} gav ${c.length} kandidater`)
  return c[0]
}

export function stockholmDayBoundsUtc(date: string): { startMs: number; endMs: number; minutes: number } {
  const { y, m, d } = parseYmd(date)
  const startMs = stockholmMidnightUtcMs(y, m, d)
  const next = civilFromDays(daysFromCivil(y, m, d) + 1)
  const endMs = stockholmMidnightUtcMs(next.y, next.m, next.d)
  return { startMs, endMs, minutes: (endMs - startMs) / MIN_MS }
}

export function stockholmMonthBoundsUtc(month: string): { startMs: number; endMs: number; days: string[]; minutes: number } {
  const { y, m } = parseYm(month)
  const n = daysInMonth(y, m)
  const nextY = m === 12 ? y + 1 : y
  const nextM = m === 12 ? 1 : m + 1
  const startMs = stockholmMidnightUtcMs(y, m, 1)
  const endMs = stockholmMidnightUtcMs(nextY, nextM, 1)
  return { startMs, endMs, days: Array.from({ length: n }, (_, i) => ymd(y, m, i + 1)), minutes: (endMs - startMs) / MIN_MS }
}

export const quartersInDay = (date: string): number => stockholmDayBoundsUtc(date).minutes / 15
export const hoursInDay = (date: string): number => stockholmDayBoundsUtc(date).minutes / 60
export const quartersInMonth = (month: string): number => stockholmMonthBoundsUtc(month).minutes / 15
export const hoursInMonth = (month: string): number => stockholmMonthBoundsUtc(month).minutes / 60

/** Stockholms kalenderdag (YYYY-MM-DD) för ett UTC-ögonblick. */
export function stockholmDateOf(utcMs: number): string {
  const p = stockholmLocalParts(utcMs)
  return ymd(p.y, p.m, p.d)
}

export type Slot = { startMs: number; endMs: number; index: number }
/** Sammanhängande intervall [startMs, endMs) med steg `stepMinutes`. */
export function slots(startMs: number, endMs: number, stepMinutes: number): Slot[] {
  const step = stepMinutes * MIN_MS
  if ((endMs - startMs) % step !== 0) throw new Error('intervallet är inte en jämn multipel av steget')
  const out: Slot[] = []
  for (let t = startMs, i = 0; t < endMs; t += step, i += 1) out.push({ startMs: t, endMs: t + step, index: i })
  return out
}

export const isoUtc = (ms: number): string => new Date(ms).toISOString()

/** Sammanfattar UTC-ögonblick som lokal tid + offset, t.ex. "2027-10-31 02:00 +02:00". */
export function describeLocal(utcMs: number): string {
  const p = stockholmLocalParts(utcMs)
  return `${ymd(p.y, p.m, p.d)} ${pad2(p.hh)}:${pad2(p.mm)} +${pad2(p.offsetMinutes / 60)}:00`
}

/** sha256-hex av text (för checksummor i spotsammanställningar; ingen appkod). */
export const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')
