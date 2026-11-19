import { expect, it, vi } from 'vitest'
import { buildAperakDraft } from '@/lib/ediel/ack'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { segmentComposite, segmentUntrimmedRaw, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'
import { prepareUtiltsConsumptionContracts } from '@/lib/ediel/utilts/consumptionPreparation'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { energyHandoffMessage, observationHandoffMessage } from '@/__tests__/helpers/utiltsObservationHandoff'
import { recountEdifactUnt } from '@/__tests__/helpers/recountEdifactUnt'
import { utiltsErrGatewayFixture } from '@/__tests__/helpers/utiltsErrGatewayFixture'

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))

const registrationA = '202607010020'
const registrationB = '202607010025'
const owned = 'OWN-IDE'
const sibling = 'SIBLING-IDE'

function physicalSource(first: string, second: string | null, ownFirst: boolean, custom: boolean) {
  const source = utiltsErrGatewayFixture({
    company: 'synthetic-transaction-registration',
    transactions: (ownFirst ? [owned, sibling] : [sibling, owned]).map(reference => ({
      reference, outcome: 'accepted',
    })),
  })
  source.message_received_at = '2026-10-15T20:00:00Z'
  source.created_at = source.message_received_at
  const lines = source.raw_payload!.split('\n')
  const section = lines.findIndex(line => line.startsWith('IDE+24+' + owned))
  const declaration = lines.findIndex((line, index) => index > section && line.startsWith('DTM+597:'))
  const registration = [`DTM+597:${first}:203'`]
  if (second !== null) registration.push(`DTM+597:${second}:203'`)
  lines.splice(declaration, 1, ...registration)
  const businessSegments = tokenizeEdifact(lines.join('\n')).segments
    .filter(segment => !['UNB', 'UNH', 'UNT', 'UNZ'].includes(segment.tag))
    .map(segmentUntrimmedRaw)
  source.raw_payload = EdifactEnvelopeCodec.encode({
    sender: '91100', receiver: '21660', interchangeReference: 'REGISTRATION-TEST',
    applicationReference: source.application_reference, acknowledgementRequest: false, environment: 'test',
    createdAt: new Date('2026-10-01T18:11:00Z'),
    ...(custom ? { una: { componentDataElementSeparator: '*', dataElementSeparator: ';', releaseCharacter: '!', segmentTerminator: '~' } } : {}),
    messages: [{ messageReference: '1', messageTypeToken: 'UTILTS:D:02B:UN:E5SE5A', businessSegments }],
  })
  return source
}

it.each([
  { first: registrationA, second: registrationB, ownFirst: true, custom: false },
  { first: registrationB, second: registrationA, ownFirst: false, custom: false },
  { first: registrationA, second: registrationB, ownFirst: false, custom: true },
  { first: registrationB, second: registrationA, ownFirst: true, custom: true },
])('rejects own conflicting SG5 time $second with custom UNA $custom and own-first $ownFirst', ({ first, second, ownFirst, custom }) => {
  const source = physicalSource(first, second, ownFirst, custom)
  const original = source.raw_payload
  const runtime = runUtiltsRuntimeForMessage(source)

  expect(runtime.validation.syntaxOk).toBe(true)
  expect(runtime.transactionDispositions.find(item => item.transactionId === owned)).toMatchObject({
    disposition: 'guide_rejected', responseType: 'negative_aperak',
  })
  expect(runtime.transactionDispositions.find(item => item.transactionId === sibling)).toMatchObject({
    disposition: 'accepted', responseType: 'positive_aperak',
  })
  expect(runtime.ackPlan.aperakApplicationErrors).toContainEqual(expect.objectContaining({
    fieldCode: '512', ercCode: '42', referenceNumber: owned, text: 'INCORRECT DATA ' + second,
  }))
  expect(runtime.ackPlan.aperakApplicationErrors.find(error => error.referenceNumber === sibling)).toBeUndefined()

  const draft = buildAperakDraft({
    sourceMessage: source, outcome: 'negative', relatedTransactionReference: owned,
    applicationErrors: runtime.ackPlan.aperakApplicationErrors.filter(error => error.referenceNumber === owned),
  })
  const wire = tokenizeEdifact(draft.rawPayload)
  const values = wire.segments.filter(segment => segment.tag === 'FTX').map(segment => segmentComposite(segment, 4, wire.una)[0])
  expect(values).toContain('INCORRECT DATA ' + second)
  expect(wire.segments.filter(segment => segment.tag === 'RFF').map(segment => segmentComposite(segment, 1, wire.una)))
    .toContainEqual(['ACW', owned])
  expect(source.raw_payload).toBe(original)
})

