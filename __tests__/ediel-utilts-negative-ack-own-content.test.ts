import { expect, it } from 'vitest'
import { buildAperakDraft } from '@/lib/ediel/ack'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { segmentComposite, segmentUntrimmedRaw, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { escapeEdifactData } from '@/lib/ediel/core/una'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { utiltsErrGatewayFixture } from './helpers/utiltsErrGatewayFixture'

// Independent primary facit: A3 SHA fad5cf4f… p123 / U SHA0524c18f… p118.
// ERC42 copies the erroneous received field; ERC41 keeps its prescribed text.
const literal = "BAD+:'?"
const cases = [
  { code: 'UTILTS_QUANTITY_UNIT_NOT_USED', field: 'QTY/C186/6411', content: "+?'",
    replace: "QTY+136:500'", with: `QTY+136:500:${escapeEdifactData("+?'")}'` },
  { code: 'UTILTS_DECIMAL_FIELD_INVALID', field: '516', content: literal,
    replace: "QTY+136:500'", with: `QTY+136:${escapeEdifactData(literal)}'` },
  { code: 'UTILTS_DECIMAL_FIELD_INVALID', field: '522', content: '1.234',
    replace: "SEQ++1'", with: "SEQ++1'\nMOA+9:1.234:SEK'" },
  { code: 'UTILTS_DECIMAL_FIELD_INVALID', field: '523', content: '1.1234567',
    replace: "SEQ++1'", with: "SEQ++1'\nPRI+CAL:1.1234567'" },
  { code: 'UTILTS_EXCHANGE_SINGLE_AREA_NOT_USED', field: '260a', content: 'TES',
    replace: "LOC+239+TES:SVK:260'", with: "LOC+239+TES:SVK:260'\nLOC+232+ABC:SVK:260'" },
  { code: 'UTILTS_OBSERVATION_TIME_ORDER', field: 'DTM/2380', content: '202606302345',
    replace: "DTM+597:202607010000:203'", with: "DTM+597:202607010000:203'\nSEQ++2'\nQTY+136:3'\nDTM+597:202606302345:203'" },
  { code: 'UTILTS_METER_READING_DUPLICATED', field: '517', content: '010.00',
    replace: "QTY+136:500'", with: "QTY+220:10.0'\nDTM+597:202607010000:203'\nSEQ++2'\nQTY+220:010.00'" },
  { code: 'UTILTS_OBSERVATION_BLOCK_NOT_CONTIGUOUS', field: 'QTY/6063', content: '136',
    replace: "QTY+136:500'", with: "QTY+136:500'\nSEQ++2'\nQTY+220:10'\nSEQ++3'\nQTY+136:3'" },
] as const

function physicalSource(testCase?: typeof cases[number], custom = false, transform?: (raw: string) => string) {
  const source = utiltsErrGatewayFixture({ company: 'synthetic-own-negative-content',
    transactions: [{ reference: 'OWN-IDE', outcome: 'accepted' }, { reference: 'SIBLING-IDE', outcome: 'accepted' }] })
  source.message_received_at = '2026-10-15T20:00:00Z'; source.created_at = source.message_received_at
  const originalRaw = testCase ? source.raw_payload!.replace(testCase.replace, testCase.with) : source.raw_payload!
  const raw = transform ? transform(originalRaw) : originalRaw
  const businessSegments = tokenizeEdifact(raw).segments.filter(segment => !['UNB', 'UNH', 'UNT', 'UNZ'].includes(segment.tag)).map(segment => segmentUntrimmedRaw(segment))
  source.raw_payload = EdifactEnvelopeCodec.encode({ sender: '91100', receiver: '21660', interchangeReference: 'OWN-CONTENT',
    applicationReference: source.application_reference, acknowledgementRequest: false, environment: 'test',
    createdAt: new Date('2026-10-01T18:11:00Z'),
    ...(custom ? { una: { componentDataElementSeparator: '*', dataElementSeparator: ';', releaseCharacter: '!', segmentTerminator: '~' } } : {}),
    messages: [{ messageReference: '1', messageTypeToken: 'UTILTS:D:02B:UN:E5SE5A', businessSegments }] })
  return source
}

for (const custom of [false, true]) it.each(cases)(`own $code copies $content into a renderable ERC42, custom UNA=${custom}`, testCase => {
  const source = physicalSource(testCase, custom), original = source.raw_payload
  const runtime = runUtiltsRuntimeForMessage(source)
  expect(runtime.validation.syntaxOk, JSON.stringify(runtime.validation.issues)).toBe(true)
  expect(runtime.validation.issues).toContainEqual(expect.objectContaining({ code: testCase.code, aperakFieldCode: testCase.field,
    aperakErcCode: '42', referenceNumber: 'OWN-IDE' }))
  expect(runtime.transactionDispositions.find(row => row.transactionId === 'OWN-IDE')).toMatchObject({ disposition: 'guide_rejected', responseType: 'negative_aperak' })
  expect(runtime.transactionDispositions.find(row => row.transactionId === 'SIBLING-IDE')).toMatchObject({ disposition: 'accepted', responseType: 'positive_aperak' })
  const errors = runtime.ackPlan.aperakApplicationErrors.filter(error => error.referenceNumber === 'OWN-IDE')
  const draft = buildAperakDraft({ sourceMessage: source, outcome: 'negative', applicationErrors: errors, relatedTransactionReference: 'OWN-IDE' })
  const wire = tokenizeEdifact(draft.rawPayload)
  expect(wire.segments.filter(segment => segment.tag === 'FTX').map(segment => segmentComposite(segment, 4, wire.una)[0]))
    .toContain(`INCORRECT DATA ${testCase.content}`)
  expect(wire.segments.filter(segment => segment.tag === 'RFF').map(segment => segmentComposite(segment, 1, wire.una)))
    .toContainEqual(['ACW', 'OWN-IDE'])
  expect(runtime.ackPlan.utiltsErrCodes).toEqual([])
  expect(source.raw_payload).toBe(original)
})

for (const custom of [false, true]) it(`empty ownLOC239 keeps ERC41 and renders without sibling content, custom UNA=${custom}`, () => {
  const source = physicalSource(undefined, custom, raw => raw
    .replace("LOC+239+TES:SVK:260'", "LOC+239'\nLOC+232+ABC:SVK:260'"))
  source.parsed_payload = { ...source.parsed_payload, gridAreaId: 'POISON' }
  const original = source.raw_payload
  const runtime = runUtiltsRuntimeForMessage(source)
  expect(runtime.validation.syntaxOk, JSON.stringify(runtime.validation.issues)).toBe(true)
  const errors = runtime.ackPlan.aperakApplicationErrors.filter(error => error.referenceNumber === 'OWN-IDE')
  expect(errors).toContainEqual(expect.objectContaining({ fieldCode: '260a', ercCode: '41', text: 'MANDATORY FIELD MISSING' }))
  expect(errors).toContainEqual(expect.objectContaining({ fieldCode: '260c', ercCode: '41', text: 'MANDATORY FIELD MISSING' }))
  expect(errors.some(error => error.fieldCode === '260a' && error.ercCode === '42')).toBe(false)
  expect(errors.some(error => /POISON|TES/.test(error.text ?? ''))).toBe(false)
  expect(runtime.transactionDispositions.find(row => row.transactionId === 'OWN-IDE')).toMatchObject({ disposition: 'guide_rejected', responseType: 'negative_aperak' })
  expect(runtime.transactionDispositions.find(row => row.transactionId === 'SIBLING-IDE')).toMatchObject({ disposition: 'accepted', responseType: 'positive_aperak' })
  const draft = buildAperakDraft({ sourceMessage: source, outcome: 'negative', applicationErrors: errors, relatedTransactionReference: 'OWN-IDE' })
  const wire = tokenizeEdifact(draft.rawPayload)
  expect(wire.segments.filter(segment => segment.tag === 'FTX').map(segment => segmentComposite(segment, 4, wire.una)[0]))
    .toEqual(errors.map(() => 'MANDATORY FIELD MISSING'))
  expect(draft.rawPayload).not.toContain('POISON')
  expect(runtime.ackPlan.utiltsErrCodes).toEqual([])
  expect(source.raw_payload).toBe(original)
})

it.each(['invalid-point', 'missing-point'] as const)('E30 %s preserves own209 and copies its forbidden received MEA unit', defect => {
  const source = physicalSource()
  source.message_code = 'E30'; source.application_reference = '23-MDR-E30-S'
  source.raw_payload = source.raw_payload!.replaceAll('23-DDQ-E66-T', source.application_reference).replace('BGM+E66::260', 'BGM+E30::260')
    .replace('LOC+172+735999260731000007::9', defect === 'invalid-point' ? 'LOC+172+735999260731000008::9' : 'LOC+172+::9')
  const runtime = runUtiltsRuntimeForMessage(source), errors = runtime.ackPlan.aperakApplicationErrors.filter(error => error.referenceNumber === 'OWN-IDE')
  expect(errors).toContainEqual(expect.objectContaining({ fieldCode: '264', ercCode: '42', text: 'INCORRECT DATA KWH' }))
  expect(errors).toContainEqual(expect.objectContaining({ fieldCode: '209', ercCode: defect === 'invalid-point' ? '42' : '41',
    text: defect === 'invalid-point' ? 'INCORRECT DATA 735999260731000008' : 'MANDATORY FIELD MISSING' }))
  const draft = buildAperakDraft({ sourceMessage: source, outcome: 'negative', applicationErrors: errors, relatedTransactionReference: 'OWN-IDE' })
  expect(draft.rawPayload).toContain('INCORRECT DATA KWH')
})

it('missing own6060 fails full syntax before national ERC, while zero and NULL retain distinct source meanings', () => {
  const source = physicalSource()
  source.raw_payload = source.raw_payload!.replace('QTY+136:500', 'QTY+136:')
  const missing = runUtiltsRuntimeForMessage(source)
  expect(missing.validation.syntaxOk).toBe(false)
  expect(missing.ackPlan.aperakApplicationErrors).toEqual([])
  expect(missing.transactionDispositions.every(row => row.disposition === 'syntax_rejected' && row.responseType === 'negative_contrl')).toBe(true)
  for (const value of ['0', 'NULL']) {
    const valid = physicalSource()
    const before = "QTY+136:500'"
    const after = value === 'NULL' ? "QTY+136:NULL'" : "QTY+136:0'"
    const segments = tokenizeEdifact(valid.raw_payload!.replace(before, after).replace("STS+7++21::260'", value === 'NULL' ? "STS+7++21::260'\nSTS+8+46'" : "STS+7++21::260'")).segments.filter(segment => !['UNB', 'UNH', 'UNT', 'UNZ'].includes(segment.tag)).map(segment => segmentUntrimmedRaw(segment))
    valid.raw_payload = EdifactEnvelopeCodec.encode({ sender: '91100', receiver: '21660', interchangeReference: 'OWN-VALUE',
      applicationReference: valid.application_reference, acknowledgementRequest: false, environment: 'test',
      createdAt: new Date('2026-10-01T18:11:00Z'), messages: [{ messageReference: '1', messageTypeToken: 'UTILTS:D:02B:UN:E5SE5A', businessSegments: segments }] })
    const runtime = runUtiltsRuntimeForMessage(valid)
    expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues)).toBe(true)
    expect(runtime.facts.transactions[0].quantities[0].value).toBe(value === '0' ? 0 : null)
  }
})

