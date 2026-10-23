// reality-defects: T15 (reality scenario G: end of daylight saving time 2026-10-25; findings DST-H1, DST-H2, F108)
// A grid owner's E66 day is 00:00–24:00 in fixed normal time +0100 (ENV-08, owner decision 2026-10-23): always
// 96 quarter-hours from 23:00Z the day before, also on the DST days. The real UTILTS parser, profile validation,
// consumption preparation and persistence payload give one value per quarter-hour with its own UTC instant, and
// the civil Stockholm day (portal, partner API, spot: 100 on 25 Oct 2026, 92 on 29 Mar 2026 / 28 Mar 2027) is
// the sum by instant of the Ediel files that overlap it, never a gap or a duplicate in the repeated hour.
// T15: the reality builders (live-chain-wire dailyE66, dst.ts dayE66) send exactly that day; the former civil
// framings (DST-H1: +0200 in summer, 92/100 values on the DST days) are counterfactual inputs kept only to show
// what the parser does with them. DST-H2: the synthetic spot day follows the Stockholm calendar day.
import { describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'
import { prepareUtiltsConsumptionContracts } from '@/lib/ediel/utilts/consumptionPreparation'
import { buildUtiltsTransactionPersistencePayload } from '@/lib/ediel/utilts/transactionPersistence'
import { validateSpotPriceDay } from '@/lib/pricing/spot/intervalCoverage'
import { dailyE66, dayProfile, hourlyFromQuarters } from '../scripts/helpers/live-chain-wire'
import { civilDayTotals, dayE66, dstDayProfile, edielDayProfile, edielMonthQuarterCount, edielMonthUtc, edielQuarterStarts, kwhSum, stockholmDayUtc, stockholmQuarterCount,
  stockholmQuarterStarts, syntheticSpotDay, type E66DayFraming } from '../scripts/helpers/reality/dst'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { platformMailboxFor } from '../scripts/reality/simulators/platformMailbox'

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: vi.fn() } }))
vi.mock('@/lib/ediel/core/versionRegistry', () => ({ resolveCanonicalOutboundVersion: vi.fn(async () => 'E5SE5A') }))
vi.mock('@/lib/ediel/matching', () => ({
  matchMeteringPointIdByIdentifier: vi.fn().mockResolvedValue('point'),
  matchSiteAndCustomerForMeteringPoint: vi.fn().mockResolvedValue({ customerId: 'customer', siteId: 'site', gridOwnerId: 'owner' }),
}))

