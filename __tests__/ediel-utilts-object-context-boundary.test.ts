import { describe, expect, it } from 'vitest'

import type { EdielMessageRow } from '@/lib/ediel/types'
import { runUtiltsOperationsEngine } from '@/lib/ediel/utilts/engine'
import { validateUtilts } from '@/lib/ediel/utilts/validateUtilts'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'

const VALID_MONTHLY_E66 = [
  "UNA:+.? '",
  "UNB+UNOC:3+91100:ZZ+21660:ZZ+260831:1811+260831181101++23-DDQ-E66-S++1'",
  "UNH+1+UTILTS:D:02B:UN:E5SE5A'",
  "BGM+E66::260+GRIDEX2607E66MSG001+9+AB'",
  "DTM+137:202608311811:203'",
  "DTM+735:?+0200:406'",
  "MKS+23+E02::260'",
  "NAD+MS+91100:SVK:260'",
  "NAD+MR+21660:SVK:260'",
  "NAD+DDQ'",
  "IDE+24+GRIDEX2607E66001'",
  "LOC+172+735999260731000007::9'",
  "LOC+239+TES:SVK:260'",
  "LIN+++8716867000030:::9'",
  "DTM+324:202607010000202608010000:719'",
  "DTM+597:202608010000:203'",
  "DTM+354:1:802'",
  "STS+7++E88::260'",
  "MEA+AAZ++KWH'",
  "CCI+++E12::260'",
  "CAV+E17::260'",
  "SEQ++1'",
  "RFF+AES:101'",
  "RFF+MG:M-GRIDEX-2607-01'",
  "QTY+220:10000'",
  "DTM+597:202607010000:203'",
  "CCI+++E22::260'",
  "CAV+E27::260'",
  "SEQ++2'",
  "RFF+AES:101'",
  "QTY+220:11000'",
  "DTM+597:202608010000:203'",
  "CCI+++E22::260'",
  "CAV+E27::260'",
  "SEQ++3'",
  "QTY+136:1000'",
  "UNT+35+1'",
  "UNZ+1+260831181101'",
].join('\n')

function runtimeMessage(overrides: Partial<EdielMessageRow> = {}): EdielMessageRow {
  return {
    id: 'utilts-object-context-boundary',
    message_family: 'UTILTS',
    message_code: 'E66',
    direction: 'inbound',
    environment: 'test',
    raw_payload: VALID_MONTHLY_E66,
    validation_report: null,
    syntax_check_status: 'not_checked',
    functional_check_status: 'not_checked',
    message_received_at: '2026-08-31T18:11:00+02:00',
    created_at: '2026-08-31T18:11:00+02:00',
    ...overrides,
  } as unknown as EdielMessageRow
}

describe('UTILTS object/processability context boundary', () => {
  it('runs complete E66 structural/processability validation before tenant resolution without inventing UNKNOWN_METERING_POINT', () => {
    const result = runUtiltsRuntimeForMessage(runtimeMessage(), { referenceDate: '2026-08-31' })

    expect(result.validation.classification).toBe('accepted')
    expect(result.validation.issues.some((issue) => issue.code === 'UTILTS_E66_UNKNOWN_METERING_POINT')).toBe(false)
    expect(result.facts.meterPointId).toBe('735999260731000007')
    expect(result.normalizedPayload.quantity).toBe(1000)
  })

  it('keeps UNKNOWN_METERING_POINT fail-closed once a tenant is known but the object is unresolved', () => {
    const result = runUtiltsRuntimeForMessage(runtimeMessage({
      company_id: '11111111-1111-4111-8111-111111111111',
    }), { referenceDate: '2026-08-31' })

    expect(result.validation.classification).toBe('functional_rejected')
    expect(result.validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'UTILTS_E66_UNKNOWN_METERING_POINT',
        kind: 'functional',
        utiltsErrCode: 'E10',
      }),
    ]))
  })

  it('does not hide real E66 functional faults merely because tenant resolution has not happened yet', () => {
    const mismatched = VALID_MONTHLY_E66.replace("QTY+220:11000'", "QTY+220:11001'")
    const result = runUtiltsRuntimeForMessage(runtimeMessage({ raw_payload: mismatched }), { referenceDate: '2026-08-31' })

    expect(result.validation.classification).toBe('functional_rejected')
    expect(result.validation.issues.some((issue) => issue.code === 'UTILTS_E66_UNKNOWN_METERING_POINT')).toBe(false)
    expect(result.validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'UTILTS_E66_METER_READING_ENERGY_MISMATCH',
        utiltsErrCode: 'E19',
      }),
    ]))
  })

  it('keeps parser-only validation and operations preview on the same central runtime boundary', () => {
    const validation = validateUtilts(VALID_MONTHLY_E66)
    const operations = runUtiltsOperationsEngine({ rawPayload: VALID_MONTHLY_E66 })

    expect(validation.classification).toBe('accepted')
    expect(validation.issues.some((issue) => issue.code === 'UTILTS_E66_UNKNOWN_METERING_POINT')).toBe(false)
    expect(operations.validation.classification).toBe('accepted')
    expect(operations.validation.issues.some((issue) => issue.code === 'UTILTS_E66_UNKNOWN_METERING_POINT')).toBe(false)
  })
})