it.each([
  { defect: 'mixed-reasons', field: '223', original: 'STS+7++E88::260', replacement: 'STS+7++E23::260', own: 'E23', sibling: 'E88' },
  { defect: 'mixed-resolutions', field: '508', original: 'DTM+354:15:806', replacement: 'DTM+354:1:802', own: '1', sibling: '15' },
])('$defect copies each IDE own received $field into its negative ACK', ({ field, original, replacement, own, sibling }) => {
  const source = physicalSource()
  source.raw_payload = source.raw_payload!.replace(original, replacement)
  const runtime = runUtiltsRuntimeForMessage(source)
  expect(runtime.transactionDispositions.every(row => row.disposition === 'guide_rejected')).toBe(true)
  for (const [reference, received] of [['OWN-IDE', own], ['SIBLING-IDE', sibling]]) {
    const errors = runtime.ackPlan.aperakApplicationErrors.filter(error => error.referenceNumber === reference)
    expect(errors).toContainEqual(expect.objectContaining({ fieldCode: field, ercCode: '42', text: `INCORRECT DATA ${received}` }))
    const draft = buildAperakDraft({ sourceMessage: source, outcome: 'negative', applicationErrors: errors, relatedTransactionReference: reference })
    expect(draft.rawPayload).toContain(`INCORRECT DATA ${received}`)
  }
})

for (const custom of [false, true]) it(`full grammar rejects physical MEA inside own SEQ before all application/sibling effects, custom UNA=${custom}`, () => {
  const source=physicalSource(undefined,custom,raw=>raw.replace("SEQ++1'","SEQ++1'\nMEA+AAZ++MWH'"))
  const runtime=runUtiltsRuntimeForMessage(source)
  expect(runtime.validation.syntaxOk).toBe(false)
  expect(runtime.transactionDispositions.every(row=>row.disposition==='syntax_rejected' && row.responseType==='negative_contrl')).toBe(true)
  expect(runtime.ackPlan.aperakApplicationErrors).toEqual([])
  expect(runtime.ackPlan.utiltsErrCodes).toEqual([])
})
