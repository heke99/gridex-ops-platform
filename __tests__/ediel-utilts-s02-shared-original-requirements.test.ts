import { expect, it } from 'vitest'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { segmentUntrimmedRaw, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { DEFAULT_UNA } from '@/lib/ediel/core/una'
import { buildUtiltsTransactionPersistencePayload } from '@/lib/ediel/utilts/transactionPersistence'
import { prepareUtiltsConsumptionContracts } from '@/lib/ediel/utilts/consumptionPreparation'
import { s02PlanningFixture, s02PlanningPair, s02PlanningSecondSequence } from './helpers/utiltsS02PlanningFixture'

// Hash-qualified originals: prior U/G01 pp52/53/98/133 and current U pp51/52/95/127.
// Own SG5 point209 and own SG8/SG11 planned quantity515 apply in both guide packages.
const guides = ['25-A-3', '25-A-4'] as const
function recount(raw: string) {
  const wire = tokenizeEdifact(raw)
  const start = wire.segments.findIndex(segment => segment.tag === 'UNH')
  const end = wire.segments.findIndex(segment => segment.tag === 'UNT')
  return raw.replace(/UNT\+[0-9]+\+1'/, `UNT+${end - start + 1}+1'`)
}
function selectedPolicy(guide: typeof guides[number]) {
  return resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'S02', direction: 'inbound',
    referenceDate: '2026-10-01', associationAssignedCode: 'E5SE5A', applicationReference: '23-DDQ-S02-S',
    selectedGuideRevision: guide, mode: 'parse' })
}

function declaredAlphabet(raw: string, custom: boolean) {
  if (!custom) return recount(raw)
  const una = { ...DEFAULT_UNA, componentDataElementSeparator: '*', dataElementSeparator: ';',
    decimalMark: ',', releaseCharacter: '!', segmentTerminator: '~' }
  return EdifactEnvelopeCodec.encode({ sender: '91100', receiver: '21660', interchangeReference: 'S02NATIVE001',
    applicationReference: '23-DDQ-S02-S', acknowledgementRequest: false, environment: 'test', una, createdAt: new Date('2026-10-01T18:11:00Z'),
    messages: [{ messageReference: '1', messageTypeToken: 'UTILTS:D:02B:UN:E5SE5A',
      businessSegments: tokenizeEdifact(raw).segments.filter(segment => !['UNB', 'UNH', 'UNT', 'UNZ'].includes(segment.tag)).map(segment => segmentUntrimmedRaw(segment)) }] })
}

it.each(guides)('%s requires a nonempty own point even when a complete sibling follows', guide => {
  const source = s02PlanningFixture({ company: 'shared-original', transactions: s02PlanningPair('clean', true) })
  source.raw_payload = source.raw_payload!.replace('LOC+172+735999260731000007::9', 'LOC+172+::9')
  const original = source.raw_payload
  const policy = selectedPolicy(guide)
  expect(policy.guide.guideRevision).toBe(guide)
  const runtime = runUtiltsRuntimeForMessage(source, { canonicalPolicy: policy })
  expect(runtime.validation.syntaxOk, JSON.stringify(runtime.validation.issues)).toBe(true)
  expect(runtime.validation.issues).toContainEqual(expect.objectContaining({ aperakFieldCode: '209', referenceNumber: 'S02-OWN' }))
  expect(runtime.transactionDispositions.find(row => row.transactionId === 'S02-OWN')).toMatchObject({ disposition: 'guide_rejected' })
  expect(runtime.transactionDispositions.find(row => row.transactionId === 'S02-SIBLING')).toMatchObject({ disposition: 'accepted' })
  expect(source.raw_payload).toBe(original)
})

it.each(guides.flatMap(guide => ['0', 'NULL'].map(value => ({ guide, value }))))('$guide keeps an explicitly supplied own quantity $value', ({ guide, value }) => {
  const source = s02PlanningFixture({ company: 'shared-original', transactions: s02PlanningPair('clean', true) })
  source.raw_payload = recount(source.raw_payload!.replace("QTY+135:111'", value === 'NULL'
    ? "QTY+135:NULL'\nSTS+8+46'" : "QTY+135:0'"))
  const runtime = runUtiltsRuntimeForMessage(source, { canonicalPolicy: selectedPolicy(guide) })
  expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues)).toBe(true)
  expect(runtime.transactionDispositions.find(row => row.transactionId === 'S02-OWN')).toMatchObject({ disposition: 'accepted' })
  expect(runtime.transactionDispositions.find(row => row.transactionId === 'S02-SIBLING')).toMatchObject({ disposition: 'accepted' })
})

it.each(guides.flatMap(guide => ['absent', '21'].map(quality => ({ guide, quality }))))('$guide refuses own NULL without own46 ($quality), despite sibling46', ({ guide, quality }) => {
  const source = s02PlanningFixture({ company: 'shared-original', transactions: s02PlanningPair('clean', true) })
  source.raw_payload = recount(source.raw_payload!.replace("QTY+135:111'", `QTY+135:NULL'${quality === '21' ? "\nSTS+8+21'" : ''}`)
    .replace("QTY+135:222'", "QTY+135:NULL'\nSTS+8+46'"))
  const runtime = runUtiltsRuntimeForMessage(source, { canonicalPolicy: selectedPolicy(guide) })
  expect(runtime.validation.syntaxOk, JSON.stringify(runtime.validation.issues)).toBe(true)
  expect(runtime.validation.issues).toContainEqual(expect.objectContaining({ aperakErcCode: '41', aperakFieldCode: '520', referenceNumber: 'S02-OWN' }))
  expect(runtime.transactionDispositions.find(row => row.transactionId === 'S02-OWN')).toMatchObject({ disposition: 'guide_rejected' })
  expect(runtime.transactionDispositions.find(row => row.transactionId === 'S02-SIBLING')).toMatchObject({ disposition: 'accepted' })
})

