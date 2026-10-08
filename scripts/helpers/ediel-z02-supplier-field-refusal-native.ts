import {segmentComposite, segmentElementCount, tokenizeEdifact, type EdifactTokenizedSegment} from '@/lib/ediel/core/edifactTokenizer'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'
import type {RulebookValidationResult} from '@/lib/ediel/rulebook/validator'

/** Observes real inputs/results only. These four exact refusals prove missing
 * R/D data cannot finalize an original. They do not prove positive finalization,
 * external source approval, or a numeric P-01 diagnostic for missing BGM/202.
 */
type Validation = Pick<RulebookValidationResult, 'ok' | 'blocking' | 'family' | 'code' | 'issues'>
export type Z01CausalFieldRefusalInput = {
  field: string
  rawOriginal: string
  rawOmitted: string
  positiveValidation: Validation
  negativeValidation: Validation
  diagnostics: readonly EdielRulebookIssue[]
  finalizerError: string | null
  sameBoundSource: boolean
  noOriginal: boolean
  noBusinessEffects: boolean
}
export type Z01CausalFieldRefusalProof = {
  field: '202' | 'END_USER_GROUP' | '229' | '234'
  causeCode: string
  causeDescription: string
  fieldPath: string | null
  objectId: string
  identityAgency: string
  lineItemReference: string
  messageReference: string
  physicalChange: 'BGM/C002/1001' | 'NAD+UD' | 'NAD+UD/C059' | 'NAD+IT/C059'
  positiveValidationAccepted: true
  sameBoundSource: true
  noOriginal: true
  noBusinessEffects: true
  numeric202DiagnosticProved: false
  positiveFinalizationProved: false
}
export type Z01CausalFieldRefusal = {phase: 'causal_field_refused'; proof: Z01CausalFieldRefusalProof}
type Wire = ReturnType<typeof tokenizeEdifact>
type Own = {objectId: string; identityAgency: string; lineItemReference: string; messageReference: string; lineNumber: string}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const blocking = (issue: EdielRulebookIssue) => issue.blocking || issue.severity === 'error'
const parts = (token: EdifactTokenizedSegment, wire: Wire) => Array.from(
  {length: segmentElementCount(token, wire.una) + 1}, (_, index) => segmentComposite(token, index, wire.una))