const METER = '735999260731000007'
function message(day: string, values: number[], framing: E66DayFraming = 'fixed_cet_day', reference = 'GDST2610250001'): { row: EdielMessageRow; wire: ReturnType<typeof dayE66> } {
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

describe('T15: the grid owner\'s fixed-CET E66 days around the DST changes through the real UTILTS reception (scenario G)', () => {
  it('dayE66 defaults to fixed_cet_day: 23–26 October are 96 values each in +0100, one contiguous series from 22 Oct 23:00Z', async () => {
    const all: string[] = [], files: Array<{ starts: string[]; values: number[] }> = []
    for (const [index, day] of ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'].entries()) {
      const values = edielDayProfile(day, index)
      expect(values, day).toHaveLength(96)
      const wire = dayE66({ issuer: '91100', receiver: '21660', meterId: METER, day, values, reference: `GCET${day.replaceAll('-', '').slice(2)}${index}` })
      expect(wire.framing).toBe('fixed_cet_day')
      expect(wire.offset).toBe('+0100')
      expect(wire.edifact).toContain("DTM+735:?+0100:406'")
      expect(wire.edifact).not.toContain('+0200')
      const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
      expect(wire.edifact).toContain(`DTM+324:${day.replaceAll('-', '')}0000${next.replaceAll('-', '')}0000:719'`)
      expect(Date.parse(wire.periodStart)).toBe(Date.parse(`${day}T00:00:00Z`) - 3_600_000)
      expect(Date.parse(wire.periodEnd) - Date.parse(wire.periodStart)).toBe(24 * 3_600_000)
      expect(wire.starts).toEqual(edielQuarterStarts(day))
      const { row } = message(day, values, 'fixed_cet_day', `GCET${day.replaceAll('-', '').slice(2)}${index}`)
      const { runtime, payload, observations } = await receive(row)
      expect(runtime.validation.ok, `${day} ${JSON.stringify(runtime.validation.issues.map(issue => issue.code))}`).toBe(true)
      expect([payload[0].periodStart, payload[0].periodEnd]).toEqual([wire.periodStart, wire.periodEnd])
      expect(observations.map(observation => observation.periodStart)).toEqual(wire.starts)
      expect(kwhSum(observations.map(observation => Number(observation.quantity)))).toBeCloseTo(kwhSum(values), 6)
      all.push(...wire.starts)
      files.push({ starts: wire.starts, values })
    }
    expect(['2026-10-25'].map(day => dayE66({ issuer: '91100', receiver: '21660', meterId: METER, day, values: edielDayProfile(day), reference: 'GCET25' })))
      .toMatchObject([{ periodStart: '2026-10-24T23:00:00.000Z', periodEnd: '2026-10-25T23:00:00.000Z' }])
    expect(all).toHaveLength(384)
    expect(new Set(all).size).toBe(384)
    expect(all[0]).toBe('2026-10-22T23:00:00.000Z')
    expect(all.every((iso, i) => i === 0 || Date.parse(iso) - Date.parse(all[i - 1]) === 900_000)).toBe(true)
    // Civil views by instant: 24 Oct = 4 + 92, 25 Oct = the last 4 of the 24 Oct file + the 96 of 25 Oct = 100, 26 Oct = 96.
    const civil = civilDayTotals(files)
    expect([civil['2026-10-24'].count, civil['2026-10-25'].count, civil['2026-10-26'].count]).toEqual([96, 100, 96])
    expect(civil['2026-10-24'].count + civil['2026-10-25'].count + civil['2026-10-26'].count).toBe(292)
    expect(stockholmQuarterStarts('2026-10-25')).toEqual([...files[1].starts.slice(92), ...files[2].starts])
  })

  it.each(['2026-03-29', '2027-03-28'])('spring %s: the Ediel day is 96 values in +0100; the civil day by instant has 92', async day => {
    const values = edielDayProfile(day)
    const { row, wire } = message(day, values, 'fixed_cet_day', `GCET${day.replaceAll('-', '').slice(2)}`)
    expect(values).toHaveLength(96)
    expect(wire.edifact).toContain("DTM+735:?+0100:406'")
    const { runtime, observations } = await receive(row)
    expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues.map(issue => issue.code))).toBe(true)
    expect(observations.map(observation => observation.periodStart)).toEqual(edielQuarterStarts(day))
    expect(stockholmQuarterCount(day)).toBe(92)
  })

  it('an Ediel month is days × 96 from 00:00 +0100 on the 1st: September 2 880, October 2 976', () => {
    expect(edielMonthUtc('2026-09')).toEqual({ start: Date.parse('2026-08-31T23:00:00Z'), end: Date.parse('2026-09-30T23:00:00Z') })
    expect(edielMonthUtc('2026-10')).toEqual({ start: Date.parse('2026-09-30T23:00:00Z'), end: Date.parse('2026-10-31T23:00:00Z') })
    expect([edielMonthQuarterCount('2026-09'), edielMonthQuarterCount('2026-10')]).toEqual([2880, 2976])
    const october = edielMonthUtc('2026-10')
    expect((october.end - october.start) / 900_000).toBe(2976)
  })
})

