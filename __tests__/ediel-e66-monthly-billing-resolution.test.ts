import { describe, expect, it } from 'vitest'

import type { EdielMessageRow } from '@/lib/ediel/types'
import { ingestUtiltsE66MeteringValues } from '@/lib/ediel/metering/meteringValueEngine'
import { parseE66, parseE66Observations } from '@/lib/ediel/utilts/e66'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'

export const MONTHLY_E66_BILLING_PAYLOAD = [
  "UNA:+.? '",
  "UNB+UNOC:3+92825:ZZ+21660:ZZ+260831:1811+260831181101++23-DDQ-E66-S++1'",
  "UNH+1+UTILTS:D:02B:UN:E5SE5A'",
  "BGM+E66::260+GRIDEX2607E66MSG001+9+AB'",
  "DTM+137:202608311811:203'",
  "DTM+735:?+0200:406'",
  "MKS+23+E02::260'",
  "NAD+MS+92825:SVK:260'",
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

describe('UTILTS E66 monthly billing resolution', () => {
  it('preserves EDIFACT 802 as one month and only emits QTY+136 as billable energy', () => {
    const parsed = parseE66(MONTHLY_E66_BILLING_PAYLOAD)
    expect(parsed.transactions).toHaveLength(1)
    expect(parsed.transactions[0]?.resolution).toBe('1')
    expect(parsed.transactions[0]?.resolutionFormat).toBe('802')

    const observations = parseE66Observations(MONTHLY_E66_BILLING_PAYLOAD)
    expect(observations).toHaveLength(1)
    expect(observations[0]).toMatchObject({
      quantity: 1000,
      qualityStatus: '136',
      measurementResolution: 'P1M',
      meteringPointExternalId: '735999260731000007',
      gridAreaId: 'TES',
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-08-01T00:00:00.000Z',
      sourceOrder: 2,
    })
  })

  it('normalizes the billing ingest to monthly resolution without treating register reads as kWh', async () => {
    const result = await ingestUtiltsE66MeteringValues({
      companyId: '11111111-1111-4111-8111-111111111111',
      meteringPointId: '22222222-2222-4222-8222-222222222222',
      utiltsMessageId: '33333333-3333-4333-8333-333333333333',
      rawPayload: MONTHLY_E66_BILLING_PAYLOAD,
      persist: false,
    })

    expect(result.normalized.resolution).toBe('P1M')
    expect(result.normalized.values).toHaveLength(1)
    expect(result.normalized.values[0]?.quantity).toBe(1000)
    expect(result.normalized.values[0]?.quality).toBe('measured')
    expect(result.gaps).toEqual([])
  })

  it('does not reject the official monthly 802 structure with a minute-based DST count error', () => {
    const message = {
      id: 'monthly-e66-runtime-regression',
      company_id: '11111111-1111-4111-8111-111111111111',
      message_family: 'UTILTS',
      message_code: 'E66',
      raw_payload: MONTHLY_E66_BILLING_PAYLOAD,
      validation_report: null,
      syntax_check_status: 'not_checked',
      message_received_at: '2026-08-31T18:11:00+02:00',
      metering_point_id: '22222222-2222-4222-8222-222222222222',
      business_match_status: 'matched',
    } as unknown as EdielMessageRow

    const result = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-08-31' })
    expect(result.validation.issues.some((issue) => issue.code === 'UTILTS_DST_INTERVAL_COUNT_MISMATCH')).toBe(false)
    expect(result.validation.classification).toBe('accepted')
  })
})
