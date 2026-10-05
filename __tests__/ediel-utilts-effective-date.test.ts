// masterplan: U-07, AT-U-07, U-11
import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { resolveAuthoritativeEdielGuide } from '@/lib/ediel/rulebook/guideRegistry'
import {
  assertUtiltsOutboundMessageAllowed,
  assertUtiltsMessageUseAllowed,
  assertUtiltsRejectionReasonAllowed,
  assertUtiltsTransactionReasonAllowed,
  resolveUtiltsProcessabilityPolicy,
} from '@/lib/ediel/rulebook/utilts25A4'

describe('effective-dated UTILTS canonical rules', () => {
  it('keeps E73 eligible in the first current-guide policy after an attempted active-code change', async () => {
    vi.resetModules()
    const { UTILTS_25_A_4_POLICY, assertUtiltsOutboundMessageAllowed } = await import('@/lib/ediel/rulebook/utilts25A4')
    const { resolveCanonicalEdielPolicy } = await import('@/lib/ediel/rulebook/canonicalEdielPolicy')
    const input = { referenceDate: '2026-10-15', messageCode: 'E73' }
    expect(() => assertUtiltsOutboundMessageAllowed(input)).not.toThrow()
    const codes = UTILTS_25_A_4_POLICY.activeOutboundMessageCodes
    const index = codes.indexOf('E73')
    expect(index).toBeGreaterThanOrEqual(0)
    const changed = Reflect.set(codes, String(index), 'BOGUS')
    try {
      const policy = resolveCanonicalEdielPolicy({
        family: 'UTILTS', ...input, direction: 'outbound',
        applicationReference: '23-DDQ-E66-S', mode: 'catalog_evidence',
      })
      expect(policy.guide.guideRevision).toBe('25-A-4')
      expect(policy.utiltsProcessability?.activeOutboundMessageCodes).toContain('E73')
      expect(changed).toBe(false)
    } finally {
      // A broken source may be frozen by the first policy; discard that graph.
      vi.resetModules()
    }
  })

  it.each([
    ['2026-09-30', '25-A-3', true],
    ['2026-10-01', '25-A-4', false],
  ] as const)('keeps the published %s comparison rule after an attempted policy change', async (date, revision, compares) => {
    vi.resetModules()
    const { resolveUtiltsProcessabilityPolicy } = await import('@/lib/ediel/rulebook/utilts25A4')
    const source = resolveUtiltsProcessabilityPolicy(date)
    const changed = Reflect.set(source, 'compareMeterReadingsToEnergyVolumes', !compares)
    try {
      const selected = resolveUtiltsProcessabilityPolicy(date)
      expect(selected.guideRevision).toBe(revision)
      expect(selected.compareMeterReadingsToEnergyVolumes).toBe(compares)
      expect(changed).toBe(false)
    } finally {
      if (changed) Reflect.set(source, 'compareMeterReadingsToEnergyVolumes', compares)
      vi.resetModules()
    }
  })

  it.each(['2026-09-30', '2026-10-15'])('retains the original nested source identity in the first %s policy', async (date) => {
    vi.resetModules()
    const { resolveUtiltsProcessabilityPolicy } = await import('@/lib/ediel/rulebook/utilts25A4')
    const { resolveCanonicalEdielPolicy } = await import('@/lib/ediel/rulebook/canonicalEdielPolicy')
    const source = resolveUtiltsProcessabilityPolicy(date)
    const originalHash = source.structuralComparisonSource.sha256
    const originalSections = [...source.structuralComparisonSource.sections]
    const originalSection = source.source.section
    const changed = [
      Reflect.set(source.structuralComparisonSource, 'sha256', 'f'.repeat(64)),
      Reflect.set(source.structuralComparisonSource.sections, '0', 'unqualified locator'),
      Reflect.set(source.source, 'section', 'unqualified section'),
    ]
    try {
      const selected = resolveCanonicalEdielPolicy({
        family: 'UTILTS', messageCode: 'E73', direction: 'outbound', referenceDate: date,
        applicationReference: '23-DDQ-E66-S', mode: 'catalog_evidence',
      }).utiltsProcessability!
      expect(selected.structuralComparisonSource.sha256).toBe(originalHash)
      expect(selected.structuralComparisonSource.sections).toEqual(originalSections)
      expect(selected.source.section).toBe(originalSection)
      expect(changed).toEqual([false, false, false])
    } finally {
      vi.resetModules()
    }
  })

  it.each(['rejection', 'transaction'] as const)('does not revive a current removed %s code after an attempted array change', async (kind) => {
    vi.resetModules()
    const source = await import('@/lib/ediel/rulebook/utilts25A4')
    const policy = source.resolveUtiltsProcessabilityPolicy('2026-10-01')
    const codes = kind === 'rejection' ? policy.removedRejectionReasonCodes : policy.removedTransactionReasonCodes
    const reasonCode = kind === 'rejection' ? 'E19' : 'Z03'
    const changed = Reflect.set(codes, '0', 'BOGUS')
    try {
      const assertAllowed = kind === 'rejection' ? source.assertUtiltsRejectionReasonAllowed : source.assertUtiltsTransactionReasonAllowed
      expect(() => assertAllowed({ referenceDate: '2026-10-01', reasonCode })).toThrow(`utilts_${kind}_reason_removed:25-A-4:${reasonCode}`)
      expect(changed).toBe(false)
    } finally {
      if (changed) Reflect.set(codes, '0', reasonCode)
      vi.resetModules()
    }
  })

  it('selects 25-A-3 through 2026-09-30 and 25-A-4 from 2026-10-01', () => {
    expect(resolveAuthoritativeEdielGuide({ family: 'UTILTS', referenceDate: '2026-09-30', associationAssignedCode: 'E5SE5A' }).guideRevision).toBe('25-A-3')
    expect(resolveAuthoritativeEdielGuide({ family: 'UTILTS', referenceDate: '2026-10-01', associationAssignedCode: 'E5SE5A' }).guideRevision).toBe('25-A-4')
    expect(resolveUtiltsProcessabilityPolicy('2026-09-30').guideRevision).toBe('25-A-3')
    expect(resolveUtiltsProcessabilityPolicy('2026-10-01').guideRevision).toBe('25-A-4')
  })

  it.each(['2025-06-01', '2026-09-30', '2026-10-01'])('qualifies source-backed meter/register comparison on %s', date => {
    expect(resolveUtiltsProcessabilityPolicy(date).validateMeterAndRegisterAgainstStructuralInformation).toBe(true)
  })

  it('rejects policy dates before the prior guide became effective', () => {
    expect(() => resolveUtiltsProcessabilityPolicy('2025-05-31')).toThrow('utilts_guide_not_effective:2025-05-31')
  })

  it('encodes the exact 25-A-4 processability changes without mutating 25-A-3 history', () => {
    const current = resolveUtiltsProcessabilityPolicy('2026-09-30')
    const future = resolveUtiltsProcessabilityPolicy('2026-10-01')

    expect(current.compareMeterReadingsToEnergyVolumes).toBe(true)
    expect(future.compareMeterReadingsToEnergyVolumes).toBe(false)
    expect(current.endMeterReadingBelowStartIsError).toBe(true)
    expect(future.endMeterReadingBelowStartIsError).toBe(false)
    expect(future.validateIndividualMeteringPointEnergyValuesBeyondE30).toBe(false)
    expect(future.validateMeterAndRegisterAgainstStructuralInformation).toBe(true)
    expect(future.removedFieldNumbers).toEqual(['535', '536', '537', '538'])
    expect(future.removedRejectionReasonCodes).toContain('E19')
    expect(future.removedTransactionReasonCodes).toContain('Z03')
  })

  it.each(['2026-09-30', '2026-10-01'])('holds unused S06 outbound while retaining historical parsing on %s', date => {
    expect(() => assertUtiltsOutboundMessageAllowed({referenceDate:date, messageCode:'S06'})).toThrow('utilts_s06_outbound_not_in_use')
    expect(resolveUtiltsProcessabilityPolicy(date).activeOutboundMessageCodes).not.toContain('S06')
    expect(() => assertUtiltsMessageUseAllowed({referenceDate:date, messageCode:'S06', mode:'historical_replay'})).not.toThrow()
  })

  it('blocks removed future codes and discontinued S08 outbound', () => {
    expect(() => assertUtiltsTransactionReasonAllowed({ referenceDate: '2026-09-30', reasonCode: 'Z03' })).not.toThrow()
    expect(() => assertUtiltsTransactionReasonAllowed({ referenceDate: '2026-10-01', reasonCode: 'Z03' })).toThrow('utilts_transaction_reason_removed:25-A-4:Z03')

    expect(() => assertUtiltsRejectionReasonAllowed({ referenceDate: '2026-09-30', reasonCode: 'E19' })).not.toThrow()
    expect(() => assertUtiltsRejectionReasonAllowed({ referenceDate: '2026-10-01', reasonCode: 'E19' })).toThrow('utilts_rejection_reason_removed:25-A-4:E19')

    expect(() => assertUtiltsOutboundMessageAllowed({ referenceDate: '2026-10-01', messageCode: 'S08' })).toThrow('utilts_s08_outbound_discontinued:2026-10-01')
  })
})
