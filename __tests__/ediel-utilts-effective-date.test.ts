import { describe, expect, it } from 'vitest'
import { resolveAuthoritativeEdielGuide } from '@/lib/ediel/rulebook/guideRegistry'
import {
  assertUtiltsOutboundMessageAllowed,
  assertUtiltsRejectionReasonAllowed,
  assertUtiltsTransactionReasonAllowed,
  resolveUtiltsProcessabilityPolicy,
} from '@/lib/ediel/rulebook/utilts25A4'

describe('effective-dated UTILTS canonical rules', () => {
  it('selects 25-A-3 through 2026-09-30 and 25-A-4 from 2026-10-01', () => {
    expect(resolveAuthoritativeEdielGuide({ family: 'UTILTS', referenceDate: '2026-09-30', associationAssignedCode: 'E5SE5A' }).guideRevision).toBe('25-A-3')
    expect(resolveAuthoritativeEdielGuide({ family: 'UTILTS', referenceDate: '2026-10-01', associationAssignedCode: 'E5SE5A' }).guideRevision).toBe('25-A-4')
    expect(resolveUtiltsProcessabilityPolicy('2026-09-30').guideRevision).toBe('25-A-3')
    expect(resolveUtiltsProcessabilityPolicy('2026-10-01').guideRevision).toBe('25-A-4')
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

  it('blocks removed future codes and discontinued S08 outbound', () => {
    expect(() => assertUtiltsTransactionReasonAllowed({ referenceDate: '2026-09-30', reasonCode: 'Z03' })).not.toThrow()
    expect(() => assertUtiltsTransactionReasonAllowed({ referenceDate: '2026-10-01', reasonCode: 'Z03' })).toThrow('utilts_transaction_reason_removed:25-A-4:Z03')

    expect(() => assertUtiltsRejectionReasonAllowed({ referenceDate: '2026-09-30', reasonCode: 'E19' })).not.toThrow()
    expect(() => assertUtiltsRejectionReasonAllowed({ referenceDate: '2026-10-01', reasonCode: 'E19' })).toThrow('utilts_rejection_reason_removed:25-A-4:E19')

    expect(() => assertUtiltsOutboundMessageAllowed({ referenceDate: '2026-10-01', messageCode: 'S08' })).toThrow('utilts_s08_outbound_discontinued:2026-10-01')
  })
})
