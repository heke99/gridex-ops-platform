// TERM02: deterministiska syntetiska tidsserier (förbrukning och spotpris) för scenariot. Ren kod utan databas.
//
// Konventioner: förbrukning anges i hela Wh (heltal) och blir kWh-strängar med högst 3 decimaler; spotpris anges i
// tiondels öre per kWh (p4 = SEK/kWh * 10 000, heltal) och blir SEK/kWh-strängar med högst 4 decimaler. Heltal gör att
// oraklet kan räkna exakt och att datat kan väljas så att inga belopp ligger nära ett halvt öre (utom i TERM02.08).
import {
  decToString, isoUtc, stockholmLocalParts, stockholmMonthBoundsUtc, stockholmDayBoundsUtc, slots,
  type OracleInterval, type Slot,
} from './term-oracle'
import type { MeterValueInput, SpotIntervalInput } from './term-billing'

/** Heltal Wh -> kanonisk kWh-sträng ('0.25', '2', '0', '1.234'). */
export function whToKwh(wh: number): string {
  if (!Number.isInteger(wh) || wh < 0) throw new Error(`whToKwh: ${wh}`)
  return decToString({ n: BigInt(wh), s: 3 })
}

/** Heltal p4 (tiondels öre/kWh) -> SEK/kWh-sträng ('0.09', '-0.0900' blir '-0.09', '1.9'). */
export function p4ToSek(p4: number): string {
  if (!Number.isInteger(p4)) throw new Error(`p4ToSek: ${p4}`)
  return decToString({ n: BigInt(p4), s: 4 })
}

export type Point = { slot: Slot; wh: number; p4: number }

const hh = (ms: number): number => stockholmLocalParts(ms).hh
const dd = (ms: number): number => stockholmLocalParts(ms).d

/** Gemensamt timpris-mönster (dyra kvällstimmar). */
export function hourlyShapePrice(startMs: number): number {
  const h = hh(startMs)
  const day = dd(startMs)
  const base = h <= 5 ? 2800 + 40 * h
    : h <= 9 ? 5200 + 100 * (h - 6)
    : h <= 15 ? 4200
    : h <= 20 ? 11800 + 250 * (h - 16)
    : 6100
  return base + ((day * 37) % 400)
}

/** Icke-uniform förbrukning: tunga timmar (16-20) sammanfaller med de dyra priserna. */
export function hourlyShapeWh(startMs: number): number {
  const h = hh(startMs)
  const day = dd(startMs)
  if (h >= 16 && h <= 20) return 2400 + ((day * 53) % 500)
  if (h >= 6 && h <= 9) return 900
  return 300 + ((day * 17) % 200)
}

export function monthSlots(month: string, stepMinutes: 15 | 60): Slot[] {
  const b = stockholmMonthBoundsUtc(month)
  return slots(b.startMs, b.endMs, stepMinutes)
}

export function toMeterValues(points: readonly Pick<Point, 'slot' | 'wh'>[], resolution: 'PT15M' | 'PT60M'): MeterValueInput[] {
  return points.map((p) => ({ startUtc: isoUtc(p.slot.startMs), endUtc: isoUtc(p.slot.endMs), kwh: whToKwh(p.wh), resolution }))
}

export function toSpotIntervals(points: readonly Pick<Point, 'slot' | 'p4'>[], resolution: 'hourly' | 'quarter_hour'): SpotIntervalInput[] {
  return points.map((p) => ({ startUtc: isoUtc(p.slot.startMs), endUtc: isoUtc(p.slot.endMs), sekPerKwh: p4ToSek(p.p4), resolution }))
}

export const toOracle = (points: readonly Point[]): OracleInterval[] => points.map((p) => ({ kwh: whToKwh(p.wh), price: p4ToSek(p.p4) }))

// ---------------------------------------------------------------- TERM02.01 (timavtal, icke-uniform förbrukning)

