// reality-defects: J2 (reality scenario J2 harness: the grid owner's E66/E31 wire is what the platform's own runtime accepts)
// scripts/helpers/reality/inboundUtilts.ts builds the files scenario J2 mails to the platform. These checks run the
// platform's real UTILTS runtime on them, so a scenario failure is a product finding, not a malformed fixture.
// Expectations are the values written into the wire. Synthetic data only.
import { describe, expect, it } from 'vitest'
import { runUtiltsRuntimeForMessage, parseUtiltsRuntimeFacts } from '@/lib/ediel/utiltsEngine'
import { canonicalUtiltsTransactions, utiltsPhysicalQuantityQuality } from '@/lib/ediel/utilts/canonicalObservationScope'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { changedQuarters, correctedValues, hourlyFromQuarterValues, utiltsE31, utiltsE66 } from '../scripts/helpers/reality/inboundUtilts'
import { dstDayProfile } from '../scripts/helpers/reality/dst'
import { gs1 } from '../scripts/helpers/live-chain-wire'

const message = (raw: string, code = 'E66') => ({ id: 'j2-wire', company_id: 'tenant', environment: 'test', direction: 'inbound', message_family: 'UTILTS', message_code: code,
  message_standard: 'edifact', raw_payload: raw, metering_point_id: code === 'E66' ? 'meter-j2' : null, business_match_status: 'matched', message_received_at: '2026-10-22T08:00:00Z', created_at: '2026-10-22T08:00:00Z', parsed_payload: {} }) as unknown as EdielMessageRow
const DAY = '2026-09-10', VALUES = dstDayProfile(DAY, 3, 2)
const base = { issuer: '16700', receiver: '40000', meterId: gs1('73599900000000001'), day: DAY, values: VALUES, registeredAt: Date.parse('2026-09-11T06:00:00Z') }

describe('E66 for scenario J2', () => {
  it('a whole measured day: 96 quarter-hours accepted, no quality flag', () => {
    const file = utiltsE66({ ...base, reference: 'J2W1' })
    const runtime = runUtiltsRuntimeForMessage(message(file.edifact))
    expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues)).toBe(true)
    expect(runtime.transactionDispositions).toMatchObject([{ disposition: 'accepted', responseType: 'positive_aperak' }])
    expect(file).toMatchObject({ periodStart: '2026-09-09T22:00:00.000Z', periodEnd: '2026-09-10T22:00:00.000Z' })
    expect(file.values).toHaveLength(96)
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

  it('a window of the day: 06:00–12:00 Stockholm (05:00–11:00 in the fixed +0100) is 24 quarter-hours for the window only', () => {
    const corrected = correctedValues(VALUES, { every: 1, deltaKwh: 0.05, from: 24, to: 48 })
    expect(changedQuarters(VALUES, corrected)).toHaveLength(24)
    const file = utiltsE66({ ...base, values: corrected, reference: 'J2W3', window: { from: 24, to: 48 }, registeredAt: Date.parse('2026-09-12T06:00:00Z') })
    const facts = parseUtiltsRuntimeFacts(file.edifact)
    expect(facts.transactions[0].deliveryPeriodRaw).toBe('202609100500202609101100')
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
    expect(file.values).toHaveLength(24)
  })
})
