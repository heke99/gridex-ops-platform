import { compileRuleProfile } from '@/lib/ediel/rulebook/compileRuleProfile'

export type FieldMatrixActivationEvaluationInput = {
  profileKey: string
  version: string
  sourceDocument?: string | null
  sourceVersion?: string | null
  validFrom?: string | null
  validTo?: string | null
  rows: Array<{ ruleType: string; segment: string; qualifier?: string | null; rulePayload?: Record<string, unknown> }>
}

export function evaluateFieldMatrixForActivation(input: FieldMatrixActivationEvaluationInput) {
  const result = compileRuleProfile({
    profileKey: input.profileKey,
    version: input.version,
    sourceDocument: input.sourceDocument,
    sourceVersion: input.sourceVersion,
    validFrom: input.validFrom,
    validTo: input.validTo,
    fieldRules: input.rows,
  })

  return {
    canActivate: result.ok,
    conflicts: result.conflicts,
    warnings: result.warnings,
    compiled: result.compiled,
  }
}
