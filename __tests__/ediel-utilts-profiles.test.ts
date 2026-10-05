import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { UTILTS_CANONICAL_PROFILES } from '@/lib/ediel/rulebook/utiltsRulebook'

describe('UTILTS canonical profile coverage', () => {
  it('keeps the published E73 phase in the first actual current-guide policy', async () => {
    vi.resetModules()
    const { UTILTS_CANONICAL_PROFILES } = await import('@/lib/ediel/rulebook/utiltsRulebook')
    const { resolveCanonicalEdielPolicy } = await import('@/lib/ediel/rulebook/canonicalEdielPolicy')
    const source = UTILTS_CANONICAL_PROFILES.find(row => row.messageCode === 'E73')!
    const changed = Reflect.set(source, 'phase', 'settlement')
    try {
      const policy = resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'E73', direction: 'outbound',
        referenceDate: '2026-10-15', applicationReference: '23-DDQ-E66-S', mode: 'catalog_evidence' })
      expect(policy.guide.guideRevision).toBe('25-A-4')
      expect(policy.phase).toBe('metering')
      expect(policy.utiltsProfile?.phase).toBe('metering')
      expect(changed).toBe(false)
    } finally {
      if (changed) Reflect.set(source, 'phase', 'metering')
      vi.resetModules()
    }
  })

  it('retains all existing nested profile arrays in the first actual canonical projection', async () => {
    vi.resetModules()
    const { UTILTS_CANONICAL_PROFILES } = await import('@/lib/ediel/rulebook/utiltsRulebook')
    const { resolveCanonicalEdielPolicy } = await import('@/lib/ediel/rulebook/canonicalEdielPolicy')
    const source = UTILTS_CANONICAL_PROFILES.find(row => row.messageCode === 'E73')!
    const keys = ['requiredSignals', 'agtCases', 'allowedSenderRoles', 'allowedReceiverRoles'] as const
    const originals = keys.map(key => [...source[key]])
    const changed = keys.map(key => Reflect.set(source[key], '0', 'UNQUALIFIED'))
    try {
      const profile = resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'E73', direction: 'outbound',
        referenceDate: '2026-10-15', applicationReference: '23-DDQ-E66-S', mode: 'catalog_evidence' }).utiltsProfile!
      expect(keys.map(key => profile[key])).toEqual(originals)
      expect(changed).toEqual([false, false, false, false])
    } finally {
      // The selected copy can freeze shared arrays; discard the isolated graph.
      vi.resetModules()
    }
  })

  it('retains the published E73 profile key after an attempted backing-row replacement', async () => {
    vi.resetModules()
    const { UTILTS_CANONICAL_PROFILES } = await import('@/lib/ediel/rulebook/utiltsRulebook')
    const { resolveCanonicalEdielPolicy } = await import('@/lib/ediel/rulebook/canonicalEdielPolicy')
    const index = UTILTS_CANONICAL_PROFILES.findIndex(row => row.messageCode === 'E73')
    const original = UTILTS_CANONICAL_PROFILES[index]
    const changed = Reflect.set(UTILTS_CANONICAL_PROFILES, String(index), { ...original, profileKey: 'unqualified_profile' })
    try {
      const policy = resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'E73', direction: 'outbound',
        referenceDate: '2026-10-15', applicationReference: '23-DDQ-E66-S', mode: 'catalog_evidence' })
      expect(policy.profileKey).toBe('utilts_e73')
      expect(changed).toBe(false)
    } finally {
      if (changed) Reflect.set(UTILTS_CANONICAL_PROFILES, String(index), original)
      vi.resetModules()
    }
  })

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
