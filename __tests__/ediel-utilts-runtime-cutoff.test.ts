import { describe, expect, it } from 'vitest'

import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { resolveCanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'
import { buildAperakDraft } from '@/lib/ediel/ack'
import { observationHandoffMessage } from './helpers/utiltsObservationHandoff'

describe('UTILTS runtime effective-date cutoff', () => {
  it('rejects an invalid E66 market header as guide error before a real E19 mismatch', () => {
    const control = observationHandoffMessage('2026-09-30', 'tenant-header')
    const message = { ...control, sender_ediel_id: '91100', receiver_ediel_id: '21660',
      raw_payload: control.raw_payload!.replace('MKS+23+E02::260', 'MKS+99+E02::260') }
    const result = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-09-30' })

    expect(result.validation.classification).toBe('application_rejected')
    expect(result.transactionDispositions.map(item => item.responseType)).toEqual(['negative_aperak'])
    expect(result.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldCode: '501' }),
    ]))
    expect(result.ackPlan.utiltsErrDetails).toEqual([])
    const decision = resolveCanonicalRuntimeDecision(message)
    expect(decision).toMatchObject({ syntaxDecision: 'accepted', applicationDecision: 'rejected', functionalDecision: 'accepted' })
    expect(decision.responsePlan.some(item => item.family === 'UTILTS_ERR')).toBe(false)
    const plan = decision.responsePlan.find(item => item.family === 'APERAK')!
    expect(plan).toMatchObject({ outcome: 'negative', applicationErrors: [{ fieldCode: '501', ercCode: '42' }] })
    expect(buildAperakDraft({ sourceMessage: message, outcome: 'negative', applicationErrors: plan.applicationErrors }).rawPayload).toContain('FTX+AAO++501::260')
  })
  it('keeps field 501 required and reads its value with the declared UNA', () => {
    const control = observationHandoffMessage('2026-09-30', 'tenant-una')
    const missing = runUtiltsRuntimeForMessage({ ...control, raw_payload: control.raw_payload!.replace('MKS+23+E02::260\'\n', '') }, { referenceDate: '2026-09-30' })
    expect(missing.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([expect.objectContaining({ fieldCode: '501', ercCode: '41' })]))
    expect(missing.ackPlan.utiltsErrDetails).toEqual([])

    const custom = control.raw_payload!.split('\n').map((segment, index) => index === 0
      ? 'UNA*;.? ~'
      : segment.replaceAll('+', ';').replaceAll(':', '*').replaceAll("'", '~')).join('\n')
    const valid = runUtiltsRuntimeForMessage({ ...control, raw_payload: custom }, { referenceDate: '2026-09-30' })
    expect(valid.validation.issues.some(issue => issue.code === 'UTILTS_MARKET_INVALID' || issue.code === 'MKS_MISSING')).toBe(false)
    const invalid = runUtiltsRuntimeForMessage({ ...control, raw_payload: custom.replace('MKS;23;', 'MKS;99;') }, { referenceDate: '2026-09-30' })
    expect(invalid.validation.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'UTILTS_MARKET_INVALID', aperakFieldCode: '501' })]))
  })
  it('keeps E19 through 25-A-3 and removes the same processability rejection from 25-A-4', () => {
    // The complete monthly original has a real 1000/500 reading-energy
    // mismatch. The old minimal wire also lacked mandatory guide fields,
    // so its E19 was never an eligible functional rejection.
    const message = observationHandoffMessage('2026-09-30', 'tenant-cutoff')
    const beforeCutoff = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-09-30' })
    const afterCutoff = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-10-01' })

    expect(beforeCutoff.validation.issues.some((issue) => issue.kind === 'application' && issue.severity === 'error')).toBe(false)

    expect(
      beforeCutoff.validation.issues.some(
        (issue) =>
          issue.code === 'UTILTS_E66_METER_READING_ENERGY_MISMATCH' &&
          issue.utiltsErrCode === 'E19',
      ),
    ).toBe(true)
    expect(beforeCutoff.ackPlan.utiltsErrCodes).toContain('E19')

    expect(
      afterCutoff.validation.issues.some(
        (issue) =>
          issue.code === 'UTILTS_E66_METER_READING_ENERGY_MISMATCH' ||
          issue.utiltsErrCode === 'E19',
      ),
    ).toBe(false)
    expect(afterCutoff.ackPlan.utiltsErrCodes).not.toContain('E19')
  })
})
