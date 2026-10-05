// masterplan: ENV-08, AT-ENV-08
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildUtiltsOutboundDraft } from '@/lib/ediel/utilts'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { canonicalBusinessDate, resolveCanonicalMessagePolicy, resolveEdielMessageTimeAnchors } from '@/lib/ediel/core/messagePolicy'
import { prodatMarketMinuteToUtc, prodatNowDate203 } from '@/lib/ediel/prodat/render/dates'
import { prodatDateState } from '@/lib/ediel/prodat/prodatDateFields'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { validateCanonicalUtiltsProfile } from '@/lib/ediel/utilts/profiles'
import { expectedObservationCountForResolution } from '@/lib/ediel/utilts/resolution'
import { localEdifactDateTimeToUtc, parseEdifactTimezoneOffsetFromSegments } from '@/lib/ediel/utilts/timezone'
import { prepareUtiltsConsumptionContracts } from '@/lib/ediel/utilts/consumptionPreparation'
import { buildUtiltsTransactionPersistencePayload, persistUtiltsTransactionResults, type UtiltsBoundPersistenceInput } from '@/lib/ediel/utilts/transactionPersistence'
import { bindingRpcRows } from './helpers/utiltsBoundFixture'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { recountEdifactUnt } from './helpers/recountEdifactUnt'
import { buildProdatMessage } from '@/lib/ediel/prodat/buildProdat'
import { selectedAddressFact, selectedInvoiceeFact } from './fixtures/prodat-ud'

const io = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc } }))
vi.mock('@/lib/ediel/core/versionRegistry', () => ({ resolveCanonicalOutboundVersion: vi.fn(async () => 'E5SE5A') }))
vi.mock('@/lib/ediel/matching', () => ({
  matchMeteringPointIdByIdentifier: vi.fn().mockResolvedValue('point'),
  matchSiteAndCustomerForMeteringPoint: vi.fn().mockResolvedValue({ customerId: 'customer', siteId: 'site', gridOwnerId: 'owner' }),
}))

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })
const input = (periodStart = '2026-07-01T00:00', periodEnd = '2026-07-02T00:00') => ({
  code: 'E66' as const, senderEdielId: '12345', receiverEdielId: '54321',
  applicationReference: '23-DDQ-E66-T', externalReference: 'DOC', transactionReference: 'TX',
  payload: { legalSenderEdielId: '12345', legalReceiverEdielId: '54321', meterPointId: '735999260731000007',
    periodStart, periodEnd, registrationTime: '2026-07-02T00:00', quantity: 5, resolution: '15', unit: 'KWH' },
})

describe('ENV08 source-preserving UTC storage preparation', () => {
  it.each([
    ['2026-03-29', '20260329', '2026-03-28T23:00:00.000Z'],
    ['2026-10-25', '20261025', '2026-10-24T23:00:00.000Z'],
  ])('writes fixed-CET UTC with original offset, format and business date for %s', async (date, compact, utcStart) => {
    const original = energyHandoffMessage(date)
    const message = { ...original, raw_payload: original.raw_payload!
      .replace('?+0200:406', '?+0100:406')
      .replaceAll('202607010000', `${compact}0000`).replace('202607010015', `${compact}0015`)
      .replace('202607010020', `${compact}0020`) }
    const runtime = runUtiltsRuntimeForMessage(message), policy = resolveCanonicalMessagePolicy(message)!
    expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues)).toBe(true)
    const anchors = resolveEdielMessageTimeAnchors(message)
    expect(anchors).toMatchObject({ documentDate: date, businessEffectiveDate: date,
      documentTimestamp: { value: `${compact}1811`, format: '203', originalOffset: '+0100', timeBasis: 'fixed_UTC_plus_1' },
      measurementPeriods: [{ qualifier: '324', value: `${compact}0000${compact}0015`, format: '719', originalOffset: '+0100', timeBasis: 'fixed_UTC_plus_1' }] })
    expect(canonicalBusinessDate(message)).toBe(date)
    const contracts = await prepareUtiltsConsumptionContracts({ message, runtime, policy, matches: [], dataRequest: null,
      fallback: { customerId: 'customer', siteId: 'site', meteringPointId: 'point', gridOwnerId: 'owner' }, allowConsumption: true })
    const transactions = buildUtiltsTransactionPersistencePayload({ messageCode: 'E66', transactions: runtime.facts.transactions,
      dispositions: runtime.transactionDispositions, matches: [], rawSegments: runtime.facts.rawSegments })
    const bound: UtiltsBoundPersistenceInput = { companyId: message.company_id!, environment: message.environment,
      sourceMessageId: message.id, messageCode: 'E66', rawPayload: message.raw_payload, contracts, transactions }
    io.rpc.mockResolvedValue({ data: bindingRpcRows(bound), error: null })
    await persistUtiltsTransactionResults({ ...bound, actorUserId: '00000000-0000-4000-8000-000000000001' })
    // RPC is the external port; real parsing/preparation/serialization and returned
    // binding validation run. Native durability is covered by the existing suite.
    expect(io.rpc).toHaveBeenCalledTimes(1)
    expect(io.rpc).toHaveBeenCalledWith('gridex_persist_utilts_consumption_v1', expect.objectContaining({
      p_company_id: message.company_id, p_source_message_id: message.id, p_raw_payload: message.raw_payload,
      p_transactions: [expect.objectContaining({ periodStart: utcStart, consumptionContract: expect.objectContaining({
        interpretation: expect.objectContaining({ localPeriodStart: `${date}T00:00:00`, localPeriodEnd: `${date}T00:15:00`,
          timezoneRaw: '+0100', timezoneFormat: '406', offsetMinutes: 60, resolutionValue: '15', resolutionFormat: '806' }),
        observations: [expect.objectContaining({ periodStart: utcStart })],
      }) })],
    }))
  })

  it.each(['202603290230', '202610250230'])('round-trips PRODAT fixed-CET minute %s without DST guessing', minute => {
    const utc = prodatMarketMinuteToUtc(minute)!
    expect(utc).toBe(`${minute.slice(0, 4)}-${minute.slice(4, 6)}-${minute.slice(6, 8)}T01:30:00.000Z`)
    expect(prodatNowDate203(new Date(utc))).toBe(minute)
    const wire = tokenizeEdifact(`UNH+M+PRODAT:D:97A:UN:E2SE6A'DTM+ZZZ:1:805'UNT+3+M'`)
    expect(prodatDateState('206', wire.segments, wire.una)).toMatchObject({ value: '1', format: '805', malformed: false })
  })

  it('retains the declared foreign offset exception and never applies a second offset to an instant', () => {
    // Complete frozen U206 p122 explicitly allows other-country offsets. A
    // decoder accepts that supplied basis, never annual DST inferred from a date.
    const offset = parseEdifactTimezoneOffsetFromSegments(['DTM+735:?+0200:406'])!
    expect(localEdifactDateTimeToUtc('2026-10-25T00:00', offset)).toBe('2026-10-24T22:00:00.000Z')
    expect(localEdifactDateTimeToUtc('2026-10-25T00:00:00+03:00', offset)).toBe('2026-10-24T21:00:00.000Z')
    expect(localEdifactDateTimeToUtc('2026-02-30T00:00', offset)).toBeNull()
  })
})

