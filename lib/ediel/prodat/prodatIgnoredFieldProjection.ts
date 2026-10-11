import { segmentComposite, segmentSourceSpan, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { bindReceivedProdatIgnoredFields } from '@/lib/ediel/core/receivedProdatIgnoredFieldBinding'
import { canonicalProdatFieldWireDescriptor } from '@/lib/ediel/rulebook/canonicalEdielFacade'
import { fieldRulePresent, type ProdatIgnoredField, type RulebookFieldRule } from '@/lib/ediel/rulebook/fieldMatrix'
import { prodatRegisterGroups, prodatRegisterMessageSegments } from '@/lib/ediel/prodat/prodatRegisterGroups'

/**
 * P26.A r3 p119 (SC-031 / P-02): physical segment INDEXES of recorded ignored
 * field occurrences. Bound to this exact raw source and to each record's own
 * header/line scope, so an identical segment text in another scope is never
 * selected. Returns null when the records do not bind to this source.
 */
export function ignoredProdatSegmentIndexes(rawPayload: string, recorded: unknown): ReadonlySet<number> | null {
  if (recorded === undefined || recorded === null || (Array.isArray(recorded) && recorded.length === 0)) return new Set()
  const fields = bindReceivedProdatIgnoredFields(recorded, rawPayload)
  if (!fields) return null
  const { segments, una } = tokenizeEdifact(rawPayload)
  const code = segmentComposite(segments.find(segment => segment.tag === 'BGM'), 1, una)[0] ?? ''
  const applicationReference = segmentComposite(segments.find(segment => segment.tag === 'UNB'), 7, una)[0] ?? null
  const groups = prodatRegisterGroups(segments, una, code).groups
  const grouped = new Set(groups.flatMap(group => group.segments.map(segment => segment.index)))
  const header = prodatRegisterMessageSegments(segments, una).filter(segment => !grouped.has(segment.index) && !['UNH', 'BGM'].includes(segment.tag))
  const indexes = new Set<number>()
  for (const field of fields as ProdatIgnoredField[]) {
    const descriptor = canonicalProdatFieldWireDescriptor(field.fieldNumber)
    if (!descriptor) return null
    const presence: RulebookFieldRule = { family: 'PRODAT', code, fieldNumber: descriptor.fieldNumber, fieldKey: descriptor.fieldKey,
      label: descriptor.fieldKey, segmentPath: descriptor.segmentPath, requirement: 'forbidden', source: 'static' }
    const scope = field.occurrence.scope === 'header' ? header
      : groups.find(group => group.lineIndex === field.occurrence.lineIndex)?.segments ?? []
    const present = (rows: readonly { raw: string }[]) => fieldRulePresent(presence, { code, una, applicationReference, rawSegments: rows.map(row => row.raw) })
    const before = indexes.size
    for (const segment of scope) {
      // A segment carries the field alone (RFF/QTY/DTM) or is required for its
      // presence in this scope (CCI+CAV pair): only that occurrence is selected.
      if (present([segment]) || (present(scope) && !present(scope.filter(row => row !== segment)))) indexes.add(segment.index)
    }
    if (indexes.size === before) return null
  }
  return indexes
}

/** Business-only wire view: the original text with exactly the ignored
 * occurrences (and their terminators) cut out. Raw evidence is never changed. */
export function projectProdatBusinessWire(rawPayload: string, recorded: unknown): string {
  const indexes = ignoredProdatSegmentIndexes(rawPayload, recorded)
  if (!indexes) throw new Error('PRODAT_IGNORED_FIELD_BINDING_INVALID')
  if (!indexes.size) return rawPayload
  const { segments, una } = tokenizeEdifact(rawPayload)
  let projected = '', cursor = 0
  for (const segment of segments) {
    if (!indexes.has(segment.index)) continue
    const span = segmentSourceSpan(segment)
    if (!span) throw new Error('PRODAT_IGNORED_FIELD_BINDING_INVALID')
    const end = rawPayload[span.endOffset] === una.segmentTerminator ? span.endOffset + 1 : span.endOffset
    projected += rawPayload.slice(cursor, span.startOffset)
    cursor = end
  }
  return projected + rawPayload.slice(cursor)
}

/** Recorded runtime ignored fields as persisted by inbound processing. */
export function recordedProdatIgnoredFields(parsedPayload: unknown): unknown {
  if (!parsedPayload || typeof parsedPayload !== 'object') return undefined
  const payload = parsedPayload as Record<string, unknown>
  const canonical = payload.canonical && typeof payload.canonical === 'object' ? payload.canonical as Record<string, unknown> : null
  return canonical?.prodatIgnoredFields ?? payload.prodatIgnoredFields
}