export function term0201Hourly(month: string): Point[] {
  return monthSlots(month, 60).map((slot) => ({ slot, wh: hourlyShapeWh(slot.startMs), p4: hourlyShapePrice(slot.startMs) }))
}

// ---------------------------------------------------------------- TERM02.02 (negativa priser och nollpris)

/** Dag 12-13: negativa priser (-0,05..-0,20 SEK/kWh) med tung förbrukning; dag 14: nollpris; övrigt positivt. */
export function term0202Hourly(month: string): Point[] {
  return monthSlots(month, 60).map((slot) => {
    const h = hh(slot.startMs)
    const day = dd(slot.startMs)
    if (day === 12 || day === 13) return { slot, wh: 3000 + h * 10, p4: -(500 + ((h * 61) % 1500)) }
    if (day === 14) return { slot, wh: 400 + ((h * 91) % 1400), p4: 0 }
    // +4 Wh i var sjunde timme: valt så att ingen rad (inkl. moms) hamnar på exakt halvt öre (se TERM02.08 för halva ören).
    return { slot, wh: 400 + ((h * 91 + day * 13) % 1400) + (slot.index % 7 === 0 ? 4 : 0), p4: 3000 + ((h * 211 + day * 97) % 6000) }
  })
}

// ---------------------------------------------------------------- TERM02.03 (noll kWh hela månaden)

export function term0203Hourly(month: string): Point[] {
  return monthSlots(month, 60).map((slot) => ({ slot, wh: 0, p4: 4500 + hh(slot.startMs) * 50 }))
}

// ---------------------------------------------------------------- TERM02.04 (matris)

/** Kvartspriser: timmönstret plus 0,0025 SEK/kWh per kvart i timmen, så att timpris och kvartspris skiljer. */
export function quarterPriceFromHourShape(startMs: number): number {
  return hourlyShapePrice(startMs) + 25 * ((startMs / 60_000 / 15) % 4)
}

export function term0204QuarterPrices(month: string): Point[] {
  return monthSlots(month, 15).map((slot) => ({ slot, wh: 0, p4: quarterPriceFromHourShape(slot.startMs) }))
}
export function term0204HourlyPrices(month: string): Point[] {
  return monthSlots(month, 60).map((slot) => ({ slot, wh: 0, p4: hourlyShapePrice(slot.startMs) }))
}
export function term0204QuarterWh(index: number): number { return 60 + ((index * 37) % 140) }
export function term0204HourlyWh(index: number): number { return 300 + ((index * 53) % 700) }

// ---------------------------------------------------------------- TERM02.05 / 06 (DST-månader, kvartsdata)

export function dstQuarterSeries(month: string, seed: 'mar' | 'oct'): Point[] {
  const a = seed === 'mar' ? { pm: 3000, pi: 131, pr: 7000, wm: 50, wi: 29, wr: 400 } : { pm: 3500, pi: 173, pr: 6500, wm: 40, wi: 31, wr: 350 }
  return monthSlots(month, 15).map((slot) => ({
    slot,
    // +1 Wh i var elfte kvart för mars-serien: valt så att ingen rad (inkl. moms) hamnar på exakt halvt öre.
    wh: a.wm + ((slot.index * a.wi) % a.wr) + (seed === 'mar' && slot.index % 11 === 0 ? 1 : 0),
    p4: a.pm + ((slot.index * a.pi + (slot.index >> 3) * 17) % a.pr),
  }))
}

/**
 * Felaktig dygnsserie för den dag där lokal tid hoppar: avsändaren har skickat 96 kvartar från lokal midnatt, som om
 * dygnet alltid var 24 timmar (på vårens dag finns lokala 02:00-03:00 inte; på höstens dag saknas den dubblerade timmen).
 * Övriga dagar är korrekta. Ger 96 kvartar för `badDay`; på vårens dag spiller de 4 sista kvartarna in i nästa dygn
 * (överlapp mot nästa dygns första 4 kvartar), på höstens dag saknas de 4 sista kvartarna (lucka mot månadens slut).
 */
