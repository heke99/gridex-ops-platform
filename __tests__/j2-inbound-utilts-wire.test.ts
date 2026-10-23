// reality-defects: J2, T15 (reality scenario J2 harness: the grid owner's E66/E31 wire is what the platform's own runtime accepts)
// scripts/helpers/reality/inboundUtilts.ts builds the files scenario J2 mails to the platform. These checks run the
// platform's real UTILTS runtime on them, so a scenario failure is a product finding, not a malformed fixture.
// Expectations are the values written into the wire. Every file is a grid owner's real day: 00:00–24:00 in fixed
// normal time +0100 (ENV-08), 96 quarter-hours from 23:00Z the day before (T15). Synthetic data only.
import { describe, expect, it } from 'vitest'
import { runUtiltsRuntimeForMessage, parseUtiltsRuntimeFacts } from '@/lib/ediel/utiltsEngine'
import { canonicalUtiltsTransactions, utiltsPhysicalQuantityQuality } from '@/lib/ediel/utilts/canonicalObservationScope'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { changedQuarters, correctedValues, hourlyFromQuarterValues, utiltsE31, utiltsE66 } from '../scripts/helpers/reality/inboundUtilts'
import { edielDayProfile, edielQuarterStarts } from '../scripts/helpers/reality/dst'
import { gs1 } from '../scripts/helpers/live-chain-wire'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'

const message = (raw: string, code = 'E66', received = '2026-10-22T08:00:00Z') => ({ id: 'j2-wire', company_id: 'tenant', environment: 'test', direction: 'inbound', message_family: 'UTILTS', message_code: code,
  message_standard: 'edifact', raw_payload: raw, metering_point_id: code === 'E66' ? 'meter-j2' : null, business_match_status: 'matched', message_received_at: received, created_at: received, parsed_payload: {} }) as unknown as EdielMessageRow
const DAY = '2026-09-10', VALUES = edielDayProfile(DAY, 3, 2)
const base = { issuer: '16700', receiver: '40000', meterId: gs1('73599900000000001'), day: DAY, values: VALUES, registeredAt: Date.parse('2026-09-11T06:00:00Z') }

describe('E66 for scenario J2', () => {
  it('a whole measured Ediel day: 96 quarter-hours 00:00–24:00 +0100 (23:00Z–23:00Z) accepted, no quality flag', () => {
    const file = utiltsE66({ ...base, reference: 'J2W1' })
    const runtime = runUtiltsRuntimeForMessage(message(file.edifact))
    expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues)).toBe(true)
    expect(runtime.transactionDispositions).toMatchObject([{ disposition: 'accepted', responseType: 'positive_aperak' }])
    expect(file).toMatchObject({ periodStart: '2026-09-09T23:00:00.000Z', periodEnd: '2026-09-10T23:00:00.000Z' })
    expect(file.edifact).toContain("DTM+735:?+0100:406'")
    expect(file.edifact).not.toContain('+0200')
    expect(parseUtiltsRuntimeFacts(file.edifact).transactions[0].deliveryPeriodRaw).toBe('202609100000202609110000')
    expect(file.values).toHaveLength(96)
    expect(file.starts).toEqual(edielQuarterStarts(DAY))
    // Registered 06:00Z = 08:00 CEST: DTM+137 in +0100 (07:00), UNB in Swedish local time (ENV-08).
    expect(file.edifact).toContain("DTM+137:202609110700:203'")
    expect(file.edifact).toMatch(/UNB\+UNOC:3\+16700:ZZ\+40000:ZZ\+260911:0800\+/)
  })

  it('every day is 96 values in +0100, also on the DST days; a civil 100/92-value day is refused', () => {
    for (const day of ['2026-10-25', '2026-03-29', '2027-03-28']) {
      const file = utiltsE66({ ...base, day, values: edielDayProfile(day), reference: `J2D${day.slice(2, 4)}`, registeredAt: undefined })
      expect(file.values, day).toHaveLength(96)
      expect(file.edifact, day).toContain("DTM+735:?+0100:406'")
      expect(Date.parse(file.periodEnd) - Date.parse(file.periodStart), day).toBe(24 * 3_600_000)
      const runtime = runUtiltsRuntimeForMessage(message(file.edifact, 'E66', new Date(Date.parse(file.registeredAt) + 3_600_000).toISOString()))
      expect(runtime.validation.ok, `${day} ${JSON.stringify(runtime.validation.issues.map(issue => issue.code))}`).toBe(true)
    }
    expect(utiltsE66({ ...base, day: '2026-10-25', values: edielDayProfile('2026-10-25'), reference: 'J2D25', registeredAt: undefined }))
      .toMatchObject({ periodStart: '2026-10-24T23:00:00.000Z', periodEnd: '2026-10-25T23:00:00.000Z' })
    expect(() => utiltsE66({ ...base, day: '2026-10-25', values: [...VALUES, 0.1, 0.1, 0.1, 0.1], reference: 'J2D100' })).toThrow('requires 96')
  })

  it('estimated quarter-hours carry quality 56; the others none', () => {
    const file = utiltsE66({ ...base, reference: 'J2W2', estimated: new Set([0, 1, 95]) })
    const runtime = runUtiltsRuntimeForMessage(message(file.edifact))
    expect(runtime.transactionDispositions).toMatchObject([{ disposition: 'accepted' }])
    const wire = tokenizeEdifact(file.edifact)
    const [transaction] = canonicalUtiltsTransactions(wire.segments.slice(wire.segments.findIndex(s => s.tag === 'UNH')), wire.una, 0)
    const quality = transaction.observations.map(o => utiltsPhysicalQuantityQuality(o, o.quantities[0], wire.una))
    expect(quality.filter(q => q === '56')).toHaveLength(3)
    expect([quality[0], quality[1], quality[2], quality[95]]).toEqual(['56', '56', null, '56'])
  })

  it('a window of the day: 06:00–12:00 +0100 (07:00–13:00 CEST) is 24 quarter-hours for the window only', () => {
    const corrected = correctedValues(VALUES, { every: 1, deltaKwh: 0.05, from: 24, to: 48 })
    expect(changedQuarters(VALUES, corrected)).toHaveLength(24)
    const file = utiltsE66({ ...base, values: corrected, reference: 'J2W3', window: { from: 24, to: 48 }, registeredAt: Date.parse('2026-09-12T06:00:00Z') })
    const facts = parseUtiltsRuntimeFacts(file.edifact)
    expect(facts.transactions[0].deliveryPeriodRaw).toBe('202609100600202609101200')
    expect(file).toMatchObject({ periodStart: '2026-09-10T05:00:00.000Z', periodEnd: '2026-09-10T11:00:00.000Z' })
    expect(file.values).toEqual(corrected.slice(24, 48))
    expect(runUtiltsRuntimeForMessage(message(file.edifact)).transactionDispositions).toMatchObject([{ disposition: 'accepted' }])
  })

  it('refuses a registration before the period has ended', () => {
    expect(() => utiltsE66({ ...base, reference: 'J2W4', registeredAt: Date.parse('2026-09-10T12:00:00Z') })).toThrow('registered before')
  })
})

