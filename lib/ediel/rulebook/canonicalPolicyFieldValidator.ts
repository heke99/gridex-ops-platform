import {validateProdatDeathStatus} from './prodatDeathStatusPolicy'
import {isMeterChangeField} from '@/lib/ediel/prodat/prodatMeterChangeFacts'
import {validateProdatMeterChange} from './prodatMeterChangePolicy'
import {isReportingPermissionField,type ExpectedContext} from '@/lib/ediel/prodat/prodatReportingPermissionContext'
import {validateProdatReportingPermission} from './prodatReportingPermissionPolicy'
import {isProdatDateEventField} from '@/lib/ediel/prodat/prodatDateEvents'
import {validateProdatDateEvents} from './prodatDateEventPolicy'
import {validateProdatInvoicee} from './prodatInvoiceePolicy'
import {INVOICEE_FIELDS} from '@/lib/ediel/prodat/prodatInvoicee'
import {validateProdatEndUserAddress} from './prodatEndUserAddressPolicy'
import {END_USER_ADDRESS_CODES} from '@/lib/ediel/prodat/prodatEndUserAddress'
import { isZ14DependentField } from '@/lib/ediel/rulebook/prodatZ14Policy'
import { isSourceBoundOptionalInstallationField, validateProdatOptionalInstallationPolicy } from '@/lib/ediel/rulebook/prodatOptionalInstallationPolicy'
import { isSourceBoundEndUserField, isProdatFieldInInapplicableParent } from '@/lib/ediel/prodat/prodatParentApplicability'
import { prodatSourceSubtypeRule } from '@/lib/ediel/prodat/prodatSubtypeRequirement'
import { validateProdatSubtypePolicy } from '@/lib/ediel/rulebook/prodatSubtypePolicy'
import { prodatRegisterFieldScope } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { validateProdatRegisterPolicy } from '@/lib/ediel/rulebook/prodatRegisterPolicy'
import type { EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import type { CanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {
  fieldRulePresent,
  validateFieldMatrixPayload,
  type FieldMatrixEvaluationInput,
  type RulebookFieldRule,
} from '@/lib/ediel/rulebook/fieldMatrix'
import type { EdielRulebookIssue } from '@/lib/ediel/rulebook/rulebook'

function asRulebookFieldRule(value: unknown): RulebookFieldRule {
  return value as RulebookFieldRule
}

/**
 * Field validation consumes a previously resolved canonical policy snapshot.
 * The legacy field-matrix dependency fallback is deliberately disabled by
 * running the structural/base validation in parse mode; PRODAT D cardinality is
 * then decided by source-bound wire rules for migrated cells and the existing
 * policy conditions for cells not yet migrated. Register overlays stay separate.
 */
export function validateCanonicalPolicyFields(input: {
  reportingContext?: ExpectedContext
  policy: CanonicalEdielPolicy
  rawSegments?: readonly string[] | null
  scope?: 'all' | 'dependent_only'
  una?: EdifactServiceStringAdvice
}): EdielRulebookIssue[] {
  const rules = input.policy.fieldRules.map(asRulebookFieldRule).flatMap((rule): RulebookFieldRule[] => {
    if (input.policy.code === 'Z14' && input.policy.direction === 'outbound' && isZ14DependentField(rule.fieldNumber ?? '')) return [rule]
    // The new UD parent is selected per wire object below, never from a root snapshot.
    if (['Z06', 'Z09'].includes(input.policy.code) && (rule.fieldNumber === '229' || isSourceBoundEndUserField(input.policy.code, rule.fieldNumber ?? ''))) return [rule]
    if (input.policy.family !== 'PRODAT' || !isProdatFieldInInapplicableParent({
      messageCode: input.policy.code, subtype: input.policy.subtype, fieldNumber: rule.fieldNumber,
    })) return [rule]
    // Inbound extra information is ignored (§2.2); outbound must not carry it.
    return input.policy.direction === 'outbound' ? [{ ...rule, requirement: 'forbidden' }] : []
  })
  const matrixInput: FieldMatrixEvaluationInput = {
    una: input.una,
    family: input.policy.family,
    code: input.policy.code,
    rawSegments: input.rawSegments ?? null,
    applicationReference: input.policy.applicationReference,
    expectedApplicationReference: input.policy.applicationReference,
    // Do not let the legacy `send => dependent required` fallback execute.
    mode: 'parse',
  }

  const baseRules = input.policy.family === 'PRODAT' ? rules.filter(rule => {
    const field = rule.fieldNumber ?? ''
    if(field==='310'&&['Z05','Z06','Z09'].includes(input.policy.code))return false
    if(isMeterChangeField(input.policy.code,field))return false
    if(isReportingPermissionField(input.policy.code,field)||isProdatDateEventField(input.policy.code,field))return false
    if ((input.policy.code === 'Z14' && isZ14DependentField(field)) || isSourceBoundEndUserField(input.policy.code, field)) {
      return input.policy.direction === 'inbound'
    }
    return !prodatSourceSubtypeRule(input.policy.code, field)
  }) : rules
  const issues = input.scope === 'dependent_only'
    ? input.policy.family === 'PRODAT'
      ? validateFieldMatrixPayload(matrixInput, baseRules.filter(rule => prodatRegisterFieldScope(rule.fieldNumber ?? '') === 'local'))
      : []
    : validateFieldMatrixPayload(matrixInput, baseRules)
  if (input.policy.family !== 'PRODAT') return issues
  issues.push(...validateProdatSubtypePolicy(matrixInput, input.policy.direction === 'inbound'
    ? rules.filter(rule => !isReportingPermissionField(input.policy.code,rule.fieldNumber??'') && !isProdatDateEventField(input.policy.code,rule.fieldNumber??'') && !(input.policy.code === 'Z14' && (isZ14DependentField(rule.fieldNumber ?? '') || ['321','323'].includes(rule.fieldNumber ?? ''))) && !isSourceBoundEndUserField(input.policy.code, rule.fieldNumber ?? '')) : rules.filter(rule=>!isReportingPermissionField(input.policy.code,rule.fieldNumber??'') && !isProdatDateEventField(input.policy.code,rule.fieldNumber??''))))
  if (input.policy.direction === 'outbound') issues.push(...validateProdatOptionalInstallationPolicy(matrixInput, rules))
  const register = validateProdatRegisterPolicy({
    code:input.policy.code,
    rawSegments:input.rawSegments ?? [],
    una:input.una,
    facts:input.policy.prodatDependentFacts,
    rules,
    requireIndependentInventory:input.policy.direction === 'outbound',
    applicationReference:input.policy.applicationReference,
  })
  issues.push(...register.issues)
  if(input.policy.direction==='outbound' && rules.some(rule=>rule.fieldNumber==='229')) issues.push(...validateProdatEndUserAddress({code:input.policy.code,rawSegments:input.rawSegments??[],una:input.una,facts:input.policy.prodatDependentFacts}))

  if(rules.some(rule=>INVOICEE_FIELDS.includes(rule.fieldNumber??''))) issues.push(...validateProdatInvoicee({code:input.policy.code,rawSegments:input.rawSegments??[],una:input.una,facts:input.policy.prodatDependentFacts,direction:input.policy.direction as 'inbound'|'outbound'}))

  if(rules.some(rule=>isProdatDateEventField(input.policy.code,rule.fieldNumber??'')))issues.push(...validateProdatDateEvents({code:input.policy.code,rawSegments:input.rawSegments??[],una:input.una,facts:input.policy.prodatDependentFacts,direction:input.policy.direction as 'inbound'|'outbound'}))

  if(rules.some(rule=>isReportingPermissionField(input.policy.code,rule.fieldNumber??'')))issues.push(...validateProdatReportingPermission({code:input.policy.code,rawSegments:input.rawSegments??[],una:input.una,facts:input.policy.prodatDependentFacts,direction:input.policy.direction as 'inbound'|'outbound',reportingContext:input.reportingContext}))

  if(rules.some(rule=>isMeterChangeField(input.policy.code,rule.fieldNumber??'')))issues.push(...validateProdatMeterChange({code:input.policy.code,rawSegments:input.rawSegments??[],una:input.una,facts:input.policy.prodatDependentFacts,direction:input.policy.direction as 'inbound'|'outbound',applicationReference:input.policy.applicationReference}))

  if(rules.some(rule=>rule.fieldNumber==='310'))issues.push(...validateProdatDeathStatus({code:input.policy.code,rawSegments:input.rawSegments??[],una:input.una,facts:input.policy.prodatDependentFacts,direction:input.policy.direction as 'inbound'|'outbound'}))

  const dependentByField = new Map(
    input.policy.prodatDependentConditions.map((condition) => [condition.fieldNumber, condition] as const),
  )

  for (const rule of rules.filter((candidate) => candidate.requirement === 'dependent')) {
    const fieldNumber = String(rule.fieldNumber ?? '').trim()
    if(fieldNumber==='310')continue
    if(isMeterChangeField(input.policy.code,fieldNumber))continue
    if(isReportingPermissionField(input.policy.code,fieldNumber)||isProdatDateEventField(input.policy.code,fieldNumber))continue
    if(INVOICEE_FIELDS.includes(fieldNumber)) continue
    if(fieldNumber==='229' && END_USER_ADDRESS_CODES.includes(input.policy.code)) continue
    if (input.policy.code === 'Z14' && input.policy.direction === 'outbound' && isZ14DependentField(fieldNumber)) continue
    if (register.handledFields.has(fieldNumber) || prodatSourceSubtypeRule(input.policy.code, fieldNumber)
      || isSourceBoundEndUserField(input.policy.code, fieldNumber)
      || isSourceBoundOptionalInstallationField(input.policy.code, fieldNumber)) continue
    const condition = dependentByField.get(fieldNumber)

    if (!condition) {
      issues.push({
        severity: 'error',
        blocking: true,
        code: 'PRODAT_DEPENDENT_CONDITION_MISSING',
        title: 'PRODAT D-villkor saknas',
        description: `Fält ${fieldNumber || rule.fieldKey} är D i den canonicala matrisen men saknar exekverbart villkor.`,
        fieldPath: rule.segmentPath,
      })
      continue
    }

    if (condition.status === 'undetermined') {
      issues.push({
        severity: 'error',
        blocking: true,
        code: 'PRODAT_DEPENDENT_CONDITION_UNDETERMINED',
        title: 'PRODAT D-villkor kan inte avgöras',
        description: `${condition.id} kan inte avgöras från källstyrda fakta; produktion ska blockeras i stället för att gissa.`,
        fieldPath: rule.segmentPath,
      })
      continue
    }

    if (condition.status === 'required' && !fieldRulePresent(rule, matrixInput)) {
      issues.push({
        severity: 'error',
        blocking: true,
        code: rule.errorCodeIfMissing ?? 'PRODAT_DEPENDENT_FIELD_MISSING',
        title: 'Obligatoriskt PRODAT-fält saknas',
        description: `${condition.id} är required enligt ${condition.source.document}: ${condition.source.note}`,
        fieldPath: rule.segmentPath,
      })
    }
  }

  return issues
}
