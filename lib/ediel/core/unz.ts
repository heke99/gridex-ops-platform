import type { EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'

export type ParsedUnz = {
  messageCount: number | null
  interchangeReference: string | null
}

export function parseUnz(segment: EdifactTokenizedSegment | null | undefined): ParsedUnz | null {
  if (!segment || segment.tag !== 'UNZ') return null
  const count = Number(segment.elements[1])
  return {
    messageCount: Number.isFinite(count) ? count : null,
    interchangeReference: segment.elements[2] || null,
  }
}
