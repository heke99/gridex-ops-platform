// lib/ediel/core/messageBuilder/segmentCounter.ts

export function edifactSegmentsFromPayload(rawPayload: string): string[] {
  const text = String(rawPayload ?? '')
  const normalized = text.toUpperCase().startsWith('UNA') ? text.slice(9) : text
  return normalized.split("'").map((segment) => segment.trim()).filter(Boolean)
}

export function countSegmentsBetweenUnhAndUnt(rawSegments: readonly string[]): number | null {
  const unhIndex = rawSegments.findIndex((segment) => segment.toUpperCase().startsWith('UNH+'))
  const untIndex = rawSegments.findIndex((segment) => segment.toUpperCase().startsWith('UNT+'))
  if (unhIndex < 0 || untIndex < unhIndex) return null
  return untIndex - unhIndex + 1
}

export function countMessagesInInterchange(rawSegments: readonly string[]): number {
  return rawSegments.filter((segment) => segment.toUpperCase().startsWith('UNH+')).length
}

export function assertUntUnzReferences(rawSegments: readonly string[]): { ok: boolean; issues: string[] } {
  const issues: string[] = []
  const unh = rawSegments.find((segment) => segment.toUpperCase().startsWith('UNH+')) ?? null
  const unt = rawSegments.find((segment) => segment.toUpperCase().startsWith('UNT+')) ?? null
  const unb = rawSegments.find((segment) => segment.toUpperCase().startsWith('UNB+')) ?? null
  const unz = rawSegments.find((segment) => segment.toUpperCase().startsWith('UNZ+')) ?? null

  const unhRef = unh?.split('+')[1]?.trim() ?? null
  const untRef = unt?.split('+')[2]?.trim() ?? null
  const unbRef = unb?.split('+')[5]?.trim() ?? null
  const unzRef = unz?.split('+')[2]?.trim() ?? null

  if (unhRef && untRef && unhRef !== untRef) issues.push(`UNH/UNT mismatch: ${unhRef} != ${untRef}`)
  if (unbRef && unzRef && unbRef !== unzRef) issues.push(`UNB/UNZ mismatch: ${unbRef} != ${unzRef}`)

  return { ok: issues.length === 0, issues }
}
