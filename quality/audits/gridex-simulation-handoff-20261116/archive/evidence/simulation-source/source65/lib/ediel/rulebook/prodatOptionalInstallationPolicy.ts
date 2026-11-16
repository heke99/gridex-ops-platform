import { segmentComposite, segmentElementCount, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import { parseUna } from '@/lib/ediel/core/una'
import { canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { prodatPartySyntaxIssues } from '@/lib/ediel/prodat/prodatPartyFields'
import { prodatRegisterGroups, prodatRegisterMessageSegments } from '@/lib/ediel/prodat/prodatRegisterGroups'
import { validateFieldMatrixPayload, type FieldMatrixEvaluationInput, type RulebookFieldRule } from '@/lib/ediel/rulebook/fieldMatrix'
import type { EdielRulebookIssue } from '@/lib/ediel/rulebook/rulebook'

const OPTIONAL_INSTALLATION_CODES = new Set(['Z01', 'Z03', 'Z08'])
const OPTIONAL_INSTALLATION_CHILDREN = new Set(['233', '234'])

export function isSourceBoundOptionalInstallationField(messageCode: string, fieldNumber: string): boolean {
  return OPTIONAL_INSTALLATION_CODES.has(messageCode) && OPTIONAL_INSTALLATION_CHILDREN.has(fieldNumber)
}

export function optionalInstallationRules(messageCode: string): RulebookFieldRule[] {
  if (!OPTIONAL_INSTALLATION_CODES.has(messageCode)) return []
  return canonicalProdat26AFieldRules(messageCode).filter(rule => OPTIONAL_INSTALLATION_CHILDREN.has(rule.fieldNumber ?? ''))
}

/** P26.A r3 p22/p81. Z01/Z03/Z08 make the IT parent an outbound choice.
 * Exact wire presence selects that parent for one object; it is not inferred
 * from address/customer facts or caller byCell flags. Once selected, both
 * children are mandatory and belong to the same first-register object. */
export function validateProdatOptionalInstallationPolicy(
  input: FieldMatrixEvaluationInput,
  rules: readonly RulebookFieldRule[] = optionalInstallationRules(input.code ?? ''),
): EdielRulebookIssue[] {
  const code = input.code ?? ''
  if (!OPTIONAL_INSTALLATION_CODES.has(code) || !rules.some(rule => OPTIONAL_INSTALLATION_CHILDREN.has(rule.fieldNumber ?? ''))) return []
  const una = input.una ?? parseUna(null)
  const tokens = prodatRegisterMessageSegments(input.rawSegments ?? [], una)
  const grouped = prodatRegisterGroups(tokens, una, code)
  const scopes = grouped.groups
    .filter(group => !group.validRegisterChain || group.registerPosition === 1)
    .map(group => group.segments)
  if (!grouped.groups.length && !tokens.some(token => ['UNB', 'UNH', 'BGM'].includes(token.tag))) scopes.push(tokens)

  const issues: EdielRulebookIssue[] = []
  const selected = (token: EdifactTokenizedSegment) => token.tag === 'NAD'
    && segmentComposite(token, 1, una)[0]?.trim().toUpperCase() === 'IT'
  const allowed = new Map<number, EdifactTokenizedSegment[]>()
  for (const scope of scopes) for (const token of scope) allowed.set(token.index, scope)
  const ruleFor = (field: string) => rules.find(rule => rule.fieldNumber === field)
  const fail = (field: string, failureCode: string, detail: string) => {
    const rule = ruleFor(field === 'INSTALLATION_GROUP' ? '233' : field)
    issues.push({
      scope: 'prodat_dependent', severity: 'error', blocking: true, code: failureCode,
      title: 'PRODAT-anläggningsgruppen följer inte källregeln', fieldPath: field === 'INSTALLATION_GROUP' ? 'NAD+IT' : rule?.segmentPath,
      description: `${code}:${field}, P26.A §2.2 s.22 / §2.6 s.81: ${detail}.`,
    })
  }
  const extra = (token: EdifactTokenizedSegment, last: number) => {
    for (let index = last + 1; index <= segmentElementCount(token, una); index++) {
      if (segmentComposite(token, index, una).some(value => value.trim())) return true
    }
    return false
  }

  // Scan every supplied IT before object narrowing so a malformed/header group
  // cannot disappear merely because another object has a valid group.
  for (const token of tokens.filter(selected)) {
    const role = segmentComposite(token, 1, una)
    if (!allowed.has(token.index)) {
      fail('INSTALLATION_GROUP', 'PRODAT_DEPENDENT_OPTIONAL_INSTALLATION_SCOPE_INVALID', 'IT måste ligga i sitt LIN-objekt, inte i meddelandehuvudet')
    }
    if (role.length !== 1 || role[0] !== 'IT' || extra(token, 9)) {
      fail('INSTALLATION_GROUP', 'PRODAT_DEPENDENT_OPTIONAL_INSTALLATION_FORMAT_INVALID', 'partkvalificeraren och NAD-komponenterna måste vara exakta')
    }
    const identity = segmentComposite(token, 2, una)
    const address = segmentComposite(token, 5, una)
    if ((identity[0]?.length ?? 0) > 25 || (identity[1]?.length ?? 0) > 3 || (identity[2]?.length ?? 0) > 3
      || address.slice(0, 3).some(value => value.length > 35) || address.slice(3).some(value => value.trim())) {
      fail('INSTALLATION_GROUP', 'PRODAT_DEPENDENT_OPTIONAL_INSTALLATION_FORMAT_INVALID', 'avkodade identitets- eller adresskomponenter överskrider källtabellens gränser')
    }
    if (prodatPartySyntaxIssues([token], una).length) {
      fail('INSTALLATION_GROUP', 'PRODAT_DEPENDENT_OPTIONAL_INSTALLATION_FORMAT_INVALID', 'vald IT innehåller tomma obligatoriska, ogiltiga eller oanvända komponenter')
    }
  }

  for (const scope of scopes) {
    const parents = scope.filter(selected)
    if (!parents.length) continue
    const lin = scope.find(token => token.tag === 'LIN')
    const objectIdentity = segmentComposite(lin, 3, una)
    const context = `Objekt ${objectIdentity[0] || '(saknar identitet)'} / ${objectIdentity[3] || '(saknar kod)'}`
    if (parents.length !== 1) {
      fail('INSTALLATION_GROUP', 'PRODAT_DEPENDENT_OPTIONAL_INSTALLATION_CARDINALITY_INVALID', `${context}: vald parent kräver exakt en IT-grupp`)
    }
    for (const rule of rules.filter(rule => OPTIONAL_INSTALLATION_CHILDREN.has(rule.fieldNumber ?? ''))) {
      const failures = validateFieldMatrixPayload(
        { ...input, rawSegments: scope.map(token => token.raw), mode: 'parse' },
        [{ ...rule, requirement: 'required' }],
      )
      issues.push(...failures.map(failure => ({
        ...failure,
        scope: 'prodat_dependent' as const,
        description: `${context}; ${code}:${rule.fieldNumber}, P26.A §2.2 s.22 / §2.6 s.81: ${failure.description}`,
      })))
    }
    const parent = parents[0]
    if (!parent) continue
    const partyIdentity = segmentComposite(parent, 2, una)
    if (!objectIdentity[0] || partyIdentity[0] !== objectIdentity[0]) {
      fail('233', 'PRODAT_DEPENDENT_OPTIONAL_INSTALLATION_ID_INVALID', `${context}: fält233 måste vara samma faktiska identitet som fält209`)
    }
    if (!['9', '89'].includes(objectIdentity[3] ?? '') || partyIdentity[2] !== objectIdentity[3]) {
      fail('233', 'PRODAT_DEPENDENT_OPTIONAL_INSTALLATION_AGENCY_INVALID', `${context}: fält233 måste använda samma giltiga 9/89-agency som fält209`)
    }
  }
  return issues
}
