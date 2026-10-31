/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// VENDORED COPY. Origin: claude/gifted-hamilton-vss1hj @ 2711f86287fd77da12e48aa5fd26a695f4a51426:scripts/helpers/reality/inboundProdatWire.ts
// Only the edits listed in chain/vendor-sync.py PATCHES (and @/ import rewrites) differ from the origin.
// What a grid owner sends a supplier about its switches and facilities (reality scenario J1): Z04 confirmations
// built only from our received Z03, with the deviations a real DSO produces (another start date, another
// facility, a re-sent document). Pure functions, no database, no network; the J1 grid-owner simulator
// (scripts/reality/simulators/gridOwnerInboundProdat.ts) and the J1 native defect tests share them.
// Synthetic only: every party, facility and identity comes from the received file.
import { randomUUID } from 'node:crypto'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { OWNER } from '@/__tests__/helpers/sourceOwnerFixtures'
import { structuralOwnerSource } from '@/__tests__/helpers/structuralOwnerFixtures'
import { buildZ04ForSwitchRequest, encodeGridOwnerAnswer, readSwitchRequest } from '../../reality/simulators/gridOwnerWire'
import { readReceivedRequest } from './rejectsWire'

/** CCYYMMDD of a YYYY-MM-DD or CCYYMMDD date. */
const compact = (date: string) => date.replaceAll('-', '').slice(0, 8)

/** YYYY-MM-DD `days` calendar days after (negative: before) a YYYY-MM-DD date. */
export function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Our Z03 as the DSO would read it, with the requested start (field 210, DTM+92) replaced. */
export function withRequestedStart(z03: string, startDate: string) {
  const from = readSwitchRequest(z03).startDate
  return z03.replaceAll(`DTM+92:${from}`, `DTM+92:${compact(startDate)}`)
}

/** Single-tariff meter-reading declaration of one register (fields 214 constant, 218 digits, 259 counter code 101). */
export const METER_READING_DECLARATION = ['CCI++Z02', 'CAV+:::1', 'CCI++Z05', 'CAV+:::6', 'CCI++Z16', 'CAV+:::101'] as const

/**
 * Inserts register characteristics into the object (before its first RFF/NAD) and recounts UNT. With field 259
 * (counter code) present the DSO declares that meter readings follow in UTILTS (P26.A field 259).
 */
export function withObjectSegments(raw: string, segments: readonly string[]) {
  const parts = raw.split("'")
  const line = parts.findIndex(part => part.startsWith('LIN+'))
  const boundary = parts.findIndex((part, index) => index > line && /^(?:RFF|NAD)\+/.test(part))
  if (line < 0 || boundary < 0) throw Error('z04_object_boundary_missing')
  const out = [...parts.slice(0, boundary), ...segments, ...parts.slice(boundary)]
  return out.join("'").replace(/UNT\+(\d+)\+/, (_, count: string) => `UNT+${Number(count) + segments.length}+`)
}

/**
 * Z04 for our Z03. `startDate` (YYYY-MM-DD) is the start the grid owner confirms; omitted = the requested start.
 * A DSO that cannot switch on the requested day and confirms another day sends exactly this. `readings`
 * (default true) declares the register's meter-reading fields 214/218/259; false omits them (an hourly facility
 * whose DSO sends no counter code).
 */
/**
 * Removes the meter reading declaration (fields 214, 218 and 259: CCI++Z02, CCI++Z05 and CCI++Z16 with their CAV)
 * from the object and recounts UNT. The world's Z04 builder already declares it (T6), so adding it again duplicated
 * every field and the platform answered with a negative APERAK (FINDINGS J1-B5).
 */
export function withoutMeterReadingDeclaration(raw: string) {
  const parts = raw.split("'")
  const out: string[] = []
  let removed = 0
  for (let index = 0; index < parts.length; index++) {
    if (/^CCI\+\+Z(?:02|05|16)$/.test(parts[index]) && parts[index + 1]?.startsWith('CAV+')) { index++; removed += 2; continue }
    out.push(parts[index])
  }
  return out.join("'").replace(/UNT\+(\d+)\+/, (_, count: string) => `UNT+${Number(count) - removed}+`)
}

export function z04For(z03: string, gridOwnerEdielId: string, options: { startDate?: string; readings?: boolean } = {}) {
  const request = options.startDate ? withRequestedStart(z03, options.startDate) : z03
  const built = buildZ04ForSwitchRequest({ request, gridOwnerEdielId })
  // Exactly one declaration, or none for a Z04 without field 259 (J1-10).
  const bare = withoutMeterReadingDeclaration(built.raw)
  return { ...built, raw: options.readings === false ? bare : withObjectSegments(bare, METER_READING_DECLARATION) }
}

