import type { EdielMessageRow } from '@/lib/ediel/types'

/** Fixed synthetic wire adapted from the existing monthly E66 regression.
 * This helper is not a source of expected register inventory. */
export function observationHandoffMessage(date = '2026-09-30', company = 'tenant-a', environment: 'test' | 'production' = 'test'): EdielMessageRow {
  const raw = [
    "UNA:+.? '",
    "UNB+UNOC:3+91100:ZZ+21660:ZZ+260831:1811+260831181101++23-DDQ-E66-S++1'",
    "UNH+1+UTILTS:D:02B:UN:E5SE5A'",
    "BGM+E66::260+GRIDEX2607E66MSG001+9+AB'",
    `DTM+137:${date.replaceAll('-', '')}1811:203'`,
    "DTM+735:?+0200:406'", "MKS+23+E02::260'",
    "NAD+MS+91100:SVK:260'", "NAD+MR+21660:SVK:260'", "NAD+DDQ'",
    "IDE+24+GRIDEX2607E66001'", "LOC+172+735999260731000007::9'", "LOC+239+TES:SVK:260'",
    "LIN+++8716867000030:::9'", "DTM+324:202607010000202608010000:719'",
    "DTM+597:202608010000:203'", "DTM+354:1:802'", "STS+7++E88::260'", "MEA+AAZ++KWH'",
    "CCI+++E12::260'", "CAV+E17::260'",
    "SEQ++1'", "RFF+AES:101'", "RFF+MG:M-GRIDEX-2607-01'", "QTY+220:10000'", "DTM+597:202607010000:203'",
    "CCI+++E22::260'", "CAV+E27::260'",
    "SEQ++2'", "RFF+AES:101'", "QTY+220:11000'", "DTM+597:202608010000:203'", "CCI+++E22::260'", "CAV+E27::260'",
    "SEQ++3'", "QTY+136:500'", "UNT+35+1'", "UNZ+1+260831181101'",
  ].join('\n')
  return {
    id: `observed-handoff-${company}-${date}`, company_id: company, environment,
    direction: 'inbound', message_family: 'UTILTS', message_code: 'E66', message_standard: 'edifact',
    message_version: 'E5SE5A', application_reference: '23-DDQ-E66-S', raw_payload: raw,
    message_received_at: `${date}T20:00:00Z`, created_at: `${date}T20:00:00Z`,
    metering_point_id: `meter-${company}`, business_match_status: 'matched', parsed_payload: {}, validation_report: null,
  } as unknown as EdielMessageRow
}

/** Accepted characterization path with no register readings. The monthly
 * observation fixture above deliberately becomes internal-review after the
 * October activation unless an authoritative structural readset is available.
 * Keep that new behavior in structural-owner integration tests; these energy
 * values retain the old diagnostic-only invariance oracle without bypassing it. */
export function energyHandoffMessage(date = '2026-10-01', company = 'tenant-a', environment: 'test' | 'production' = 'test'): EdielMessageRow {
  const message = observationHandoffMessage(date, company, environment)
  const lines = message.raw_payload!.split('\n')
  const start = lines.findIndex(line => line.startsWith('SEQ+'))
  const raw = [
    ...lines.slice(0,start).map(line => line
      .replace('23-DDQ-E66-S','23-DDQ-E66-T')
      .replace('202607010000202608010000:719','202607010000202607010015:719')
      .replace('DTM+597:202608010000:203','DTM+597:202607010020:203')
      .replace('DTM+354:1:802','DTM+354:15:806')),
    "SEQ++1'", "QTY+136:500'", "DTM+597:202607010000:203'", "STS+7++21::260'",
  ]
  raw.push(`UNT+${raw.length-1}+1'`, lines[lines.length-1])
  return {...message, application_reference:'23-DDQ-E66-T', raw_payload:raw.join('\n')}
}
