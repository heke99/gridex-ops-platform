import {expect, it} from 'vitest'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {bindReceivedRegisterValidation} from '@/lib/ediel/core/receivedRegisterValidationBinding'
import {prodatAckObjectScopes} from '@/lib/ediel/prodat/prodatAckMessageFunction'
import {isQualifiedProdatApplicationError, projectProdatDiagnostics} from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import type {ProdatRegisterValidationEvidence} from '@/lib/ediel/prodat/prodatRegisterValidationEvidence'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {guideOrderedFixtureRaw} from './helpers/prodatGuideOrderedFixture'
import {characteristic, line, type Parts} from './fixtures/prodat-register'
import {head} from './fixtures/prodat-identity'

// Rejected response-scope prerequisite only. No admission, native/capture or
// whole H05/H08 approval tags; the real public negative response remains due.
function object(sequence = '1', identity = '', li = 'OWN-END-1', reason = 'Z25'): Parts[] {
  return [line(sequence, identity, undefined, '9'), ['DTM', ['93', '202610161330', '203']],
    ...characteristic('Z13', reason), ['RFF', ['Z05', 'NET']], ['RFF', ['LI', li]],
    ['NAD', 'UD', ['199001011234', 'SE2', '260'], '', 'Synthetic', 'Street', 'Town', '', '12345', 'SE'],
    // This physical NAD cannot supply the missing LIN identity.
    ['NAD', 'IT', ['735123456789012345', '', '9'], '', '', 'Site Street', 'Site Town', '', '12345', 'SE'],
    ['NAD', 'Z02', ['99876', '160', 'SVK']]]
}
function assess(body = object(), reason = 'Z25') {
  const raw = guideOrderedFixtureRaw([...head(), ...body], 'Z05'), wire = tokenizeEdifact(raw)
  const policy = resolveCanonicalEdielPolicy({family: 'PRODAT', messageCode: 'Z05', direction: 'inbound',
    subtypeOrReasonCode: reason, referenceDate: '2026-10-07', applicationReference: '23-DDQ-PRODAT', mode: 'catalog_evidence'})
  let evidence: ProdatRegisterValidationEvidence | undefined
  const issues = validateCanonicalPolicyFields({policy, rawPayload: raw, rawSegments: wire.segments.map(token => token.raw),
    una: wire.una, onRegisterValidation: value => {evidence = value}})
  if (!evidence) throw Error('actual_register_projection_required')
  const errors = projectProdatDiagnostics(issues).applicationErrors.filter(error => error.fieldCode === '209')
  return {raw, wire, evidence, errors}
}
const negativeScopes = (value: ReturnType<typeof assess>, errors = value.errors) => prodatAckObjectScopes({
  sourceWire: value.wire, messageCode: 'Z05', outcome: 'negative', applicationErrors: errors,
})

it.each(['Z25', 'Z22'])('actual %s field owner keeps invalid :::9 as a rejected null point with own LI', reason => {
  const value = assess(object('1', '', 'OWN-END-1', reason), reason)
  expect(value.errors).toMatchObject([{ercCode: '42', fieldCode: '209', referenceNumber: null, referenceQualifier: null,
    lineItemReference: 'OWN-END-1', prodatFieldDiagnostic: {kind: 'field', errorKind: 'invalid',
      occurrence: {objectId: null, identityAgency: '9', ownReferences: {objectId: {kind: 'absent'}}}}}])
  expect(value.evidence.objects).toMatchObject([{objectId: null, identityAgency: '9', disposition: 'rejected'}])
})

it('binds the exact rejected physical null scope without accepting it or borrowing NAD IT', () => {
  const value = assess(), rejected = structuredClone(value.evidence)
  rejected.objects[0].disposition = 'rejected'
  rejected.objects[0].reasons = ['FIELD_MATRIX_FIELD_FORMAT_INVALID']
  expect(bindReceivedRegisterValidation(rejected, value.raw)).toEqual(rejected)
  const accepted = structuredClone(rejected)
  accepted.objects[0].disposition = 'accepted'; accepted.objects[0].reasons = []
  expect(bindReceivedRegisterValidation(accepted, value.raw)).toBeNull()
  rejected.objects[0].objectId = '735123456789012345'
  expect(bindReceivedRegisterValidation(rejected, value.raw)).toBeNull()
})

it('selects the actual negative 42/209 first LIN and its LI without a Z07 identity', () => {
  const value = assess(), firstLineIndex = value.wire.segments.find(token => token.tag === 'LIN')!.index
  expect(negativeScopes(value)).toEqual([{objectId: null, identityAgency: '9', firstLineIndex, lineItemReference: 'OWN-END-1'}])
})

it('keeps two rejected null identities separate by actual LIN and own LI', () => {
  const value = assess([...object(), ...object('2', '', 'OWN-END-2')])
  expect(value.evidence.objects.map(own => [own.objectId, own.disposition, own.registers[0].lineIndex])).toEqual([
    [null, 'rejected', 0], [null, 'rejected', 1],
  ])
  expect(negativeScopes(value).map(own => own.lineItemReference)).toEqual(['OWN-END-1', 'OWN-END-2'])
})

it('does not select a duplicate physical LI or malformed LIN sequence', () => {
  expect(() => negativeScopes(assess([...object(), ...object('2')]))).toThrow('requested_scope_unqualified')
  expect(() => negativeScopes(assess(object('2')))).toThrow('requested_scope_unqualified')
})