export function faultyDstDaySeries(month: string, badDay: string, seed: 'mar' | 'oct'): Point[] {
  const a = seed === 'mar' ? { wm: 50, wi: 29, wr: 400 } : { wm: 40, wi: 31, wr: 350 }
  const b = stockholmMonthBoundsUtc(month)
  const out: Point[] = []
  let running = 0
  for (const day of b.days) {
    const d = stockholmDayBoundsUtc(day)
    const endMs = day === badDay ? d.startMs + 96 * 15 * 60_000 : d.endMs
    for (const slot of slots(d.startMs, endMs, 15)) {
      out.push({ slot: { startMs: slot.startMs, endMs: slot.endMs, index: running }, wh: a.wm + ((running * a.wi) % a.wr), p4: 0 })
      running += 1
    }
  }
  return out
}

// ---------------------------------------------------------------- TERM02.07 (dubblerad lokal timme)

/** Instanserna av lokala 02:00-03:00 den 2027-10-31: +02:00 (00:00-01:00Z) och +01:00 (01:00-02:00Z). */
export const DUP_HOUR_FIRST_UTC = '2027-10-31T00:00:00.000Z'
export const DUP_HOUR_SECOND_UTC = '2027-10-31T01:00:00.000Z'

export function term0207Hourly(month: string): Point[] {
  return monthSlots(month, 60).map((slot) => {
    const iso = isoUtc(slot.startMs)
    if (iso === DUP_HOUR_FIRST_UTC) return { slot, wh: 2000, p4: 4000 }
    if (iso === DUP_HOUR_SECOND_UTC) return { slot, wh: 5000, p4: 19000 }
    return { slot, wh: 300 + ((slot.index * 53) % 700), p4: 4000 + ((slot.index * 97) % 5000) }
  })
}

// ---------------------------------------------------------------- TERM02.08 (halva ören)

export type HalfCase = { key: 'P1' | 'P2' | 'N1' | 'N2' | 'ORD'; hourIndex: number; wh: number; p4: number }
/**
 * Varje fall har egen timme (och eget pris) i samma prisserie; kunden förbrukar bara i sin timme (noll övriga timmar).
 *   P1: 0,5 kWh * 0,09  = 4,5 öre   (exakt halvt, positivt; även momsen på påslaget 2 öre = 0,5 öre)
 *   P2: 0,5 kWh * 0,11  = 5,5 öre   (halvt; momsen på 6 öre = 1,5 öre)
 *   N1: 0,5 kWh * -0,09 = -4,5 öre  (halvt, negativt)
 *   N2: 0,5 kWh * -0,11 = -5,5 öre  (halvt, negativt; momsen på -6 öre = -1,5 öre)
 *   ORD: 1,234 kWh * 0,4321 (inte halvt)
 */
export const HALF_CASES: readonly HalfCase[] = [
  { key: 'P1', hourIndex: 100, wh: 500, p4: 900 },
  { key: 'P2', hourIndex: 200, wh: 500, p4: 1100 },
  { key: 'N1', hourIndex: 300, wh: 500, p4: -900 },
  { key: 'N2', hourIndex: 400, wh: 500, p4: -1100 },
  { key: 'ORD', hourIndex: 500, wh: 1234, p4: 4321 },
]

export function term0208Prices(month: string): Point[] {
  return monthSlots(month, 60).map((slot) => {
    const c = HALF_CASES.find((x) => x.hourIndex === slot.index)
    return { slot, wh: 0, p4: c ? c.p4 : 5000 }
  })
}
export function term0208Consumption(month: string, caseKey: HalfCase['key']): Point[] {
  const c = HALF_CASES.find((x) => x.key === caseKey)!
  return term0208Prices(month).map((p) => ({ ...p, wh: p.slot.index === c.hourIndex ? c.wh : 0 }))
}

