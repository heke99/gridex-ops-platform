// EDIFACT faults for reality scenario J3 (inbound Ediel robustness). Pure string builders on top of the grid
// owner's real UTILTS E66 (live-chain-wire.dailyE66); no database, network or test runner. Synthetic data only.
import { dailyE66, dayProfile, kwhText } from '../live-chain-wire'

export type E66Input = { issuer: string; receiver: string; meterId: string; day: string; reference: string }

/** A valid grid-owner E66 (LF segment lines, no trailing newline: what the other scenarios send). */
export const validE66 = (input: E66Input, dayIndex = 0) => dailyE66({ ...input, values: dayProfile(dayIndex) })

/** The same file as many grid-owner systems write it: CRLF lines and a final CRLF (J3-01). */
export const crlfTerminated = (edifact: string) => edifact.replace(/\r?\n/g, '\r\n') + '\r\n'

/** UTF-8 byte-order mark before UNA (J3-01). */
export const withBom = (edifact: string) => '﻿' + edifact

/** Cut inside a free text after a release character: the classic truncated transfer (J3-06). */
export function truncatedAfterRelease(edifact: string) {
  const cut = edifact.indexOf("STS+7++21::260'", edifact.length / 2)
  return edifact.slice(0, cut > 0 ? cut : edifact.length / 2) + 'FTX+AAO+++avkortad?'
}

/** UNZ missing: the interchange trailer was lost (complete segments otherwise). */
export const withoutUnz = (edifact: string) => edifact.replace(/\r?\nUNZ\+[^']*'\s*$/, '')

/** UNT/0074 declares one segment too many. */
export const wrongUntCount = (edifact: string) => edifact.replace(/UNT\+(\d+)\+/, (_m, count: string) => `UNT+${Number(count) + 1}+`)

/** UNA cut to seven characters: the service string advice cannot be read. */
export const brokenUna = (edifact: string) => edifact.replace(/^UNA:\+\.\? '/, 'UNA:+.')

/** UNB/0035 omitted: a production interchange (the world's mailbox is the test mailbox). */
export const productionIndicator = (edifact: string) => edifact.replace(/(UNB\+[^']*?)\+\+\+\+1'/, "$1'")

/** The known receiver with a routing sub-address it never configured (UNB S003/0014). */
export const withReceiverSubaddress = (edifact: string, receiver: string, subaddress: string) =>
  edifact.replace(`+${receiver}:ZZ+`, `+${receiver}:ZZ:${subaddress}+`)

/** Two interchanges in one file: the second without its own UNA (J3-02). */
export const twoInterchanges = (first: string, second: string) => `${first}\n${second.replace(/^UNA[^\n]*\n/, '')}`

/** A CONTRL from the grid owner for an interchange the platform never sent: the response arrives first/alone. */
export function unsolicitedContrl(input: { issuer: string; receiver: string; reference: string; acknowledgedReference: string }) {
  const lines = [
    "UNA:+.? '",
    `UNB+UNOC:3+${input.issuer}:ZZ+${input.receiver}:ZZ+261022:0800+${input.reference}++++++1'`,
    `UNH+1+CONTRL:D:3:UN:E5SE1A'`,
    `UCI+${input.acknowledgedReference}+${input.receiver}:ZZ+${input.issuer}:ZZ+7'`,
  ]
  return [...lines, `UNT+${lines.length - 1}+1'`, `UNZ+1+${input.reference}'`].join('\n')
}

/**
 * A large file: one E66 for all of September (no DST change, fixed +0200) with 2 880 quarter-hours, ~170 kB.
 * Same segment template as dailyE66; F1 showed month files used to exceed the 8 s statement limit.
 */
export function septemberMonthE66(input: Omit<E66Input, 'day'>) {
  const values = Array.from({ length: 30 }, (_, day) => dayProfile(day)).flat()
  const at = (minutes: number) => {
    const t = new Date(Date.UTC(2026, 8, 1) + minutes * 60_000)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}${p(t.getUTCHours())}${p(t.getUTCMinutes())}`
  }
  const registered = at(30 * 1440 + 6 * 60)
  const lines = [
    "UNA:+.? '",
    `UNB+UNOC:3+${input.issuer}:ZZ+${input.receiver}:ZZ+${registered.slice(2, 8)}:${registered.slice(8, 12)}+${input.reference}++23-DDQ-E66-T++++1'`,
    "UNH+1+UTILTS:D:02B:UN:E5SE5A'", `BGM+E66::260+M${input.reference}+9+AB'`, `DTM+137:${registered}:203'`, "DTM+735:?+0200:406'",
    "MKS+23+E02::260'", `NAD+MS+${input.issuer}:SVK:260'`, `NAD+MR+${input.receiver}:SVK:260'`, "NAD+DDQ'",
    `IDE+24+T${input.reference}'`, `LOC+172+${input.meterId}::9'`, "LOC+239+TES:SVK:260'", "LIN+++8716867000030:::9'",
    `DTM+324:${at(0)}${at(30 * 1440)}:719'`, `DTM+597:${registered}:203'`, "DTM+354:15:806'", "STS+7++E88::260'", "MEA+AAZ++KWH'",
    "CCI+++E12::260'", "CAV+E17::260'",
  ]
  values.forEach((value, q) => lines.push(`SEQ++${q + 1}'`, `QTY+136:${kwhText(value)}'`, `DTM+597:${at(q * 15)}:203'`, "STS+7++21::260'"))
  lines.push(`UNT+${lines.length - 1}+1'`, `UNZ+1+${input.reference}'`)
  return lines.join('\n')
}
