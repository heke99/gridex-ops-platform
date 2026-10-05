import { describe, expect, it, vi } from 'vitest'
import { buildEdielExternalReference, buildEdielInterchangeReference, buildEdielTransactionReference, normalizeInterchangeReference } from '@/lib/ediel/core/referenceRegistry'
import { generateEdielInterchangeReference, generateEdielTransactionReference } from '@/lib/ediel/core/referenceGenerator'

describe('TEN-13 shared physical reference allocation', () => {
  it('uses all UUID entropy within the source transaction bound even with long context', () => {
    const input = { family: 'UTILTS_ERR', code: 'APERAK', relatedMessageId: '00000000-0000-0000-0000-000000000001' }
    const a = buildEdielTransactionReference(input), b = buildEdielTransactionReference(input)
    expect(a).toMatch(/^APE[0-9A-F]{32}$/); expect(a).not.toBe(b)
    expect(buildEdielExternalReference(input).length).toBeLessThanOrEqual(70)
  })
  it('shares bounded interchange generation with actual PRODAT callers without tenant counters', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => { throw Error('noncryptographic reference allocator') })
    try {
      expect(buildEdielInterchangeReference()).toMatch(/^[0-9A-F]{14}$/)
      expect(generateEdielInterchangeReference('UNB')).toMatch(/^[0-9A-F]{14}$/)
      expect(generateEdielTransactionReference('Z03')).toMatch(/^Z03[0-9A-F]{32}$/)
    } finally { vi.restoreAllMocks() }
  })
  it('preserves original physical identifiers instead of silently truncating them', () => {
    const original = 'exact-original-physical-reference-longer-than-thirty-five'
    expect(normalizeInterchangeReference(original)).toBe(original)
  })
})
