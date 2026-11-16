import { segmentComposite, segmentElementCount, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import { parseUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import { prodatRegisterMessageSegments, prodatRegisterRuleScopes } from '@/lib/ediel/prodat/prodatRegisterGroups'
import { prodatPartySyntaxIssues } from '@/lib/ediel/prodat/prodatPartyFields'
import { isSourceBoundEndUserField, resolveProdatEndUserGroupRequirement } from '@/lib/ediel/prodat/prodatParentApplicability'
import { findProdatSubtypeRule } from '@/lib/ediel/rulebook/prodatSubtypeRegistry'
import { validateFieldMatrixPayload, type FieldMatrixEvaluationInput, type RulebookFieldRule } from '@/lib/ediel/rulebook/fieldMatrix'
import type { EdielRulebookIssue } from '@/lib/ediel/rulebook/rulebook'

// P26.A p79: widths apply to decoded wire components BEFORE normalization.
// Existing scalar readers trim display values; that must not hide an overlong
// supplied component. Address syntax here is not field229 availability evidence.
const UD_COMPONENT_LIMITS = [
  { field: '227', element: 2, maxima: [35, 3, 3] },
  { field: '228', element: 4, maxima: [35, 35] },
  { field: '229', element: 5, maxima: [35, 35, 35] },
  { field: '232', element: 6, maxima: [35] },
  { field: '231', element: 8, maxima: [9] },
  { field: '316', element: 9, maxima: [3] },
] as const

function hasExtraElements(token: EdifactTokenizedSegment, last: number, una: EdifactServiceStringAdvice): boolean {
  for (let index = last + 1; index <= segmentElementCount(token, una); index++) {
    if (segmentComposite(token, index, una).some(value => value.trim())) return true
  }
  return false
}

/** Actual field223 in SG14 of ONE register. No aliases, cached subtype, sibling
 * data or a reason hidden inside SG16/17 may select the UD parent. */
export function prodatEndUserWireSubtype(code: string, segments: readonly EdifactTokenizedSegment[], una: EdifactServiceStringAdvice) {
  const candidates = segments.filter(token => token.tag === 'CCI' && segmentComposite(token, 2, una)[0]?.trim().toUpperCase() === 'Z13')
  if (candidates.length !== 1) return null
  const cci = candidates[0], index = segments.indexOf(cci), cav = segments[index + 1]
  const parentStart = segments.findIndex(token => ['RFF', 'NAD'].includes(token.tag))
  const descriptor = segmentComposite(cci, 2, una)
  if ((parentStart >= 0 && index >= parentStart) || cav?.tag !== 'CAV' || segments[index + 2]?.tag === 'CAV'
    || descriptor[0] !== 'Z13' || descriptor.slice(1).some(value => value.trim())
    || segmentComposite(cci, 1, una).some(value => value.trim()) || hasExtraElements(cci, 2, una)
    || hasExtraElements(cav, 1, una)) return null
  const parts = segmentComposite(cav, 1, una)
  if (parts.slice(1).some(value => value.trim())) return null
  const reason = parts[0]?.trim(), known = reason ? findProdatSubtypeRule(reason, code) : null
  return known?.transactionReasonCode === reason ? known.subtype : null
}

export function prodatEndUserObjectScopes(input: FieldMatrixEvaluationInput) {
  if (!['Z06', 'Z09'].includes(input.code ?? '')) return []
  const una = input.una ?? parseUna(null), code = input.code!
  return (prodatRegisterRuleScopes('END_USER_GROUP', input.rawSegments ?? [], una, code) ?? []).map(segments => {
    const subtype = prodatEndUserWireSubtype(code, segments, una)
    const identity = segmentComposite(segments.find(token => token.tag === 'LIN'), 3, una)
    return {segments, subtype, requirement: resolveProdatEndUserGroupRequirement(code, subtype),
      context: `Objekt ${identity[0] || '(saknar identitet)'} / ${identity[3] || '(saknar kod)'}`}
  })
}

/** P26.A r3 p22/p79. Parent cardinality is checked BEFORE children; all supplied
 * groups are checked BEFORE first-register narrowing. Only this two-code UD
 * unit is handled here; field229 availability and IV/Z14 are not migrated. */
export function validateProdatEndUserPolicy(input: FieldMatrixEvaluationInput, rules: readonly RulebookFieldRule[]): EdielRulebookIssue[] {
  const code = input.code ?? ''
  if (!rules.some(rule => isSourceBoundEndUserField(code, rule.fieldNumber ?? ''))) return []
  const una = input.una ?? parseUna(null)
  const scopes = prodatEndUserObjectScopes(input)
  const tokens = prodatRegisterMessageSegments(input.rawSegments ?? [], una)
  const suppliedUd = (token: EdifactTokenizedSegment) => token.tag === 'NAD'
    && segmentComposite(token, 1, una)[0]?.trim().toUpperCase() === 'UD'
  const allowedIndices = new Set(scopes.flatMap(scope => scope.segments.filter(suppliedUd).map(token => token.index)))
  const issues: EdielRulebookIssue[] = []
  const fail = (failureCode: string, detail: string, field = 'END_USER_GROUP', path = 'NAD+UD') => {
    issues.push({scope:'prodat_dependent',severity:'error',blocking:true,code:failureCode,
      title:'PRODAT-kundgruppen följer inte källregeln', description:`${code}:${field}, P26.A s.22/79: ${detail}.`,fieldPath:path})
  }
  for (const token of tokens.filter(suppliedUd)) {
    const role = segmentComposite(token, 1, una)
    if (!allowedIndices.has(token.index)) fail('PRODAT_DEPENDENT_END_USER_SCOPE_INVALID','UD måste tillhöra objektets första register, inte huvudet eller ett senare register')
    if (role.length !== 1 || role[0] !== 'UD') fail('PRODAT_DEPENDENT_END_USER_INVALID','partkvalificeraren måste vara exakt UD utan ytterligare komponenter')
    if (hasExtraElements(token, 9, una)) fail('PRODAT_DEPENDENT_END_USER_INVALID','NAD får inte ha ytterligare ifyllda dataelement')
    for (const constraint of UD_COMPONENT_LIMITS) {
      const parts = segmentComposite(token, constraint.element, una)
      if (constraint.maxima.some((maximum, index) => (parts[index]?.length ?? 0) > maximum)) {
        fail('PRODAT_DEPENDENT_END_USER_INVALID', 'avkodade komponenter överskrider källtabellens längdgräns före normalisering',
          constraint.field === '229' ? 'END_USER_GROUP' : constraint.field)
      }
    }
    // Country is a coded token (P p79), not normalized free text. In
    // particular, leading padding must not manufacture an ISO-shaped value.
    const country = segmentComposite(token, 9, una)
    if (country.some(value => value.length) && (country.length !== 1 || !/^[A-Z]{2,3}$/.test(country[0]))) {
      fail('PRODAT_DEPENDENT_END_USER_INVALID', 'landkoden måste vara en ensam kod utan utfyllnad', '316')
    }
    for (const failure of prodatPartySyntaxIssues([token], una)) {
      fail('PRODAT_DEPENDENT_END_USER_INVALID', 'angiven UD innehåller tomma obligatoriska, för långa eller oanvända komponenter',
        failure.fieldNumber && failure.fieldNumber !== '229' ? failure.fieldNumber : 'END_USER_GROUP')
    }
  }
  for (const scope of scopes) {
    const parents = scope.segments.filter(suppliedUd)
    if (scope.requirement === 'undetermined' || scope.requirement === null) {
      fail('PRODAT_DEPENDENT_CONDITION_UNDETERMINED', `${scope.context}: exakt en giltig, korrekt placerad transaktionsorsak i fält223 krävs`)
      continue
    }
    if (scope.requirement === 'forbidden') {
      if (parents.length) fail('PRODAT_DEPENDENT_END_USER_FORBIDDEN', `${scope.context}: UD får inte anges för denna transaktionstyp`)
      continue
    }
    if (parents.length !== 1) fail('PRODAT_DEPENDENT_END_USER_CARDINALITY_INVALID',`${scope.context}: E kräver exakt en UD-grupp`)
    for (const rule of rules.filter(rule => rule.fieldNumber !== 'END_USER_GROUP' && isSourceBoundEndUserField(code, rule.fieldNumber ?? ''))) {
      const failures = validateFieldMatrixPayload({...input,rawSegments:scope.segments.map(token => token.raw),mode:'parse'},[{...rule,requirement:'required'}])
      issues.push(...failures.map(failure => ({...failure,scope:'prodat_dependent' as const,
        description:`${scope.context}; ${code}:${rule.fieldNumber}, P26.A s.22/79: ${failure.description}`})))
    }
  }
  return issues
}
