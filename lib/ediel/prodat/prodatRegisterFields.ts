import {prodatComponentEvidence,type ProdatFailureEvidence} from './prodatFailureEvidence'
import { segmentComposite, segmentElementCount, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import { parseUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import { PRODAT_26A_FIELD_MATRIX } from '@/lib/ediel/prodat/prodat26AFieldMatrix'

export type ProdatRegisterSegment = string | EdifactTokenizedSegment
export type ProdatRegisterFieldState = { present: boolean; value: string | null; malformed: boolean; failureEvidence?: ProdatFailureEvidence }
export const prodatPositiveSequence = (value: string | null): boolean => value !== null && /^\d{1,6}$/.test(value) && Number(value) > 0

export function prodatRegisterTokens(source: readonly ProdatRegisterSegment[], una = parseUna(null)): EdifactTokenizedSegment[] {
  return source.map((segment, index) => typeof segment !== 'string' ? segment : {
    raw: segment, index, tag: segment.split(una.dataElementSeparator)[0].trim().toUpperCase(), elements: [],
  })
}

/** Read only this LIN group's own register fields; never borrow a CAV or QTY. */
export function prodatRegisterFieldState(fieldNumberOrKey: string, source: readonly ProdatRegisterSegment[], una = parseUna(null)): ProdatRegisterFieldState | null {
  const field = PRODAT_26A_FIELD_MATRIX.find(row => row.fieldNumber === fieldNumberOrKey || row.fieldKey === fieldNumberOrKey)
  if (!field || field.registerScope !== 'local') return null
  const tokens = prodatRegisterTokens(source, una)
  const start = tokens.findIndex(s => s.tag === 'LIN')
  const end = tokens.findIndex((s, i) => i > start && ['LIN', 'UNH', 'UNT', 'UNZ'].includes(s.tag))
  const segments = tokens.slice(Math.max(0, start), end < 0 ? undefined : end)
  const lin = start < 0 ? null : tokens[start]
  if (field.linElement !== undefined) {
    const parts = segmentComposite(lin, field.linElement, una)
    const present = parts.some(value => value !== '')
    const value = parts[field.linComponent ?? 0] || null
    if (field.fieldNumber === '314') return { failureEvidence:lin?prodatComponentEvidence(lin.raw,field.segmentPath,parts):undefined, present, value, malformed: present && (parts.length !== 1 || !prodatPositiveSequence(value)) }
    if (field.fieldNumber === '209') return { failureEvidence:lin?prodatComponentEvidence(lin.raw,field.segmentPath,parts,parts.length===4?[...(!value||value.length>25?[0]:[]),...(parts[1]?[1]:[]),...(parts[2]?[2]:[]),...(!['9','89'].includes(parts[3])?[3]:[])]:undefined):undefined, present, value, malformed: present && (!value || value.length > 25 || parts.length !== 4 || parts[1] !== '' || parts[2] !== '' || !['9','89'].includes(parts[3])) }
    // C829 is either omitted (single register) or exactly indicator:index.
    const exists = Boolean(lin && segmentElementCount(lin, una) >= 4)
    return { failureEvidence:lin?prodatComponentEvidence(lin.raw,field.segmentPath,parts):undefined, present: exists, value, malformed: exists && (parts.length !== 2 || parts[0] !== '1' || !prodatPositiveSequence(value) || segmentElementCount(lin!, una) > 4) }
  }
  if (field.fieldNumber === '213') {
    const found = segments.filter(s => s.tag === 'QTY' && segmentComposite(s, 1, una)[0] === '31')
    const parts = segmentComposite(found[0], 1, una)
    const value = parts[1] || null
    return { failureEvidence:found.flatMap(t=>{const p=segmentComposite(t,1,una);return prodatComponentEvidence(t.raw,field.segmentPath,p,found.length===1&&p.length<=3?[...(!p[1]||!/^\d{1,15}$/.test(p[1])?[1]:[]),...(p[2]&&!['KWH','MTQ'].includes(p[2])?[2]:[])]:undefined)}), present: found.length > 0, value, malformed: found.length > 0 && (found.length !== 1 || !value || !/^\d{1,15}$/.test(value) || parts.length > 3 || (Boolean(parts[2]) && !['KWH','MTQ'].includes(parts[2])) || segmentElementCount(found[0], una) !== 1) }
  }
  const qualifier = field.segmentPath.slice('CCI++'.length, -'/CAV'.length)
  const matches = segments.flatMap((s, index) => s.tag === 'CCI' && segmentComposite(s, 2, una)[0] === qualifier ? [index] : [])
  const cav = matches.length && segments[matches[0] + 1]?.tag === 'CAV' ? segments[matches[0] + 1] : null
  const parts = segmentComposite(cav, 1, una)
  // This reader owns the selected 7110 field, not the other C889 fields.
  // C889 has five components; a trailing empty component is legal syntax.
  // Unrelated component usage belongs to full segment/profile validation.
  const value = parts[field.cavComponent ?? 3]?.trim() || null
  return { failureEvidence:matches.flatMap(i=>{const t=segments[i+1]?.tag==='CAV'?segments[i+1]:segments[i];const p=segmentComposite(t,t.tag==='CAV'?1:2,una);return prodatComponentEvidence(t.raw,field.segmentPath,p,matches.length===1&&t.tag==='CAV'&&value&&p.length<=5?[field.cavComponent??3]:undefined)}), present: matches.length > 0, value, malformed: matches.length > 0 && (matches.length !== 1 || !cav || !value || value.length > 35 || parts.length > 5 || segmentElementCount(cav, una) !== 1) }
}

/** Partition SG8 fields using the same field matrix, keeping CCI/CAV adjacent. */
export function prodatRegisterLocalSegments(source: readonly EdifactTokenizedSegment[], una: EdifactServiceStringAdvice): Set<EdifactTokenizedSegment> {
  const local = new Set<EdifactTokenizedSegment>()
  const qualifiers = new Set(PRODAT_26A_FIELD_MATRIX.filter(f => f.registerScope === 'local' && f.cavComponent !== undefined).map(f => f.segmentPath.slice(5,-4)))
  source.forEach((s, index) => {
    if (s.tag === 'LIN' || (s.tag === 'QTY' && segmentComposite(s,1,una)[0] === '31')) local.add(s)
    if (s.tag === 'CCI' && qualifiers.has(segmentComposite(s,2,una)[0])) {
      local.add(s)
      if (source[index + 1]?.tag === 'CAV') local.add(source[index + 1])
    }
  })
  return local
}


/** Invalid supplied measurements remain in raw evidence, not trusted scalars. */
export function prodatRegisterFieldValue(field: string, source: readonly ProdatRegisterSegment[], una = parseUna(null)): string | null {
  const state = prodatRegisterFieldState(field, source, una)
  return state && !state.malformed ? state.value : null
}