function singleton(wire: Wire, tag: string) {
  const matches = wire.segments.filter(token => token.tag === tag)
  return matches.length === 1 ? matches[0] : null
}
function party(wire: Wire, qualifier: string) {
  const matches = wire.segments.filter(token => token.tag === 'NAD' && segmentComposite(token, 1, wire.una)[0] === qualifier)
  return matches.length === 1 ? matches[0] : null
}
function validEnvelope(wire: Wire) {
  const unb = singleton(wire, 'UNB'), unh = singleton(wire, 'UNH'), unt = singleton(wire, 'UNT'), unz = singleton(wire, 'UNZ')
  return Boolean(unb && unh && unt && unz && wire.segments[0] === unb && wire.segments.at(-1) === unz
    && unb.index < unh.index && unh.index < unt.index && unt.index < unz.index
    && segmentComposite(unh, 2, wire.una)[0] === 'PRODAT'
    && segmentComposite(unh, 1, wire.una)[0]
    && equal(segmentComposite(unt, 2, wire.una), segmentComposite(unh, 1, wire.una))
    && equal(segmentComposite(unz, 2, wire.una), segmentComposite(unb, 5, wire.una))
    && equal(segmentComposite(unz, 1, wire.una), ['1'])
    && equal(segmentComposite(unt, 1, wire.una), [String(unt.index - unh.index + 1)]))
}
function ownSource(wire: Wire): Own | null {
  const lin = singleton(wire, 'LIN'), unh = singleton(wire, 'UNH'), unt = singleton(wire, 'UNT')
  const ud = party(wire, 'UD'), it = party(wire, 'IT'), bgm = singleton(wire, 'BGM')
  if (!lin || !unh || !unt || !ud || !it || !bgm || segmentComposite(bgm, 1, wire.una)[0] !== 'Z01') return null
  const identity = segmentComposite(lin, 3, wire.una), lineNumber = segmentComposite(lin, 1, wire.una)[0]
  if (!identity[0] || !['9', '89'].includes(identity[3]) || !lineNumber
    || !equal(identity, [identity[0], '', '', identity[3]])
    || !equal(segmentComposite(it, 2, wire.una), [identity[0], '', identity[3]])
    || !(lin.index < ud.index && ud.index < unt.index && lin.index < it.index && it.index < unt.index)) return null
  const references = wire.segments.filter(token => token.tag === 'RFF' && segmentComposite(token, 1, wire.una)[0] === 'LI')
  if (references.length !== 1 || references[0].index <= lin.index || references[0].index >= unt.index) return null
  const reference = segmentComposite(references[0], 1, wire.una)
  if (!reference[1] || !equal(reference, ['LI', reference[1]])) return null
  return {objectId: identity[0], identityAgency: identity[3], lineItemReference: reference[1],
    messageReference: segmentComposite(unh, 1, wire.una)[0], lineNumber}
}
function exactPhysicalOmission(original: Wire, omitted: Wire, field: Z01CausalFieldRefusalProof['field']) {
  if (!equal(original.una, omitted.una) || !validEnvelope(original) || !validEnvelope(omitted)) return false
  const originalUnt = singleton(original, 'UNT')!, omittedUnt = singleton(omitted, 'UNT')!
  const expectedUnt = parts(originalUnt, original).map((value, index) => index === 1
    ? [String(omittedUnt.index - singleton(omitted, 'UNH')!.index + 1)] : value)
  if (!equal(parts(omittedUnt, omitted), expectedUnt)) return false
  const target = field === '202' ? singleton(original, 'BGM') : party(original, field === '234' ? 'IT' : 'UD')
  if (!target) return false
  const a = original.segments.filter(token => token.tag !== 'UNT')
  const b = omitted.segments.filter(token => token.tag !== 'UNT')
  if (field === 'END_USER_GROUP') {
    if (omitted.segments.some(token => token.tag === 'NAD' && segmentComposite(token, 1, omitted.una)[0] === 'UD')) return false
    const retained = a.filter(token => token !== target)
    return retained.length === b.length && retained.every((token, index) => token.raw === b[index].raw)
  }
  if (a.length !== b.length) return false
  const targetParts = parts(target, original), element = field === '202' ? 1 : 5
  if (field === '202' && !equal(targetParts[1], ['Z01'])) return false
  if (!targetParts[element]?.some(value => value.trim())) return false
  const expected = targetParts.map((value, index) => index === element ? [''] : value)
  return a.every((token, index) => token === target
    ? b[index].tag === target.tag && equal(parts(b[index], omitted), expected)
    : token.raw === b[index].raw)
}
function sameIssue(a: EdielRulebookIssue, b: EdielRulebookIssue) {
  return a.code === b.code && a.description === b.description && a.scope === b.scope
    && a.fieldPath === b.fieldPath && a.severity === b.severity && a.blocking === b.blocking
    && equal(a.prodatDiagnostic, b.prodatDiagnostic)
}
function ownMissingField(issues: readonly EdielRulebookIssue[], number: string, path: string, own: Own) {
  return issues.some(issue => {
    const diagnostic = issue.prodatDiagnostic
    if (!blocking(issue) || issue.code !== 'FIELD_MATRIX_REQUIRED_FIELD_MISSING' || issue.fieldPath !== path
      || diagnostic?.kind !== 'field' || diagnostic.fieldNumber !== number || diagnostic.errorKind !== 'missing'
      || diagnostic.sourceRule !== `PRODAT26A:§2.2:Z01:${number}` || diagnostic.segmentPath !== path) return false
    const occurrence = diagnostic.occurrence
    return occurrence.scope === 'object' && occurrence.lineIndex === 0 && occurrence.registerPosition === 1
      && occurrence.lineNumber === own.lineNumber && occurrence.objectId === own.objectId
      && occurrence.identityAgency === own.identityAgency && occurrence.lineItemReference === own.lineItemReference
      && equal(occurrence.ownReferences?.objectId, {kind: 'present', value: own.objectId})
      && equal(occurrence.ownReferences?.lineItemReference, {kind: 'present', value: own.lineItemReference})
  })
}

/** Fail closed for any other field, mutation, earlier guard, missing source
 * binding or effect. The reported cause comes from the real first issue and
 * exact actual finalizer error; the observer never constructs diagnostics.
 */