it('does not select an unrelated or forged negative diagnostic', () => {
  const value = assess(), error = value.errors[0]
  expect(error.prodatOccurrence).toBeTruthy()
  expect(() => negativeScopes(value, [{...error, fieldCode: '223'}])).toThrow('requested_scope_unqualified')
  expect(() => negativeScopes(value, [{...error, referenceNumber: '735123456789012345', referenceQualifier: 'Z07'}])).toThrow('requested_scope_unqualified')
  expect(() => negativeScopes(value, [{...error, prodatOccurrence: {...error.prodatOccurrence!, lineIndex: 1}}])).toThrow('requested_scope_unqualified')
})

it('preserves ordinary non-null register identity', () => {
  const value = assess(object('1', '735123456789012345'))
  expect(value.errors).toEqual([])
  expect(value.evidence.objects[0]).toMatchObject({objectId: '735123456789012345', identityAgency: '9', disposition: 'accepted'})
  expect(bindReceivedRegisterValidation(value.evidence, value.raw)).toEqual(value.evidence)
})

it('keeps a complete sibling register unchanged beside the own rejected null identity', () => {
  const value = assess([...object('1', '735123456789012345'), ...object('2', '', 'OWN-END-2')])
  expect(value.evidence.objects.map(own => [own.objectId, own.disposition])).toEqual([
    ['735123456789012345', 'accepted'], [null, 'rejected'],
  ])
  expect(negativeScopes(value).map(own => [own.objectId, own.lineItemReference])).toEqual([[null, 'OWN-END-2']])
})

it('distinguishes an actually absent required C212 from submitted invalid :::9', () => {
  const body = object(); body[0] = ['LIN', '1']
  const value = assess(body)
  expect(value.errors).toMatchObject([{ercCode: '41', fieldCode: '209', referenceQualifier: null, referenceNumber: null,
    lineItemReference: 'OWN-END-1', prodatFieldDiagnostic: {errorKind: 'missing'}}])
  expect(value.evidence.objects[0]).toMatchObject({objectId: null, identityAgency: null, disposition: 'rejected'})
  expect(bindReceivedRegisterValidation(value.evidence, value.raw)).toEqual(value.evidence)
  expect(negativeScopes(value)).toMatchObject([{objectId: null, identityAgency: null, lineItemReference: 'OWN-END-1'}])
})

it('requires submitted failure content and the original kind, message, agency and LI', () => {
  const value = assess(), error = value.errors[0], diagnostic = error.prodatFieldDiagnostic
  if (diagnostic?.kind !== 'field') throw Error('actual209_diagnostic_required')
  expect(diagnostic.failureEvidence?.length).toBeGreaterThan(0)
  const substitutions = [
    {...diagnostic, errorKind: 'missing' as const},
    {...diagnostic, failureEvidence: diagnostic.failureEvidence!.map(own => ({...own, content: 'BORROWED'}))},
    {...diagnostic, occurrence: {...diagnostic.occurrence, messageReference: 'FOREIGN'}},
    {...diagnostic, occurrence: {...diagnostic.occurrence, identityAgency: '89'}},
    {...diagnostic, occurrence: {...diagnostic.occurrence, lineItemReference: 'FOREIGN'}},
  ]
  for (const changed of substitutions) expect(() => negativeScopes(value, [{...error, prodatFieldDiagnostic: changed}]))
    .toThrow('requested_scope_unqualified')
})

it('refuses missing LI, unsupported reason and repeated register authority', () => {
  for (const body of [object().filter(part => part[0] !== 'RFF' || !Array.isArray(part[1]) || part[1][0] !== 'LI'),
    [...object().map(part => part[0] === 'LIN' ? ['LIN', '1', '', ['', '', '', '9'], ['1', '1']] as Parts : part)],
  ]) {
    const value = assess(body)
    expect(value.evidence.objects[0].disposition).toBe('unavailable')
    expect(() => negativeScopes(value)).toThrow('requested_scope_unqualified')
  }
  const value = assess(object('1', '', 'OWN-END-1', 'Z24'))
  expect(value.evidence.objects[0].disposition).toBe('unavailable')
  expect(() => negativeScopes(value)).toThrow('requested_scope_unqualified')
})


it.each([{kind: 'present' as const, value: 'FOREIGN-CUSTOMER'}, {kind: 'absent' as const}, {kind: 'unavailable' as const}])(
  'binds missing209 fallback customer state to the physical own source: %j', customerId => {
    const body = object(); body[0] = ['LIN', '1']
    const value = assess(body), diagnostic = value.errors[0].prodatFieldDiagnostic
    if (diagnostic?.kind !== 'field' || !diagnostic.occurrence.ownReferences) throw Error('actual209_diagnostic_required')
    expect(diagnostic.occurrence.ownReferences.customerId).toEqual({kind: 'present', value: '199001011234'})
    const changed = {...diagnostic, occurrence: {...diagnostic.occurrence,
      ownReferences: {...diagnostic.occurrence.ownReferences, customerId}}}
    const recomposed = projectProdatDiagnostics([{severity: 'error', blocking: true, code: 'FIELD_MATRIX_FIELD_REQUIRED',
      title: 'Actual missing209 with substituted customer reference', description: 'Negative source-binding control',
      prodatDiagnostic: changed}]).applicationErrors
    // Genuine recomposition passes the existing syntax/text qualifier. The new
    // source guard must still reject references absent from its physical NAD.
    expect(recomposed).toHaveLength(1)
    expect(isQualifiedProdatApplicationError(recomposed[0])).toBe(true)
    if (customerId.kind === 'present') expect(recomposed[0].text).toContain('kundid=FOREIGN-CUSTOMER')
    expect(() => negativeScopes(value, recomposed)).toThrow('requested_scope_unqualified')
  },
)