describe('ENV08 fixed-CET days have 96 quarters across Swedish DST transitions', () => {
  for (const [date, next] of [['2026-03-29', '2026-03-30'], ['2026-10-25', '2026-10-26']]) {
    it.each([92, 96, 100])(`${date}: actual profile accepts 96 and rejects %i instead of a local-DST day`, count => {
      const source = energyHandoffMessage(date)
      const start = date.replaceAll('-', ''), end = next.replaceAll('-', '')
      const rows = source.raw_payload!.replace('?+0200:406', '?+0100:406')
        .replace('202607010000202607010015', `${start}0000${end}0000`)
        .replace('202607010020', `${end}0020`).split('\n')
      const first = rows.findIndex(row => row.startsWith('SEQ+')), close = rows.findIndex(row => row.startsWith('UNT+'))
      const observations = Array.from({ length: count }, (_, index) => [`SEQ++${index + 1}'`, "QTY+136:1'", "STS+7++21::260'"]).flat()
      const message = { ...source, message_received_at: `${next}T20:00:00Z`, created_at: `${next}T20:00:00Z`,
        raw_payload: recountEdifactUnt([...rows.slice(0, first), ...observations, ...rows.slice(close)].join('\n')) }
      const runtime = runUtiltsRuntimeForMessage(message)
      expect(expectedObservationCountForResolution({ start: `${date}T00:00`, end: `${next}T00:00`, value: '15', format: '806' })).toBe(96)
      const errors = validateCanonicalUtiltsProfile(runtime.facts).filter(issue => issue.code === 'UTILTS_DST_INTERVAL_COUNT_MISMATCH')
      expect(errors.length).toBe(count === 96 ? 0 : 1)
      if (count !== 96) expect(errors[0]).toMatchObject({ kind: 'functional', utiltsErrCode: 'E87' })
      expect(runtime.validation.issues.some(issue => issue.code === 'UTILTS_DST_INTERVAL_COUNT_MISMATCH')).toBe(count !== 96)
      expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues)).toBe(count === 96)
    })
  }
})

