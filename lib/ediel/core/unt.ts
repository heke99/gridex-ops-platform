import type { EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'

export type ParsedUnt = {
  declaredSegmentCount: number | null
  messageReference: string | null
}

export function parseUnt(segment: EdifactTokenizedSegment | null | undefined): ParsedUnt | null {
  if (!segment || segment.tag !== 'UNT') return null
  const count = Number(segment.elements[1])
  return {
    declaredSegmentCount: Number.isFinite(count) ? count : null,
    messageReference: segment.elements[2] || null,
  }
}

export function countSegmentsUnhToUnt(segments: readonly EdifactTokenizedSegment[]): number | null {
  const unhIndex = segments.findIndex((segment) => segment.tag === 'UNH')
  const untIndex = segments.findIndex((segment) => segment.tag === 'UNT')
  if (unhIndex < 0 || untIndex < unhIndex) return null
  return untIndex - unhIndex + 1
}