const requiredCases = guides.flatMap(guide => [true, false].flatMap(ownFirst =>
  ['missing-point', 'missing-quantity', 'missing-both', 'foreign-point', 'wrong-quantity', 'header-quantity', 'second-sequence']
    .map(defect => ({ guide, ownFirst, defect }))))
it.each(requiredCases)('$guide own $defect cannot borrow a sibling when ownFirst=$ownFirst', async ({ guide, ownFirst, defect }) => {
  const source = s02PlanningFixture({ company: 'shared-original', transactions: s02PlanningPair(
    defect === 'missing-point' || defect === 'missing-quantity' || defect === 'missing-both' ? defect : 'clean', ownFirst) })
  let raw = source.raw_payload!
  if (defect === 'foreign-point') raw = raw.replace('LOC+172+735999260731000007::9', 'LOC+175+735999260731000007::9')
  if (defect === 'wrong-quantity') raw = raw.replace('QTY+135:111', 'QTY+136:111')
  if (defect === 'header-quantity') raw = raw.replace("SEQ++1'\nQTY+135:111'", "QTY+135:111'\nSEQ++1'")
  if (defect === 'second-sequence') raw = s02PlanningSecondSequence(raw, null)
  source.raw_payload = recount(raw)
  const original = source.raw_payload, policy = selectedPolicy(guide)
  const runtime = runUtiltsRuntimeForMessage(source, { canonicalPolicy: policy })
  if (defect === 'header-quantity') {
    expect(runtime.validation.syntaxOk).toBe(false)
    expect(runtime.transactionDispositions.every(row => row.disposition === 'syntax_rejected' && row.responseType === 'negative_contrl')).toBe(true)
    expect(runtime.ackPlan.aperakApplicationErrors).toEqual([])
    expect(runtime.ackPlan.utiltsErrCodes).toEqual([])
    expect(source.raw_payload).toBe(original)
    return
  }
  expect(runtime.validation.syntaxOk, JSON.stringify(runtime.validation.issues)).toBe(true)
  expect(runtime.transactionDispositions.find(row => row.transactionId === 'S02-OWN')).toMatchObject({ disposition: 'guide_rejected', responseType: 'negative_aperak' })
  expect(runtime.transactionDispositions.find(row => row.transactionId === 'S02-SIBLING')).toMatchObject({ disposition: 'accepted', responseType: 'positive_aperak' })
  const fields = defect === 'missing-both' ? ['209', '515'] : ['missing-point', 'foreign-point'].includes(defect) ? ['209'] : ['515']
  for (const field of fields) expect(runtime.validation.issues).toContainEqual(expect.objectContaining({ aperakErcCode: '41', aperakFieldCode: field, referenceNumber: 'S02-OWN' }))
  const payload = buildUtiltsTransactionPersistencePayload({ messageCode: 'S02', transactions: runtime.facts.transactions,
    dispositions: runtime.transactionDispositions, rawSegments: runtime.facts.rawSegments, matches: [] })
  expect(payload.filter(row => row.disposition === 'accepted').map(row => row.transactionId)).toEqual(['S02-SIBLING'])
  const contracts = await prepareUtiltsConsumptionContracts({ message: source, runtime, policy, matches: [], dataRequest: null,
    fallback: { customerId: null, siteId: null, meteringPointId: null, gridOwnerId: null }, allowConsumption: true })
  expect(contracts).toHaveLength(2)
  for (const contract of contracts) expect(contract).toMatchObject({ observations: [], metering: { capability: 'skip' }, billing: { capability: 'skip' } })
  expect(runtime.ackPlan.utiltsErrCodes).toEqual([])
  expect(source.raw_payload).toBe(original)
})

