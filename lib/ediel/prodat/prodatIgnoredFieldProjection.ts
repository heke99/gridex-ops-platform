import { segmentComposite, segmentSourceSpan, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { bindReceivedProdatIgnoredFields } from '@/lib/ediel/core/receivedProdatIgnoredFieldBinding'
import { canonicalProdatFieldWireDescriptor } from '@/lib/ediel/rulebook/canonicalEdielFacade'
import { fieldRulePresent, type ProdatIgnoredField, type RulebookFieldRule } from '@/lib/ediel/rulebook/fieldMatrix'
import { PRODAT_26A_FIELD_MATRIX } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { prodatRegisterGroups, prodatRegisterMessageSegments } from '@/lib/ediel/prodat/prodatRegisterGroups'

type WireRow = { index: number; raw: string }
type Una = ReturnType<typeof tokenizeEdifact>['una']

/** Split on a separator, keeping release sequences verbatim (wire text). */
function splitWire(value: string, separator: string, release: string): string[] {
  const parts: string[] = []
  let current = '', released = false
  for (const char of value) {
    if (released) { current += char; released = false; continue }
    if (char === release) { current += char; released = true; continue }
    if (char === separator) { parts.push(current); current = ''; continue }
    current += char
  }
  parts.push(current)
  return parts
}

function staticPresenceRule(code: string, fieldNumber: string): RulebookFieldRule | null {
  const descriptor = canonicalProdatFieldWireDescriptor(fieldNumber)
  return descriptor ? { family: 'PRODAT', code, fieldNumber: descriptor.fieldNumber, fieldKey: descriptor.fieldKey,
    label: descriptor.fieldKey, segmentPath: descriptor.segmentPath, requirement: 'forbidden', source: 'static' } : null
}

/**
 * P26.A r3 p119 (SC-031 / P-02): per source/occurrence/field-component edits for
 * recorded ignored fields. Each record is bound to this exact raw source and to
 * its own header/line scope (physical segment indexes, never text), so an
 * identical segment in another scope is never selected. A segment that carries
 * only ignored data is removed; a shared carrier (NAD/LIN/CCI/CAV ...) keeps its
 * structure and only the ignored component is blanked. An edit is accepted only
 * when the field disappears and no other canonical field presence in the scope
 * changes. Returns null when the records do not bind to this source.
 */
function ignoredProdatEdits(rawPayload: string, recorded: unknown): { edits: Map<number, string | null>; una: Una } | null {
  const { segments, una } = tokenizeEdifact(rawPayload)
  const edits = new Map<number, string | null>()
  if (recorded === undefined || recorded === null || (Array.isArray(recorded) && recorded.length === 0)) return { edits, una }
  const fields = bindReceivedProdatIgnoredFields(recorded, rawPayload)
  if (!fields) return null
  const code = segmentComposite(segments.find(segment => segment.tag === 'BGM'), 1, una)[0] ?? ''
  const applicationReference = segmentComposite(segments.find(segment => segment.tag === 'UNB'), 7, una)[0] ?? null
  const groups = prodatRegisterGroups(segments, una, code).groups
  const grouped = new Set(groups.flatMap(group => group.segments.map(segment => segment.index)))
  const header = prodatRegisterMessageSegments(segments, una).filter(segment => !grouped.has(segment.index) && !['UNH', 'BGM'].includes(segment.tag))
  const matrixRules = PRODAT_26A_FIELD_MATRIX.map(row => staticPresenceRule(code, row.fieldNumber)).filter((rule): rule is RulebookFieldRule => Boolean(rule))
  const present = (rule: RulebookFieldRule, rows: readonly WireRow[]) => fieldRulePresent(rule, { code, una, applicationReference, rawSegments: rows.map(row => row.raw) })
  const others = (target: string, rows: readonly WireRow[]) => matrixRules.filter(rule => rule.fieldNumber !== target && present(rule, rows)).map(rule => rule.fieldNumber).join('|')
  const view = (scope: readonly WireRow[], overlay: ReadonlyMap<number, string | null>) => scope
    .map(row => ({ index: row.index, raw: overlay.has(row.index) ? overlay.get(row.index)! : row.raw }))
    .filter((row): row is WireRow => row.raw !== null)

  for (const field of fields as ProdatIgnoredField[]) {
    const rule = staticPresenceRule(code, field.fieldNumber)
    if (!rule) return null
    const scope: WireRow[] = (field.occurrence.scope === 'header' ? header
      : groups.find(group => group.lineIndex === field.occurrence.lineIndex)?.segments ?? []).map(row => ({ index: row.index, raw: row.raw }))
    const current = view(scope, edits)
    if (!present(rule, current)) return null
    const baseline = others(field.fieldNumber, current)
    const accept = (overlay: Map<number, string | null>) => {
      const candidate = view(scope, overlay)
      return !present(rule, candidate) && others(field.fieldNumber, candidate) === baseline
    }
    // 1. Segments carrying only this field in this occurrence are removed whole.
    const carriers = current.filter(row => present(rule, [row]))
    if (carriers.length) {
      const overlay = new Map(edits)
      for (const row of carriers) overlay.set(row.index, null)
      if (accept(overlay)) { for (const row of carriers) edits.set(row.index, null); continue }
    }
    // 2. Shared carrier: blank exactly one data component (value-first), else
    // exactly one data element when presence is element-level. Trailing empty
    // elements are trimmed; preceding positions keep their structure.
    const serialize = (elements: string[]) => {
      const kept = [...elements]
      while (kept.length > 1 && kept[kept.length - 1] === '') kept.pop()
      return kept.join(una.dataElementSeparator)
    }
    const tryRaw = (row: WireRow, raw: string) => {
      if (raw === row.raw) return false
      const overlay = new Map(edits)
      overlay.set(row.index, raw)
      if (!accept(overlay)) return false
      edits.set(row.index, raw)
      return true
    }
    let matched = false
    search: for (const level of ['component', 'element'] as const) {
      for (const row of current) {
        const elements = splitWire(row.raw, una.dataElementSeparator, una.releaseCharacter)
        for (let e = elements.length - 1; e >= 1; e -= 1) {
          if (!elements[e]) continue
          if (level === 'element') {
            if (tryRaw(row, serialize(elements.map((element, at) => at === e ? '' : element)))) { matched = true; break search }
            continue
          }
          const components = splitWire(elements[e], una.componentDataElementSeparator, una.releaseCharacter)
          for (let c = components.length - 1; c >= 0; c -= 1) {
            if (!components[c]) continue
            const blanked = components.map((component, at) => at === c ? '' : component).join(una.componentDataElementSeparator)
            if (tryRaw(row, serialize(elements.map((element, at) => at === e ? blanked : element)))) { matched = true; break search }
          }
        }
      }
    }
    if (!matched) return null
  }
  return { edits, una }
}

/** Physical segment indexes touched by recorded ignored field occurrences. */
export function ignoredProdatSegmentIndexes(rawPayload: string, recorded: unknown): ReadonlySet<number> | null {
  const result = ignoredProdatEdits(rawPayload, recorded)
  return result ? new Set(result.edits.keys()) : null
}

/** Business-only wire view: the original text with exactly the ignored
 * occurrences/components removed; segment structure and siblings retained.
 * Raw evidence is never changed. */
export function projectProdatBusinessWire(rawPayload: string, recorded: unknown): string {
  const result = ignoredProdatEdits(rawPayload, recorded)
  if (!result) throw new Error('PRODAT_IGNORED_FIELD_BINDING_INVALID')
  const { edits, una } = result
  if (!edits.size) return rawPayload
  let projected = '', cursor = 0
  for (const segment of tokenizeEdifact(rawPayload).segments) {
    if (!edits.has(segment.index)) continue
    const span = segmentSourceSpan(segment)
    if (!span) throw new Error('PRODAT_IGNORED_FIELD_BINDING_INVALID')
    const replacement = edits.get(segment.index)
    projected += rawPayload.slice(cursor, span.startOffset)
    if (replacement === null || replacement === undefined) {
      cursor = rawPayload[span.endOffset] === una.segmentTerminator ? span.endOffset + 1 : span.endOffset
    } else {
      projected += replacement
      cursor = span.endOffset
    }
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
