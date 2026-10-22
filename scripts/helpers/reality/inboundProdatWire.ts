// What a grid owner sends a supplier about its switches and facilities (reality scenario J1): Z04 confirmations
// built only from our received Z03, with the deviations a real DSO produces (another start date, another
// facility, a re-sent document). Pure functions, no database, no network; the J1 grid-owner simulator
// (scripts/reality/simulators/gridOwnerInboundProdat.ts) and the J1 native defect tests share them.
// Synthetic only: every party, facility and identity comes from the received file.
import { buildZ04ForSwitchRequest, readSwitchRequest } from '../../reality/simulators/gridOwnerWire'

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
export function z04For(z03: string, gridOwnerEdielId: string, options: { startDate?: string; readings?: boolean } = {}) {
  const request = options.startDate ? withRequestedStart(z03, options.startDate) : z03
  const built = buildZ04ForSwitchRequest({ request, gridOwnerEdielId })
  return options.readings === false ? built : { ...built, raw: withObjectSegments(built.raw, METER_READING_DECLARATION) }
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
  return { ...built, raw: withObjectSegments(built.raw, METER_READING_DECLARATION) }
}

/** The case reference (RFF+LI) and the facility (LIN) of any PRODAT file. */
export function prodatFacts(raw: string) {
  return { li: /RFF\+LI:([^'+]+)/.exec(raw)?.[1] ?? '', facility: /LIN\+\d+\+\+([^:']+)/.exec(raw)?.[1] ?? '',
    start: /DTM\+92:(\d{8})/.exec(raw)?.[1] ?? '', document: /BGM\+[A-Z0-9]+\+([^+']+)/.exec(raw)?.[1] ?? '' }
}
