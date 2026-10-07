import {expect, it} from 'vitest'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {bindReceivedRegisterValidation} from '@/lib/ediel/core/receivedRegisterValidationBinding'
import {prodatAckObjectScopes} from '@/lib/ediel/prodat/prodatAckMessageFunction'
import {projectProdatDiagnostics} from '@/lib/ediel/prodat/prodatDiagnosticProjection'
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

it('preserves ordinary non-null register identity and excludes the new path from positive scope', () => {
  const value = assess(object('1', '735123456789012345'))
  expect(value.errors).toEqual([])
  expect(value.evidence.objects[0]).toMatchObject({objectId: '735123456789012345', identityAgency: '9', disposition: 'accepted'})
  expect(bindReceivedRegisterValidation(value.evidence, value.raw)).toEqual(value.evidence)
})
