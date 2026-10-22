// reality-defects: J4 parse conformance — inbound UTILTS E66/E31: QTY decimals and signs, quality (STS+8), periods, resolution, DTM+735, units, several metering points
//
// Field positions from the UTILTS guide (U §3.7: 516 SG11/QTY+136, 520 SG11/STS+8/C555/4405, 264 SG5/MEA+AAZ, 505 IDE,
// 324 period 719, 354 resolution, ENV-08 DTM+735 406) and masterplan U-02/U-10. Messages come from the grid owner's own
// builder (scripts/helpers/live-chain-wire.ts dailyE66) or are hand-written counterparty wire with a custom UNA.
// Expectations are the values written into the wire, never the parser's own output. Synthetic data only.
import { describe, expect, it } from 'vitest'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { parseUtiltsRuntimeFacts } from '@/lib/ediel/utiltsEngine'
import { utiltsRuntimeSegments } from '@/lib/ediel/utiltsEngine.part-1'
import { canonicalUtiltsTransactions, utiltsPhysicalQuantityQuality } from '@/lib/ediel/utilts/canonicalObservationScope'
import { canonicalUtiltsDecimal, sumUtiltsDecimals, utiltsEnergyQuantityKwh } from '@/lib/ediel/utilts/exactDecimal'
import { parseUtilts } from '@/lib/ediel/utilts/parseUtilts'
import { utiltsPhysicalQuantityUnit } from '@/lib/ediel/utilts/quantityUnitScope'
import { normalizeEdifactResolution } from '@/lib/ediel/utilts/resolution'
import { localEdifactDateTimeToUtc, parseEdifactTimezoneOffsetFromSegments } from '@/lib/ediel/utilts/timezone'
import { parseEdifactPayload } from '@/lib/inbound-mail/edielEmailParser'
import { dailyE66, dayProfile, kwhText } from '../scripts/helpers/live-chain-wire'

const METER = '735999000000000017'

function physical(raw: string) {
  const wire = tokenizeEdifact(raw)
  const transactions = canonicalUtiltsTransactions(wire.segments.slice(wire.segments.findIndex(s => s.tag === 'UNH')), wire.una, 0)
  return { wire, transactions }
}

