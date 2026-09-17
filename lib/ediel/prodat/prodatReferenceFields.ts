import { segmentComposite, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import { parseUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import { PRODAT_26A_FIELD_MATRIX } from '@/lib/ediel/prodat/prodat26AFieldMatrix'

type Segment = string | Pick<EdifactTokenizedSegment, 'raw' | 'tag'>
type ReferenceField = (typeof PRODAT_26A_FIELD_MATRIX)[number] & { referenceScope: 'sender' | 'line' }
type ReferenceOccurrence = { qualifier: string; value: string | null; raw: string; sender: boolean; line: boolean }

// P 26.A r3 §2.6 p46 and pp76–79: C506/1154 is the reference number.
// 1153 selects its meaning; neither 1156 nor 4000 is part of that number.
const fields = PRODAT_26A_FIELD_MATRIX.filter((row): row is ReferenceField => row.referenceScope !== undefined)
const qualifier = (field: ReferenceField): string => field.segmentPath.slice('RFF+'.length)

export function prodatReferenceField(fieldNumberOrKey: string): ReferenceField | null {
  return fields.find(row => row.fieldNumber === fieldNumberOrKey || row.fieldKey === fieldNumberOrKey) ?? null
}

function tokens(segments: readonly Segment[], una: EdifactServiceStringAdvice): EdifactTokenizedSegment[] {
  return segments.map((segment, index) => {
    const raw = typeof segment === 'string' ? segment : segment.raw
    const tag = typeof segment === 'string' ? raw.split(una.dataElementSeparator)[0].trim().toUpperCase() : segment.tag
    return { index, raw, tag, elements: [] }
  })
}

function occurrences(segments: readonly Segment[], una: EdifactServiceStringAdvice): ReferenceOccurrence[] {
  const all = tokens(segments, una)
  const start = all.findIndex(segment => segment.tag === 'UNH')
  if (start >= 0 && segmentComposite(all[start], 2, una)[0]?.trim().toUpperCase() !== 'PRODAT') return []
  const selected = all.slice(Math.max(0, start))
  const end = selected.findIndex((segment, index) => segment.tag === 'UNT' || segment.tag === 'UNZ' || (index > 0 && segment.tag === 'UNH'))
  const message = end < 0 ? selected : selected.slice(0, end)
  const hasHeader = message.some(segment => ['UNB', 'UNH', 'BGM'].includes(segment.tag))
  const hasLin = message.some(segment => segment.tag === 'LIN')
  const hasNad = message.some(segment => segment.tag === 'NAD')
  // Detached field fragments are used by field-level validators. Once message
  // or line boundaries exist, a header/party RFF cannot supply an object field.
  let line = !hasHeader && !hasLin && !hasNad
  let sender = line
  let seenLine = false
  const result: ReferenceOccurrence[] = []
  for (const segment of message) {
    if (segment.tag === 'LIN') { seenLine = true; line = true; sender = false; continue }
    if (segment.tag === 'NAD') {
      sender = !seenLine && segmentComposite(segment, 1, una)[0]?.trim().toUpperCase() === 'FR'
      line = false
      continue
    }
    if (segment.tag !== 'RFF') continue
    const parts = segmentComposite(segment, 1, una)
    const name = parts[0]?.trim().toUpperCase() ?? ''
    if (!name) continue
    result.push({ qualifier: name, value: parts[1]?.trim() || null, raw: segment.raw, sender, line })
  }
  return result
}

function inScope(field: ReferenceField, occurrence: ReferenceOccurrence): boolean {
  return field.referenceScope === 'sender' ? occurrence.sender : occurrence.line
}

/** Decoded references are evidence, not permission to execute or correlate. */
export function prodatReferenceEntries(segments: readonly Segment[], una = parseUna(null)): { qualifier: string; value: string; raw: string }[] {
  return occurrences(segments, una).flatMap(entry => {
    const field = fields.find(candidate => qualifier(candidate) === entry.qualifier)
    if (!entry.value || (field && !inScope(field, entry))) return []
    return [{ qualifier: entry.qualifier, value: entry.value, raw: entry.raw }]
  })
}

export function prodatReferenceValues(fieldNumberOrKey: string, segments: readonly Segment[], una = parseUna(null)): string[] {
  const field = prodatReferenceField(fieldNumberOrKey)
  if (!field) return []
  return occurrences(segments, una)
    .filter(entry => entry.qualifier === qualifier(field) && inScope(field, entry))
    .flatMap(entry => entry.value === null ? [] : [entry.value])
}

export function prodatReferenceValue(fieldNumberOrKey: string, segments: readonly Segment[], una = parseUna(null)): string | null {
  return prodatReferenceValues(fieldNumberOrKey, segments, una)[0] ?? null
}

export function prodatReferenceByQualifier(name: string, segments: readonly Segment[], una = parseUna(null)): string | null {
  return prodatReferenceEntries(segments, una).find(entry => entry.qualifier === name.trim().toUpperCase())?.value ?? null
}

export function prodatReferencePresent(fieldNumberOrKey: string, segments: readonly Segment[], options: { forbidden?: boolean; una?: EdifactServiceStringAdvice } = {}): boolean {
  const field = prodatReferenceField(fieldNumberOrKey)
  if (!field) return false
  return occurrences(segments, options.una ?? parseUna(null)).some(entry => entry.qualifier === qualifier(field)
    // Forbidden references cannot evade the rule by being empty or misplaced.
    && (options.forbidden || (inScope(field, entry) && entry.value !== null)))
}
