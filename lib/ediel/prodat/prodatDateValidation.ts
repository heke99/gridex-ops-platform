import { canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { prodatDateField, prodatDateSyntaxIssues } from '@/lib/ediel/prodat/prodatDateFields'
import { validateFieldMatrixPayload } from '@/lib/ediel/rulebook/fieldMatrix'
import type { EdielRulebookIssue } from '@/lib/ediel/rulebook/rulebook'
import { parseUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import type { EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'

/** Structural/date-only view of the existing authority: R fields per scope,
 * forbidden fields (including per-object subtype exclusions in the matrix),
 * strict C507 formats and calendars. D business requirements
 * are deliberately still evaluated by the canonical dependent-condition engine. */
export function validateProdatDateFields(code: string, segments: readonly (string | Pick<EdifactTokenizedSegment, 'raw' | 'tag'>)[], una: EdifactServiceStringAdvice = parseUna(null)): EdielRulebookIssue[] {
  const rawSegments = segments.map(row => typeof row === 'string' ? row : row.raw)
  const rules = canonicalProdat26AFieldRules(code).filter(rule => prodatDateField(rule.fieldNumber ?? rule.fieldKey))
  const issues = validateFieldMatrixPayload({ family: 'PRODAT', code, rawSegments, una, mode: 'parse' }, rules)
  for (const failure of prodatDateSyntaxIssues(segments, una)) {
    const field = prodatDateField(failure.fieldNumber)
    if (issues.some(issue => issue.fieldPath === field?.segmentPath)) continue
    issues.push({ severity: 'error', blocking: true, code: 'FIELD_MATRIX_FIELD_FORMAT_INVALID',
      title: 'Ogiltigt PRODAT-datumfält', description: `Fält ${failure.fieldNumber} följer inte P26.A s.43,49–52 (format, kalender, tidszon, placering eller entydighet).`, fieldPath: field?.segmentPath })
  }
  return issues
}