describe('J4 UTILTS E66 from the grid owner builder — one civil day of quarter-hours', () => {
  const DAYS = [
    { day: '2026-09-01', count: 96, offset: '+0200', minutes: 120, period: '202609010000202609020000', startUtc: '2026-08-31T22:00:00.000Z', endUtc: '2026-09-01T22:00:00.000Z' },
    { day: '2026-11-03', count: 96, offset: '+0100', minutes: 60, period: '202611030000202611040000', startUtc: '2026-11-02T23:00:00.000Z', endUtc: '2026-11-03T23:00:00.000Z' },
    // Last Sunday in October: 25 hours in the fixed +0200 offset of its local midnight (DST-H1).
    { day: '2026-10-25', count: 100, offset: '+0200', minutes: 120, period: '202610250000202610260100', startUtc: '2026-10-24T22:00:00.000Z', endUtc: '2026-10-25T23:00:00.000Z' },
  ]
  for (const row of DAYS) {
    it(`${row.day}: ${row.count} values, DTM+735 ${row.offset}, period and every quantity exact`, () => {
      const values = row.count === 96 ? dayProfile(3) : [...dayProfile(3), 0.111, 0.112, 0.113, 0.114]
      const raw = dailyE66({ issuer: '16700', receiver: '40000', meterId: METER, day: row.day, values, reference: 'J4E66' })
      const facts = parseUtiltsRuntimeFacts(raw)
      expect(facts).toMatchObject({ messageCode: 'E66', documentReference: 'MJ4E66', interchangeReference: 'J4E66', applicationReference: '23-DDQ-E66-T',
        meterPointId: METER, gridAreaId: 'TES', deliveryPeriodRaw: row.period })
      expect(parseUtilts(raw).utiltsSubtype).toBe('E66-KVART')
      expect(facts.transactions).toHaveLength(1)
      const [tx] = facts.transactions
      expect(tx).toMatchObject({ transactionId: 'TJ4E66', meterPointId: METER, gridAreaId: 'TES', resolution: '15', resolutionFormat: '806', unit: 'KWH', transactionReason: 'E88' })
      expect(normalizeEdifactResolution({ value: tx.resolution, format: tx.resolutionFormat })).toBe('PT15M')
      const timezone = parseEdifactTimezoneOffsetFromSegments(utiltsRuntimeSegments(facts))
      expect(timezone).toEqual({ raw: row.offset, offsetMinutes: row.minutes, format: '406' })
      expect(localEdifactDateTimeToUtc(tx.deliveryPeriodStart, timezone)).toBe(row.startUtc)
      expect(localEdifactDateTimeToUtc(tx.deliveryPeriodEnd, timezone)).toBe(row.endUtc)
      // Every quarter-hour, in order, with the exact decimal the grid owner wrote.
      const { wire, transactions } = physical(raw)
      const observations = transactions[0].observations
      expect(observations.map(o => o.observationId)).toEqual(values.map((_, i) => String(i + 1)))
      expect(observations.map(o => o.quantities.map(q => [q.qualifier, q.value]))).toEqual(values.map(v => [['136', kwhText(v)]]))
      for (const o of observations) {
        expect(utiltsPhysicalQuantityQuality(o, o.quantities[0], wire.una)).toBeNull()
        expect(utiltsPhysicalQuantityUnit(transactions[0], o, o.quantities[0], wire.una)).toBe('KWH')
      }
      expect(sumUtiltsDecimals(observations.map(o => canonicalUtiltsDecimal(o.quantities[0].value!, wire.una.decimalMark))))
        .toBe(canonicalUtiltsDecimal((values.reduce((a, v) => a + Math.round(v * 1000), 0) / 1000).toFixed(3)))
    })
  }

  it('hourly resolution (DTM+354 60:806) gives PT60M and 24 values', () => {
    const values = Array.from({ length: 24 }, (_, h) => Math.round((0.5 + h / 100) * 1000) / 1000)
    const raw = dailyE66({ issuer: '16700', receiver: '40000', meterId: METER, day: '2026-11-03', values, reference: 'J4H', resolutionMinutes: 60 })
    const [tx] = parseUtiltsRuntimeFacts(raw).transactions
    expect(normalizeEdifactResolution({ value: tx.resolution, format: tx.resolutionFormat })).toBe('PT60M')
    expect(physical(raw).transactions[0].observations.map(o => o.quantities[0].value)).toEqual(values.map(kwhText))
  })
})

// Counterparty wire with UNA component ';', element '*', decimal ',', release '#', terminator '!' and two metering points.
const TWO_POINTS = [
  'UNA;*,# !',
  'UNB*UNOC;3*16700;ZZ*40000;ZZ*261022;0600*R123**23-DDQ-E66-T****1!',
  'UNH*1*UTILTS;D;02B;UN;E5SE5A!', 'BGM*E66;;260*M123*9*AB!', 'DTM*137;202610220600;203!', 'DTM*735;#+0100;406!', 'MKS*23*E02;;260!',
  'NAD*MS*16700;SVK;260!', 'NAD*MR*40000;SVK;260!',
  'IDE*24*TA1!', 'LOC*172*735999000000000017;;9!', 'LOC*239*ALS;SVK;260!', 'LIN***8716867000030;;;9!',
  'DTM*324;202610200000202610200100;719!', 'DTM*597;202610220600;203!', 'DTM*354;15;806!', 'STS*7**E88;;260!', 'MEA*AAZ**KWH!',
  'SEQ**1!', 'QTY*136;0,125!', 'SEQ**2!', 'QTY*136;-1,5!', 'STS*8*56!', 'SEQ**3!', 'QTY*136;12!', 'STS*8*46!', 'SEQ**4!', 'QTY*136;0,0010!',
  'IDE*24*TB2!', 'LOC*172*735999000000000024;;9!', 'LOC*239*ALS;SVK;260!', 'LIN***8716867000030;;;9!',
  'DTM*324;202610200000202610200100;719!', 'DTM*597;202610220600;203!', 'DTM*354;60;806!', 'STS*7**E88;;260!', 'MEA*AAZ**MWH!',
  'SEQ**1!', 'QTY*136;1,000001!',
  'UNT*39*1!', 'UNZ*1*R123!',
].join('\n')

