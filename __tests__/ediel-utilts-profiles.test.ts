import { describe, expect, it } from 'vitest'
import { UTILTS_CANONICAL_PROFILES } from '@/lib/ediel/rulebook/utiltsRulebook'

describe('UTILTS canonical profile coverage', () => {
  it('covers every production scope code', () => {
    const codes = new Set(UTILTS_CANONICAL_PROFILES.map((profile) => profile.messageCode))
    for (const code of ['S01','S02','S03','S04','S05','S06','S07','E30','E31','E66','E72','E73','E74','ERR']) {
      expect(codes.has(code as never), code).toBe(true)
    }
  })

  it('requires transactional validation for every non-error profile', () => {
    expect(UTILTS_CANONICAL_PROFILES.filter((profile) => profile.messageCode !== 'ERR').every((profile) => profile.requiresTransaction)).toBe(true)
  })
})
