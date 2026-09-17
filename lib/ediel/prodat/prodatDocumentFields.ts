import { segmentComposite, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import { escapeEdifactValue } from '@/lib/ediel/core/edifactSerializer'
import { parseUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import { PRODAT_26A_FIELD_MATRIX, PRODAT_26A_MESSAGE_CODES } from '@/lib/ediel/prodat/prodat26AFieldMatrix'

// P26.A r3 p42: C002/1001; flat1004; flat1225; flat4343. UNH0062 is separate.
export function prodatDocumentField(field: string) {
  return PRODAT_26A_FIELD_MATRIX.find(row =>
    (row.fieldNumber === field || row.fieldKey === field) && row.documentElement !== undefined) ?? null
}

export function prodatDocumentSegment(
  segments: readonly (EdifactTokenizedSegment | string)[],
  una: EdifactServiceStringAdvice = parseUna(null),
): EdifactTokenizedSegment | null {
  const rows = segments.map((row, index) => typeof row === 'string'
    ? { raw: row, tag: row.split(una.dataElementSeparator)[0].toUpperCase(), index, elements: [] }
    : row)
  const start = rows.findIndex(row => row.tag === 'UNH')
  if (start >= 0 && segmentComposite(rows[start], 2, una)[0]?.trim().toUpperCase() !== 'PRODAT') return null
  // Header-only projection. A missing first header is never filled from a line,
  // trailer or later message. First BGM also owns its empty fields.
  for (let i = Math.max(start, 0); i < rows.length; i += 1) {
    const row = rows[i]
    if (['LIN', 'UNT', 'UNZ'].includes(row.tag) || (row.tag === 'UNH' && i !== start)) break
    if (row.tag === 'BGM') return row
  }
  return null
}

export function prodatDocumentState(
  field: string,
  segments: readonly (EdifactTokenizedSegment | string)[],
  una: EdifactServiceStringAdvice = parseUna(null),
): { value: string | null; present: boolean; malformed: boolean } {
  const descriptor = prodatDocumentField(field)
  const segment = descriptor ? prodatDocumentSegment(segments, una) : null
  if (!descriptor || descriptor.documentElement === undefined || !segment) {
    return { value: null, present: false, malformed: false }
  }
  const parts = segmentComposite(segment, descriptor.documentElement, una)
  const malformed = descriptor.fieldNumber === '202'
    ? parts.slice(1).some(part => part.trim().length > 0) // unused C002 metadata
    : parts.length !== 1 // 1004/1225/4343 are flat, not composites
  const present = parts.some(part => part.trim().length > 0)
  const value = descriptor.fieldNumber !== '202' && malformed ? null : parts[0]?.trim() || null
  return { value, present, malformed }
}

export function prodatDocumentValue(
  field: string,
  segments: readonly (EdifactTokenizedSegment | string)[],
  una: EdifactServiceStringAdvice = parseUna(null),
): string | null {
  return prodatDocumentState(field, segments, una).value
}

/** Serialize the four documented BGM fields, not a parallel message profile. */
export function renderProdatDocumentHeader(input: {
  code: string
  documentId: string
  messageFunction?: '9' | '5' | null
  acknowledgement?: 'AB' | 'NA' | null
}): string {
  const code = input.code.trim().toUpperCase()
  if (!PRODAT_26A_MESSAGE_CODES.some(candidate => candidate === code)) throw new Error('prodat_document_code_invalid')
  const id = input.documentId.trim()
  if (!id || id.length > 35 || /[\r\n\0]/.test(id)) throw new Error('prodat_document_reference_invalid')
  const fn = input.messageFunction === undefined ? '9' : input.messageFunction ?? ''
  const ack = input.acknowledgement === undefined ? 'AB' : input.acknowledgement ?? ''
  if (fn && !['9', '5'].includes(fn)) throw new Error('prodat_document_function_invalid')
  if ((ack && !['AB', 'NA'].includes(ack)) || (!ack && code !== 'Z01')) throw new Error('prodat_document_acknowledgement_invalid')
  // Do not compact/truncate an already allocated identity; reject invalid input.
  return `BGM+${code}+${escapeEdifactValue(id)}+${fn}${ack ? `+${ack}` : ''}`
}
