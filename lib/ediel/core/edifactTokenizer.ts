import { parseUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una'

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

export type EdifactSourceSpan = Readonly<{
  startOffset: number
  endOffset: number
  /** Text offsets, never fabricated MIME/UTF8 byte offsets. */
  unit: 'utf16_code_unit'
}>

const originalSources = new WeakMap<EdifactTokenizedSegment, { raw: string; originalRaw: string; span: EdifactSourceSpan }>()

/** Original input text is observational evidence attached to the exact token.
 * Copies and changed raw text cannot inherit its provenance. */
export function segmentSourceSpan(segment: EdifactTokenizedSegment): EdifactSourceSpan | null {
  const source = originalSources.get(segment)
  return source?.raw === segment.raw ? source.span : null
}

export function segmentOriginalRaw(segment: EdifactTokenizedSegment): string | null {
  const source = originalSources.get(segment)
  return source?.raw === segment.raw ? source.originalRaw : null
}

function originalSegmentSlices(raw: string, una: EdifactServiceStringAdvice, completedOnly=false): Array<{ source: string; startOffset: number; endOffset: number }> {
  const slices: Array<{ source: string; startOffset: number; endOffset: number }> = []
  let startOffset = raw.toUpperCase().startsWith('UNA') ? 9 : 0
  let current = ''
  let released = false
  for (let index = startOffset; index < raw.length; index += 1) {
    const char = raw[index]
    // Preserve established parsing normalization while retaining original spans.
    if (char === '\r' && raw[index + 1] === '\n') { index += 1; continue }
    if (char === '\n') continue
    if (released) { current += char; released = false; continue }
    if (char === una.releaseCharacter) { current += char; released = true; continue }
    if (char === una.segmentTerminator) {
      if (current.trim()) slices.push({ source: current, startOffset, endOffset: index })
      current = ''
      startOffset = index + 1
      continue
    }
    current += char
  }
  if (released && !completedOnly) throw new Error('edifact_dangling_release_character')
  if (!completedOnly && current.trim()) slices.push({ source: current, startOffset, endOffset: raw.length })
  return slices
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

function tokenizeSegments(rawPayload:string|null|undefined,completedOnly:boolean):EdifactTokenizeResult {
  const una = parseUna(rawPayload)
  const original = String(rawPayload ?? '')
  const rawSegments = originalSegmentSlices(original, una, completedOnly)

  return {
    una,
    segments: rawSegments.map(({ source, startOffset, endOffset }, index) => {
      const raw = source.trim()
      const elements = splitReleased(raw, una.dataElementSeparator, una.releaseCharacter)
      const token: EdifactTokenizedSegment = {
        index,
        tag: String(elements[0] ?? '').toUpperCase(),
        raw,
        elements,
      }
      if (source !== raw) untrimmedSegments.set(token, source)
      originalSources.set(token, { raw, originalRaw: original.slice(startOffset, endOffset),
        span: Object.freeze({ startOffset, endOffset, unit: 'utf16_code_unit' }) })
      return token
    }),
  }
}

export function tokenizeEdifact(rawPayload:string|null|undefined):EdifactTokenizeResult{return tokenizeSegments(rawPayload,false)}
/** Technical-header observation only. Uses the same framing and decoding, but
 * returns exclusively complete terminated segments. An incomplete tail is not
 * business syntax, a national guide result or permission to apply any data. */
export function observeCompletedEdifactSegments(rawPayload:string|null|undefined):EdifactTokenizeResult{return tokenizeSegments(rawPayload,true)}

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
