// masterplan: none (reality scenario G: end of daylight saving time 2026-10-25, findings DST-H1, DST-H2)
// A grid owner's E66 for the Stockholm civil days around a DST change: the real UTILTS parser, profile
// validation, consumption preparation and persistence payload give one value per actual quarter-hour with
// its own UTC instant (100 on 25 Oct 2026, 92 on 28 Mar 2027), never a gap or a duplicate in the repeated
// hour. Also proves the reality harness defects: live-chain-wire's dailyE66 had a fixed +0200 day of 96 values
// (DST-H1) and the external world's synthetic spot day had 96 quarter-hours at +02:00 (DST-H2).
import { describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'
import { prepareUtiltsConsumptionContracts } from '@/lib/ediel/utilts/consumptionPreparation'
import { buildUtiltsTransactionPersistencePayload } from '@/lib/ediel/utilts/transactionPersistence'
import { validateSpotPriceDay } from '@/lib/pricing/spot/intervalCoverage'
import { dailyE66 } from '../scripts/helpers/live-chain-wire'
import { dayE66, dstDayProfile, kwhSum, stockholmDayUtc, stockholmQuarterCount, stockholmQuarterStarts, syntheticSpotDay, type E66DayFraming } from '../scripts/helpers/reality/dst'

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: vi.fn() } }))
vi.mock('@/lib/ediel/core/versionRegistry', () => ({ resolveCanonicalOutboundVersion: vi.fn(async () => 'E5SE5A') }))
vi.mock('@/lib/ediel/matching', () => ({
  matchMeteringPointIdByIdentifier: vi.fn().mockResolvedValue('point'),
  matchSiteAndCustomerForMeteringPoint: vi.fn().mockResolvedValue({ customerId: 'customer', siteId: 'site', gridOwnerId: 'owner' }),
}))

const METER = '735999260731000007'
function message(day: string, values: number[], framing: E66DayFraming, reference = 'GDST2610250001'): { row: EdielMessageRow; wire: ReturnType<typeof dayE66> } {
  const wire = dayE66({ issuer: '91100', receiver: '21660', meterId: METER, day, values, reference, framing })
  const received = new Date(Date.parse(wire.registeredAt) + 3_600_000).toISOString()
  return { wire, row: { id: `dst-${day}-${framing}`, company_id: 'tenant-a', environment: 'test', direction: 'inbound', message_family: 'UTILTS', message_code: 'E66',
    message_standard: 'edifact', message_version: 'E5SE5A', application_reference: '23-DDQ-E66-T', raw_payload: wire.edifact,
    message_received_at: received, created_at: received, metering_point_id: 'point', business_match_status: 'matched', parsed_payload: {}, validation_report: null } as unknown as EdielMessageRow }
}

/** The platform's own reception chain up to the persistence RPC payload (the RPC itself is the native suite's). */
async function receive(row: EdielMessageRow) {
  const runtime = runUtiltsRuntimeForMessage(row), policy = resolveCanonicalMessagePolicy(row)!
  const contracts = runtime.validation.ok ? await prepareUtiltsConsumptionContracts({ message: row, runtime, policy, matches: [], dataRequest: null,
    fallback: { customerId: 'customer', siteId: 'site', meteringPointId: 'point', gridOwnerId: 'owner' }, allowConsumption: true }) : []
  const payload = buildUtiltsTransactionPersistencePayload({ messageCode: 'E66', transactions: runtime.facts.transactions,
    dispositions: runtime.transactionDispositions, matches: [], rawSegments: runtime.facts.rawSegments })
  type Observation = { periodStart: string; periodEnd: string; quantity: number | string }
  const observations = contracts.flatMap(contract => contract.observations as readonly Observation[])
  return { runtime, payload, observations }
}

