import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'

/** ISO 8859-1 representability is a byte invariant, separate from the UNOC
 * repertoire and family/profile validation. Never silently truncate UTF-16. */
export function assertEdifactLatin1Representable(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code > 0xff) {
      // Deliberately omit source content: identifiers/free text can be private.
      throw new Error(`edifact_character_not_iso8859_1:${index}:U+${code.toString(16).toUpperCase().padStart(4, '0')}`)
    }
  }
}

/** Lossless EDIFACT bytes, without conversion, replacement or truncation. */
export function encodeEdifactLatin1(value: string): Buffer {
  assertEdifactLatin1Representable(value)
  return Buffer.from(value, 'latin1')
}

/** T24-A-6 §6: C0, DEL and C1 are not UNOC data. Keep this outbound
 * policy separate from lossless encoding of captured (possibly invalid) originals.
 * Reject without conversion; diagnostics must not contain source text. */
export function assertEdifactUnocText(value: string): void {
  assertEdifactLatin1Representable(value)
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      throw new Error(`edifact_character_not_unoc:${index}:U+${code.toString(16).toUpperCase().padStart(4, '0')}`)
    }
  }
}

/** Outbound EDIFACT data only; MIME headers and their CRLF are separate. */
export function encodeEdifactUnoc(value: string): Buffer {
  assertEdifactUnocText(value)
  return encodeEdifactLatin1(value)
}

/** T24-A-6 §6.1: PRODAT, UTILTS and their APERAK use exactly UNOC:3.
 * CONTRL may use UNOB:2, so callers apply this only to the relevant families. */
export function assertEdifactUnocSyntax3(value: string): void {
  const tokenized = tokenizeEdifact(value)
  const unb = tokenized.segments.filter(segment => segment.tag === 'UNB')
  const syntax = segmentComposite(unb[0], 1, tokenized.una)
  if (unb.length !== 1 || syntax.length !== 2 || syntax[0] !== 'UNOC' || syntax[1] !== '3') {
    throw new Error('edifact_unoc_syntax_3_required')
  }
}
