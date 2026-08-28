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
 * then decided only by policy.prodatDependentConditions.
 */
export function validateCanonicalPolicyFields(input: {
  policy: CanonicalEdielPolicy
  rawSegments?: readonly string[] | null
  scope?: 'all' | 'dependent_only'
}): EdielRulebookIssue[] {
  const rules = input.policy.fieldRules.map(asRulebookFieldRule)
  const matrixInput: FieldMatrixEvaluationInput = {
    family: input.policy.family,
    code: input.policy.code,
    rawSegments: input.rawSegments ?? null,
    applicationReference: input.policy.applicationReference,
    expectedApplicationReference: input.policy.applicationReference,
    // Do not let the legacy `send => dependent required` fallback execute.
    mode: 'parse',
  }

  const issues = input.scope === 'dependent_only'
    ? []
    : validateFieldMatrixPayload(matrixInput, rules)
  if (input.policy.family !== 'PRODAT') return issues

  const dependentByField = new Map(
    input.policy.prodatDependentConditions.map((condition) => [condition.fieldNumber, condition] as const),
  )

  for (const rule of rules.filter((candidate) => candidate.requirement === 'dependent')) {
    const fieldNumber = String(rule.fieldNumber ?? '').trim()
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