describe('ENV08 physical outbound payload and local UNB clocks', () => {
  it.each([
    ['2026-07-01T10:15:59Z', '202607011115', '260701', '1215'],
    ['2026-01-01T10:15:59Z', '202601011115', '260101', '1115'],
    ['2026-03-29T01:30:00Z', '202603290230', '260329', '0330'],
    ['2026-10-25T01:30:00Z', '202610250230', '261025', '0230'],
    ['2026-07-01T22:30:00Z', '202607012330', '260702', '0030'],
    ['2026-12-31T23:30:00Z', '202701010030', '270101', '0030'],
  ])('converts the creation instant %s to fixed CET while UNB uses Swedish local time', async (instant, documentMinute, localDate, localMinute) => {
    vi.useFakeTimers().setSystemTime(new Date(instant))
    const draft = await buildUtiltsOutboundDraft(input())
    const wire = tokenizeEdifact(draft.rawPayload)
    const dates = wire.segments.filter(segment => segment.tag === 'DTM').map(segment => segmentComposite(segment, 1, wire.una))
    expect(dates).toContainEqual(['137', documentMinute, '203'])
    expect(dates).toContainEqual(['735', '+0100', '406'])
    expect(segmentComposite(wire.segments.find(segment => segment.tag === 'UNB'), 4, wire.una)).toEqual([localDate, localMinute])
  })

  it.each([
    ['2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', '202607010100202607020100'],
    ['2026-07-01T00:00:00+02:00', '2026-07-02T00:00:00+02:00', '202606302300202607012300'],
    ['2026-07-01T00:00', '2026-07-02T00:00', '202607010000202607020000'],
    ['2026-07-01', '2026-07-02', '202607010000202607020000'],
    ['2026-07-01T00:00:00+01:00', '2026-07-02T00:00:00+01:00', '202607010000202607020000'],
  ])('converts explicit instant periods and preserves market wall dates: %s', async (start, end, expected) => {
    const draft = await buildUtiltsOutboundDraft(input(start, end))
    const wire = tokenizeEdifact(draft.rawPayload)
    expect(wire.segments.filter(segment => segment.tag === 'DTM').map(segment => segmentComposite(segment, 1, wire.una)))
      .toContainEqual(['324', expected, '719'])
  })

  it.each(['E66', 'E73'] as const)('converts the %s registration instant to the declared fixed CET clock', async code => {
    const original = input()
    const draft = await buildUtiltsOutboundDraft({ ...original, code,
      payload: { ...original.payload, quantity: code === 'E73' ? undefined : 5, registrationTime: '2026-07-02T00:30:00+02:00' } })
    const wire = tokenizeEdifact(draft.rawPayload)
    expect(wire.segments.filter(segment => segment.tag === 'DTM').map(segment => segmentComposite(segment, 1, wire.una)))
      .toContainEqual(['597', '202607012330', '203'])
  })

  it.each([
    ['2026-07-01T10:15:00Z', '202607011115', '260701', '1215'],
    ['2026-01-01T10:15:00Z', '202601011115', '260101', '1115'],
    ['2026-07-01T22:30:00Z', '202607012330', '260702', '0030'],
    ['2026-12-31T23:30:00Z', '202701010030', '270101', '0030'],
  ])('PRODAT also separates the payload and UNB creation clock for %s', (instant, documentMinute, localDate, localMinute) => {
    vi.useFakeTimers().setSystemTime(new Date(instant))
    const built = buildProdatMessage({ customer: { id: 'USR', name: 'Synthetic', idAgency: '89' }, companyId: 'tenant',
      dependentConditionFacts: { endUserAddressObjects: [selectedAddressFact('POINT', 'tenant', '9', 'USR')],
        invoiceeObjects: [selectedInvoiceeFact('POINT', 'tenant', '9', 'USR')] },
      role: 'supplier', businessCode: 'Z03', sender: { edielId: '12345' }, receiver: { edielId: '54321' },
      meteringPoint: { id: 'POINT' }, environment: 'test', references: { LI: 'CASE' }, codedAttributes: { Z13: 'Z22' },
      dates: { startDate: '2027-01-01', createdAt: instant } })
    const wire = tokenizeEdifact(built.rawEdifact)
    const dates = wire.segments.filter(segment => segment.tag === 'DTM').map(segment => segmentComposite(segment, 1, wire.una))
    expect(dates).toContainEqual(['137', documentMinute, '203'])
    expect(dates).toContainEqual(['ZZZ', '1', '805'])
    expect(dates).toContainEqual(['92', '202701010000', '203'])
    expect(segmentComposite(wire.segments.find(segment => segment.tag === 'UNB'), 4, wire.una)).toEqual([localDate, localMinute])
  })

  it.each(['2026-07-02T24:00', '2026-02-30T00:00', 'not-a-date'])('does not invent a minute from invalid period/registration %s', async invalid => {
    const original = input('2026-07-01T00:00', invalid)
    const draft = await buildUtiltsOutboundDraft({ ...original, payload: { ...original.payload, registrationTime: invalid } })
    const wire = tokenizeEdifact(draft.rawPayload)
    const qualifiers = wire.segments.filter(segment => segment.tag === 'DTM').map(segment => segmentComposite(segment, 1, wire.una)[0])
    // Existing optional renderer boundary omits unrepresentable fields. Their
    // national presence/acceptance gate remains the caller's separate contract.
    expect(qualifiers).not.toContain('324')
    expect(qualifiers).not.toContain('597')
    expect(draft.rawPayload).not.toContain(':null:')
  })
})
