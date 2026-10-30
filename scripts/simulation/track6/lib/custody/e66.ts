// E66 (UTILTS) hjälpare: tolkning av mätpunkter/referenser ur importerade original, samt byggare för egna syntetiska E66.
// Byggaren är kopierad från 01d97c27:scripts/simulation/track3/lib/e01-fixture.ts buildRoutableE66() + gs1WithCheckDigit()
// (ändrad: ingen modulglobal OWN_EDIEL_ID, receiver anges; miljöflaggor oförändrade).
import { COUNTERPARTY_EDIEL_ID } from '../seed.mjs'
import { mode, sha256 } from './base'

export type ParsedE66 = { sender: string | null; receiver: string | null; interchangeRef: string | null; documentRef: string | null; transactionRef: string | null; meteringPoint: string | null; testIndicator: boolean }
const segs = (edi: string) => edi.replace(/^UNA.{6}/, '').split("'").map((s) => s.trim()).filter(Boolean)

/** Tolka UNB/BGM/IDE/LOC+172 i ett E66. Endast läsning; inget tolkas som affärssanning. */
export function parseE66(edi: string): ParsedE66 {
  const s = segs(edi)
  const unb = s.find((x) => x.startsWith('UNB+'))?.split('+') ?? []
  const bgm = s.find((x) => x.startsWith('BGM+'))?.split('+') ?? []
  const ide = s.find((x) => x.startsWith('IDE+'))?.split('+') ?? []
  const loc = s.find((x) => x.startsWith('LOC+172+'))?.split('+') ?? []
  return {
    sender: unb[2]?.split(':')[0] ?? null, receiver: unb[3]?.split(':')[0] ?? null, interchangeRef: unb[5] ?? null,
    documentRef: bgm[2] ?? null, transactionRef: ide[2] ?? null, meteringPoint: loc[2]?.split(':')[0] ?? null,
    testIndicator: unb.slice(6).includes('1'),
  }
}

export function gs1WithCheckDigit(body17: string): string {
  if (!/^\d{17}$/.test(body17)) throw new Error('gsrn_body_must_be_17_digits')
  let sum = 0
  for (let i = 0; i < 17; i++) sum += Number(body17[16 - i]) * (i % 2 === 0 ? 3 : 1)
  return body17 + String((10 - (sum % 10)) % 10)
}

export type E66Spec = { seq: number; interchangeRef: string; documentRef: string; transactionRef: string; meteringPoint: string; raw: string }

export function buildRoutableE66(o: { prefix: string; seq: number; receiver: string; now?: Date; environment?: 'test' | 'production'; sender?: string }): E66Spec {
  const now = o.now ?? new Date()
  const env = o.environment ?? mode()
  const sender = o.sender ?? COUNTERPARTY_EDIEL_ID
  const receiver = o.receiver
  const h = sha256(`${o.prefix}:${o.seq}`)
  const interchangeRef = `I${h.slice(0, 13)}`
  const documentRef = `M${h.slice(13, 33)}`
  const transactionRef = `T${h.slice(33, 49)}`
  const digits = BigInt('0x' + h.slice(0, 15)).toString().padStart(9, '0').slice(-9)
  const meteringPoint = gs1WithCheckDigit(`73599926${digits}`)
  const pad = (n: number) => String(n).padStart(2, '0')
  const yymmdd = `${pad(now.getUTCFullYear() % 100)}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`
  const hhmm = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`
  const periodStart = new Date(now.getTime() - 3 * 86400_000)
  const ps = `${periodStart.getUTCFullYear()}${pad(periodStart.getUTCMonth() + 1)}${pad(periodStart.getUTCDate())}0000`
  const pe = `${periodStart.getUTCFullYear()}${pad(periodStart.getUTCMonth() + 1)}${pad(periodStart.getUTCDate())}0015`
  const testFlags = env === 'test' ? '++1++1' : '++1'
  const body = [
    "UNA:+.? '",
    `UNB+UNOC:3+${sender}:ZZ+${receiver}:ZZ+${yymmdd}:${hhmm}+${interchangeRef}++23-DDQ-E66-T${testFlags}'`,
    "UNH+1+UTILTS:D:02B:UN:E5SE5A'",
    `BGM+E66::260+${documentRef}+9+AB'`,
    `DTM+137:20${yymmdd}${hhmm}:203'`,
    "DTM+735:?+0200:406'", "MKS+23+E02::260'",
    `NAD+MS+${sender}:SVK:260'`, `NAD+MR+${receiver}:SVK:260'`, "NAD+DDQ'",
    `IDE+24+${transactionRef}'`, `LOC+172+${meteringPoint}::9'`, "LOC+239+TES:SVK:260'",
    "LIN+++8716867000030:::9'", `DTM+324:${ps}${pe}:719'`,
    `DTM+597:${pe}:203'`, "DTM+354:15:806'", "STS+7++E88::260'", "MEA+AAZ++KWH'",
    "CCI+++E12::260'", "CAV+E17::260'",
    "SEQ++1'", "QTY+136:500'", `DTM+597:${ps}:203'`, "STS+7++21::260'",
  ]
  const unh = body.findIndex((s) => s.startsWith('UNH+'))
  const lines = [...body, `UNT+${body.length - unh + 1}+1'`, `UNZ+1+${interchangeRef}'`]
  return { seq: o.seq, interchangeRef, documentRef, transactionRef, meteringPoint, raw: lines.join('\n') }
}
