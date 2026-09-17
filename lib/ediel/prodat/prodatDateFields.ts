import { canonicalProdatSubtypeAlias } from '@/lib/ediel/rulebook/prodatSubtypeRegistry'
import { segmentComposite, segmentElementCount, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import { parseUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import { PRODAT_26A_FIELD_MATRIX } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { isProdatCalendarDate, isProdatCalendarMinute, prodatDate102, prodatDate203 } from '@/lib/ediel/prodat/render/dates'

type Segment = string | Pick<EdifactTokenizedSegment, 'raw' | 'tag'>
export type ProdatDateState = { value: string | null; format: string | null; present: boolean; malformed: boolean; raw: string | null }

/** The existing canonical matrix owns the twelve P26.A r3 DTM identities. */
export function prodatDateField(field: string) {
  return PRODAT_26A_FIELD_MATRIX.find(row => row.dateQualifier && (row.fieldNumber === field || row.fieldKey === field)) ?? null
}


/** Source-defined subtype exclusions shared by rendering and validation.
 * P26.A §2.2 fields 210/211/216/302/321/326/508. This only forbids inapplicable
 * fields; it does not infer missing national D-condition facts. */
export function prodatDateExcludedBySubtype(code: string, variant: string | null | undefined, field: string): boolean {
  const subtype = canonicalProdatSubtypeAlias(variant, code)
  if (code === 'Z14' && subtype === 'N') return ['302', '321', '326', '508'].includes(field)
  if (code === 'Z09') return subtype === 'D' ? field === '216' : ['210', '211'].includes(field)
  return false
}

/** First-message boundary only; detached field/line fragments remain supported. */
function messageSegments(segments: readonly Segment[], una: EdifactServiceStringAdvice): EdifactTokenizedSegment[] {
  const rows = segments.map((segment, index) => {
    const raw = typeof segment === 'string' ? segment : segment.raw
    return { index, raw, tag: typeof segment === 'string' ? raw.split(una.dataElementSeparator)[0].trim().toUpperCase() : segment.tag, elements: [] }
  })
  const start = rows.findIndex(row => row.tag === 'UNH')
  if (start >= 0 && segmentComposite(rows[start], 2, una)[0]?.toUpperCase() !== 'PRODAT') return []
  const selected = rows.slice(Math.max(0, start))
  const end = selected.findIndex((row, index) => ['UNT', 'UNZ'].includes(row.tag) || (index > 0 && row.tag === 'UNH'))
  return end < 0 ? selected : selected.slice(0, end)
}

/** Header fields never borrow from objects, nor one object's dates from another.
 * Callers of scalar readers choose the first scope; rule evaluators visit each. */
export function prodatDateRuleScopes(field: string, segments: readonly Segment[], una = parseUna(null)): EdifactTokenizedSegment[][] {
  const descriptor = prodatDateField(field)
  const rows = messageSegments(segments, una)
  const starts = rows.flatMap((row, index) => row.tag === 'LIN' ? [index] : [])
  if (descriptor?.dateScope === 'header') return [starts.length ? rows.slice(0, starts[0]) : rows]
  if (!starts.length) return [rows.some(row => ['UNH','BGM','UNB'].includes(row.tag)) ? [] : rows]
  return starts.map((start, index) => rows.slice(start, starts[index + 1]))
}

/** Format and value validation; period units remain periods, never dates.
 * Market/bilateral permission for optional resolutions is a separate policy. */
export function validProdatDateValue(field: string, value: string, format: string): boolean {
  const kind = prodatDateField(field)?.dateKind
  if (kind === 'minute') return format === '203' && isProdatCalendarMinute(value)
  if (kind === 'date') return format === '102' && isProdatCalendarDate(value)
  if (kind === 'offset') return format === '805' && value === '1'
  return kind === 'period' && ['801','802','804','806'].includes(format) && /^[1-9]\d{0,34}$/.test(value)
}

/** Read exact C507/2380+2379 once. Duplicates, empty/extra components and bad
 * calendars are evidence of an invalid supplied field, not fallback values. */
export function prodatDateState(field: string, segments: readonly Segment[], una = parseUna(null)): ProdatDateState {
  const descriptor = prodatDateField(field)
  const rows = prodatDateRuleScopes(field, segments, una)[0] ?? []
  const matches = rows.filter(row => row.tag === 'DTM' && segmentComposite(row, 1, una)[0] === descriptor?.dateQualifier)
  const row = matches[0]
  if (!row || !descriptor) return { value: null, format: null, present: false, malformed: false, raw: null }
  const parts = segmentComposite(row, 1, una)
  const extra = segmentElementCount(row, una) !== 1
  const malformed = matches.length !== 1 || parts.length !== 3 || extra || !validProdatDateValue(field, parts[1] ?? '', parts[2] ?? '')
  return { value: malformed ? null : parts[1], format: malformed ? null : parts[2], present: true, malformed, raw: row.raw }
}

/** Scalar projection is intentionally first-object scoped. */
export function prodatDateValue(field: string, segments: readonly Segment[], una = parseUna(null)): string | null {
  return prodatDateState(field, segments, una).value
}

export type ProdatDateSyntaxIssue = { fieldNumber: string; raw: string; kind: 'format' | 'scope' }

/** Validate supplied DTM fields in their message/object scopes. National R/D/O
 * presence stays with the canonical rule engine; no conditional cell is promoted. */
export function prodatDateSyntaxIssues(segments: readonly Segment[], una = parseUna(null)): ProdatDateSyntaxIssue[] {
  const rows = messageSegments(segments, una)
  const result: ProdatDateSyntaxIssue[] = []
  const hasEnvelope = rows.some(row => ['UNH','BGM','UNB'].includes(row.tag))
  let line = false
  let seen = new Set<string>()
  for (const row of rows) {
    if (row.tag === 'LIN') { line = true; seen = new Set() }
    if (row.tag !== 'DTM') continue
    const qualifier = segmentComposite(row, 1, una)[0]
    const descriptor = PRODAT_26A_FIELD_MATRIX.find(field => field.dateQualifier === qualifier)
    if (!descriptor) continue
    const wrongScope = hasEnvelope && (descriptor.dateScope === 'header' ? line : !line)
    const state = prodatDateState(descriptor.fieldNumber, [row], una)
    if (wrongScope || state.malformed || seen.has(qualifier)) {
      result.push({ fieldNumber: descriptor.fieldNumber, raw: row.raw, kind: wrongScope ? 'scope' : 'format' })
    }
    seen.add(qualifier)
  }
  return result
}

/** Render only a known field in its declared format. Null means omitted;
 * a provided invalid value throws and may not be replaced with now/another date. */
export function renderProdatDateField(field: string, input: string | null | undefined, periodFormat?: string): string | null {
  if (input == null) return null
  const descriptor = prodatDateField(field)
  const value = descriptor?.dateKind === 'minute' ? prodatDate203(input) : descriptor?.dateKind === 'date' ? prodatDate102(input) : input
  const format = descriptor?.dateKind === 'minute' ? '203' : descriptor?.dateKind === 'date' ? '102' : descriptor?.dateKind === 'offset' ? '805' : periodFormat ?? ''
  if (!descriptor || value == null || !validProdatDateValue(field, value, format)) throw new Error(`prodat_date_invalid:${field}`)
  return `DTM+${descriptor.dateQualifier}:${value}:${format}`
}

/** Comparison normalization preserves date meaning and period units. A malformed
 * expected value cannot compare equal merely by removing punctuation/digits. */
export function prodatDateComparisonValue(field: string, input: string | null | undefined): string | null {
  if (input == null) return null
  const descriptor = prodatDateField(field)
  if (descriptor?.dateKind === 'minute') return prodatDate203(input)
  if (descriptor?.dateKind === 'date') return prodatDate102(input)
  if (descriptor?.dateKind === 'offset') return input === '1' ? input : null
  const period = input.split(':')
  return descriptor?.dateKind === 'period' && period.length === 2 && validProdatDateValue(field, period[0], period[1]) ? input : null
}

/** Canonical P date-fact projection. This facade owns field selection so runtime
 * consumers never import or reconstruct a normative matrix. */
export function prodatDateValuesByQualifier(segments: readonly Segment[], una = parseUna(null)): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const field of PRODAT_26A_FIELD_MATRIX.filter(row => row.dateQualifier)) {
    const values = prodatDateRuleScopes(field.fieldNumber, segments, una)
      .map(scope => prodatDateValue(field.fieldNumber, scope, una)).filter((value): value is string => value !== null)
    if (values.length) result[field.dateQualifier!] = values
  }
  return result
}