export function classifyZ01CausalFieldRefusal(input: Z01CausalFieldRefusalInput): Z01CausalFieldRefusal | null {
  if (!['202', 'END_USER_GROUP', '229', '234'].includes(input.field) || !input.sameBoundSource
    || !input.noOriginal || !input.noBusinessEffects || !input.positiveValidation.ok || input.positiveValidation.blocking
    || input.positiveValidation.family !== 'PRODAT' || input.positiveValidation.code !== 'Z01'
    || input.positiveValidation.issues.some(blocking) || input.negativeValidation.ok || !input.negativeValidation.blocking
    || input.negativeValidation.family !== 'PRODAT') return null
  const field = input.field as Z01CausalFieldRefusalProof['field']
  const first = input.negativeValidation.issues.find(blocking)
  if (!first || !input.diagnostics.some(issue => sameIssue(first, issue))
    || input.diagnostics.some(issue => !input.negativeValidation.issues.some(actual => sameIssue(issue, actual)))
    || input.negativeValidation.issues.some(issue => !input.diagnostics.some(actual => sameIssue(issue, actual)))
    || input.finalizerError !== `Outbound PRODAT Z01 blockerades av canonical Ediel-policy: ${first.code} - ${first.description}`) return null
  try {
    const original = tokenizeEdifact(input.rawOriginal), omitted = tokenizeEdifact(input.rawOmitted)
    const own = ownSource(original)
    if (!own || !exactPhysicalOmission(original, omitted, field)) return null
    const issues = input.negativeValidation.issues
    let physicalChange: Z01CausalFieldRefusalProof['physicalChange']
    if (field === '202') {
      if (input.negativeValidation.code !== null || first.code !== 'PRODAT_REGISTER_EVIDENCE_INVALID'
        || first.scope !== 'prodat_register' || first.description !== 'prodat_register_evidence_invalid'
        || !issues.some(issue => blocking(issue) && issue.code === 'PRODAT_CUSTOMER_MASTERDATA_SOURCE_UNQUALIFIED'
          && issue.fieldPath === 'NAD+UD' && issue.description === 'Kundkällan kräver sitt faktiska egna tillämpliga PRODAT-original.')) return null
      physicalChange = 'BGM/C002/1001'
    } else {
      if (input.negativeValidation.code !== 'Z01') return null
      if (field === 'END_USER_GROUP') {
        if (first.code !== 'FIELD_MATRIX_REQUIRED_FIELD_MISSING' || first.fieldPath !== 'NAD+UD'
          || first.description !== 'NAD+UD krävs för PRODAT Z01.' || first.prodatDiagnostic?.kind !== 'internal'
          || first.prodatDiagnostic.sourceRule !== 'PRODAT26A:§2.2:Z01:END_USER_GROUP') return null
        const children = [['227', 'NAD+UD/C082/3039'], ['228', 'NAD+UD/C080/3036[1..2]'],
          ['231', 'NAD+UD/3251'], ['232', 'NAD+UD/3164'], ['316', 'NAD+UD/3207']]
        if (!children.every(([number, path]) => ownMissingField(issues, number, path, own))) return null
        physicalChange = 'NAD+UD'
      } else if (field === '229') {
        if (first.code !== 'PRODAT_END_USER_ADDRESS_VALUE_MISMATCH' || first.fieldPath !== 'NAD+UD/C059/3042[1..3]'
          || first.description !== `Z01:229, P26.A s.22/79/117-118: ${JSON.stringify([own.objectId, own.identityAgency])}: adressens komponenter avviker från valt underlag`
          || !issues.some(issue => blocking(issue) && issue.code === 'PRODAT_CUSTOMER_MASTERDATA_SOURCE_UNQUALIFIED'
            && issue.fieldPath === 'NAD+UD' && issue.description === 'Faktiska UD-värden avviker från den skyddade källans identitet, namn eller folkbokföringsadress.')) return null
        physicalChange = 'NAD+UD/C059'
      } else {
        if (first.code !== 'PRODAT_DEPENDENT_OPTIONAL_INSTALLATION_FORMAT_INVALID' || first.fieldPath !== 'NAD+IT'
          || first.description !== 'Z01:INSTALLATION_GROUP, P26.A §2.2 s.22 / §2.6 s.81: vald IT innehåller tomma obligatoriska, ogiltiga eller oanvända komponenter.'
          || !ownMissingField(issues, '234', 'NAD+IT/C059/3042[1..3]', own)) return null
        physicalChange = 'NAD+IT/C059'
      }
    }
    return {phase: 'causal_field_refused', proof: {field, causeCode: first.code, causeDescription: first.description,
      fieldPath: first.fieldPath ?? null, objectId: own.objectId, identityAgency: own.identityAgency,
      lineItemReference: own.lineItemReference, messageReference: own.messageReference, physicalChange,
      positiveValidationAccepted: true, sameBoundSource: true, noOriginal: true, noBusinessEffects: true,
      numeric202DiagnosticProved: false, positiveFinalizationProved: false}}
  } catch {return null}
}