describe('Stockholm civil days around the DST changes', () => {
  it.each([['2026-10-24', 96], ['2026-10-25', 100], ['2026-10-26', 96], ['2027-03-27', 96], ['2027-03-28', 92], ['2027-03-29', 96]])('%s has %i quarter-hours', (day, count) => {
    expect(stockholmQuarterCount(day)).toBe(count)
    expect(dstDayProfile(day)).toHaveLength(count)
    expect(new Set(stockholmQuarterStarts(day)).size).toBe(count)
  })
  it('25 October 2026 runs 22:00Z–23:00Z and holds the repeated 02:00 hour twice (00:00Z and 01:00Z)', () => {
    const { start, end } = stockholmDayUtc('2026-10-25')
    expect([new Date(start).toISOString(), new Date(end).toISOString()]).toEqual(['2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z'])
    const starts = stockholmQuarterStarts('2026-10-25')
    expect(starts[8]).toBe('2026-10-25T00:00:00.000Z') // 02:00 CEST
    expect(starts[12]).toBe('2026-10-25T01:00:00.000Z') // 02:00 CET, the repeated hour
  })
})

describe('E66 for a civil DST day through the real UTILTS reception (scenario G)', () => {
  for (const framing of ['civil_fixed_cet', 'civil_start_offset'] as const) {
    it(`${framing}: 24/25/26 October give 96/100/96 values with contiguous, distinct UTC instants`, async () => {
      const all: string[] = []
      for (const [index, day] of ['2026-10-24', '2026-10-25', '2026-10-26'].entries()) {
        const values = dstDayProfile(day, index)
        const { row, wire } = message(day, values, framing, `GDST${day.replaceAll('-', '').slice(2)}${index}`)
        const { runtime, payload, observations } = await receive(row)
        expect(runtime.validation.ok, `${day} ${JSON.stringify(runtime.validation.issues.map(issue => issue.code))}`).toBe(true)
        expect(payload).toHaveLength(1)
        expect([payload[0].periodStart, payload[0].periodEnd]).toEqual([wire.periodStart, wire.periodEnd])
        expect(observations).toHaveLength(values.length)
        expect(observations.map(observation => observation.periodStart)).toEqual(stockholmQuarterStarts(day))
        expect(observations.every(observation => Date.parse(observation.periodEnd) - Date.parse(observation.periodStart) === 900_000)).toBe(true)
        expect(kwhSum(observations.map(observation => Number(observation.quantity)))).toBeCloseTo(kwhSum(values), 6)
        all.push(...observations.map(observation => observation.periodStart))
      }
      expect(all).toHaveLength(292)
      expect(new Set(all).size).toBe(292)
      expect(all[0]).toBe('2026-10-23T22:00:00.000Z')
      expect(all.every((iso, i) => i === 0 || Date.parse(iso) - Date.parse(all[i - 1]) === 900_000)).toBe(true)
    })
  }

  it('spring 28 March 2027: 92 values, the skipped hour is never invented', async () => {
    const values = dstDayProfile('2027-03-28', 0)
    const { row } = message('2027-03-28', values, 'civil_fixed_cet', 'GDST2703280001')
    const { runtime, observations } = await receive(row)
    expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues.map(issue => issue.code))).toBe(true)
    const starts = observations.map(observation => observation.periodStart)
    expect(starts).toEqual(stockholmQuarterStarts('2027-03-28'))
    // 01:45 CET (00:45Z) is followed directly by 03:00 CEST (01:00Z): no invented 02:00–03:00.
    expect(starts.slice(7, 9)).toEqual(['2027-03-28T00:45:00.000Z', '2027-03-28T01:00:00.000Z'])
  })

  it('a civil 25 October that claims 25 hours but carries only 96 values is refused (E87), never stored short', async () => {
    const { row } = message('2026-10-25', dstDayProfile('2026-10-25'), 'civil_fixed_cet')
    const lines = row.raw_payload!.split('\n'), firstDropped = lines.indexOf("SEQ++97'")
    // Drop the last four quarter-hours (SEQ, QTY, DTM, STS each) and recount UNT.
    lines.splice(firstDropped, 16)
    const unt = lines.findIndex(line => line.startsWith('UNT+'))
    lines[unt] = `UNT+${unt - 1}+1'`
    const runtime = runUtiltsRuntimeForMessage({ ...row, raw_payload: lines.join('\n') })
    expect(runtime.validation.ok).toBe(false)
    expect(runtime.validation.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['UTILTS_DST_INTERVAL_COUNT_MISMATCH']))
  })

  it('ENV-08 fixed normal-time day 25 October: 96 values 23:00Z–23:00Z are accepted', async () => {
    const values = Array.from({ length: 96 }, (_, q) => Math.round((0.1 + (q % 7) / 1000) * 1000) / 1000)
    const { row, wire } = message('2026-10-25', values, 'fixed_cet_day', 'GDST2610250CET')
    expect([wire.periodStart, wire.periodEnd]).toEqual(['2026-10-24T23:00:00.000Z', '2026-10-25T23:00:00.000Z'])
    const { runtime, observations } = await receive(row)
    expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues.map(issue => issue.code))).toBe(true)
    expect(observations.map(observation => observation.periodStart)[0]).toBe('2026-10-24T23:00:00.000Z')
    expect(new Set(observations.map(observation => observation.periodStart)).size).toBe(96)
  })
})