describe('Counterfactual civil-day E66 (never sent by a Swedish grid owner): the parser still neither drops nor duplicates', () => {
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

describe('T15 reality harness: live-chain-wire dailyE66 sends the grid owner\'s fixed-CET day (formerly DST-H1 civil days)', () => {
  const base = { issuer: '16700', receiver: '70001', meterId: METER, reference: 'H1' }
  it.each([
    ['2026-09-01', '202609010000202609020000', '2026-08-31T23:00:00.000Z', '260902:0700'],
    ['2026-10-25', '202610250000202610260000', '2026-10-24T23:00:00.000Z', '261026:0600'],
    ['2026-03-29', '202603290000202603300000', '2026-03-28T23:00:00.000Z', '260330:0700'],
    ['2026-11-03', '202611030000202611040000', '2026-11-02T23:00:00.000Z', '261104:0600'],
  ])('%s: 96 values, DTM+735 +0100, DTM+324 %s, first value at %s, UNB Swedish local time', (day, period, first, unb) => {
    const raw = dailyE66({ ...base, day, values: dayProfile(2) })
    expect(raw).toContain("DTM+735:?+0100:406'")
    expect(raw).not.toContain('+0200')
    expect(raw).toContain(`DTM+324:${period}:719'`)
    expect(raw.match(/^QTY\+136:/gm)).toHaveLength(96)
    // The first value starts at 00:00 +0100 = the given UTC instant; registration 06:00 +0100 the next morning.
    expect(raw).toContain(`SEQ++1'\nQTY+136:${dayProfile(2)[0]}'\nDTM+597:${day.replaceAll('-', '')}0000:203'`)
    expect(Date.parse(first)).toBe(Date.parse(`${day}T00:00:00+01:00`))
    expect(raw).toContain(`DTM+137:${period.slice(12, 20)}0600:203'`)
    expect(raw).toContain(`+70001:ZZ+${unb}+H1++23-DDQ-E66-T++++1'`)
  })
  it('the DST days are never 92 or 100 values; hourly resolution is always 24 values', () => {
    expect(() => dailyE66({ ...base, day: '2026-10-25', values: dstDayProfile('2026-10-25') })).toThrow(/requires 96 values/)
    expect(() => dailyE66({ ...base, day: '2027-03-28', values: dstDayProfile('2027-03-28') })).toThrow(/requires 96 values/)
    const hourly = dailyE66({ ...base, day: '2026-10-25', values: hourlyFromQuarters(dayProfile(1)), resolutionMinutes: 60 })
    expect(hourly.match(/^QTY\+136:/gm)).toHaveLength(24)
    expect(hourly).toContain("DTM+324:202610250000202610260000:719'")
    expect(hourly).toContain("DTM+354:60:806'")
    expect(() => dailyE66({ ...base, day: '2026-10-25', values: [...hourlyFromQuarters(dayProfile(1)), 0.1], resolutionMinutes: 60 })).toThrow(/requires 24 values/)
  })
  it('the platform\'s UTILTS runtime accepts the summer and DST-day files as 96 quarter-hours from 23:00Z', async () => {
    for (const day of ['2026-09-01', '2026-10-25']) {
      const raw = dailyE66({ ...base, day, values: dayProfile(3), reference: `H1${day.slice(8)}` })
      const row = { ...message(day, dayProfile(3)).row, raw_payload: raw, message_received_at: '2026-11-05T12:00:00Z', created_at: '2026-11-05T12:00:00Z' } as EdielMessageRow
      const { runtime, observations } = await receive(row)
      expect(runtime.validation.ok, `${day} ${JSON.stringify(runtime.validation.issues.map(issue => issue.code))}`).toBe(true)
      expect(observations.map(observation => observation.periodStart), day).toEqual(edielQuarterStarts(day))
    }
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

describe('T13 reality harness: dayE66 carries the lane of the tenant it is sent to', () => {
  const input = { issuer: '16700', receiver: '70001', meterId: '735999000000000017', day: '2026-10-25', values: edielDayProfile('2026-10-25'), reference: 'GLANE1' }
  it('defaults to the test lane (UNB 0035=1) and the test platform mailbox, as before', () => {
    const wire = dayE66(input).edifact
    expect(wire).toContain("+GLANE1++23-DDQ-E66-T++++1'")
    expect(EdifactEnvelopeCodec.decode(wire)).toMatchObject({ environment: 'test', testIndicator: '1' })
    expect(platformMailboxFor(wire)).toBe(process.env.GRIDEX_SHARED_EDIEL_TEST_EMAIL ?? 'gridex-ediel-test@example.invalid')
  })
  it("environment 'production' omits the test indicator and nothing else, so it reaches the production mailbox", () => {
    const test = dayE66({ ...input, environment: 'test' }), production = dayE66({ ...input, environment: 'production' })
    expect(production.edifact).toContain("+GLANE1++23-DDQ-E66-T'")
    expect(EdifactEnvelopeCodec.decode(production.edifact)).toMatchObject({ environment: 'production', testIndicator: null })
    expect(platformMailboxFor(production.edifact)).toBe(process.env.GRIDEX_SHARED_EDIEL_PRODUCTION_EMAIL ?? 'gridex-ediel@example.invalid')
    expect(production.edifact.replace("E66-T'", "E66-T++++1'")).toBe(test.edifact)
    expect({ ...production, edifact: '' }).toEqual({ ...test, edifact: '' })
  })
})
