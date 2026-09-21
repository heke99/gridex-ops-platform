import { parseUna, stripUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una'

export type EdifactTokenizedSegment = {
  index: number
  tag: string
  raw: string
  // Legacy decoded element strings. Use segmentComposite for structured access:
  // an escaped component separator cannot be distinguished after decoding.
  elements: string[]
}

export type EdifactTokenizeResult = {
  una: EdifactServiceStringAdvice
  segments: EdifactTokenizedSegment[]
}

// Private evidence only: no public token field, serialized metadata or string-key
// cache. Legacy raw/elements keep their established trimmed representation.
const untrimmedSegments = new WeakMap<EdifactTokenizedSegment, string>()

/** Read pre-trim segment text after existing CR/LF normalization. Only the exact
 * unchanged token can retrieve retained text; copies or mutated raw use own raw.
 * This is observational evidence, not original MIME bytes or input authority. */
export function segmentUntrimmedRaw(segment: EdifactTokenizedSegment): string {
  const retained = untrimmedSegments.get(segment)
  return retained !== undefined && retained.trim() === segment.raw ? retained : segment.raw
}

function splitReleased(
  value: string,
  separator: string,
  releaseCharacter: string,
  options: { preserveReleaseSequence?: boolean } = {},
): string[] {
  const result: string[] = []
  let current = ''
  let released = false

  for (const char of value) {
    if (released) {
      if (options.preserveReleaseSequence) current += releaseCharacter
      current += char
      released = false
      continue
    }

    if (char === releaseCharacter) {
      released = true
      continue
    }

    if (char === separator) {
      result.push(current)
      current = ''
      continue
    }

    current += char
  }

  if (released) throw new Error('edifact_dangling_release_character')

  result.push(current)
  return result
}

export function tokenizeEdifact(rawPayload: string | null | undefined): EdifactTokenizeResult {
  const una = parseUna(rawPayload)
  const body = stripUna(rawPayload).replace(/\r?\n/g, '')
  const rawSegments = splitReleased(body, una.segmentTerminator, una.releaseCharacter, {
    preserveReleaseSequence: true,
  })
    .filter((segment) => Boolean(segment.trim()))

  return {
    una,
    segments: rawSegments.map((source, index) => {
      const raw = source.trim()
      const elements = splitReleased(raw, una.dataElementSeparator, una.releaseCharacter)
      const token: EdifactTokenizedSegment = {
        index,
        tag: String(elements[0] ?? '').toUpperCase(),
        raw,
        elements,
      }
      if (source !== raw) untrimmedSegments.set(token, source)
      return token
    }),
  }
}

export function splitComposite(value: string | null | undefined, una: EdifactServiceStringAdvice = parseUna(null)): string[] {
  return splitReleased(String(value ?? ''), una.componentDataElementSeparator, una.releaseCharacter)
}

export function firstCompositeComponent(value: string | null | undefined, una?: EdifactServiceStringAdvice): string | null {
  const first = splitComposite(value, una)[0]?.trim() ?? ''
  return first.length > 0 ? first : null
}

/**
 * Decode a composite from its wire segment, retaining release sequences through
 * the outer data-element split. Splitting already-decoded `elements` would turn
 * literal component separators into structure and decode question marks twice.
 */
export function segmentComposite(
  segment: EdifactTokenizedSegment | null | undefined,
  index: number,
  una: EdifactServiceStringAdvice = parseUna(null),
): string[] {
  if (!segment) return ['']
  const wireElements = splitReleased(segment.raw, una.dataElementSeparator, una.releaseCharacter, {
    preserveReleaseSequence: true,
  })
  return splitComposite(wireElements[index], una)
}

/** Count wire data elements before decoding. Empty trailing elements still count;
 * release-escaped separators are literal content, not extra structure. */
export function segmentElementCount(segment: Pick<EdifactTokenizedSegment, 'raw'>, una: EdifactServiceStringAdvice = parseUna(null)): number {
  return splitReleased(segment.raw, una.dataElementSeparator, una.releaseCharacter, { preserveReleaseSequence: true }).length - 1
}