const qualityCases = guides.flatMap(guide => [true, false].flatMap(custom =>
  ['own-quality', 'missing-quality', 'quality-before', 'next-quantity-quality', 'next-sequence-quality']
    .map(quality => ({ guide, custom, quality }))))
it.each(qualityCases)('$guide NULL uses only own following quality $quality with custom UNA=$custom', ({ guide, custom, quality }) => {
  const source = s02PlanningFixture({ company: 'shared-original', transactions: s02PlanningPair('clean', true) })
  let raw = source.raw_payload!.replace("QTY+135:222'", "QTY+135:NULL'\nSTS+8+46'")
  const quantity = "QTY+135:NULL'", status = "STS+8+46'"
  const supplied = quality === 'own-quality' ? `${quantity}\n${status}` : quality === 'quality-before' ? `${status}\n${quantity}`
    : quality === 'next-quantity-quality' ? `${quantity}\nQTY+135:100'\n${status}` : quantity
  raw = raw.replace("QTY+135:111'", supplied)
  if (quality === 'next-sequence-quality') raw = s02PlanningSecondSequence(raw, 333).replace("QTY+135:333'", `${quantity}\n${status}`)
  source.raw_payload = declaredAlphabet(raw.replace("IDE+24+S02-OWN'", "IDE+24+S02-OWN?+IDE'"), custom)
  const original = source.raw_payload, runtime = runUtiltsRuntimeForMessage(source, { canonicalPolicy: selectedPolicy(guide) })
  if (quality === 'quality-before') {
    expect(runtime.validation.syntaxOk).toBe(false)
    expect(runtime.transactionDispositions.every(row => row.disposition === 'syntax_rejected' && row.responseType === 'negative_contrl')).toBe(true)
    expect(runtime.ackPlan.aperakApplicationErrors).toEqual([])
    expect(runtime.ackPlan.utiltsErrCodes).toEqual([])
    expect(source.raw_payload).toBe(original)
    return
  }
  expect(runtime.validation.syntaxOk, JSON.stringify(runtime.validation.issues)).toBe(true)
  expect(runtime.transactionDispositions.find(row => row.transactionId === 'S02-OWN+IDE')).toMatchObject({
    disposition: quality === 'own-quality' ? 'accepted' : 'guide_rejected', responseType: quality === 'own-quality' ? 'positive_aperak' : 'negative_aperak' })
  expect(runtime.transactionDispositions.find(row => row.transactionId === 'S02-SIBLING')).toMatchObject({ disposition: 'accepted' })
  if (quality === 'own-quality') expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues)).toBe(true)
  else expect(runtime.validation.issues).toContainEqual(expect.objectContaining({ aperakErcCode: '41', aperakFieldCode: '520', referenceNumber: 'S02-OWN+IDE' }))
  expect(runtime.ackPlan.utiltsErrCodes).toEqual([])
  expect(source.raw_payload).toBe(original)
})
