import { validateFieldMatrixPayload, type FieldMatrixEvaluationInput } from '@/lib/ediel/rulebook/fieldMatrix'
import { canonicalProdat26AFieldRules } from './prodat26AFieldMatrix'
import { isQualifiedProdatApplicationError, projectProdatDiagnostics } from './prodatDiagnosticProjection'

/**
 * ENV-06 (P26.A §2.1, §2.6, field 223 p.122): CCI Z13/CAV carries the exact
 * three-character reason code allowed for the BGM function. When policy
 * selection failed because that wire code is unknown, belongs to another
 * function or is absent, the defect is the sender's own field content and is
 * qualified as ERC41/42 on field 223. Other policy failures, including the
 * bilateral-capability gate, are local evidence and are never matched here.
 */
export function prodatWireReasonCodeRejection(input: {
  failure: string
  code: string | null | undefined
  rawSegments: readonly string[]
  una?: FieldMatrixEvaluationInput['una']
}) {
  if (!/^prodat_subtype_(?:unknown|not_allowed):/.test(input.failure)) return null
  const rules = canonicalProdat26AFieldRules(input.code).filter(rule => rule.fieldNumber === '223')
  if (!rules.length) return null
  const issues = validateFieldMatrixPayload({ family: 'PRODAT', code: input.code, rawSegments: input.rawSegments,
    una: input.una, direction: 'inbound', mode: 'parse' }, rules)
  const projected = issues.length ? projectProdatDiagnostics(issues) : null
  const qualified = Boolean(projected?.applicationErrors.length
    && projected.applicationErrors.every(error => error.fieldCode === '223' && isQualifiedProdatApplicationError(error)))
  return qualified && projected
    ? { sourceRule: `PRODAT26A:§2.2:${String(input.code).trim().toUpperCase()}:223`, issues, applicationErrors: projected.applicationErrors }
    : null
}
