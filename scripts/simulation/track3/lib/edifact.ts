// Syntetisk EDIFACT-generator för spår 3.
// Härkomst: segmentlayouten för UTILTS E66 är anpassad från den syntetiska fixturen i
// 1c0c088cb4ed66d0dd8b3e34c9606019342a1a56:__tests__/helpers/utiltsObservationHandoff.ts (observationHandoffMessage).
// Avsändare/mottagare, referenser och datum är genererade; inga verkliga identiteter.
import { COUNTERPARTY_EDIEL_ID, OWN_EDIEL_ID } from './seed.mjs'

export type E66Options = {
  /** Unikt per körning (ur newRunContext().prefix). */
  prefix: string
  /** Löpnummer inom körningen, för unika UNB-/BGM-/IDE-referenser. */
  seq?: number
  sender?: string
  receiver?: string
  senderQualifier?: string
  receiverQualifier?: string
  /** UNB applikationsreferens (23-DDQ-E66-S/T i befintliga fixturer). */
  applicationReference?: string
  /** Datum för DTM+137 (UTC). */
  now?: Date
  /** Mätpunkts-id (GSRN 18 siffror). */
  meteringPoint?: string
  /** Med UNA-service-string-advice först (default true, som i enhetsfixturerna). */
  una?: boolean
  /** Egna scenarier kan ändra segmentlistan (UNH..sista datasegment) innan UNT/UNZ läggs på. */
  mutate?: (segments: string[]) => string[]
}

export type GeneratedEdifact = { raw: string; interchangeRef: string; messageRef: string; documentRef: string; segments: string[] }

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
const yymmdd = (d: Date) => `${pad(d.getUTCFullYear() % 100)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
const hhmm = (d: Date) => `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`

/** Syntetiskt UTILTS E66 (förbrukningsdata) från 70007 (nätägare/DSO) till 16700 (egen part). */
export function buildUtiltsE66(options: E66Options): GeneratedEdifact {
  const now = options.now ?? new Date()
  const seq = options.seq ?? 1
  const sender = options.sender ?? COUNTERPARTY_EDIEL_ID
  const receiver = options.receiver ?? OWN_EDIEL_ID
  const sq = options.senderQualifier ?? 'ZZ'
  const rq = options.receiverQualifier ?? 'ZZ'
  const app = options.applicationReference ?? '23-DDQ-E66-T'
  const key = `${options.prefix}${pad(seq, 3)}`
  const interchangeRef = `${key}I`.slice(-14)
  const documentRef = `${key}D`
  const messageRef = '1'
  const mp = options.meteringPoint ?? `73599926${options.prefix.replace(/\D/g, '').padEnd(10, '0').slice(0, 10)}`
  const stamp = `${yymmdd(now)}:${hhmm(now)}`
  const dtm137 = `${yymmdd(now)}${hhmm(now)}`
  const segments = [
    `UNB+UNOC:3+${sender}:${sq}+${receiver}:${rq}+${stamp}+${interchangeRef}++${app}++1`,
    `UNH+${messageRef}+UTILTS:D:02B:UN:E5SE5A`,
    `BGM+E66::260+${documentRef}+9+AB`,
    `DTM+137:20${dtm137}:203`,
    'DTM+735:?+0200:406', 'MKS+23+E02::260',
    `NAD+MS+${sender}:SVK:260`, `NAD+MR+${receiver}:SVK:260`, 'NAD+DDQ',
    `IDE+24+${key}IDE`, `LOC+172+${mp.slice(0, 18).padEnd(18, '0')}::9`, 'LOC+239+TES:SVK:260',
    'LIN+++8716867000030:::9', 'DTM+324:202607010000202608010000:719',
    'DTM+597:202608010000:203', 'DTM+354:1:802', 'STS+7++E88::260', 'MEA+AAZ++KWH',
    'CCI+++E12::260', 'CAV+E17::260',
    'SEQ++1', 'RFF+AES:101', `RFF+MG:M-${key}`, 'QTY+220:10000', 'DTM+597:202607010000:203',
    'CCI+++E22::260', 'CAV+E27::260',
    'SEQ++2', 'RFF+AES:101', 'QTY+220:11000', 'DTM+597:202608010000:203', 'CCI+++E22::260', 'CAV+E27::260',
    'SEQ++3', 'QTY+136:500',
  ]
  const body = options.mutate ? options.mutate(segments) : segments
  // UNT räknar segment från UNH till och med UNT.
  const unhIndex = body.findIndex((s) => s.startsWith('UNH+'))
  const count = body.length - unhIndex + 1
  const all = [...body, `UNT+${count}+${messageRef}`, `UNZ+1+${interchangeRef}`]
  const head = options.una === false ? '' : "UNA:+.? '\n"
  return { raw: `${head}${all.join("'\n")}'`, interchangeRef, messageRef, documentRef, segments: all }
}
