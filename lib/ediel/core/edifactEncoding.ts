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

function serviceCharacters(value: string): { terminator: string; release: string; headerEnd: number } {
  return value.startsWith('UNA') && value.length >= 9
    ? { terminator: value[8], release: value[6], headerEnd: 9 }
    : { terminator: "'", release: '?', headerEnd: 0 }
}

/** True when the character at `index` is an unreleased segment terminator. */
function isSegmentEnd(value: string, index: number, terminator: string, release: string): boolean {
  if (index < 0 || value[index] !== terminator) return false
  let releases = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === release; cursor -= 1) releases += 1
  return releases % 2 === 0
}

/** UNOC:3 is the ISO 8859-1 graphic repertoire. C0, DEL and C1 controls never
 * belong in segment data; the only tolerated controls are CR/LF placed directly
 * after a segment terminator (or the UNA header) as inter-segment line breaks. */
export function assertEdifactUnocRepertoire(value: string): void {
  const { terminator, release, headerEnd } = serviceCharacters(value)
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0x20 && (code < 0x7f || code > 0x9f)) continue
    if (code === 0x0d || code === 0x0a) {
      let previous = index - 1
      while (previous >= 0 && (value[previous] === '\r' || value[previous] === '\n')) previous -= 1
      if (isSegmentEnd(value, previous, terminator, release) || (headerEnd > 0 && previous + 1 === headerEnd)) continue
    }
    // Deliberately omit source content: identifiers/free text can be private.
    throw new Error(`edifact_character_not_unoc:${index}:U+${code.toString(16).toUpperCase().padStart(4, '0')}`)
  }
}

/** Outbound EDIFACT interchange bytes: ISO 8859-1 and the UNOC:3 repertoire. */
export function encodeOutboundEdifactInterchange(value: string): Buffer {
  assertEdifactUnocRepertoire(value)
  return encodeEdifactLatin1(value)
}

/** Lossless ISO 8859-1 bytes (byte mapping only; repertoire is checked by callers). */
export function encodeEdifactLatin1(value: string): Buffer {
  assertEdifactLatin1Representable(value)
  return Buffer.from(value, 'latin1')
}
