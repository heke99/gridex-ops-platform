import { segmentComposite, segmentElementCount, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import type { EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import { findProdatSubtypeRule } from '@/lib/ediel/rulebook/prodatSubtypeRegistry'
import { PRODAT_26A_FIELD_MATRIX } from './prodat26AFieldMatrix'
import type { ProdatRegisterFieldState } from './prodatRegisterFields'

export const isProdatReadingField = (field: string): boolean => ['214', '218', '259'].includes(field)
const qualifier = (field: string) => PRODAT_26A_FIELD_MATRIX.find(row => row.fieldNumber === field)!.segmentPath.slice(5, -4)
const populatedAfter = (token: EdifactTokenizedSegment, last: number, una: EdifactServiceStringAdvice) =>
  Array.from({ length: Math.max(0, segmentElementCount(token, una) - last) }, (_, i) => segmentComposite(token, last + i + 1, una)).some(parts => parts.some(value => value !== ''))

/** Recognize malformed supplied qualifiers too, but never normalize them into
 * authority. P26.A pp55,58,64–66: SG14 pairs precede SG16/17. */
function pairs(field: string, segments: readonly EdifactTokenizedSegment[], una: EdifactServiceStringAdvice) {
  return segments.flatMap((token, index) => token.tag === 'CCI' && segmentComposite(token, 2, una)[0]?.trim().toUpperCase() === qualifier(field) ? [index] : [])
}
function validPair(field: string, segments: readonly EdifactTokenizedSegment[], index: number, una: EdifactServiceStringAdvice) {
  const cci = segments[index], cav = segments[index + 1]
  const descriptor = segmentComposite(cci, 2, una)
  const parent = segments.findIndex(token => ['RFF', 'NAD'].includes(token.tag))
  return (parent < 0 || index < parent) && cav?.tag === 'CAV' && segments[index + 2]?.tag !== 'CAV'
    && descriptor[0] === qualifier(field) && descriptor.slice(1).every(value => value === '')
    && segmentComposite(cci, 1, una).every(value => value === '') && !populatedAfter(cci, 2, una)
    && !populatedAfter(cav, 1, una)
}

/** Unique source-exact reason from the actual first register. API aliases,
 * trimming, another function's reason and extra CAV values are not authority. */
export function prodatRegisterReadingSubtype(code: string, segments: readonly EdifactTokenizedSegment[], una: EdifactServiceStringAdvice): string | null {
  const found = pairs('223', segments, una)
  if (found.length !== 1 || !validPair('223', segments, found[0], una)) return null
  const parts = segmentComposite(segments[found[0] + 1], 1, una)
  if (parts.length > 5 || parts.slice(1).some(value => value !== '')) return null
  const rule = findProdatSubtypeRule(parts[0], code)
  return rule?.transactionReasonCode === parts[0] && rule.allowedMessageCodes.some(allowed => allowed === code) ? rule.subtype : null
}

/** Own supplied reading value, validated before normalization. An absent or
 * malformed first value never supplies another register's numeric value. */
export function prodatRegisterReadingState(field: string, segments: readonly EdifactTokenizedSegment[], una: EdifactServiceStringAdvice): ProdatRegisterFieldState {
  const found = pairs(field, segments, una)
  if (!found.length) return { present: false, value: null, malformed: false }
  const cav = segments[found[0] + 1]
  const parts = cav?.tag === 'CAV' ? segmentComposite(cav, 1, una) : []
  const value = parts[3] ?? ''
  return { present: true, value: value.trim() || null, malformed: found.length !== 1 || !validPair(field, segments, found[0], una)
    || !value.trim() || value.length > 35 || parts.length > 5 || parts.some((part, index) => index !== 3 && part !== '') }
}

/** Wire UNB wins over caller facts. A canonical policy may supply context for
 * a renderer/body fragment without UNB. GAS is recognized only to preserve the
 * existing separate overlay; this adds no GAS capability or certification. */
export function prodatRegisterReadingMarket(tokens: readonly EdifactTokenizedSegment[], una: EdifactServiceStringAdvice, applicationReference?: string | null): 'electricity' | 'gas' | null {
  const end = tokens.findIndex(token => ['UNT', 'UNZ'].includes(token.tag))
  const first = end < 0 ? tokens : tokens.slice(0, end)
  const unbs = first.filter(token => token.tag === 'UNB')
  let reference = applicationReference
  if (unbs.length) {
    const body = first.find(token => ['UNH', 'BGM', 'LIN'].includes(token.tag))
    const parts = segmentComposite(unbs[0], 7, una)
    if (unbs.length !== 1 || !body || unbs[0].index >= body.index || parts.length !== 1) return null
    reference = parts[0]
  }
  return reference === '23-DDQ-PRODAT' || reference === '23-DGI-PRODAT' ? 'electricity' : reference === '27-DDQ-PRODAT' ? 'gas' : null
}
