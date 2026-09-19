import {prodatTokenFieldDiagnostic} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import { segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { parseUna } from '@/lib/ediel/core/una'
import { prodatRegisterGroups, prodatRegisterMessageSegments } from '@/lib/ediel/prodat/prodatRegisterGroups'
import { prodatSourceSubtypeRule } from '@/lib/ediel/prodat/prodatSubtypeRequirement'
import type { FieldMatrixEvaluationInput, RulebookFieldRule } from '@/lib/ediel/rulebook/fieldMatrix'
import type { EdielRulebookIssue } from '@/lib/ediel/rulebook/rulebook'

/** P26.A r3 §2.2 p21 / §2.6 p78: field319 is the first-register SG16
 * RFF/Z07 C506/1154, max25 decoded characters. 1156/4000 are not used.
 * Run before narrowing to objects, so an otherwise valid reference cannot
 * hide an additional header, party or later-register occurrence.
 */
export function validateProdatDependentReferenceScope(input: FieldMatrixEvaluationInput, rules: readonly RulebookFieldRule[]): EdielRulebookIssue[] {
  if (!rules.some(rule => rule.fieldNumber === '319' && prodatSourceSubtypeRule(input.code ?? '', '319'))) return []
  const una = input.una ?? parseUna(null)
  const message = prodatRegisterMessageSegments(input.rawSegments ?? [], una)
  const { groups, tokens } = prodatRegisterGroups(message, una, input.code)
  const permitted = new Set<number>()
  const scopes = groups.filter(group => !group.validRegisterChain || group.registerPosition === 1).map(group => group.segments)
  // Preserve genuinely detached field validation; a header without a LIN is
  // not a detached fragment and cannot supply a metering-point reference.
  if (!groups.length && !tokens.some(token => ['UNB','UNH','BGM','NAD'].includes(token.tag))) scopes.push(tokens)
  for (const scope of scopes) {
    for (const token of scope) {
      if (token.tag === 'NAD') break
      if (token.tag === 'RFF') permitted.add(token.index)
    }
  }
  return tokens.flatMap((token): EdielRulebookIssue[] => {
    if (token.tag !== 'RFF') return []
    const parts = segmentComposite(token, 1, una)
    if (parts[0]?.trim().toUpperCase() !== 'Z07') return []
    const misplaced = !permitted.has(token.index)
    const malformed = (parts[1]?.length ?? 0) > 25 || parts.slice(2).some(part => part.trim().length > 0)
    if (!misplaced && !malformed) return []
    return [{prodatDiagnostic:prodatTokenFieldDiagnostic('319',input,token,'PRODAT26A:P21/78'),scope:'prodat_dependent', severity:'error', blocking:true,
      code:misplaced ? 'PRODAT_DEPENDENT_REFERENCE_SCOPE_INVALID' : 'PRODAT_DEPENDENT_REFERENCE_FORMAT_INVALID',
      title:'Ogiltig PRODAT D-referens', fieldPath:'RFF+Z07',
      description:`Z04:319, P26.A §2.2 s.21 / §2.6 s.78: ${misplaced ? 'referensen måste ligga i första registrets SG16, före NAD' : 'C506/1154 får ha högst 25 tecken; 1156/4000 får inte anges'}.`}]
  })
}
