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
