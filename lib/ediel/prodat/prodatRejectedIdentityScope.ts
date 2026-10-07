import {segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import type {EdifactServiceStringAdvice} from '@/lib/ediel/core/una'
import {prodatRegisterGroups, type ProdatRegisterGroup} from './prodatRegisterGroups'
import {prodatRegisterFieldState} from './prodatRegisterFields'
import {prodatCharacteristicValues} from './prodatCharacteristicFields'
import {evaluateProdatTransactionReason} from './prodatTransactionReason'
import {prodatErrorOccurrence, validProdatWireDiagnostic, type ProdatDiagnostic} from './prodatFieldDiagnostic'

type Input = {code: string; group: ProdatRegisterGroup; rawSegments: readonly string[]; una: EdifactServiceStringAdvice}
const reference = (group: ProdatRegisterGroup, una: EdifactServiceStringAdvice) => {
  const party = group.segments.findIndex(token => token.tag === 'NAD')
  const refs = group.segments.slice(0, party < 0 ? undefined : party)
    .filter(token => token.tag === 'RFF' && segmentComposite(token, 1, una)[0] === 'LI')
  const parts = refs.length === 1 ? segmentComposite(refs[0], 1, una) : []
  return parts.length === 2 && /^[^\x00-\x1f\x7f]{1,128}$/.test(parts[1]) && parts[1] === parts[1].trim() ? parts[1] : null
}

/** Physical serialization boundary for a rejected Z05 H/L identity only.
 * This is not lawful identity omission, a field decision or accepted authority.
 * Keep each null identity keyed by its exact first LIN and unique own LI.
 */
export function isProdatRejectedIdentityScope(input: Input): boolean {
  if (input.code !== 'Z05' || input.group.itemId !== null) return false
  const all = prodatRegisterGroups(input.rawSegments, input.una, input.code)
  const bgms = all.tokens.filter(token => token.tag === 'BGM')
  if (all.tokens.filter(token => token.tag === 'UNH').length !== 1 || bgms.length !== 1
    || segmentComposite(bgms[0], 1, input.una)[0] !== input.code
    || all.problems.some(problem => problem.fieldNumber === '314')) return false
  const own = all.groups.find(group => group.lineIndex === input.group.lineIndex
    && group.segments[0].index === input.group.segments[0]?.index && group.segments[0].raw === input.group.segments[0]?.raw)
  if (!own || own.messageIndex !== 0 || own.itemId !== null || own.identityAgency !== input.group.identityAgency
    || own.lineNumber !== input.group.lineNumber || !own.validRegisterChain || own.registerCount !== 1
    || own.registerPosition !== 1 || own.registerIndex !== null) return false
  const state = prodatRegisterFieldState('209', own.segments, input.una)
  if (!state || state.value !== null || state.present && !state.malformed) return false
  const reasons = prodatCharacteristicValues('223', all.tokens, input.una)
  if (reasons.length !== all.groups.length || !['Z25', 'Z22'].includes(reasons[0])
    || reasons.some(reason => reason !== reasons[0])
    || evaluateProdatTransactionReason({rawSegments: input.rawSegments, una: input.una, code: input.code}).issues.length) return false
  const li = reference(own, input.una)
  return li !== null && all.groups.filter(group => reference(group, input.una) === li).length === 1
}

/** The projection/negative-response edge additionally needs the real typed209
 * finding, its exact physical occurrence and submitted failure evidence.
 */
export function hasProdatRejectedIdentityDiagnostic(input: Input, diagnostic: ProdatDiagnostic | undefined): boolean {
  if (!validProdatWireDiagnostic(diagnostic) || diagnostic.kind !== 'field' || diagnostic.fieldNumber !== '209'
    || diagnostic.occurrence.scope === 'header' || !isProdatRejectedIdentityScope(input)) return false
  const state = prodatRegisterFieldState('209', input.group.segments, input.una)!
  if (diagnostic.errorKind !== (state.malformed ? 'invalid' : 'missing')
    || diagnostic.errorKind === 'invalid' && JSON.stringify(diagnostic.failureEvidence) !== JSON.stringify(state.failureEvidence)) return false
  const actual = prodatErrorOccurrence({code: input.code, rawSegments: input.rawSegments, una: input.una},
    [], diagnostic.occurrence.scope, input.group.lineIndex)
  return !!actual && (['scope', 'messageReference', 'lineIndex', 'lineNumber', 'registerPosition', 'objectId', 'identityAgency', 'lineItemReference'] as const)
    .every(key => diagnostic.occurrence[key] === actual[key])
    && diagnostic.occurrence.ownReferences?.objectId.kind === 'absent'
    && diagnostic.occurrence.ownReferences?.lineItemReference.kind === 'present'
    && diagnostic.occurrence.ownReferences.lineItemReference.value === actual.lineItemReference
}
