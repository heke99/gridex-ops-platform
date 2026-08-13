import { parseUna, stripUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una'

export type EdifactTokenizedSegment = {
  index: number
  tag: string
  raw: string
  elements: string[]
}

export type EdifactTokenizeResult = {
  una: EdifactServiceStringAdvice
  segments: EdifactTokenizedSegment[]
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
    .map((segment) => segment.trim())
    .filter(Boolean)

  return {
    una,
    segments: rawSegments.map((raw, index) => {
      const elements = splitReleased(raw, una.dataElementSeparator, una.releaseCharacter)
      return {
        index,
        tag: String(elements[0] ?? '').toUpperCase(),
        raw,
        elements,
      }
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
