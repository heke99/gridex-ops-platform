import { parseEdifact } from '@/lib/ediel/core/edifactParser'
import { countSegmentsUnhToUnt } from '@/lib/ediel/core/unt'

export type SegmentCountResult = {
  declaredUntCount: number | null
  actualUntCount: number | null
  messageReference: string | null
  ok: boolean
}

export function countEdifactMessageSegments(rawPayload: string | null | undefined): SegmentCountResult {
  const parsed = parseEdifact(rawPayload)
  const actual = countSegmentsUnhToUnt(parsed.segments)
  const declared = parsed.unt?.declaredSegmentCount ?? null

  return {
    declaredUntCount: declared,
    actualUntCount: actual,
    messageReference: parsed.unt?.messageReference ?? parsed.unh?.messageReference ?? null,
    ok: declared !== null && actual !== null && declared === actual,
  }
}