it('retains identical SG5 value semantics and keeps the independent observation time', () => {
  const source = energyHandoffMessage()
  const original = runUtiltsRuntimeForMessage(source)
  source.raw_payload = recountEdifactUnt(source.raw_payload!.replace(
    `DTM+597:${registrationA}:203'`, `DTM+597:${registrationA}:203'\nDTM+597:${registrationA}:203'`,
  ))
  const repeated = runUtiltsRuntimeForMessage(source)
  expect(original.transactionDispositions[0].responseType).toBe('positive_aperak')
  expect(repeated.transactionDispositions[0].responseType).toBe('positive_aperak')
  expect(repeated.facts.transactions[0].registrationTime).toBe(original.facts.transactions[0].registrationTime)
  expect(repeated.validation.issues.some(issue => issue.aperakFieldCode === '512')).toBe(false)
})

it('keeps distinct times at legitimate SG11 meter readings separate from field 512', () => {
  const source = observationHandoffMessage()
  const result = runUtiltsRuntimeForMessage(source)
  const dates = tokenizeEdifact(source.raw_payload!).segments.filter(segment =>
    segment.tag === 'DTM' && segment.raw.startsWith('DTM+597:'),
  )
  expect(dates).toHaveLength(3)
  expect(result.validation.syntaxOk).toBe(true)
  expect(result.validation.issues.some(issue => issue.aperakFieldCode === '512')).toBe(false)
})

it('allows different SG5 registration times under separate IDEs', () => {
  const runtime = runUtiltsRuntimeForMessage(physicalSource(registrationB, null, false, false))
  expect(runtime.facts.transactions.map(item => [item.transactionId, item.registrationTime])).toEqual([
    [sibling, '2026-07-01T00:20:00'],
    [owned, '2026-07-01T00:25:00'],
  ])
  expect(runtime.transactionDispositions.map(item => [item.transactionId, item.responseType])).toEqual([
    [sibling, 'positive_aperak'], [owned, 'positive_aperak'],
  ])
})

const lin = "LIN+++8716867000030:::9'"

it.each([
  ['between SG5 dates', `DTM+597:${registrationA}:203'`, `DTM+597:${registrationA}:203'\n${lin}\nDTM+597:${registrationB}:203'`],
  ['after SEQ', "SEQ++1'", `SEQ++1'\n${lin}\nDTM+597:${registrationB}:203'`],
] as const)('keeps extra LIN %s on the negative CONTRL path', (_position, original, replacement) => {
  const source = energyHandoffMessage()
  source.raw_payload = recountEdifactUnt(source.raw_payload!.replace(original, replacement))
  const runtime = runUtiltsRuntimeForMessage(source)
  expect(runtime.validation).toMatchObject({ classification: 'syntax_rejected', syntaxOk: false })
  expect(runtime.validation.issues.some(issue => issue.code === 'UNSM_MESSAGE_STRUCTURE_INVALID')).toBe(true)
  expect(runtime.ackPlan).toMatchObject({
    shouldSendContrl: true, contrlOutcome: 'negative', shouldSendAperak: false, aperakApplicationErrors: [],
  })
})

it('holds adjacent extra product lines before creating consumption contracts', async () => {
  const message = energyHandoffMessage()
  message.raw_payload = recountEdifactUnt(message.raw_payload!.replace(lin, lin + '\n' + lin))
  const runtime = runUtiltsRuntimeForMessage(message)
  const policy = resolveCanonicalMessagePolicy(message)!

  expect(runtime.validation.syntaxOk).toBe(true)
  await expect(prepareUtiltsConsumptionContracts({
    message, runtime, policy, dataRequest: null, allowConsumption: true,
    matches: [{
      transactionReference: 'GRIDEX2607E66001', externalMeteringPointId: '735999260731000007',
      externalGridAreaId: 'TES', meteringPointId: 'point', customerId: 'customer',
      siteId: 'site', gridOwnerId: 'owner', matchStatus: 'matched',
    }],
    fallback: { customerId: 'customer', siteId: 'site', meteringPointId: 'point', gridOwnerId: 'owner' },
  })).rejects.toThrow('physical_product_ambiguous')
})