/** Z04C (field 223 = Z24): the grid owner withdraws the start of our switch (same LI, same object). */
export function z04cFor(z03: string, gridOwnerEdielId: string) {
  const built = z04For(z03, gridOwnerEdielId)
  if (!built.raw.includes('CAV+Z22') && !built.raw.includes('CAV+Z23')) throw Error('z04c_transaction_reason_missing')
  return { ...built, raw: built.raw.replace(/CAV\+Z2[23]'/, "CAV+Z24'") }
}

/** Z04 for a switch we never requested: same parties, an unknown facility and an unknown case reference (LI). */
export function z04ForUnknownSwitch(z03: string, gridOwnerEdielId: string, unknown: { facility: string; caseReference: string }) {
  const facts = readSwitchRequest(z03)
  const request = z03.replaceAll(facts.external, unknown.facility).replaceAll(`RFF+LI:${facts.caseReference}`, `RFF+LI:${unknown.caseReference}`)
  const built = buildZ04ForSwitchRequest({ request, gridOwnerEdielId })
  return { ...built, raw: withObjectSegments(withoutMeterReadingDeclaration(built.raw), METER_READING_DECLARATION) }
}

/** Z06 subtype -> transaction reason (field 223, CCI+Z13), as the product registry has them (FINDINGS T31). */
export const Z06_REASON = { E: 'E34', F: 'E64', G: 'E32' } as const
export type Z06Kind = keyof typeof Z06_REASON

/**
 * Z06 for the facility of our Z03: E (E34, customer and masterdata change, with the customer NAD+UD), F (E64,
 * structure change with a register reading declaration) or G (E32, structure change without one). Built from the
 * approved native Z06 template (__tests__/helpers/structuralOwnerFixtures.ts) with every party, facility, case
 * reference, grid area and customer taken from the received Z03. The change (DTM+157) is `changeAfterDays` after
 * the requested start (default 12, as the native Z06 F/G fixture).
 */
export function z06For(z03: string, gridOwnerEdielId: string, kind: Z06Kind, options: { changeAfterDays?: number } = {}) {
  const f = readSwitchRequest(z03)
  if (f.gridOwner !== gridOwnerEdielId) throw Error(`switch_request_addressed_to_other_grid_owner:${f.gridOwner}`)
  const day = `${f.startDate.slice(0, 4)}-${f.startDate.slice(4, 6)}-${f.startDate.slice(6, 8)}`
  const change = compact(shiftDate(day, options.changeAfterDays ?? 12))
  const document = randomUUID().replaceAll('-', '').slice(0, 20)
  const template = structuralOwnerSource('Z06', Z06_REASON[kind], document).raw_payload!
    .replaceAll(OWNER.external, f.external).replaceAll('12345:160:SVK', `${f.gridOwner}:160:SVK`).replaceAll('54321:160:SVK', `${f.supplier}:160:SVK`)
    .replaceAll('11111:160:SVK', `${f.brp}:160:SVK`).replaceAll('CUSTOMER-1::89', `${f.customerIdentity}:SE2:260`)
    .replaceAll('RFF+Z05:NET-1', `RFF+Z05:${f.gridArea}`).replaceAll('RFF+LI:CASE-1', `RFF+LI:${f.caseReference}`)
    .replaceAll('DTM+92:202610010000', `DTM+92:${f.startDate}0000`).replaceAll('DTM+157:202610150000', `DTM+157:${change}0000`)
  const body = tokenizeEdifact(template).segments.filter(s => !['UNA', 'UNB', 'UNH', 'UNT', 'UNZ'].includes(s.tag)).map(s => s.raw)
  return { ...encodeGridOwnerAnswer(z03, f.gridOwner, f.supplier, body), facts: f, kind, reason: Z06_REASON[kind], document, change }
}

/**
 * Z02 (customer and facility information) answering our Z01: L (Z22) or LK (Z23), same object (LIN), case
 * reference (RFF+LI), grid area and customer identity as the request, as the approved native AT-Z02 fixture
 * (__tests__/ediel-at-z02l-z02lk-supplier-profile.test.ts) builds it. `gridArea` is used when the Z01 has none.
 */
export function z02For(z01: string, gridOwnerEdielId: string, options: { variant?: 'L' | 'LK'; gridArea?: string; address?: { street: string; postalCode: string; city: string } } = {}) {
  const f = readReceivedRequest(z01)
  if (f.family !== 'PRODAT' || f.code !== 'Z01') throw Error(`z02_needs_our_z01:${f.family}:${f.code}`)
  if (f.gridOwner !== gridOwnerEdielId) throw Error(`customer_info_request_addressed_to_other_grid_owner:${f.gridOwner}`)
  const gridArea = /RFF\+Z05:([^'+]+)/.exec(z01)?.[1] ?? options.gridArea ?? ''
  for (const [key, value] of Object.entries({ facility: f.facility, lineItemReference: f.lineItemReference, customerIdentity: f.customerIdentity, gridArea }))
    if (!value) throw Error(`z02_request_fact_missing:${key}`)
  // The grid owner answers with the facility's own address as it holds it: the one our Z01 named (NAD+IT), raw as on
  // the wire (FINDINGS A-B4: a fixed 'Alingsas' never matched the site's 'Alingsås', so the product's Z02 payload gate
  // held every website application with z02_installation_city_conflict).
  const a = options.address ?? z01InstallationAddress(z01) ?? { street: 'Kungsgatan 1', postalCode: '44130', city: 'Alingsas' }
  const document = randomUUID().replaceAll('-', '').slice(0, 20)
  const body = [`BGM+Z02+${document}+9+AB`, `DTM+137:${new Date().toISOString().replace(/\D/g, '').slice(0, 12)}:203`, 'DTM+ZZZ:1:805',
    `NAD+FR+${f.gridOwner}:160:SVK+++++++SE`, `NAD+DO+${f.supplier}:160:SVK+++++++SE`, `LIN+1++${f.facility}:::9`,
    'CCI++Z04', 'CAV+Z03', 'CCI++Z13', `CAV+${options.variant === 'LK' ? 'Z23' : 'Z22'}`, `RFF+Z05:${gridArea}`, `RFF+LI:${f.lineItemReference}`,
    `NAD+UD+${f.customerIdentity}:SE2:260++Synthetic Person+${a.street}+${a.city}++${a.postalCode}+SE`,
    `NAD+IT+${f.facility}::9+++${a.street}+${a.city}++${a.postalCode}+SE`]
  return { ...encodeGridOwnerAnswer(z01, f.gridOwner, f.supplier, body), facts: { ...f, gridArea }, document }
}

/** Street, city and postcode of the Z01's installation (NAD+IT, components 5, 6 and 8), or null when it has none. */
export function z01InstallationAddress(z01: string): { street: string; postalCode: string; city: string } | null {
  const segment = z01.split(/(?<!\?)'/).map(s => s.trim()).find(s => s.startsWith('NAD+IT+'))
  if (!segment) return null
  const elements = segment.split(/(?<!\?)\+/)
  const [street, city, postalCode] = [elements[5], elements[6], elements[8]]
  return street && city && postalCode ? { street, city, postalCode } : null
}

/** The case reference (RFF+LI) and the facility (LIN) of any PRODAT file. */
export function prodatFacts(raw: string) {
  return { li: /RFF\+LI:([^'+]+)/.exec(raw)?.[1] ?? '', facility: /LIN\+\d+\+\+([^:']+)/.exec(raw)?.[1] ?? '',
    start: /DTM\+92:(\d{8})/.exec(raw)?.[1] ?? '', document: /BGM\+[A-Z0-9]+\+([^+']+)/.exec(raw)?.[1] ?? '' }
}

/** One file the grid owner sends after its CONTRL/APERAK on our Z03 (see the J1 simulator). */
export type InboundProdatStep = 'z04' | 'z04-later' | 'z04-earlier' | 'z04-no-counter' | 'z04c' | 'z04-again' | 'z04-resend' | 'z04-unknown-switch'
  | 'z06e' | 'z06f' | 'z06g'
/** How the grid owner answers one received Z03: positive CONTRL+APERAK before (or after) its business files. */
export type InboundProdatPlan = { acksFirst: boolean; steps: InboundProdatStep[] }

/**
 * The platform's own answer to one of the grid owner's files, as the grid owner reads it. CONTRL: the acknowledged
 * interchange (UCI 0020) and action 0083 (4 = rejected on UCI or any UCM). APERAK: the acknowledged document
 * (RFF+ACW) and ERC codes (only ERC 100 = positive).
 */
export function readOurAnswer(raw: string): { family: 'CONTRL' | 'APERAK' | 'other'; reference: string; outcome: 'positive' | 'negative'; codes: string[] } {
  const segments = raw.split(/(?<!\?)'/).map(s => s.trim()).filter(Boolean)
  const family = /UNH\+[^+]*\+(CONTRL|APERAK)/.exec(raw)?.[1] as 'CONTRL' | 'APERAK' | undefined
  if (family === 'CONTRL') {
    const uci = segments.find(s => s.startsWith('UCI+'))?.split('+') ?? []
    const actions = [uci[4] ?? '', ...segments.filter(s => s.startsWith('UCM+')).map(s => s.split('+')[3] ?? '')].map(a => a.split(':')[0])
    return { family, reference: uci[1] ?? '', outcome: actions.includes('4') ? 'negative' : 'positive', codes: actions }
  }
  if (family === 'APERAK') {
    const codes = segments.filter(s => s.startsWith('ERC+')).map(s => s.slice(4).split(':')[0])
      .concat(segments.filter(s => s.startsWith('FTX+')).map(s => (s.split('+')[3] ?? '').split(':')[0]).filter(Boolean))
    const ercs = segments.filter(s => s.startsWith('ERC+')).map(s => s.slice(4).split(':')[0])
    return { family, reference: /RFF\+ACW:([^'+]+)/.exec(raw)?.[1] ?? '', outcome: ercs.length && ercs.every(c => c === '100') ? 'positive' : 'negative', codes }
  }
  return { family: 'other', reference: '', outcome: 'positive', codes: [] }
}
