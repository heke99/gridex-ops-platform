import { prodatDocumentValue } from '@/lib/ediel/prodat/prodatDocumentFields'
import { segmentComposite, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import { parseUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import { PRODAT_26A_FIELD_MATRIX } from '@/lib/ediel/prodat/prodat26AFieldMatrix'

export type ProdatPartyQualifier = 'FR' | 'DO' | 'UD' | 'IT' | 'IV' | 'Z02'
type Segment = string | Pick<EdifactTokenizedSegment, 'raw' | 'tag'>
export type ProdatParty = {
  id: string | null
  idQualifier: string | null
  agency: string | null
  name: string | null
  nameLines: string[]
  address: string | null
  addressLines: string[]
  city: string | null
  postalCode: string | null
  country: string | null
  raw: string | null
  identityValid: boolean
}

// P26.A r3 pp45–46 and79–83. UNB is the technical route; NAD FR/DO are
// the legal parties. Fields227/250 and LIN209/NAD233 must never be substituted.
export function prodatPartyField(field: string) {
  const component = field.match(/^(\d+)-([1-3])$/)
  return PRODAT_26A_FIELD_MATRIX.find(row => row.partyElement !== undefined
    && ((row.fieldNumber === field || row.fieldKey === field)
      || (component && row.fieldNumber === component[1] && [4, 5].includes(row.partyElement)
        && Number(component[2]) <= (row.partyComponents ?? 1)))) ?? null
}

function messageSegments(segments: readonly Segment[], una: EdifactServiceStringAdvice): EdifactTokenizedSegment[] {
  const rows = segments.map((segment, index) => {
    const raw = typeof segment === 'string' ? segment : segment.raw
    return { index, raw, tag: typeof segment === 'string' ? raw.split(una.dataElementSeparator)[0].trim().toUpperCase() : segment.tag, elements: [] }
  })
  const start = rows.findIndex(row => row.tag === 'UNH')
  if (start >= 0 && segmentComposite(rows[start], 2, una)[0]?.trim().toUpperCase() !== 'PRODAT') return []
  const selected = rows.slice(Math.max(0, start))
  const end = selected.findIndex((row, index) => ['UNT', 'UNZ'].includes(row.tag) || (index > 0 && row.tag === 'UNH'))
  return end < 0 ? selected : selected.slice(0, end)
}

/** Select exactly the header or the first object, never a later object/message.
 * Detached NAD fragments remain usable by field-level validators. */
export function prodatPartySegmentFromSource(
  role: ProdatPartyQualifier,
  segments: readonly Segment[],
  una: EdifactServiceStringAdvice = parseUna(null),
): EdifactTokenizedSegment | null {
  const rows = messageSegments(segments, una)
  const firstLine = rows.findIndex(row => row.tag === 'LIN')
  const header = role === 'FR' || role === 'DO'
  const hasEnvelope = rows.some(row => ['UNB', 'UNH', 'BGM'].includes(row.tag))
  if (!header && firstLine < 0 && hasEnvelope) return null
  let scope = header ? (firstLine < 0 ? rows : rows.slice(0, firstLine)) : rows.slice(Math.max(firstLine, 0))
  if (!header && firstLine >= 0) {
    const nextLine = scope.findIndex((row, index) => index > 0 && row.tag === 'LIN')
    if (nextLine >= 0) scope = scope.slice(0, nextLine)
  }
  return scope.find(row => row.tag === 'NAD' && segmentComposite(row, 1, una).length === 1
    && segmentComposite(row, 1, una)[0]?.trim() === role) ?? null
}

/** Rule evaluation visits each transaction independently. Scalar party readers
 * deliberately still select the first object. Never flatten identities across
 * objects or let the next UNH satisfy this message's requirements. */
export function prodatPartyRuleScopes(
  role: ProdatPartyQualifier,
  segments: readonly Segment[],
  una: EdifactServiceStringAdvice = parseUna(null),
): EdifactTokenizedSegment[][] {
  const rows = messageSegments(segments, una)
  const starts = rows.flatMap((row, index) => row.tag === 'LIN' ? [index] : [])
  if (role === 'FR' || role === 'DO') return [starts.length ? rows.slice(0, starts[0]) : rows]
  if (!starts.length) return [rows]
  return starts.map((start, index) => rows.slice(start, starts[index + 1]))
}

function text(parts: readonly string[]): string | null {
  // Preserve inner spaces and component positions; trailing unused positions
  // are not text. A released colon is content, not a new name/address line.
  const values = parts.map(value => value.trim())
  while (values.length && !values[values.length - 1]) values.pop()
  return values.some(Boolean) ? values.join('\n') : null
}

export function prodatPartyState(field: string, segments: readonly Segment[], una = parseUna(null)): {
  value: string | null; values: string[]; present: boolean; malformed: boolean; tooLong: boolean
} {
  const descriptor = prodatPartyField(field)
  const row = descriptor?.partyQualifier ? prodatPartySegmentFromSource(descriptor.partyQualifier, segments, una) : null
  if (!row || !descriptor?.partyElement) return { value: null, values: [], present: false, malformed: false, tooLong: false }
  const index = descriptor.partyElement
  const parts = segmentComposite(row, index, una).map(value => value.trim())
  const present = parts.some(Boolean)
  const capacity = descriptor.partyComponents ?? 1
  const values = index === 2 ? parts.slice(0, 1) : parts.slice(0, capacity)
  const firstRequired = index === 2 || index === 4 || (index === 5 && descriptor.partyQualifier !== 'UD')
  const value = firstRequired && !values[0] ? null : text(values)
  let malformed = index === 2 ? parts.slice(3).some(Boolean) : parts.slice(capacity).some(Boolean)
  if (present && firstRequired && !values[0]) malformed = true
  if (index !== 2 && capacity === 1 && parts.length > 1) malformed = true
  if (index === 2 && present) {
    const list = parts[1] ?? '', agency = parts[2] ?? ''
    if (['FR', 'DO', 'Z02'].includes(descriptor.partyQualifier ?? '')) malformed ||= list !== '160' || agency !== 'SVK'
    else if (descriptor.partyQualifier === 'IT') malformed ||= Boolean(list) || !['89', '9'].includes(agency)
    else malformed ||= !((['1', 'SE1', 'SE2'].includes(list) && agency === '260') || (!list && agency === '89'))
  }
  if (descriptor.fieldNumber === '207' || descriptor.fieldNumber === '208') {
    const country = segmentComposite(row, 9, una)
    malformed ||= country.length !== 1 || !/^[A-Z]{2}$/.test(country[0] ?? '')
  } else if (index === 9 && present) malformed ||= !/^[A-Z]{2,3}$/.test(values[0] ?? '')
  const tooLong = values.some(value => value.length > (descriptor.partyMaxLength ?? 35))
  return { value, values: values.filter(Boolean), present, malformed, tooLong }
}

export function prodatPartyValue(field: string, segments: readonly Segment[], una = parseUna(null)): string | null {
  const descriptor = prodatPartyField(field)
  const component = field.match(/^(\d+)-([1-3])$/)
  if (descriptor?.partyQualifier && descriptor.partyElement && component) {
    const row = prodatPartySegmentFromSource(descriptor.partyQualifier, segments, una)
    return segmentComposite(row, descriptor.partyElement, una)[Number(component[2]) - 1]?.trim() || null
  }
  return prodatPartyState(field, segments, una).value
}

/** Raw decoded evidence, not a claim that a party passed registry/identity checks. */
export function readProdatParty(role: ProdatPartyQualifier, segments: readonly Segment[], una = parseUna(null)): ProdatParty {
  const row = prodatPartySegmentFromSource(role, segments, una)
  const component = (index: number) => segmentComposite(row, index, una)
  const identity = component(2)
  const idField = PRODAT_26A_FIELD_MATRIX.find(field => field.partyQualifier === role && field.partyElement === 2)
  const state = idField ? prodatPartyState(idField.fieldNumber, segments, una) : null
  const flat = (index: number) => { const parts = component(index); return parts.length === 1 ? parts[0]?.trim() || null : null }
  const named = role === 'UD' || role === 'IV'
  const addressable = named || role === 'IT'
  const nameLines = named ? component(4).slice(0, 2).map(value => value.trim()) : []
  const addressLines = addressable ? component(5).slice(0, 3).map(value => value.trim()) : []
  return {
    identityValid: Boolean(state?.value && !state.malformed && !state.tooLong),
    id: identity[0]?.trim() || null, idQualifier: identity[1]?.trim() || null, agency: identity[2]?.trim() || null,
    name: nameLines[0] ? text(nameLines) : null, nameLines,
    address: addressable ? text(addressLines) : null, addressLines,
    city: addressable ? flat(6) : null, postalCode: addressable ? flat(8) : null,
    country: role === 'Z02' ? null : flat(9), raw: row?.raw ?? null,
  }
}

export type ProdatPartySyntaxIssue = {
  fieldNumber: string | null
  raw: string
  kind: 'format' | 'length' | 'scope'
}

/** Narrow source-table syntax checks for supplied NAD groups, not full UNSM or
 * national D-condition approval. This intentionally does not require an absent
 * optional/dependent parent solely because its children have syntax-M cells. */
export function prodatPartySyntaxIssues(segments: readonly Segment[], una = parseUna(null)): ProdatPartySyntaxIssue[] {
  const rows = messageSegments(segments, una)
  const hasEnvelope = rows.some(row => ['UNB', 'UNH', 'BGM'].includes(row.tag))
  const code = prodatDocumentValue('202', rows, una)
  const result: ProdatPartySyntaxIssue[] = []
  let line: EdifactTokenizedSegment | null = null
  for (const row of rows) {
    if (row.tag === 'LIN') line = row
    if (row.tag !== 'NAD') continue
    const roleParts = segmentComposite(row, 1, una)
    const role = roleParts[0]?.trim() as ProdatPartyQualifier
    if (!['FR', 'DO', 'UD', 'IT', 'IV', 'Z02'].includes(role)) continue
    const header = role === 'FR' || role === 'DO'
    if (roleParts.length !== 1 || (hasEnvelope && (header ? Boolean(line) : !line))) {
      result.push({ fieldNumber: null, raw: row.raw, kind: 'scope' })
      continue
    }
    if (role === 'UD' && code === 'Z13' && segmentComposite(row, 2, una)[1]?.trim() === '1') {
      result.push({ fieldNumber: '227', raw: row.raw, kind: 'format' })
    }
    const descriptors = PRODAT_26A_FIELD_MATRIX.filter(field => field.partyQualifier === role)
    for (const field of descriptors) {
      const state = prodatPartyState(field.fieldNumber, [row], una)
      // Conditional national presence remains in the policy engine. These
      // requirements concern a supplied SG4/SG17 party's source-table shape.
      const structurallyRequired = field.partyElement === 2 || field.partyElement === 4
        || (field.partyElement === 5 && role === 'IT')
        || (field.partyElement === 9 && (role === 'UD' || role === 'IV'))
        || (role === 'IV' && (field.partyElement === 6 || field.partyElement === 8))
      if (state.malformed || state.tooLong || (structurallyRequired && !state.value)) {
        result.push({ fieldNumber: field.fieldNumber, raw: row.raw, kind: state.tooLong ? 'length' : 'format' })
      }
    }
    const unused = header ? [3, 4, 5, 6, 7, 8] : role === 'Z02' ? [3, 4, 5, 6, 7, 8, 9] : role === 'IT' ? [3, 4, 7] : [3, 7]
    if (unused.some(index => segmentComposite(row, index, una).some(value => value.trim()))) {
      result.push({ fieldNumber: null, raw: row.raw, kind: 'format' })
    }
    if (role === 'IT' && line) {
      const id = segmentComposite(row, 2, una)[0]?.trim() || null
      const object = segmentComposite(line, 3, una)[0]?.trim() || null
      if (!id || id !== object) result.push({ fieldNumber: '233', raw: row.raw, kind: 'format' })
    }
  }
  return result
}
