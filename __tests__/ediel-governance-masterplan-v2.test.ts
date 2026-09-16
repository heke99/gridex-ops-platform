import { describe, expect, it } from 'vitest'
import {
  AUTHORITATIVE_EDIEL_GUIDES,
  resolveAuthoritativeEdielGuide,
  resolveEdielGuideAcceptance,
} from '@/lib/ediel/rulebook/guideRegistry'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'

describe('Ediel masterplan v2 governance boundaries', () => {
  it('GOV-01 source-controlled guide entries carry explicit identity and validity', () => {
    for (const guide of AUTHORITATIVE_EDIEL_GUIDES) {
      expect(guide.documentName.trim()).not.toBe('')
      expect(guide.guideRevision.trim()).not.toBe('')
      expect(guide.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(guide.authority).toBe('Svenska kraftnät')
    }
  })

  it('GOV-03 never selects the PRODAT APERAK guide as the UTILTS guide', () => {
    const utilts = resolveAuthoritativeEdielGuide({ family: 'UTILTS', referenceDate: '2026-09-30', associationAssignedCode: 'E5SE5A' })
    const aperak = resolveAuthoritativeEdielGuide({ family: 'APERAK', referenceDate: '2026-09-30', associationAssignedCode: 'E2SE6A' })
    expect(utilts.guideRevision).toBe('25-A-3')
    expect(aperak.guideRevision).toBe('16-B')
    expect(utilts.documentName).not.toBe(aperak.documentName)
  })

  it('GOV-04 outbound selection changes at the version boundary and never accepts the old guide for send', () => {
    const before = resolveEdielGuideAcceptance({ family: 'UTILTS', referenceDate: '2026-09-30', associationAssignedCode: 'E5SE5A' })
    const after = resolveEdielGuideAcceptance({ family: 'UTILTS', referenceDate: '2026-10-01', associationAssignedCode: 'E5SE5A' })
    expect(before.acceptedOutbound.map((guide) => guide.guideRevision)).toEqual(['25-A-3'])
    expect(after.acceptedOutbound.map((guide) => guide.guideRevision)).toEqual(['25-A-4'])
  })

  it('GOV-05 accepts exactly current plus immediately previous inbound guide during the two-week transition', () => {
    const first = resolveEdielGuideAcceptance({ family: 'UTILTS', referenceDate: '2026-10-01', associationAssignedCode: 'E5SE5A' })
    const last = resolveEdielGuideAcceptance({ family: 'UTILTS', referenceDate: '2026-10-14', associationAssignedCode: 'E5SE5A' })
    const expired = resolveEdielGuideAcceptance({ family: 'UTILTS', referenceDate: '2026-10-15', associationAssignedCode: 'E5SE5A' })
    expect(first.acceptedInbound.map((guide) => guide.guideRevision).sort()).toEqual(['25-A-3', '25-A-4'])
    expect(last.acceptedInbound.map((guide) => guide.guideRevision).sort()).toEqual(['25-A-3', '25-A-4'])
    expect(expired.acceptedInbound.map((guide) => guide.guideRevision)).toEqual(['25-A-4'])
  })

  it('GOV-05 does not treat the shared UNH association code as revision proof', () => {
    expect(resolveAuthoritativeEdielGuide({ family: 'UTILTS', referenceDate: '2026-09-30', associationAssignedCode: 'E5SE5A' }).guideRevision).toBe('25-A-3')
    expect(resolveAuthoritativeEdielGuide({ family: 'UTILTS', referenceDate: '2026-10-01', associationAssignedCode: 'E5SE5A' }).guideRevision).toBe('25-A-4')
  })

  it('GOV-06 returns a frozen canonical policy snapshot for one explicit reference date', () => {
    const policy = resolveCanonicalEdielPolicy({
      family: 'UTILTS', messageCode: 'S02', direction: 'inbound', referenceDate: '2026-09-30',
      associationAssignedCode: 'E5SE5A', applicationReference: '23-DDQ-S02-S',
    })
    expect(Object.isFrozen(policy)).toBe(true)
    expect(policy.referenceDate).toBe('2026-09-30')
    expect(policy.guide.guideRevision).toBe('25-A-3')
  })

  it('GOV-07 does not activate a future guide merely because it exists in the registry', () => {
    expect(resolveAuthoritativeEdielGuide({ family: 'UTILTS', referenceDate: '2026-09-30', associationAssignedCode: 'E5SE5A' }).guideRevision).toBe('25-A-3')
    expect(resolveAuthoritativeEdielGuide({ family: 'UTILTS', referenceDate: '2026-10-01', associationAssignedCode: 'E5SE5A' }).guideRevision).toBe('25-A-4')
  })
})