describe('E31 for scenario J2', () => {
  it('a grid-area aggregate of one day in hourly values parses as E31 without a metering point', () => {
    const file = utiltsE31({ issuer: '16700', receiver: '40000', gridArea: 'ALS', day: DAY, hourlyKwh: hourlyFromQuarterValues(VALUES), reference: 'J2E31' })
    const facts = parseUtiltsRuntimeFacts(file.edifact)
    expect(facts.messageCode).toBe('E31')
    expect(facts.transactions).toHaveLength(1)
    expect(facts.transactions[0].meterPointId ?? null).toBeNull()
    expect(facts.transactions[0].deliveryPeriodRaw).toBe('202609100000202609110000')
    expect(file.edifact).toContain("DTM+735:?+0100:406'")
    expect(file).toMatchObject({ periodStart: '2026-09-09T23:00:00.000Z', periodEnd: '2026-09-10T23:00:00.000Z' })
    expect(file.values).toHaveLength(24)
  })
})

describe('T13: J2 UTILTS files carry the lane of the tenant they are sent to', () => {
  const day = '2026-09-10', values = edielDayProfile(day), notAfter = Date.parse('2026-09-12T00:00:00Z')
  const e66 = (environment?: 'production' | 'test') => utiltsE66({ issuer: '16700', receiver: '70001', meterId: gs1('73599900000000001'), day, values, reference: 'JLANE1', notAfter, environment })
  const e31 = (environment?: 'production' | 'test') => utiltsE31({ issuer: '16700', receiver: '70001', gridArea: 'ALS', day, hourlyKwh: hourlyFromQuarterValues(values), reference: 'JLANE2', notAfter, environment })
  it('default and test: UNB 0035=1 (unchanged)', () => {
    for (const file of [e66(), e66('test'), e31(), e31('test')]) expect(EdifactEnvelopeCodec.decode(file.edifact)).toMatchObject({ environment: 'test', testIndicator: '1' })
    expect(e66().edifact).toBe(e66('test').edifact)
    expect(e31().edifact).toBe(e31('test').edifact)
  })
  it("production: no test indicator, otherwise the same file, still accepted by the UTILTS runtime", () => {
    for (const [production, test] of [[e66('production'), e66()], [e31('production'), e31()]]) {
      expect(EdifactEnvelopeCodec.decode(production.edifact)).toMatchObject({ environment: 'production', testIndicator: null })
      expect(production.edifact.replace(/(23-DDQ-E(?:66-T|31-S))'/, "$1++++1'")).toBe(test.edifact)
    }
    const runtime = runUtiltsRuntimeForMessage({ ...message(e66('production').edifact), environment: 'production' } as EdielMessageRow)
    expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues)).toBe(true)
    expect(runtime.transactionDispositions).toMatchObject([{ disposition: 'accepted', responseType: 'positive_aperak' }])
  })
})