describe('J4 UTILTS E66 — custom UNA, decimal comma, signs, quality flags, two metering points in one message', () => {
  it('header and per-transaction facts (no leak between IDE transactions)', () => {
    const facts = parseUtiltsRuntimeFacts(TWO_POINTS)
    expect(facts).toMatchObject({ messageCode: 'E66', documentReference: 'M123', interchangeReference: 'R123', applicationReference: '23-DDQ-E66-T',
      senderEdielId: '16700', receiverEdielId: '40000' })
    expect(facts.transactions.map(t => ({ id: t.transactionId, mp: t.meterPointId, ga: t.gridAreaId, start: t.deliveryPeriodStart, end: t.deliveryPeriodEnd,
      res: t.resolution, unit: t.unit, reg: t.registrationTime, values: t.quantities.map(q => q.value) }))).toEqual([
      { id: 'TA1', mp: '735999000000000017', ga: 'ALS', start: '2026-10-20T00:00:00', end: '2026-10-20T01:00:00', res: '15', unit: 'KWH', reg: '2026-10-22T06:00:00', values: [0.125, -1.5, 12, 0.001] },
      { id: 'TB2', mp: '735999000000000024', ga: 'ALS', start: '2026-10-20T00:00:00', end: '2026-10-20T01:00:00', res: '60', unit: 'MWH', reg: '2026-10-22T06:00:00', values: [1.000001] },
    ])
    const timezone = parseEdifactTimezoneOffsetFromSegments(utiltsRuntimeSegments(facts))
    expect(timezone).toEqual({ raw: '+0100', offsetMinutes: 60, format: '406' })
    expect(localEdifactDateTimeToUtc('2026-10-20T00:00:00', timezone)).toBe('2026-10-19T23:00:00.000Z')
  })

  it('exact decimals (decimal comma from UNA), quality per own QTY, unit per own IDE, kWh conversion', () => {
    const { wire, transactions } = physical(TWO_POINTS)
    const rows = transactions.flatMap(t => t.observations.flatMap(o => o.quantities.map(q => [t.transactionId, o.observationId, q.value,
      canonicalUtiltsDecimal(q.value!, wire.una.decimalMark), utiltsPhysicalQuantityQuality(o, q, wire.una), utiltsPhysicalQuantityUnit(t, o, q, wire.una)])))
    expect(rows).toEqual([
      ['TA1', '1', '0,125', '0.125', null, 'KWH'],
      ['TA1', '2', '-1,5', '-1.5', '56', 'KWH'],   // 56 = estimated
      ['TA1', '3', '12', '12', '46', 'KWH'],
      ['TA1', '4', '0,0010', '0.001', null, 'KWH'],
      ['TB2', '1', '1,000001', '1.000001', null, 'MWH'],
    ])
    expect(utiltsEnergyQuantityKwh('1.000001', 'MWH')).toBe('1000.001')
    expect(utiltsEnergyQuantityKwh('-1.5', 'KWH')).toBe('-1.5')
  })

  it('stored mail-parser projection keeps raw decimal strings and every DTM', () => {
    const stored = parseEdifactPayload(TWO_POINTS)
    expect(stored).toMatchObject({ messageFamily: 'UTILTS', messageCode: 'E66', messageFunctionCode: '9', acknowledgementRequestCode: 'AB', bgmReference: 'M123',
      senderEdielId: '16700', receiverEdielId: '40000', interchangeReference: 'R123', applicationReference: '23-DDQ-E66-T' })
    expect(stored.quantities.map(q => [q.qualifier, q.rawValue, q.value])).toEqual([
      ['136', '0,125', 0.125], ['136', '-1,5', -1.5], ['136', '12', 12], ['136', '0,0010', 0.001], ['136', '1,000001', 1.000001]])
    expect(stored.dates).toEqual({ 137: ['202610220600'], 735: ['+0100'], 324: ['202610200000202610200100', '202610200000202610200100'],
      597: ['202610220600', '202610220600'], 354: ['15', '60'] })
    expect(stored.locations).toEqual({ 172: ['735999000000000017', '735999000000000024'], 239: ['ALS', 'ALS'] })
  })

  it('an unsupported or ambiguous quality fails closed, never borrowed from another quantity', () => {
    const unsupported = physical(TWO_POINTS.replace('STS*8*46!', 'STS*8*99!'))
    const o3 = unsupported.transactions[0].observations[2]
    expect(() => utiltsPhysicalQuantityQuality(o3, o3.quantities[0], unsupported.wire.una)).toThrow('utilts_quantity_quality_unsupported')
    const ambiguous = physical(TWO_POINTS.replace('STS*8*46!', 'STS*8*46!STS*8*56!'))
    const a3 = ambiguous.transactions[0].observations[2]
    expect(() => utiltsPhysicalQuantityQuality(a3, a3.quantities[0], ambiguous.wire.una)).toThrow('utilts_quantity_quality_ambiguous')
    // Observation 1 has no STS of its own: approved, not the 56 of observation 2.
    const first = ambiguous.transactions[0].observations[0]
    expect(utiltsPhysicalQuantityQuality(first, first.quantities[0], ambiguous.wire.una)).toBeNull()
  })
})

