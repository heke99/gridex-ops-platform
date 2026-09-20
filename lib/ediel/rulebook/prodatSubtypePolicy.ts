import {prodatFieldDiagnostic} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import { validateProdatZ14Policy, z14DependentRules } from '@/lib/ediel/rulebook/prodatZ14Policy'
import { validateProdatEndUserPolicy } from '@/lib/ediel/rulebook/prodatEndUserPolicy'
import { validateProdatOptionalInstallationPolicy } from '@/lib/ediel/rulebook/prodatOptionalInstallationPolicy'
import { isSourceBoundEndUserField } from '@/lib/ediel/prodat/prodatParentApplicability'
import { prodatProductMarket, validateProdatProductScope } from '@/lib/ediel/rulebook/prodatProductScope'
import { validateProdatDependentReferenceScope } from '@/lib/ediel/rulebook/prodatDependentReferenceScope'
import { prodatDateSyntaxIssues } from '@/lib/ediel/prodat/prodatDateFields'
import { canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { prodatDocumentValue } from '@/lib/ediel/prodat/prodatDocumentFields'
import { segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { parseUna } from '@/lib/ediel/core/una'
import { prodatCharacteristicPresent, prodatCharacteristicValues } from '@/lib/ediel/prodat/prodatCharacteristicFields'
import { prodatRegisterRuleScopes, prodatRegisterGroups, prodatRegisterMessageSegments } from '@/lib/ediel/prodat/prodatRegisterGroups'
import { prodatSourceSubtypeRule, resolveProdatSourceSubtypeRequirement } from '@/lib/ediel/prodat/prodatSubtypeRequirement'
import { findProdatSubtypeRule } from '@/lib/ediel/rulebook/prodatSubtypeRegistry'
import { validateFieldMatrixPayload, type FieldMatrixEvaluationInput, type RulebookFieldRule } from '@/lib/ediel/rulebook/fieldMatrix'
import type { EdielRulebookIssue } from '@/lib/ediel/rulebook/rulebook'

/** Recompute migrated subtype-dependent D cells from each actual first-register
 * scope. A root snapshot, another object, or a later register is not authority.
 * The matrix owns field descriptors; bounded source overlays retain domain and scope restrictions.
 */
export function validateProdatSubtypePolicy(input: FieldMatrixEvaluationInput, rules: readonly RulebookFieldRule[], direction?: string): EdielRulebookIssue[] {
  const code = input.code ?? ''
  if (code === 'Z14') return validateProdatZ14Policy(input, rules)
  const una = input.una ?? parseUna(null)
  const issues: EdielRulebookIssue[] = [...validateProdatDependentReferenceScope(input, rules), ...validateProdatProductScope(input, rules, direction), ...validateProdatEndUserPolicy(input, rules)]
  // Local scoping must not hide a supplied DTM in the message header. Keep
  // the shared global placement check before narrowing to individual objects.
  for (const failure of prodatDateSyntaxIssues(input.rawSegments ?? [], una)) {
    const rule = rules.find(rule => rule.fieldNumber === failure.fieldNumber && prodatSourceSubtypeRule(code, failure.fieldNumber))
    if (failure.kind !== 'scope' || !rule) continue
    issues.push({prodatDiagnostic:prodatFieldDiagnostic(rule.fieldNumber,'invalid',input,[],'PRODAT26A:P49–52',undefined,'header'),scope:'prodat_dependent', severity:'error', blocking:true,
      code:rule.errorCodeIfInvalid ?? 'FIELD_MATRIX_FIELD_FORMAT_INVALID', title:'PRODAT D-datum ligger i fel segmentgrupp',
      description:`Fält ${failure.fieldNumber}: DTM måste tillhöra sitt LIN-objekt, inte meddelandehuvudet (P26.A s.49–52).`, fieldPath:rule.segmentPath})
  }
  for (const rule of rules) {
    const sourceRule = prodatSourceSubtypeRule(code, rule.fieldNumber ?? '')
    if (!sourceRule || isSourceBoundEndUserField(code, sourceRule.fieldNumber)) continue
    for (const segments of prodatRegisterRuleScopes(sourceRule.fieldNumber, input.rawSegments ?? [], una, code) ?? []) {
      const reasonSegments = segments.filter(segment => segment.tag === 'CCI' && segmentComposite(segment, 2, una)[0] === 'Z13')
      const reasons = prodatCharacteristicValues('223', segments, una)
      const parentStart = segments.findIndex(segment => ['RFF','NAD'].includes(segment.tag))
      const reasonInScope = !sourceRule.market || parentStart < 0 || (reasonSegments[0] && segments.indexOf(reasonSegments[0]) < parentStart)
      const reason = reasonInScope && reasons.length === 1 && reasonSegments.length === 1 ? reasons[0] : null
      const known = reason ? findProdatSubtypeRule(reason, code) : null
      // Runtime compatibility aliases and a duplicate/dangling CCI are not a
      // valid transaction reason on the wire, even if a snapshot supplies F.
      const subtype = known?.transactionReasonCode === reason ? known.subtype : null
      const requirement = resolveProdatSourceSubtypeRequirement({messageCode:code, fieldNumber:sourceRule.fieldNumber, subtype, market:sourceRule.market ? prodatProductMarket(input) : undefined})
      const lin = segments.find(segment => segment.tag === 'LIN')
      const identity = lin ? segmentComposite(lin, 3, una) : []
      const context = `Objekt ${identity[0] || '(saknar identitet)'} / ${identity[3] || '(saknar kod)'}; ${code}:${sourceRule.fieldNumber}, P26.A §2.2 s.${sourceRule.page}`
      if (requirement === 'undetermined' || requirement === null) {
        issues.push({prodatDiagnostic:prodatFieldDiagnostic(subtype ? '311' : '223',!subtype && reasonSegments.length === 0 ? 'missing' : 'invalid',input,segments.map(s=>s.raw),'PRODAT26A:P16/122'),scope:'prodat_dependent', severity:'error', blocking:true, code:'PRODAT_DEPENDENT_CONDITION_UNDETERMINED',
          title:'PRODAT D-villkor kan inte avgöras', description:`${context}: exakt en giltig transaktionsorsak i objektets fält 223 krävs${sourceRule.market ? '; EL-marknad måste styrkas av rätt Application Reference i meddelandets UNB' : ''}.`, fieldPath:rule.segmentPath})
        continue
      }
      // Optional CCI/CAV values must still satisfy their ordinary code list
      // when supplied, including an empty/dangling pair. This does not make an
      // absent optional field required or infer its D condition from presence.
      const suppliedCharacteristic = prodatCharacteristicPresent(sourceRule.fieldNumber, segments, {una, forbidden:true})
      const effectiveRule: RulebookFieldRule = {...rule, requirement:requirement === 'optional' && suppliedCharacteristic ? 'required' : requirement}
      const failures = validateFieldMatrixPayload({...input, rawSegments:segments.map(segment => segment.raw), mode:'parse'}, [effectiveRule])
      const originalGroup = prodatRegisterGroups(prodatRegisterMessageSegments(input.rawSegments ?? [],una),una,code).groups
        .find(group => group.segments[0]?.index === lin?.index)
      issues.push(...failures.map(failure => ({...failure,
        ...(failure.prodatDiagnostic?.kind === 'field' ? {prodatDiagnostic:prodatFieldDiagnostic(
          failure.prodatDiagnostic.fieldNumber,
          requirement === 'optional' && suppliedCharacteristic ? 'invalid' : failure.prodatDiagnostic.errorKind,
          input, segments.map(segment => segment.raw), failure.prodatDiagnostic.sourceRule, originalGroup?.lineIndex,
        )} : {}), scope:'prodat_dependent' as const, description:`${context}: ${failure.description}`})))
    }
  }
  return issues
}

/** Send-boundary adapter: select the migrated cells from the actual BGM, not
 * caller metadata. Detached builder fragments may use their explicit code.
 */
export function validateProdatSubtypePayload(input: FieldMatrixEvaluationInput): EdielRulebookIssue[] {
  const code = prodatDocumentValue('202', input.rawSegments ?? [], input.una)?.trim().toUpperCase() ?? input.code ?? ''
  if (code === 'Z14') return validateProdatZ14Policy({...input, code}, z14DependentRules())
  const rules = canonicalProdat26AFieldRules(code).filter(rule => prodatSourceSubtypeRule(code, rule.fieldNumber ?? ''))
  return [
    ...validateProdatOptionalInstallationPolicy({...input, code}),
    ...validateProdatSubtypePolicy({...input, code}, rules),
  ]
}
