import { isProdatCalendarMinute, prodatDate203 } from './render/dates'

/** Qualify precision before the shared codec can project away seconds or invent midnight. */
export function prodatEventMinute(value: string): string | null {
  if (isProdatCalendarMinute(value)) return value
  const iso = value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::(\d{2})(?:\.(\d{1,9}))?)?(?:Z|[+-]\d{2}:\d{2})?$/)
  return iso && Number(iso[1] ?? 0) === 0 && Number(iso[2] ?? 0) === 0 ? prodatDate203(value) : null
}
type Reference = { reference: string; revision: string }
type ObjectIdentity = { meteringPointId: string; identityAgency: '9' | '89' }
export type ProdatDateParty = { id: string; qualifier: string; agency: string }
export type ProdatDateEventObject = ObjectIdentity & (
  { kind: 'change_before_supply'; change: Reference; contract: Reference; changeEffectiveAt: string | null; supplyStartsAt: string | null; supplier: ProdatDateParty | null } |
  { kind: 'production_contract'; direction: 'production'; contract: Reference; event: Reference & { kind: 'signed' | 'ceased' | null; occurredAt?: string | null }; supplyBoundaryAt: string | null }
)
export type ProdatDateEventRoute = {
  settingsId: string; actorSettingId: string; routeProfileId: string | null; communicationRouteId: string | null; transportProfileId: string | null
  legalSender: ProdatDateParty; legalRecipient: ProdatDateParty
  senderId: string; receiverId: string; senderQualifier: string; receiverQualifier: string
  senderSubaddress: string | null; receiverSubaddress: string | null
  transportType: string; mailbox: string | null; receiverEmail: string | null; applicationReference: string
  suppliers: (ObjectIdentity & { supplier: ProdatDateParty; recipient: ProdatDateParty })[]
}
export type TgtDateEventSource = {
  kind: 'tgt'; companyId: string; runId: string; roleCode: string; caseCode: string; suite: string; stepNo: number
  code: 'Z06' | 'Z09' | 'Z10'; sourceDigest: string; actorId: string; reference: string; route: ProdatDateEventRoute
}
export type ProdatDateEventSource = { kind: 'caller_selection'; reference: string } | TgtDateEventSource
const invalid = (): never => { throw new Error('prodat_date_event_evidence_invalid') }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const result = value as Record<string, unknown>
  if (Object.keys(result).some(key => !keys.includes(key))) return invalid()
  return result
}
function text(value: unknown, max = 200, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.length) || value.length > max || value !== value.trim() || /[\x00-\x1f\x7f]/.test(value)) return invalid()
  return value
}
const nullableText = (value: unknown): string | null => value === null ? null : text(value)
function minute(value: unknown): string | null {
  if (value === null) return null
  const result = text(value)
  return prodatEventMinute(result) === null ? invalid() : result
}
function reference(value: unknown): Reference {
  const v = object(value, ['reference', 'revision'])
  return { reference: text(v.reference), revision: text(v.revision) }
}
function party(value: unknown): ProdatDateParty {
  const v = object(value, ['id', 'qualifier', 'agency'])
  return { id: text(v.id, 35), qualifier: text(v.qualifier, 3, true), agency: text(v.agency, 3) }
}
function identity(v: Record<string, unknown>): ObjectIdentity {
  if (v.identityAgency !== '9' && v.identityAgency !== '89') return invalid()
  return { meteringPointId: text(v.meteringPointId, 25), identityAgency: v.identityAgency }
}
function eventObject(value: unknown): ProdatDateEventObject {
  const selected = object(value, ['meteringPointId', 'identityAgency', 'kind', 'change', 'contract', 'changeEffectiveAt', 'supplyStartsAt', 'supplier', 'direction', 'event', 'supplyBoundaryAt'])
  if (selected.kind === 'change_before_supply') {
    const v = object(value, ['meteringPointId', 'identityAgency', 'kind', 'change', 'contract', 'changeEffectiveAt', 'supplyStartsAt', 'supplier'])
    return { ...identity(v), kind: 'change_before_supply', change: reference(v.change), contract: reference(v.contract), changeEffectiveAt: minute(v.changeEffectiveAt), supplyStartsAt: minute(v.supplyStartsAt), supplier: v.supplier === null ? null : party(v.supplier) }
  }
  const v = object(value, ['meteringPointId', 'identityAgency', 'kind', 'direction', 'contract', 'event', 'supplyBoundaryAt'])
  if (v.kind !== 'production_contract' || v.direction !== 'production') return invalid()
  const event = object(v.event, ['kind', 'reference', 'revision', 'occurredAt'])
  if (event.kind !== null && event.kind !== 'signed' && event.kind !== 'ceased') return invalid()
  return { ...identity(v), kind: 'production_contract', direction: 'production', contract: reference(v.contract), event: { kind: event.kind, reference: text(event.reference), revision: text(event.revision), ...(event.occurredAt === undefined ? {} : { occurredAt: minute(event.occurredAt) }) }, supplyBoundaryAt: minute(v.supplyBoundaryAt) }
}
export function copyProdatDateEventObjects(value: unknown): ProdatDateEventObject[] {
  if (!Array.isArray(value)) return invalid()
  const result = value.map(eventObject), keys = new Set<string>()
  for (const entry of result) {
    const key = JSON.stringify([entry.meteringPointId, entry.identityAgency])
    if (keys.has(key)) return invalid()
    keys.add(key)
  }
  return result
}
/** Explicit allowlist: runtime records may contain unrelated private configuration. */
export function copyProdatDateEventRoute(value: unknown): ProdatDateEventRoute {
  const v = object(value, ['settingsId', 'actorSettingId', 'routeProfileId', 'communicationRouteId', 'transportProfileId', 'legalSender', 'legalRecipient', 'senderId', 'receiverId', 'senderQualifier', 'receiverQualifier', 'senderSubaddress', 'receiverSubaddress', 'transportType', 'mailbox', 'receiverEmail', 'applicationReference', 'suppliers'])
  if (!Array.isArray(v.suppliers)) return invalid()
  return {
    settingsId: text(v.settingsId), actorSettingId: text(v.actorSettingId), routeProfileId: nullableText(v.routeProfileId), communicationRouteId: nullableText(v.communicationRouteId), transportProfileId: nullableText(v.transportProfileId),
    legalSender: party(v.legalSender), legalRecipient: party(v.legalRecipient), senderId: text(v.senderId), receiverId: text(v.receiverId), senderQualifier: text(v.senderQualifier), receiverQualifier: text(v.receiverQualifier),
    senderSubaddress: nullableText(v.senderSubaddress), receiverSubaddress: nullableText(v.receiverSubaddress), transportType: text(v.transportType), mailbox: nullableText(v.mailbox), receiverEmail: nullableText(v.receiverEmail), applicationReference: text(v.applicationReference),
    suppliers: v.suppliers.map(value => { const entry = object(value, ['meteringPointId', 'identityAgency', 'supplier', 'recipient']); return { ...identity(entry), supplier: party(entry.supplier), recipient: party(entry.recipient) } }),
  }
}
export function copyProdatDateEventSource(value: unknown): ProdatDateEventSource {
  const v = object(value, ['kind', 'reference', 'companyId', 'runId', 'roleCode', 'caseCode', 'suite', 'stepNo', 'code', 'sourceDigest', 'actorId', 'route'])
  if (v.kind === 'caller_selection') { object(value, ['kind', 'reference']); return { kind: 'caller_selection', reference: text(v.reference) } }
  if (v.kind !== 'tgt' || (v.code !== 'Z06' && v.code !== 'Z09' && v.code !== 'Z10') || typeof v.stepNo !== 'number' || !Number.isInteger(v.stepNo) || v.stepNo < 1) return invalid()
  return { kind: 'tgt', companyId: text(v.companyId), runId: text(v.runId), roleCode: text(v.roleCode), caseCode: text(v.caseCode), suite: text(v.suite), stepNo: v.stepNo, code: v.code as TgtDateEventSource['code'], sourceDigest: text(v.sourceDigest), actorId: text(v.actorId), reference: text(v.reference), route: copyProdatDateEventRoute(v.route) }
}
export const isProdatDateEventField = (code: string, field: string) => field === '210' && ['Z06', 'Z09', 'Z10'].includes(code) || field === '211' && code === 'Z09'
/** The mandatory predicate is separate from route and source authority. */
export function prodatDateEventRequirement(code: string, subtype: string | null, field: string, fact?: ProdatDateEventObject) {
  if (code === 'Z09') {
    if (!subtype) return 'undetermined'
    if (subtype !== 'D') return 'forbidden'
    if (fact?.kind !== 'production_contract' || fact.event.kind === null || !fact.supplyBoundaryAt) return 'undetermined'
    return (fact.event.kind === 'signed' ? field === '210' : field === '211') ? 'required' : 'forbidden'
  }
  if (!fact || fact.kind !== 'change_before_supply' || !fact.changeEffectiveAt || !fact.supplyStartsAt || (code === 'Z06' && !subtype)) return 'undetermined'
  const before = prodatEventMinute(fact.changeEffectiveAt)! < prodatEventMinute(fact.supplyStartsAt)!
  return before ? 'required' : code === 'Z06' && subtype === 'E' ? 'forbidden' : 'optional'
}
