import { describe, expect, it } from 'vitest'

import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { observationHandoffMessage } from './helpers/utiltsObservationHandoff'

describe('UTILTS runtime effective-date cutoff', () => {
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
