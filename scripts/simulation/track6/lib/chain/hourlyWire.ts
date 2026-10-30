// Ursprung: 3ea5cd2b6d37b910674e71993ac94e5720ed31a8 (origin/claude/sim-20261029-track1):scripts/simulation/track1/fixtures/wire.ts (buildDayWire)
// Ändrat: EN UTILTS E66-T med 24 TIMVÄRDEN (DTM+354:1:805, en SEQ per timme) i stället för 96 kvartsvärden, och transaktions-ID
// bundet till kunden (flera kunder i samma månad/dag). Syntetisk nätägar-wire; ingen IMAP.
import { createHash, randomUUID } from 'node:crypto'
import { energyHandoffMessage } from '@/__tests__/helpers/utiltsObservationHandoff'
import { utiltsNativeSourceFixture, utiltsRecountUnt, utiltsTestEnvironmentWire } from '@/__tests__/helpers/utiltsNativeSourceFixture'
import { edifactOffset, formatMilliKwh, hourMilliKwh, HOURS_PER_DAY, localStamp, type SyntheticMonth } from './synthetic'

export type HourlyWire = {
  sourceId: string
  raw: string
  parsed: ReturnType<typeof utiltsNativeSourceFixture>['parsed']
  txRef: string
  bgmRef: string
  /** ISO instant at which the file is received (06:30 local the day after the readings). */
  receivedAt: string
  values: number
  totalMilliKwh: number
}

export function buildHourlyDayWire(input: {
  month: SyntheticMonth
  day: number
  salt: number
  companyId: string
  external: string
  /** Own supplier EDIEL id (message receiver). */
  sender: string
  /** Synthetic grid owner EDIEL id (message issuer). */
  receiver: string
  sourceId?: string
}): HourlyWire {
  const { month, day, salt } = input
  const nextDayStamp = localStamp(month, day, 24 * 60).slice(0, 8)
  const base = energyHandoffMessage('2026-10-01', input.companyId)
  const lines = base.raw_payload!.split('\n')
  const at = lines.findIndex(entry => entry.startsWith('SEQ+'))
  const startStamp = localStamp(month, day, 0), endStamp = localStamp(month, day, 24 * 60)
  const txRef = `H${createHash('sha256').update(`${input.companyId}:${input.external}:${month.billingMonth}:${day}`).digest('hex').slice(0, 15).toUpperCase()}`
  const sourceId = input.sourceId ?? randomUUID()
  const bgmRef = `M${sourceId.replaceAll('-', '').slice(0, 20)}`
  const unbDate = `${nextDayStamp.slice(2, 8)}:0600`
  const head = lines.slice(0, at).map(entry => entry
    .replace("DTM+735:?+0200:406'", `DTM+735:?${edifactOffset(month.offsetMinutes)}:406'`)
    .replace(/DTM\+137:\d{12}:203/, `DTM+137:${nextDayStamp}0600:203`)
    .replace('202607010000202607010015:719', `${startStamp}${endStamp}:719`)
    .replace('DTM+597:202607010020:203', `DTM+597:${endStamp}:203`)
    // HOURLY resolution: 1 hour, format 805 (lib/ediel/utilts/resolution.ts:11, quantityPrecision.ts:62).
    .replace("DTM+354:15:806'", "DTM+354:1:805'")
    .replace('IDE+24+GRIDEX2607E66001', `IDE+24+${txRef}`)
    .replace('735999260731000007', input.external)
    .replace(/^(UNB\+UNOC:3\+[^+]*\+[^+]*\+)260831:1811/, `$1${unbDate}`)
    .replace(/(BGM\+[^+']*\+)[^+']+/, `$1${bgmRef}`)
    .replaceAll('+91100:ZZ+', `+${input.receiver}:ZZ+`).replaceAll('NAD+MS+91100:', `NAD+MS+${input.receiver}:`)
    .replaceAll('+21660:ZZ+', `+${input.sender}:ZZ+`).replaceAll('NAD+MR+21660:', `NAD+MR+${input.sender}:`))
  const observations: string[] = []
  let total = 0
  for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
    const milli = hourMilliKwh(day, hour, salt)
    total += milli
    observations.push(`SEQ++${hour + 1}'`, `QTY+136:${formatMilliKwh(milli)}'`,
      `DTM+597:${localStamp(month, day, hour * 60)}:203'`, "STS+7++21::260'")
  }
  const assembled = [...head, ...observations, "UNT+0+1'", lines[lines.length - 1]].join('\n')
  const fixture = utiltsNativeSourceFixture(utiltsRecountUnt(utiltsTestEnvironmentWire(assembled)), sourceId)
  const receivedAt = new Date(Date.UTC(Number(nextDayStamp.slice(0, 4)), Number(nextDayStamp.slice(4, 6)) - 1, Number(nextDayStamp.slice(6, 8)), 6, 30) - month.offsetMinutes * 60_000).toISOString()
  return { sourceId, raw: fixture.raw, parsed: fixture.parsed, txRef, bgmRef, receivedAt, values: HOURS_PER_DAY, totalMilliKwh: total }
}
