import { describe, expect, it } from 'vitest'

import type { EdielMessageRow } from '@/lib/ediel/types'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'

const E66_MISMATCH_PAYLOAD =
  "UNA:+.? '" +
  "UNB+UNOC:3+SENDER:14+RECEIVER:14+260930:1200+REF1++23-DDQ-E66-S++1'" +
  "UNH+1+UTILTS:D:04A:UN:E5SE5A'" +
  "BGM+E66+MSG1+9'" +
  "IDE+24+TX1'" +
  "LOC+172+735999000000000001'" +
  "QTY+101:10'" +
  "QTY+203:20'" +
  "QTY+136:5'" +
  "UNT+8+1'" +
  "UNZ+1+REF1'"

function message(): EdielMessageRow {
  return {
    id: 'utilts-cutoff-regression',
    message_family: 'UTILTS',
    message_code: 'E66',
    raw_payload: E66_MISMATCH_PAYLOAD,
    validation_report: null,
    syntax_check_status: 'not_checked',
    message_received_at: '2026-09-30T12:00:00Z',
    metering_point_id: '11111111-1111-4111-8111-111111111111',
    business_match_status: 'matched',
  } as unknown as EdielMessageRow
}

describe('UTILTS runtime effective-date cutoff', () => {
  it('keeps E19 through 25-A-3 and removes the same processability rejection from 25-A-4', () => {
    const beforeCutoff = runUtiltsRuntimeForMessage(message(), { referenceDate: '2026-09-30' })
    const afterCutoff = runUtiltsRuntimeForMessage(message(), { referenceDate: '2026-10-01' })

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
