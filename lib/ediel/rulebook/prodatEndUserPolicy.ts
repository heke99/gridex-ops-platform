import { segmentComposite, segmentElementCount, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import { parseUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import { prodatRegisterGroups, prodatRegisterMessageSegments } from '@/lib/ediel/prodat/prodatRegisterGroups'
import { prodatPartySyntaxIssues } from '@/lib/ediel/prodat/prodatPartyFields'
import { isSourceBoundProdatEndUserField, resolveProdatSourceSubtypeRequirement } from '@/lib/ediel/prodat/prodatSubtypeRequirement'
import { findProdatSubtypeRule } from '@/lib/ediel/rulebook/prodatSubtypeRegistry'
import { validateFieldMatrixPayload, type FieldMatrixEvaluationInput, type RulebookFieldRule } from '@/lib/ediel/rulebook/fieldMatrix'
import type { EdielRulebookIssue } from '@/lib/ediel/rulebook/rulebook'

function hasTrailingValue(token: EdifactTokenizedSegment, last: number, una: EdifactServiceStringAdvice): boolean {
  for (let element = last + 1; element <= segmentElementCount(token, una); element++) {
    if (segmentComposite(token, element, una).some(part => part.trim())) return true
  }
  return false
}

/** The UD parent depends on one source-valid SG14 field223 in THIS register.
 * Neither aliases, a later parent group's CCI nor malformed extra components
 * are authority. This is not a substitute for the complete PRODAT grammar.
 */
function wireSubtype(segments: readonly EdifactTokenizedSegment[], code: string, una: EdifactServiceStringAdvice): string | null {
  const indices = segments.flatMap((token, index) => token.tag === 'CCI'
    && segmentComposite(token, 2, una)[0]?.trim().toUpperCase() === 'Z13' ? [index] : [])
  if (indices.length !== 1) return null
  const index = indices[0], cci = segments[index], cav = segments[index + 1]
  const parent = segments.findIndex(token => token.tag === 'RFF' || token.tag === 'NAD')
  if ((parent >= 0 && index >= parent) || cav?.tag !== 'CAV' || segments[index + 2]?.tag === 'CAV') return null
  const descriptor = segmentComposite(cci, 2, una), value = segmentComposite(cav, 1, una)
  if (descriptor[0] !== 'Z13' || descriptor.slice(1).some(part => part.trim())
    || segmentComposite(cci, 1, una).some(part => part.trim()) || hasTrailingValue(cci, 2, una)
    || value.slice(1).some(part => part.trim()) || hasTrailingValue(cav, 1, una)) return null
  const known = findProdatSubtypeRule(value[0], code)
  return known?.transactionReasonCode === value[0] && known.allowedMessageCodes.some(allowed => allowed === code) ? known.subtype : null
}

const isUd = (token: EdifactTokenizedSegment, una: EdifactServiceStringAdvice) => token.tag === 'NAD'
  && segmentComposite(token, 1, una)[0]?.trim().toUpperCase() === 'UD'

/** Also used to defer field229 without trusting a message-wide parent snapshot. */
export function prodatEndUserContexts(input: FieldMatrixEvaluationInput) {
  const code = input.code ?? '', una = input.una ?? parseUna(null)
  const {groups, tokens} = prodatRegisterGroups(prodatRegisterMessageSegments(input.rawSegments ?? [], una), una, code)
  const scopes = groups.filter(group => !group.validRegisterChain || group.registerPosition === 1).map(group => group.segments)
  if (!groups.length) scopes.push(tokens.some(token => ['UNB','UNH','BGM'].includes(token.tag)) ? [] : tokens)
  const contexts = scopes.map(segments => {
    const subtype = wireSubtype(segments, code, una)
    const identity = segmentComposite(segments.find(token => token.tag === 'LIN'), 3, una)
    return {
      segments, groups:segments.filter(token => isUd(token, una)),
      requirement:resolveProdatSourceSubtypeRequirement({messageCode:code,fieldNumber:'END_USER_GROUP',subtype}),
      label:`Objekt ${identity[0] || '(saknar identitet)'} / ${identity[3] || '(saknar kod)'}`,
    }
  })
  return {contexts, tokens, una}
}

/** P26.A p22 / p79: parent activation precedes its five numeric children.
 * All physical NAD occurrences are inspected before first-register narrowing;
 * an empty/duplicate/forbidden parent cannot hide behind an absent child value.
 * Field229's availability condition is not adopted by this bounded migration.
 */
export function validateProdatEndUserPolicy(input: FieldMatrixEvaluationInput, rules: readonly RulebookFieldRule[], direction: 'inbound' | 'outbound' = 'outbound'): EdielRulebookIssue[] {
  const code = input.code ?? ''
  const selected = rules.filter(rule => isSourceBoundProdatEndUserField(code, rule.fieldNumber ?? ''))
  if (!selected.length) return []
  const {contexts, tokens, una} = prodatEndUserContexts(input)
  const issues: EdielRulebookIssue[] = []
  const add = (name: string, detail: string, label = 'Objekt (fel segmentgrupp)') => issues.push({
    scope:'prodat_dependent',severity:'error',blocking:true,code:name,fieldPath:'NAD+UD',
    title:'PRODAT elanvändargrupp följer inte källregeln',
    description:`${label}; ${code}:END_USER_GROUP, P26.A s.22,79: ${detail}.`,
  })
  const permitted = new Set(contexts.flatMap(context => context.groups.map(group => group.index)))
  for (const token of tokens.filter(token => isUd(token, una))) {
    if (!permitted.has(token.index)) add('PRODAT_DEPENDENT_UD_SCOPE_INVALID','UD ska tillhöra rätt objekts första register, inte huvudet eller ett senare register')
  }
  for (const context of contexts) {
    const {requirement, groups, label, segments} = context
    if (requirement === 'undetermined' || requirement === null) {
      add('PRODAT_DEPENDENT_CONDITION_UNDETERMINED','exakt en giltig transaktionsorsak krävs i objektets eget SG14/fält223',label)
      continue
    }
    if (requirement === 'forbidden') {
      // P bilaga4 p119/P-02: valid non-applicable national data is not
      // an outbound violation on reception. The raw payload and separate
      // syntax checks remain intact; this does not enable it in builders.
      if (direction === 'outbound' && groups.length) add('PRODAT_DEPENDENT_UD_FORBIDDEN','UD-gruppen får inte skickas för denna transaktionsorsak',label)
      continue
    }
    if (groups.length !== 1) {
      add('PRODAT_DEPENDENT_UD_CARDINALITY_INVALID','exakt en UD-grupp krävs för Z06E/Z09E',label)
      continue
    }
    const group = groups[0], role = segmentComposite(group, 1, una)
    if (role.length !== 1 || role[0] !== 'UD' || hasTrailingValue(group, 9, una)
      || prodatPartySyntaxIssues([group], una).length) {
      add('PRODAT_DEPENDENT_UD_FORMAT_INVALID','NAD ska följa rätt identitetskod/agency, komponenter, längder och oanvända element enligt s.79',label)
    }
    const children = selected.filter(rule => rule.fieldNumber !== 'END_USER_GROUP').map((rule): RulebookFieldRule => ({...rule,requirement:'required'}))
    for (const failure of validateFieldMatrixPayload({...input,family:'PRODAT',rawSegments:segments.map(segment=>segment.raw),mode:'parse'}, children)) {
      issues.push({...failure,scope:'prodat_dependent',description:`${label}; ${code}:${children.find(rule=>rule.segmentPath===failure.fieldPath)?.fieldNumber ?? 'END_USER_GROUP'}, P26.A s.22,79: ${failure.description}`})
    }
  }
  return issues
}
