import { describe, expect, it } from 'vitest'
import { resolveAuthoritativeEdielGuide } from '@/lib/ediel/rulebook/guideRegistry'
import { selectRulebookVersion } from '@/lib/ediel/rulebook/versionSelector'

describe('E058 / GOV-03 source-bound APERAK profiles', () => {
  it('does not model GAS 16-B as a generic electricity APERAK revision', () => {
    const prodatAperak = resolveAuthoritativeEdielGuide({
      family: 'APERAK',
      referenceDate: '2026-09-30',
      associationAssignedCode: 'E2SE6A',
    })
    expect(prodatAperak.guideRevision).toBe('26-A')
    expect(prodatAperak.associationAssignedCode).toBe('E2SE6A')

    expect(() => resolveAuthoritativeEdielGuide({
      family: 'APERAK',
      referenceDate: '2026-09-30',
    })).toThrow(/ediel_guide_resolution_ambiguous:APERAK/)
  })

  it('binds UTILTS-origin APERAK to the effective UTILTS revision', () => {
    const september = resolveAuthoritativeEdielGuide({
      family: 'APERAK',
      referenceDate: '2026-09-30',
      associationAssignedCode: 'E5SE5A',
    })
    const october = resolveAuthoritativeEdielGuide({
      family: 'APERAK',
      referenceDate: '2026-10-01',
      associationAssignedCode: 'E5SE5A',
    })

    expect(september.guideRevision).toBe('25-A-3')
    expect(october.guideRevision).toBe('25-A-4')
  })

  it('selects the P-family wire profile for PRODAT acknowledgements', () => {
    const selection = selectRulebookVersion({
      family: 'APERAK',
      code: 'APERAK',
      referenceDate: '2026-09-30',
      sourceMessageFamily: 'PRODAT',
    })

    expect(selection.selectedVersion).toBe('E2SE6A')
    expect(selection.guideRevision).toBe('26-A')
    expect(selection.messageTypeToken).toBe('APERAK:D:96A:UN:E2SE6A')
  })

  it('selects the U-family wire profile for UTILTS and UTILTS_ERR acknowledgements', () => {
    for (const sourceMessageFamily of ['UTILTS', 'UTILTS_ERR'] as const) {
      const selection = selectRulebookVersion({
        family: 'APERAK',
        code: 'APERAK',
        referenceDate: '2026-09-30',
        sourceMessageFamily,
      })
      expect(selection.selectedVersion).toBe('E5SE5A')
      expect(selection.guideRevision).toBe('25-A-3')
      expect(selection.messageTypeToken).toBe('APERAK:D:04A:UN:E5SE5A')
    }
  })

  it('fails closed when APERAK source family is not known', () => {
    expect(() => selectRulebookVersion({
      family: 'APERAK',
      code: 'APERAK',
      referenceDate: '2026-09-30',
    })).toThrow('ediel_aperak_source_family_required:missing')
  })
})
