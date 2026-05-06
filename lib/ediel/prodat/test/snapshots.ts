// lib/ediel/prodat/test/snapshots.ts

import type { ProdatSnapshotAssertion } from '@/lib/ediel/prodat/types'

function normalizeSegments(segments: string[]): string[] {
  return segments.map((segment) => segment.trim()).filter(Boolean)
}

export function createProdatSnapshot(name: string, segments: string[]): {
  name: string
  segments: string[]
  createdAt: string
} {
  return {
    name,
    segments: normalizeSegments(segments),
    createdAt: new Date().toISOString(),
  }
}

export function assertProdatSnapshot(params: {
  name: string
  expected: string[]
  actual: string[]
}): ProdatSnapshotAssertion {
  const expected = normalizeSegments(params.expected)
  const actual = normalizeSegments(params.actual)
  const max = Math.max(expected.length, actual.length)
  const diff: string[] = []

  for (let index = 0; index < max; index += 1) {
    const expectedSegment = expected[index] ?? '<missing>'
    const actualSegment = actual[index] ?? '<missing>'
    if (expectedSegment !== actualSegment) {
      diff.push(`#${index + 1} expected ${expectedSegment} actual ${actualSegment}`)
    }
  }

  return {
    name: params.name,
    expected,
    actual,
    passed: diff.length === 0,
    diff,
  }
}
