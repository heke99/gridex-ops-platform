import { beforeEach, expect, it, vi } from 'vitest'
import type { GridOwnerDataRequestRow } from '@/lib/cis/types'
import { buildAckDraftForSource } from '@/lib/ediel/ack'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { segmentComposite, segmentUntrimmedRaw, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { decideUtiltsResponse } from '@/lib/ediel/decisionEngine'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { prepareUtiltsConsumptionContracts } from '@/lib/ediel/utilts/consumptionPreparation'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { recountEdifactUnt } from './helpers/recountEdifactUnt'

const probes = vi.hoisted(() => ({
  countIntervals: vi.fn(),
  matchPoint: vi.fn(async () => null),
  matchCustomer: vi.fn(async () => null),
  database: vi.fn(() => { throw new Error('Database access is outside this synthetic fixture') }),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: probes.database }))
vi.mock('@/lib/ediel/matching', () => ({
  matchMeteringPointIdByIdentifier: probes.matchPoint,
  matchSiteAndCustomerForMeteringPoint: probes.matchCustomer,
}))
vi.mock('@/lib/ediel/utilts/resolution', async importOriginal => {
  const resolution = await importOriginal<typeof import('@/lib/ediel/utilts/resolution')>()
  return {
    ...resolution,
    expectedObservationCountForResolution: (...args: Parameters<typeof resolution.expectedObservationCountForResolution>) => {
      probes.countIntervals()
      return resolution.expectedObservationCountForResolution(...args)
    },
  }
})

beforeEach(() => vi.clearAllMocks())

const validPeriod = '202607010000202607010015'
const invalidStart = '202602300000202603020015'
const invalidEnd = '202502282345202502290000'
const emptyPeriod = '202607010000202607010000'
const reversedPeriod = '202607010015202607010000'
const reference = 'GRIDEX2607E66001'
const sibling = 'GRIDEX2607E66002'
const meterPoint = '735999260731000007'
const siblingMeterPoint = '735999260731000014'
const issueCode = 'UTILTS_E66_DELIVERY_PERIOD_INVALID'
const policy = resolveCanonicalEdielPolicy({
  family: 'UTILTS', messageCode: 'E66', direction: 'inbound',
  referenceDate: '2026-10-01', applicationReference: '23-DDQ-E66-T', mode: 'parse',
})

function e66(period: string) {
  const source = energyHandoffMessage('2026-10-01')
  source.sender_ediel_id = '91100'
  source.receiver_ediel_id = '21660'
  source.raw_payload = source.raw_payload!.replace(validPeriod + ':719', period + ':719')
  return source
}

const run = (source: ReturnType<typeof e66>) => runUtiltsRuntimeForMessage(source, { canonicalPolicy: policy })

function e66Interchange(transactions: readonly { id: string; period: string; point?: string }[]) {
  const source = e66(validPeriod)
  const lines = source.raw_payload!.split('\n')
  const start = lines.findIndex(line => line.startsWith('IDE+'))
  const end = lines.findIndex(line => line.startsWith('UNT+'))
  const template = lines.slice(start, end)
  lines.splice(start, end - start, ...transactions.flatMap(({ id, period, point = meterPoint }) => template.map(line =>
    line.replace(reference, id).replace(validPeriod + ':719', period + ':719').replace(meterPoint, point))))
  source.raw_payload = recountEdifactUnt(lines.join('\n'))
  return source
}

function prepare(source: ReturnType<typeof e66>, runtime: ReturnType<typeof run>, billing = false) {
  const dataRequest = billing ? { id: 'synthetic-request', request_scope: 'billing_underlay' } as GridOwnerDataRequestRow : null
  return prepareUtiltsConsumptionContracts({
    message: source, runtime, policy, matches: [], dataRequest, allowConsumption: true,
    fallback: { customerId: billing ? 'synthetic-customer' : null, siteId: null, meteringPointId: null, gridOwnerId: null },
  })
}

function expectPeriodError(runtime: ReturnType<typeof run>, source: ReturnType<typeof e66>, period: string) {
  const wire = tokenizeEdifact(source.raw_payload)
  const segment = wire.segments.find(item => item.tag === 'DTM' && segmentComposite(item, 1, wire.una)[1] === period)
  expect(segment).toBeDefined()
  expect(runtime.ackPlan.aperakApplicationErrors).toMatchObject([{
    ercCode: '42', fieldCode: '245', referenceNumber: reference, lineItemReference: reference,
    text: 'INCORRECT DATA ' + period,
  }])
  expect(runtime.validation.issues).toContainEqual(expect.objectContaining({
    code: issueCode, kind: 'application', severity: 'error',
    aperakInvalidOccurrence: { segmentIndex: segment!.index, elementIndex: 1, componentIndex: 1 },
  }))
  expect(runtime.ackPlan).toMatchObject({ contrlOutcome: 'positive', aperakOutcome: 'negative', shouldSendUtiltsErr: false })
}

it.each([
  ['non-calendar start', invalidStart],
  ['non-calendar end', invalidEnd],
  ['empty interval', emptyPeriod],
  ['reversed interval', reversedPeriod],
])('rejects a DTM+324 %s before functional checks and preparation', async (_name, period) => {
  const source = e66(period)
  const runtime = run(source)
  expect(runtime.transactionDispositions).toMatchObject([{ transactionId: reference, disposition: 'guide_rejected', responseType: 'negative_aperak' }])
  expect(probes.countIntervals).not.toHaveBeenCalled()
  expectPeriodError(runtime, source, period)

  const decision = decideUtiltsResponse({ message: source })
  expect(decision).toMatchObject({ kind: 'ack', ackFamily: 'APERAK', outcome: 'negative' })
  const draft = buildAckDraftForSource({
    sourceMessage: source, ackFamily: 'APERAK', outcome: 'negative', ackScope: 'transaction',
    relatedTransactionReference: reference, applicationErrors: runtime.ackPlan.aperakApplicationErrors,
  })
  expect(draft.rawPayload).toContain('ERC+42::260')
  expect(draft.rawPayload).toContain('RFF+ACW:' + reference)
  expect(draft.rawPayload).toContain('FTX+AAO++245::260')

  expect(await prepare(source, runtime)).toMatchObject([{
    transactionId: reference, observations: [], metering: { capability: 'skip' }, billing: { capability: 'skip' },
    interpretation: { timestampPolicy: 'no-consumption-v1' },
  }])
  expect(probes.matchPoint).not.toHaveBeenCalled()
  expect(probes.database).not.toHaveBeenCalled()
})

it.each([
  ['local midnight', validPeriod, '2026-06-30T22:00:00.000Z', '2026-06-30T22:15:00.000Z'],
  ['leap day', '202402290000202402290015', '2024-02-28T22:00:00.000Z', '2024-02-28T22:15:00.000Z'],
])('preserves the exact UTC quarter for a valid %s', async (_name, period, periodStart, periodEnd) => {
  const source = e66(period)
  const runtime = run(source)
  expect(runtime.transactionDispositions).toMatchObject([{ disposition: 'accepted', responseType: 'positive_aperak' }])
  expect(runtime.ackPlan.aperakApplicationErrors).toEqual([])
  expect(probes.countIntervals).toHaveBeenCalled()
  expect(await prepare(source, runtime)).toMatchObject([{ observations: [{ periodStart, periodEnd }] }])
  expect(probes.database).not.toHaveBeenCalled()
})

const mixedCases = [
  { name: 'non-calendar', period: invalidStart },
  { name: 'empty', period: emptyPeriod },
  { name: 'reversed', period: reversedPeriod },
].flatMap(testCase => [true, false].map(invalidFirst => ({ ...testCase, invalidFirst })))

it.each(mixedCases)('prepares only the valid physical IDE for a $name period with the bad IDE first=$invalidFirst', async ({ period, invalidFirst }) => {
  const invalid = { id: reference, period }
  const valid = { id: sibling, period: validPeriod, point: siblingMeterPoint }
  const source = e66Interchange(invalidFirst ? [invalid, valid] : [valid, invalid])

  const runtime = run(source)
  expectPeriodError(runtime, source, period)
  expect(runtime.transactionDispositions.find(item => item.transactionId === reference)).toMatchObject({
    disposition: 'guide_rejected', responseType: 'negative_aperak',
  })
  expect(runtime.transactionDispositions.find(item => item.transactionId === sibling)).toMatchObject({
    disposition: 'accepted', responseType: 'positive_aperak',
  })
  const contracts = await prepare(source, runtime, true)
  expect(contracts.find(item => item.transactionId === reference)).toMatchObject({
    observations: [], metering: { capability: 'skip' }, billing: { capability: 'skip' },
  })
  expect(contracts.find(item => item.transactionId === sibling)).toMatchObject({
    observations: [{ externalPoint: siblingMeterPoint, periodStart: '2026-06-30T22:00:00.000Z', periodEnd: '2026-06-30T22:15:00.000Z' }],
    billing: { capability: 'write', periodStart: '2026-06-30T22:00:00.000Z', periodEnd: '2026-06-30T22:15:00.000Z' },
  })
  expect(probes.database).not.toHaveBeenCalled()
})

it('anchors the shared billing context to the first accepted IDE and retains later IDE observation periods', async () => {
  const third = 'GRIDEX2607E66003'
  const source = e66Interchange([
    { id: reference, period: invalidStart }, { id: sibling, period: validPeriod },
    { id: third, period: '202607020000202607020015' },
  ])
  const runtime = run(source)
  expectPeriodError(runtime, source, invalidStart)
  const [rejected, firstAccepted, secondAccepted] = await prepare(source, runtime, true)
  expect(rejected).toMatchObject({ transactionId: reference, billing: { capability: 'skip', periodStart: null, periodEnd: null } })
  expect(firstAccepted).toMatchObject({
    transactionId: sibling,
    billing: { capability: 'write', periodStart: '2026-06-30T22:00:00.000Z', periodEnd: '2026-06-30T22:15:00.000Z' },
  })
  expect(secondAccepted).toMatchObject({ transactionId: third,
    observations: [{ periodStart: '2026-07-01T22:00:00.000Z', periodEnd: '2026-07-01T22:15:00.000Z' }],
  })
  expect(secondAccepted.billing).toEqual(firstAccepted.billing)
  expect(probes.database).not.toHaveBeenCalled()
})

const wrongDateFormats = [
  { qualifier: '324', expected: '719', received: '203', fieldCode: '245' },
  { qualifier: '597', expected: '203', received: '102', fieldCode: '512' },
] as const

type WrongDateFormat = typeof wrongDateFormats[number]

function changeSg5Format(source: ReturnType<typeof e66>, format: WrongDateFormat, id = reference) {
  const lines = source.raw_payload!.split('\n')
  const start = lines.findIndex(line => line === `IDE+24+${id}'`)
  const end = lines.findIndex((line, index) => index > start && line.startsWith('SEQ+'))
  const occurrence = lines.findIndex((line, index) => index > start && index < end && line.startsWith(`DTM+${format.qualifier}:`))
  expect(occurrence).toBeGreaterThan(start)
  lines[occurrence] = lines[occurrence].replace(`:${format.expected}'`, `:${format.received}'`)
  source.raw_payload = lines.join('\n')
}

function withCustomUna(source: ReturnType<typeof e66>) {
  const businessSegments = tokenizeEdifact(source.raw_payload).segments
    .filter(segment => !['UNB', 'UNH', 'UNT', 'UNZ'].includes(segment.tag))
    .map(segmentUntrimmedRaw)
  source.raw_payload = EdifactEnvelopeCodec.encode({
    sender: '91100', receiver: '21660', interchangeReference: 'E66-DATE-FORMAT',
    applicationReference: source.application_reference, acknowledgementRequest: false, environment: 'test',
    createdAt: new Date('2026-10-01T18:11:00Z'),
    una: { componentDataElementSeparator: '*', dataElementSeparator: ';', releaseCharacter: '!', segmentTerminator: '~' },
    messages: [{ messageReference: '1', messageTypeToken: 'UTILTS:D:02B:UN:E5SE5A', businessSegments }],
  })
}

function expectWrongDateFormat(source: ReturnType<typeof e66>, runtime: ReturnType<typeof run>, format: WrongDateFormat) {
  const wire = tokenizeEdifact(source.raw_payload)
  const segment = wire.segments.find(item => {
    if (item.tag !== 'DTM') return false
    const [qualifier, , code] = segmentComposite(item, 1, wire.una)
    return qualifier === format.qualifier && code === format.received
  })
  expect(segment).toBeDefined()
  expect(runtime.validation.issues).toContainEqual(expect.objectContaining({
    kind: 'application', severity: 'error', aperakFieldCode: format.fieldCode,
    aperakInvalidOccurrence: { segmentIndex: segment!.index, elementIndex: 1, componentIndex: 2 },
  }))
  expect(runtime.ackPlan.aperakApplicationErrors).toMatchObject([{
    ercCode: '42', fieldCode: format.fieldCode, referenceNumber: reference, lineItemReference: reference,
    text: `INCORRECT DATA ${format.received}`,
  }])
  expect(runtime.transactionDispositions.find(item => item.transactionId === reference)).toMatchObject({
    disposition: 'guide_rejected', responseType: 'negative_aperak',
  })
}

it.each(wrongDateFormats.flatMap(format => [false, true].map(custom => ({ format, custom }))))(
  'rejects SG5 DTM+$format.qualifier in format $format.received with custom UNA $custom', async ({ format, custom }) => {
    const source = e66(validPeriod)
    changeSg5Format(source, format)
    if (custom) withCustomUna(source)

    const runtime = run(source)
    expect(runtime.validation.syntaxOk).toBe(true)
    expectWrongDateFormat(source, runtime, format)
    expect(runtime.ackPlan).toMatchObject({ contrlOutcome: 'positive', aperakOutcome: 'negative', shouldSendUtiltsErr: false })
    expect(probes.countIntervals).not.toHaveBeenCalled()
    expect(decideUtiltsResponse({ message: source })).toMatchObject({ kind: 'ack', ackFamily: 'APERAK', outcome: 'negative' })
    const draft = buildAckDraftForSource({
      sourceMessage: source, ackFamily: 'APERAK', outcome: 'negative', ackScope: 'transaction',
      relatedTransactionReference: reference, applicationErrors: runtime.ackPlan.aperakApplicationErrors,
    })
    expect(draft.rawPayload).toContain('ERC+42::260')
    expect(draft.rawPayload).toContain(`RFF+ACW:${reference}`)
    expect(draft.rawPayload).toContain(`FTX+AAO++${format.fieldCode}::260`)
    expect(await prepare(source, runtime, true)).toMatchObject([{
      observations: [], metering: { capability: 'skip' }, billing: { capability: 'skip' },
    }])
    expect(probes.matchPoint).not.toHaveBeenCalled()
    expect(probes.database).not.toHaveBeenCalled()
  },
)

it.each(wrongDateFormats.flatMap(format => [false, true].map(invalidFirst => ({ format, invalidFirst }))))(
  'keeps the other IDE eligible with wrong DTM+$format.qualifier and bad IDE first=$invalidFirst', async ({ format, invalidFirst }) => {
    const invalid = { id: reference, period: '202607010015202607010030' }
    const valid = { id: sibling, period: validPeriod, point: siblingMeterPoint }
    const source = e66Interchange(invalidFirst ? [invalid, valid] : [valid, invalid])
    changeSg5Format(source, format)

    const runtime = run(source)
    expectWrongDateFormat(source, runtime, format)
    expect(runtime.transactionDispositions.find(item => item.transactionId === sibling)).toMatchObject({
      disposition: 'accepted', responseType: 'positive_aperak',
    })
    const contracts = await prepare(source, runtime, true)
    expect(contracts.find(item => item.transactionId === reference)).toMatchObject({
      observations: [], metering: { capability: 'skip' }, billing: { capability: 'skip' },
    })
    expect(contracts.find(item => item.transactionId === sibling)).toMatchObject({
      observations: [{ externalPoint: siblingMeterPoint, periodStart: '2026-06-30T22:00:00.000Z', periodEnd: '2026-06-30T22:15:00.000Z' }],
      billing: { capability: 'write', periodStart: '2026-06-30T22:00:00.000Z', periodEnd: '2026-06-30T22:15:00.000Z' },
    })
    expect(probes.database).not.toHaveBeenCalled()
  },
)

it('does not classify the DTM+597 after the first SEQ as the SG5 registration field', () => {
  const source = e66(validPeriod)
  source.raw_payload = source.raw_payload!.replace('DTM+597:202607010000:203', 'DTM+597:202607010000:102')
  const runtime = run(source)
  expect(runtime.validation.syntaxOk).toBe(true)
  expect(runtime.validation.issues.some(issue => issue.aperakFieldCode === '512')).toBe(false)
})

it('skips all preparation when both IDE dates have the wrong formats', async () => {
  const source = e66Interchange([
    { id: reference, period: validPeriod },
    { id: sibling, period: '202607010015202607010030', point: siblingMeterPoint },
  ])
  changeSg5Format(source, wrongDateFormats[0])
  changeSg5Format(source, wrongDateFormats[1], sibling)
  const runtime = run(source)

  expect(runtime.ackPlan.aperakApplicationErrors).toMatchObject([
    { fieldCode: '245', ercCode: '42', referenceNumber: reference },
    { fieldCode: '512', ercCode: '42', referenceNumber: sibling },
  ])
  expect(runtime.transactionDispositions.map(item => item.responseType)).toEqual(['negative_aperak', 'negative_aperak'])
  const contracts = await prepare(source, runtime, true)
  expect(contracts).toHaveLength(2)
  for (const contract of contracts) expect(contract).toMatchObject({
    observations: [], metering: { capability: 'skip' }, billing: { capability: 'skip', periodStart: null, periodEnd: null },
  })
  expect(probes.matchPoint).not.toHaveBeenCalled()
  expect(probes.database).not.toHaveBeenCalled()
})

it('uses the first accepted billing period after a rejected registration date without replacing later observations', async () => {
  const third = 'GRIDEX2607E66003'
  const source = e66Interchange([
    { id: reference, period: '202607010015202607010030' },
    { id: sibling, period: validPeriod },
    { id: third, period: '202607010030202607010045' },
  ])
  changeSg5Format(source, wrongDateFormats[1])
  const runtime = run(source)
  expectWrongDateFormat(source, runtime, wrongDateFormats[1])

  const [rejected, firstAccepted, laterAccepted] = await prepare(source, runtime, true)
  expect(rejected).toMatchObject({ transactionId: reference, observations: [], billing: { capability: 'skip' } })
  expect(firstAccepted).toMatchObject({ transactionId: sibling, billing: {
    capability: 'write', periodStart: '2026-06-30T22:00:00.000Z', periodEnd: '2026-06-30T22:15:00.000Z',
  } })
  expect(laterAccepted).toMatchObject({ transactionId: third, observations: [
    { periodStart: '2026-06-30T22:30:00.000Z', periodEnd: '2026-06-30T22:45:00.000Z' },
  ] })
  expect(laterAccepted.billing).toEqual(firstAccepted.billing)
  expect(probes.database).not.toHaveBeenCalled()
})

it.each(wrongDateFormats)('leaves a valid pre-transition E66 eligible and rejects SG5 DTM+$qualifier in the wrong format', format => {
  const source = energyHandoffMessage('2026-09-30')
  expect(runUtiltsRuntimeForMessage(source).transactionDispositions).toMatchObject([{ responseType: 'positive_aperak' }])

  changeSg5Format(source, format)
  expectWrongDateFormat(source, runUtiltsRuntimeForMessage(source), format)
})
