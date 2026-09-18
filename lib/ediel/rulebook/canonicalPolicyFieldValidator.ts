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
import { isProdatFieldInInapplicableParent } from '@/lib/ediel/prodat/prodatParentApplicability'

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
  policy: CanonicalEdielPolicy
  rawSegments?: readonly string[] | null
  scope?: 'all' | 'dependent_only'
  una?: EdifactServiceStringAdvice
}): EdielRulebookIssue[] {
  const rules = input.policy.fieldRules.map(asRulebookFieldRule).flatMap((rule): RulebookFieldRule[] => {
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

  const baseRules = input.policy.family === 'PRODAT'
    ? rules.filter(rule => !prodatSourceSubtypeRule(input.policy.code, rule.fieldNumber ?? '')) : rules
  const issues = input.scope === 'dependent_only'
    ? input.policy.family === 'PRODAT'
      ? validateFieldMatrixPayload(matrixInput, baseRules.filter(rule => prodatRegisterFieldScope(rule.fieldNumber ?? '') === 'local'))
      : []
    : validateFieldMatrixPayload(matrixInput, baseRules)
  if (input.policy.family !== 'PRODAT') return issues
  issues.push(...validateProdatSubtypePolicy(matrixInput, rules))
  const register = validateProdatRegisterPolicy({code:input.policy.code, rawSegments:input.rawSegments ?? [], una:input.una, facts:input.policy.prodatDependentFacts, rules})
  issues.push(...register.issues)

  const dependentByField = new Map(
    input.policy.prodatDependentConditions.map((condition) => [condition.fieldNumber, condition] as const),
  )

  for (const rule of rules.filter((candidate) => candidate.requirement === 'dependent')) {
    const fieldNumber = String(rule.fieldNumber ?? '').trim()
    if (register.handledFields.has(fieldNumber) || prodatSourceSubtypeRule(input.policy.code, fieldNumber)) continue
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
