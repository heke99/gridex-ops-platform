import { segmentComposite, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import { parseUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import { PRODAT_26A_FIELD_MATRIX } from '@/lib/ediel/prodat/prodat26AFieldMatrix'

type CharacteristicField = (typeof PRODAT_26A_FIELD_MATRIX)[number] & {
  cavComponent: 0 | 3 | 4
}
type Segment = string | Pick<EdifactTokenizedSegment, 'raw' | 'tag'>

// The existing source-controlled matrix owns both qualifier and value position.
// P 26.A r3 §2.6 pp55–74: field242 and506 share Z14 but NOT a C889 component.
const fields = PRODAT_26A_FIELD_MATRIX.filter((row): row is CharacteristicField => row.cavComponent !== undefined)
const qualifier = (field: CharacteristicField): string => field.segmentPath.slice('CCI++'.length, -'/CAV'.length)

export function prodatCharacteristicField(fieldNumberOrKey: string): CharacteristicField | null {
  return fields.find(row => row.fieldNumber === fieldNumberOrKey || row.fieldKey === fieldNumberOrKey) ?? null
}

function token(segment: Segment, index: number, una: EdifactServiceStringAdvice): EdifactTokenizedSegment {
  const raw = typeof segment === 'string' ? segment : segment.raw
  const tag = typeof segment === 'string' ? raw.split(una.dataElementSeparator)[0].trim().toUpperCase() : segment.tag
  return { index, tag, raw, elements: [] }
}

function matches(field: CharacteristicField, segments: readonly Segment[], una: EdifactServiceStringAdvice): (string[] | null)[] {
  const result: (string[] | null)[] = []
  for (let index = 0; index < segments.length; index += 1) {
    const cci = token(segments[index], index, una)
    if (cci.tag !== 'CCI' || segmentComposite(cci, 2, una)[0]?.trim().toUpperCase() !== qualifier(field)) continue
    const next = segments[index + 1]
    const cav = next === undefined ? null : token(next, index + 1, una)
    // SG14 pairs are adjacent. Never borrow CAV through another LIN, message,
    // parent or unrelated segment; preserve release sequences until decoding.
    result.push(cav?.tag === 'CAV' ? segmentComposite(cav, 1, una) : null)
  }
  return result
}

export function prodatCharacteristicValues(fieldNumberOrKey: string, segments: readonly Segment[], una = parseUna(null)): string[] {
  const field = prodatCharacteristicField(fieldNumberOrKey)
  if (!field) return []
  return matches(field, segments, una)
    .map(parts => parts?.[field.cavComponent]?.trim() ?? '')
    .filter(value => value.length > 0)
}

export function prodatCharacteristicValue(fieldNumberOrKey: string, segments: readonly Segment[], una = parseUna(null)): string | null {
  return prodatCharacteristicValues(fieldNumberOrKey, segments, una)[0] ?? null
}

export function prodatCharacteristicPresent(
  fieldNumberOrKey: string,
  segments: readonly Segment[],
  options: { forbidden?: boolean; una?: EdifactServiceStringAdvice } = {},
): boolean {
  const field = prodatCharacteristicField(fieldNumberOrKey)
  if (!field) return false
  return matches(field, segments, options.una ?? parseUna(null)).some(parts => {
    if (parts?.[field.cavComponent]?.trim()) return true
    if (!options.forbidden) return false
    // An empty/malformed forbidden pair cannot evade exclusion. But a shared
    // Z14 carrying only its permitted sibling is not this forbidden field.
    const siblingPresent = fields.some(other => other.fieldNumber !== field.fieldNumber
      && qualifier(other) === qualifier(field) && Boolean(parts?.[other.cavComponent]?.trim()))
    return !siblingPresent
  })
}

export function prodatCharacteristicCodes(segments: readonly Segment[], una = parseUna(null)): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const field of fields) {
    const values = prodatCharacteristicValues(field.fieldNumber, segments, una).map(value => value.toUpperCase())
    if (values.length) result[qualifier(field)] = [...(result[qualifier(field)] ?? []), ...values]
  }
  return result
}

/** Field506's permission-only slot guard; field242 is legitimate in Z04/06/10. */
export function misplacedProdatEnergyProducts(code: string, segments: readonly Segment[], una = parseUna(null)): string[] {
  if (!['Z13', 'Z14'].includes(code.trim().toUpperCase())) return []
  const result: string[] = []
  for (let index = 0; index + 1 < segments.length; index += 1) {
    const pair = segments.slice(index, index + 2)
    if (!prodatCharacteristicValue('242', pair, una)) continue
    const cav = pair[1]
    result.push(typeof cav === 'string' ? cav : cav.raw)
  }
  return result
}
