// Byte-correct MIME text decoding shared by the manual and Ediel pollers.
//
// Transfer decoding (base64 / quoted-printable) always yields BYTES; those
// bytes are then decoded with the part's declared charset. EDIFACT payloads
// declare their own character set in the UNB syntax identifier, which wins
// over the MIME charset (UNOA/UNOB/UNOC -> ISO-8859-1, UNOW/UNOY -> UTF-8).

export type TextCharset = 'utf-8' | 'iso-8859-1' | 'windows-1252' | 'us-ascii'

export function normalizeCharset(value: string | null | undefined): TextCharset | null {
  const charset = (value ?? '').trim().replace(/^"|"$/g, '').toLowerCase()
  if (!charset) return null
  if (['utf-8', 'utf8'].includes(charset)) return 'utf-8'
  if (['iso-8859-1', 'iso8859-1', 'iso_8859-1', 'latin1', 'latin-1', 'l1', 'iso-8859-15', 'iso8859-15'].includes(charset)) return 'iso-8859-1'
  if (['windows-1252', 'cp1252', 'x-cp1252'].includes(charset)) return 'windows-1252'
  if (['us-ascii', 'ascii'].includes(charset)) return 'us-ascii'
  return null
}

// Raw message bytes as a byte-preserving string (one char per byte).
export function toBinaryString(source: Buffer | Uint8Array | string): string {
  if (typeof source === 'string') return Buffer.from(source, 'utf8').toString('latin1')
  return Buffer.from(source).toString('latin1')
}

export function binaryToBuffer(binary: string): Buffer {
  return Buffer.from(binary, 'latin1')
}

export function decodeTransferEncoding(body: string, encoding: string | null | undefined): Buffer {
  const normalized = (encoding ?? '').trim().toLowerCase()
  if (normalized === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64')
  if (normalized === 'quoted-printable') {
    return binaryToBuffer(
      body
        .replace(/[ \t]+(?=\r?\n)/g, '')
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))),
    )
  }
  return binaryToBuffer(body)
}

const EDIFACT_SYNTAX_CHARSET: Record<string, TextCharset> = {
  UNOA: 'iso-8859-1',
  UNOB: 'iso-8859-1',
  UNOC: 'iso-8859-1',
  UNOW: 'utf-8',
  UNOY: 'utf-8',
}

// Reads the UNB syntax identifier (after an optional UNA service string).
export function edifactSyntaxCharset(bytes: Buffer): TextCharset | null {
  const head = bytes.subarray(0, 4096).toString('latin1')
  // UNB starts the message or follows a segment terminator (also the UNA one).
  const match = /(?:^|['\r\n])\s*UNB\+(UNO[A-Z])\b/.exec(head)
  return match ? EDIFACT_SYNTAX_CHARSET[match[1]] ?? null : null
}

// windows-1252 code points for 0x80-0x9F (undefined bytes keep their C1 value).
// Implemented locally because small-icu Node builds decode it as plain latin1.
const CP1252_C1 = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
]

function decodeWith(bytes: Buffer, charset: TextCharset): string {
  if (charset === 'utf-8' || charset === 'us-ascii') return bytes.toString('utf8')
  const latin1 = bytes.toString('latin1')
  if (charset === 'iso-8859-1') return latin1
  return latin1.replace(/[\x80-\x9f]/g, (char) => String.fromCharCode(CP1252_C1[char.charCodeAt(0) - 0x80]))
}

function isValidUtf8(bytes: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

// Decodes text bytes: EDIFACT syntax identifier first, then the declared
// charset, then UTF-8 when valid, else ISO-8859-1 (lossless for any byte).
export function decodeTextBytes(bytes: Buffer, declaredCharset?: string | null): string {
  const charset = edifactSyntaxCharset(bytes) ?? normalizeCharset(declaredCharset)
  if (charset) return decodeWith(bytes, charset)
  return isValidUtf8(bytes) ? bytes.toString('utf8') : decodeWith(bytes, 'iso-8859-1')
}

// Text representation of the complete raw source for storage: UTF-8 when the
// bytes are valid UTF-8, otherwise ISO-8859-1 so no byte is replaced by U+FFFD.
export function rawSourceToText(source: unknown): string | null {
  if (!source) return null
  if (typeof source === 'string') return source
  if (!Buffer.isBuffer(source) && !(source instanceof Uint8Array)) return null
  const bytes = Buffer.from(source)
  return isValidUtf8(bytes) ? bytes.toString('utf8') : bytes.toString('latin1')
}