/** Hjälp: tillverka (kvart-)förbrukning på ett timprisunderlag, där varje kvart får priset för sin timme. */
export function quartersOnHourlyPrices(quarterWh: (index: number) => number, hourlyPrices: readonly Point[], month: string): Point[] {
  const priceByHourStart = new Map(hourlyPrices.map((h) => [h.slot.startMs, h.p4]))
  return monthSlots(month, 15).map((slot) => {
    const hourStart = slot.startMs - (((slot.startMs / 60_000) % 60) * 60_000)
    const p4 = priceByHourStart.get(hourStart)
    if (p4 === undefined) throw new Error(`inget timpris för kvarten ${isoUtc(slot.startMs)}`)
    return { slot, wh: quarterWh(slot.index), p4 }
  })
}


// ---------------------------------------------------------------- timserier för DST-månader (TERM02.05/06 timvariant)

/** Timserie för hela månaden (743 timmar i 2027-03, 745 i 2027-10). */
export function dstHourlySeries(month: string, seed: 'mar' | 'oct'): Point[] {
  const a = seed === 'mar' ? { pm: 3300, pi: 113, pr: 6800, wm: 300, wi: 53, wr: 900 } : { pm: 3700, pi: 127, pr: 6200, wm: 250, wi: 59, wr: 800 }
  return monthSlots(month, 60).map((slot) => ({
    slot,
    wh: a.wm + ((slot.index * a.wi) % a.wr) + (slot.index % 17 === 0 ? 1 : 0),
    p4: a.pm + ((slot.index * a.pi + (slot.index >> 2) * 19) % a.pr),
  }))
}

/**
 * Felaktig timserie: `badDay` har 24 timmar från lokal midnatt som om dygnet alltid var 24 timmar (vårdagen får en
 * timme som inte finns lokalt 02:00-03:00 och spiller 1 timme in i nästa dygn = överlapp; höstdagen saknar sista
 * timmen = lucka mot månadens slut). Övriga dagar är korrekta. Totalt 31*24 rader.
 */
export function faultyDstHourlySeries(month: string, badDay: string): Point[] {
  const b = stockholmMonthBoundsUtc(month)
  const out: Point[] = []
  let running = 0
  for (const day of b.days) {
    const d = stockholmDayBoundsUtc(day)
    const endMs = day === badDay ? d.startMs + 24 * 3_600_000 : d.endMs
    for (const slot of slots(d.startMs, endMs, 60)) {
      out.push({ slot: { startMs: slot.startMs, endMs: slot.endMs, index: running }, wh: 300 + ((running * 53) % 900), p4: 0 })
      running += 1
    }
  }
  return out
}

// ---------------------------------------------------------------- TERM02.01/.02 originalorakelts exempelvärden

/** Originalorakelts (all-systems-scenarios.safe.json, TERM02 fixture) exempelvärden: 0 / 0,25 / 1,5 / 2 kWh. */
export const ORIGINAL_EXAMPLE_WH: readonly number[] = [0, 250, 1500, 2000]
/** Originalorakelts exempelpriser: -0,50 / 0 / 0,75 / 1,20 SEK/kWh (p4 = SEK/kWh * 10 000). */
export const ORIGINAL_EXAMPLE_P4: readonly number[] = [-5000, 0, 7500, 12000]

/** Timslot i cyklar deterministiskt genom alla 16 (wh, p4)-kombinationer: wh = i % 4, p4 = floor(i / 4) % 4. */
export function term02OriginalExampleHourly(month: string): Point[] {
  return monthSlots(month, 60).map((slot) => ({
    slot,
    wh: ORIGINAL_EXAMPLE_WH[slot.index % 4],
    p4: ORIGINAL_EXAMPLE_P4[Math.floor(slot.index / 4) % 4],
  }))
}
