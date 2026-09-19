import { segmentComposite, segmentElementCount, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import { parseUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import { prodatCharacteristicValues } from '@/lib/ediel/prodat/prodatCharacteristicFields'
import { prodatRegisterTokens } from '@/lib/ediel/prodat/prodatRegisterFields'
import { prodatRegisterGroups, prodatRegisterMessageSegments } from '@/lib/ediel/prodat/prodatRegisterGroups'
import type { FieldMatrixEvaluationInput, RulebookFieldRule } from '@/lib/ediel/rulebook/fieldMatrix'
import type { EdielRulebookIssue } from '@/lib/ediel/rulebook/rulebook'

/** Frozen P26.A r3 p69 table, not a prefix matcher or mutable registry. */
export {PRODAT_EL_AGGREGATION_PRODUCTS} from '@/lib/ediel/prodat/prodatMeterChangeFacts'
import {PRODAT_EL_AGGREGATION_PRODUCTS} from '@/lib/ediel/prodat/prodatMeterChangeFacts'

/** Field311 P16 defines both electricity references. Market evidence does not
 * authorize a process: the unchanged canonical policy separately binds Z06 to DDQ.
 */
const PRODAT_ELECTRICITY_REFERENCES: readonly string[] = Object.freeze(['23-DDQ-PRODAT', '23-DGI-PRODAT'])

/** Field311 (P p16): the actual first interchange supplies the market.
 * Full messages cannot borrow a cached EL label when UNB is missing/invalid.
 * Only genuinely detached field fragments may use an explicit application ref.
 */
export function prodatProductMarket(input: FieldMatrixEvaluationInput): 'electricity' | null {
  const una = input.una ?? parseUna(null)
  const tokens = prodatRegisterTokens(input.rawSegments ?? [], una)
  const end = tokens.findIndex(token => ['UNT', 'UNZ'].includes(token.tag))
  const first = end < 0 ? tokens : tokens.slice(0, end)
  const unbs = first.filter(token => token.tag === 'UNB')
  if (!tokens.some(token => ['UNB', 'UNH', 'BGM', 'UNT', 'UNZ'].includes(token.tag))) {
    return typeof input.applicationReference === 'string' && PRODAT_ELECTRICITY_REFERENCES.includes(input.applicationReference) ? 'electricity' : null
  }
  if (unbs.length !== 1) return null
  const body = first.find(token => ['UNH', 'BGM', 'LIN'].includes(token.tag))
  if (!body || unbs[0].index >= body.index) return null
  const reference = segmentComposite(unbs[0], 7, una)
  return reference.length === 1 && PRODAT_ELECTRICITY_REFERENCES.includes(reference[0]) ? 'electricity' : null
}

function hasPopulatedTrailingElements(segment: EdifactTokenizedSegment, last: number, una: EdifactServiceStringAdvice): boolean {
  for (let element = last + 1; element <= segmentElementCount(segment, una); element += 1) {
    if (segmentComposite(segment, element, una).some(part => part.trim())) return true
  }
  return false
}

/** P p69 gives valid measuring/settlement combinations for each product.
 * Validate supplied context in this first register only. This does not make
 * absent optional G/E context mandatory or borrow it from a different object.
 */
function compatibleContext(
  scope: EdifactTokenizedSegment[],
  product: string,
  una: EdifactServiceStringAdvice,
): boolean {
  const parent = scope.findIndex(token => ['RFF', 'NAD'].includes(token.tag))
  const common = parent < 0 ? scope : scope.slice(0, parent)
  const fields = [
    {field: '217', qualifier: 'Z04', allowed: product === 'L917' ? ['Z01', 'Z04'] : ['Z04']},
    {field: '254', qualifier: 'Z15', allowed: product === 'L917' ? ['Z31'] : ['Z32']},
  ]
  return fields.every(({field, qualifier, allowed}) => {
    const supplied = scope.filter(token => token.tag === 'CCI' && segmentComposite(token, 2, una)[0]?.trim().toUpperCase() === qualifier)
    if (!supplied.length) return true
    const values = prodatCharacteristicValues(field, common, una)
    return supplied.length === 1 && values.length === 1 && allowed.includes(values[0])
  })
}

/** Inspect all supplied Z06 product pairs BEFORE first-register narrowing.
 * P p68: field242 is first7110, field506 is second7110 (not used in Z06).
 * SG14 precedes RFF/party groups; other objects/registers cannot supply it.
 */
export function validateProdatProductScope(
  input: FieldMatrixEvaluationInput,
  rules: readonly RulebookFieldRule[],
): EdielRulebookIssue[] {
  if (input.code !== 'Z06' || !rules.some(rule => rule.fieldNumber === '242')) return []
  const una = input.una ?? parseUna(null)
  const {groups, tokens} = prodatRegisterGroups(prodatRegisterMessageSegments(input.rawSegments ?? [], una), una, input.code)
  const scopes = groups.filter(group => !group.validRegisterChain || group.registerPosition === 1).map(group => group.segments)
  if (!groups.length && !tokens.some(token => ['UNB', 'UNH', 'BGM', 'NAD', 'RFF'].includes(token.tag))) scopes.push(tokens)
  const permitted = new Map<number, EdifactTokenizedSegment[]>()
  const duplicates = new Set<number>()
  for (const scope of scopes) {
    const pairs: number[] = []
    for (const token of scope) {
      if (['NAD', 'RFF'].includes(token.tag)) break
      if (token.tag === 'CCI' && segmentComposite(token, 2, una)[0]?.trim().toUpperCase() === 'Z14') pairs.push(token.index)
    }
    for (const index of pairs) {
      permitted.set(index, scope)
      if (pairs.length > 1) duplicates.add(index)
    }
  }
  return tokens.flatMap((token, index): EdielRulebookIssue[] => {
    const descriptor = segmentComposite(token, 2, una)
    if (token.tag !== 'CCI' || descriptor[0]?.trim().toUpperCase() !== 'Z14') return []
    const cav = tokens[index + 1]
    const parts = cav?.tag === 'CAV' ? segmentComposite(cav, 1, una) : []
    const value = parts[3]?.trim().toUpperCase() ?? ''
    const scope = permitted.get(token.index)
    const misplaced = !scope
    const malformed = duplicates.has(token.index) || !(PRODAT_EL_AGGREGATION_PRODUCTS as readonly string[]).includes(value)
      || segmentComposite(token, 1, una).some(part => part.trim()) || descriptor.slice(1).some(part => part.trim())
      || hasPopulatedTrailingElements(token, 2, una)
      || (cav && hasPopulatedTrailingElements(cav, 1, una))
      || tokens[index + 2]?.tag === 'CAV'
      || (parts[3]?.length ?? 0) > 35 || Boolean(parts[0]?.trim() || parts[1]?.trim())
      || (parts[2]?.length ?? 0) > 3 || parts.slice(4).some(part => part.trim())
    const incompatible = scope && !compatibleContext(scope, value, una)
    if (!misplaced && !malformed && !incompatible) return []
    const detail = misplaced
      ? 'produktparet måste ligga i första registrets SG14 före RFF/NAD'
      : incompatible
        ? 'produktkoden måste stämma med objektets egna angivna mät- och avräkningsmetoder enligt produkttabellen'
        : 'exakt en giltig EL-produkt krävs i första 7110; gas/energi-id, tomma eller dubbla par och oanvända komponenter får inte ersätta produktkoden'
    return [{
      scope: 'prodat_dependent', severity: 'error', blocking: true, fieldPath: 'CCI++Z14/CAV',
      code: misplaced ? 'PRODAT_DEPENDENT_PRODUCT_SCOPE_INVALID' : 'PRODAT_DEPENDENT_PRODUCT_INVALID',
      title: 'Ogiltig PRODAT-produktkod',
      description: `Z06:242, P26.A s.20,68–69: ${detail}.`,
    }]
  })
}
