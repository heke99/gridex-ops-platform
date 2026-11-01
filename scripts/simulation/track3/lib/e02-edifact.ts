// EDIEL02: UTILTS E66 som koden kvalificerar som "accepted" (70007 -> 16700), med testindikator i UNB.
// Ursprung (segmentlayout): 1c0c088c:__tests__/helpers/utiltsObservationHandoff.ts energyHandoffMessage() (15-minutersupplösning,
// DTM+597 = senaste uppdateringsdatum, SEQ++1 QTY+136 + DTM+597 + STS+7++21) och
// 1c0c088c:__tests__/helpers/utiltsErrGatewayFixture.ts rad 28-30 (UNB 0031/0035: `++1++1`, fysisk testväxel).
// Skillnad mot lib/edifact.ts buildUtiltsE66: den genererar månadsserie utan testindikator (UNB 0035) och hålls i test-miljön av
// ediel_inbound_context (derive_before_received_err_response_v1) -> `ediel_inbound_legal_context_required`. Det är ett harnessfel
// i delad lib (inte ändrat här), den här filen är ersättningen för EDIEL02.
import { COUNTERPARTY_EDIEL_ID } from './seed.mjs'
import { E02_OWN_ID } from './e02-tenant'

export type E02Options = {
  prefix: string
  /** Löpnummer: unikt per meddelande i körningen (UNB-ref, BGM 1004, fält 203/505). */
  seq: number
  meteringPoint: string
  /** Transaktionsreferens (IDE+24, fält 505). Default härleds ur prefix+seq. */
  transactionRef?: string
  /** Mängd kWh (QTY+136). */
  quantity?: string
  /** Senaste uppdateringsdatum yyyymmddhhmm (DTM+597 i huvudet; avgör ersättning/ordning). */
  latestUpdate?: string
  /** Period (kvart): start yyyymmddhhmm. */
  periodStart?: string
  sender?: string
  receiver?: string
  now?: Date
  /** Egen segmentmutation (UNH..sista datasegment) innan UNT/UNZ. */
  mutate?: (segments: string[]) => string[]
  /** Behåll UNA (default false: UNA-inledd bilaga ger edifact_dangling_release_character, se README). */
  una?: boolean
  /** Eget interchange-ref (annars löpnummer). */
  interchangeRef?: string
  /** Eget dokumentref BGM 1004 (annars löpnummer). */
  documentRef?: string
}
export type E02Edifact = { raw: string; interchangeRef: string; documentRef: string; transactionRef: string; segments: string[]; meteringPoint: string; quantity: string; latestUpdate: string }

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
const yymmdd = (d: Date) => `${pad(d.getUTCFullYear() % 100)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
const hhmm = (d: Date) => `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`

export function buildE02Utilts(o: E02Options): E02Edifact {
  const now = o.now ?? new Date()
  const sender = o.sender ?? COUNTERPARTY_EDIEL_ID, receiver = o.receiver ?? E02_OWN_ID
  const key = `${o.prefix}${pad(o.seq, 3)}`
  const interchangeRef = o.interchangeRef ?? `${key}I`.slice(-14)
  const documentRef = o.documentRef ?? `${key}D`
  const transactionRef = o.transactionRef ?? `${key}T`
  const quantity = o.quantity ?? '500'
  const latestUpdate = o.latestUpdate ?? '202607010020'
  const periodStart = o.periodStart ?? '202607010000'
  const ps = new Date(Date.UTC(+periodStart.slice(0, 4), +periodStart.slice(4, 6) - 1, +periodStart.slice(6, 8), +periodStart.slice(8, 10), +periodStart.slice(10, 12)))
  const pe = new Date(ps.getTime() + 15 * 60_000)
  const periodEnd = `${pe.getUTCFullYear()}${pad(pe.getUTCMonth() + 1)}${pad(pe.getUTCDate())}${pad(pe.getUTCHours())}${pad(pe.getUTCMinutes())}`
  const segments = [
    `UNB+UNOC:3+${sender}:ZZ+${receiver}:ZZ+${yymmdd(now)}:${hhmm(now)}+${interchangeRef}++23-DDQ-E66-T++1++1`,
    'UNH+1+UTILTS:D:02B:UN:E5SE5A',
    `BGM+E66::260+${documentRef}+9+AB`,
    `DTM+137:20${yymmdd(now)}${hhmm(now)}:203`,
    'DTM+735:?+0200:406', 'MKS+23+E02::260',
    `NAD+MS+${sender}:SVK:260`, `NAD+MR+${receiver}:SVK:260`, 'NAD+DDQ',
    `IDE+24+${transactionRef}`, `LOC+172+${o.meteringPoint}::9`, 'LOC+239+TES:SVK:260',
    'LIN+++8716867000030:::9', `DTM+324:${periodStart}${periodEnd}:719`,
    `DTM+597:${latestUpdate}:203`, 'DTM+354:15:806', 'STS+7++E88::260', 'MEA+AAZ++KWH',
    'CCI+++E12::260', 'CAV+E17::260',
    'SEQ++1', `QTY+136:${quantity}`, `DTM+597:${periodStart}:203`, 'STS+7++21::260',
  ]
  const body = o.mutate ? o.mutate(segments) : segments
  const unh = body.findIndex((s) => s.startsWith('UNH+'))
  const all = [...body, `UNT+${body.length - unh + 1}+1`, `UNZ+1+${interchangeRef}`]
  const head = o.una ? "UNA:+.? '\n" : ''
  return { raw: `${head}${all.join("'\n")}'`, interchangeRef, documentRef, transactionRef, segments: all, meteringPoint: o.meteringPoint, quantity, latestUpdate }
}
