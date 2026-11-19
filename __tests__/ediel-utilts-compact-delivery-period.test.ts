import { beforeEach, expect, it, vi } from 'vitest'
import type { GridOwnerDataRequestRow } from '@/lib/cis/types'
import { buildAckDraftForSource } from '@/lib/ediel/ack'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
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
