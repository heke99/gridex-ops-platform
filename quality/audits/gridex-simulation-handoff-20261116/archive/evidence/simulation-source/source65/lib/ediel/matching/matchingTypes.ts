import type { EdielMessageRow } from '@/lib/ediel/types'

export type EdielMatchConfidence = 'high' | 'medium' | 'low'

export type EdielMatchCandidate = {
  entityType: 'customer' | 'site' | 'metering_point' | 'process' | 'permission'
  entityId: string | null
  confidence: EdielMatchConfidence
  score: number
  reason: string
  details: Record<string, unknown>
}

export type EdielBusinessMatchResult = {
  confidence: EdielMatchConfidence
  customerId: string | null
  siteId: string | null
  meteringPointId: string | null
  processId: string | null
  processType: string | null
  permissionId: string | null
  candidates: EdielMatchCandidate[]
  reasons: string[]
  warnings: string[]
  manualReviewReason: string | null
}

export type EdielMatchInput = {
  message: EdielMessageRow
  companyId?: string | null
}

export function cleanMatchText(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > 0 ? text : null
}

export function upperMatchText(value: unknown): string | null {
  const clean = cleanMatchText(value)
  return clean ? clean.toUpperCase() : null
}

export function compactMatchCandidates(candidates: EdielMatchCandidate[]): EdielMatchCandidate[] {
  const byKey = new Map<string, EdielMatchCandidate>()
  for (const candidate of candidates) {
    const key = `${candidate.entityType}:${candidate.entityId ?? 'none'}:${candidate.reason}`
    const current = byKey.get(key)
    if (!current || candidate.score > current.score) byKey.set(key, candidate)
  }
  return [...byKey.values()].sort((a, b) => b.score - a.score)
}

export function confidenceFromScore(score: number): EdielMatchConfidence {
  if (score >= 140) return 'high'
  if (score >= 80) return 'medium'
  return 'low'
}