describe('J4 UTILTS E31 — hourly settlement series for two points', () => {
  const raw = [
    "UNA:+.? '", "UNB+UNOC:3+16700:ZZ+40000:ZZ+261103:0600+E31R1++23-DDQ-E31-S++++1'", "UNH+1+UTILTS:D:02B:UN:E5SE5A'",
    "BGM+E31::260+E31DOC1+9+AB'", "DTM+137:202611030600:203'", "DTM+735:?+0100:406'", "MKS+23+E02::260'",
    "NAD+MS+16700:SVK:260'", "NAD+MR+40000:SVK:260'",
    "IDE+24+E31T1'", "LOC+172+735999000000000017::9'", "LOC+239+ALS:SVK:260'", "LIN+++8716867000030:::9'",
    "DTM+324:202611020000202611020300:719'", "DTM+597:202611030600:203'", "DTM+354:60:806'", "STS+7++E88::260'", "MEA+AAZ++KWH'",
    "SEQ++1'", "QTY+136:1.250'", "SEQ++2'", "QTY+136:0'", "SEQ++3'", "QTY+136:2.5'",
    "IDE+24+E31T2'", "LOC+172+735999000000000024::9'", "LOC+239+ALS:SVK:260'", "LIN+++8716867000030:::9'",
    "DTM+324:202611020000202611020300:719'", "DTM+597:202611030600:203'", "DTM+354:60:806'", "STS+7++E88::260'", "MEA+AAZ++KWH'",
    "SEQ++1'", "QTY+136:3'", "SEQ++2'", "QTY+136:3.000'", "SEQ++3'", "QTY+136:-0.5'",
    "UNT+37+1'", "UNZ+1+E31R1'",
  ].join('')
  it('code, subtype and per-point exact series', () => {
    const facts = parseUtiltsRuntimeFacts(raw)
    expect(facts.messageCode).toBe('E31')
    expect(parseUtilts(raw).utiltsSubtype).toBe('E31-SCH')
    expect(facts.transactions.map(t => [t.transactionId, t.meterPointId, t.deliveryPeriodRaw, t.resolution, t.unit])).toEqual([
      ['E31T1', '735999000000000017', '202611020000202611020300', '60', 'KWH'], ['E31T2', '735999000000000024', '202611020000202611020300', '60', 'KWH']])
    const { wire, transactions } = physical(raw)
    expect(transactions.map(t => t.observations.map(o => canonicalUtiltsDecimal(o.quantities[0].value!, wire.una.decimalMark)))).toEqual([['1.25', '0', '2.5'], ['3', '3', '-0.5']])
  })
})