describe('DST-H1 reality harness: live-chain-wire dailyE66 frames every day as a fixed +0200 day of 96 values', () => {
  const base = { issuer: '16700', receiver: '70001', meterId: METER, reference: 'H1' }
  it('a 25 October file can carry 100 quarter-hours and covers the whole civil day', () => {
    const values = dstDayProfile('2026-10-25')
    const raw = dailyE66({ ...base, day: '2026-10-25', values })
    expect(raw).toContain('DTM+735:?+0200:406')
    expect(raw).toContain('DTM+324:202610250000202610260100:719') // 22:00Z – 23:00Z
  })
  it('a CET day (26 October, 28 March 2027) is framed in +0100, not shifted one hour into the previous day', () => {
    const october = dailyE66({ ...base, day: '2026-10-26', values: dstDayProfile('2026-10-26') })
    expect(october).toContain('DTM+735:?+0100:406')
    expect(october).toContain('DTM+324:202610260000202610270000:719')
    const spring = dailyE66({ ...base, day: '2027-03-28', values: dstDayProfile('2027-03-28') })
    expect(spring).toContain('DTM+735:?+0100:406')
    expect(spring).toContain('DTM+324:202703280000202703282300:719') // +0100, 23 hours: 92 values
  })
  it('summer days are unchanged (+0200, 96 values), so scenarios E/F produce the same wire', () => {
    const raw = dailyE66({ ...base, day: '2026-09-15', values: dstDayProfile('2026-09-15') })
    expect(raw).toContain('DTM+735:?+0200:406')
    expect(raw).toContain('DTM+324:202609150000202609160000:719')
    expect(() => dailyE66({ ...base, day: '2026-10-25', values: dstDayProfile('2026-10-24') })).toThrow(/requires 100 values/)
  })
})

describe('DST-H2 reality harness: the synthetic spot day follows the Stockholm calendar day', () => {
  it.each([['2026-10-25', 100], ['2026-10-26', 96], ['2027-03-28', 92], ['2026-09-15', 96]])('%s: %i quarter-hours, complete for the platform validator', (date, count) => {
    const rows = syntheticSpotDay(date, 'SE3')
    expect(rows).toHaveLength(count)
    const coverage = validateSpotPriceDay({ calendarDate: date, priceArea: 'SE3', intervals: rows.map(row => ({ source: 'elprisetjustnu', priceArea: 'SE3',
      timeStart: row.time_start, timeEnd: row.time_end, sekPerKwh: row.SEK_per_kWh, eurPerKwh: row.EUR_per_kWh, exchangeRate: row.EXR, resolution: 'quarter_hour' as const })) })
    expect(coverage.issues).toEqual([])
    expect(coverage.status).toBe('complete')
  })
  it('the previous generator shape (96 rows from local midnight at a fixed +02:00) is incomplete on 25 and 26 October', () => {
    const fixed = (date: string) => Array.from({ length: 96 }, (_, q) => { const start = Date.parse(`${date}T00:00:00+02:00`) + q * 900_000
      return { source: 'elprisetjustnu', priceArea: 'SE3' as const, timeStart: new Date(start).toISOString(), timeEnd: new Date(start + 900_000).toISOString(), sekPerKwh: 1, eurPerKwh: 0.09, exchangeRate: 11.2, resolution: 'quarter_hour' as const } })
    expect(validateSpotPriceDay({ calendarDate: '2026-10-25', priceArea: 'SE3', intervals: fixed('2026-10-25') }).issues.map(issue => issue.code)).toEqual(['gap'])
    expect(validateSpotPriceDay({ calendarDate: '2026-10-26', priceArea: 'SE3', intervals: fixed('2026-10-26') }).status).toBe('incomplete')
  })
})
