import { describe, expect, it } from 'vitest'
import { assertProdatDateEventAuthority, type ProdatDateEventRow, type ProdatDateEventValidationContext } from '@/lib/ediel/prodat/prodatDateEventAuthority'
import { copyProdatDateEventSource, type ProductionContractDateEventSource, type ProdatDateEventObject } from '@/lib/ediel/prodat/prodatDateEvents'
import { validateProdatDateEvents } from '@/lib/ediel/rulebook/prodatDateEventPolicy'
const source: ProductionContractDateEventSource = { kind: 'production_contract', companyId: 'tenant', environment: 'production', code: 'Z09', eventId: 'event', sourceDigest: 'a'.repeat(64), sourceVersion: '1', actorId: 'actor', reference: 'authentic-source-reference',
 route: { actorSettingId: 'setting', routeProfileId: 'profile', communicationRouteId: 'route', legalSender: { id: '12345', qualifier: '160', agency: 'SVK' }, legalRecipient: { id: '54321', qualifier: '160', agency: 'SVK' }, senderId: '88888', receiverId: '54321', senderQualifier: 'ZZ', receiverQualifier: 'ZZ', senderSubaddress: null, receiverSubaddress: null, transportType: 'smtp', mailbox: 'mailbox', receiverEmail: 'test@example.invalid', applicationReference: '23-DDQ-PRODAT', suppliers: [] } }
const row: ProdatDateEventRow = { company_id: 'tenant', environment: 'production', direction: 'outbound', message_code: 'Z09', sender_ediel_id: '88888', receiver_ediel_id: '54321', sender_sub_address: null, receiver_sub_address: null, application_reference: '23-DDQ-PRODAT', transport_type: 'smtp', receiver_email: 'test@example.invalid', communication_route_id: 'route', route_profile_id: 'profile', mailbox: 'mailbox' }
const event = (kind: 'signed'|'ceased'): ProdatDateEventObject => ({ kind: 'production_contract', direction: 'production', meteringPointId: 'A', identityAgency: '89', contract: { reference: 'contract', revision: '1' }, event: { kind, reference: 'source', revision: '1' }, supplyBoundaryAt: '2026-10-01T12:00:00Z' })
function fixture(kind: 'signed'|'ceased' = 'signed') {
 const objects = [event(kind)], facts = { market: 'electricity' as const, dateEventSource: structuredClone(source), dateEventObjects: structuredClone(objects) }
 const expected: ProdatDateEventValidationContext = { source: structuredClone(source), objects: structuredClone(objects) }
 const rawSegments = ['UNB+UNOC:3+88888:ZZ+54321:ZZ+260930:1200+I++23-DDQ-PRODAT', 'UNH+1+PRODAT:D:96B:UN:EDIEL3', 'BGM+Z09+DOC+9', 'NAD+FR+12345:160:SVK', 'NAD+DO+54321:160:SVK', 'LIN+1++A:::89', 'CCI++Z13', 'CAV+Z70', 'RFF+LI:LI', `DTM+${kind === 'signed' ? '92' : '93'}:202610011300:203`, 'UNT+10+1', 'UNZ+1+I']
 return { code: 'Z09', facts, expected, row: structuredClone(row), rawSegments }
}
describe('live production contract authority remains separate from TGT and caller metadata', () => {
 for (const kind of ['signed','ceased'] as const) it(`${kind} uses its own precise contractual boundary`, () => {
  const f = fixture(kind); expect(() => assertProdatDateEventAuthority(f)).not.toThrow()
  expect(validateProdatDateEvents({ ...f, requireAuthority: true, dateEventContext: f.expected })).toEqual([])
 })
 for (const drift of ['company', 'environment', 'sourceDigest', 'boundary', 'route', 'legalActor'] as const) it(`rejects own ${drift} drift`, () => {
  const f = fixture(); if (drift === 'company') f.row.company_id = 'other'; if (drift === 'environment') f.row.environment = 'test'
  if (drift === 'sourceDigest') f.facts.dateEventSource.sourceDigest = 'b'.repeat(64)
  if (drift === 'boundary') { const own = f.facts.dateEventObjects[0]; if (own.kind !== 'production_contract') throw new Error('wrong fixture'); own.supplyBoundaryAt = '202610011301' }
  if (drift === 'route') f.row.mailbox = 'other'
  if (drift === 'legalActor') f.rawSegments[3] = 'NAD+FR+88888:160:SVK'
  expect(() => assertProdatDateEventAuthority(f)).toThrow()
 })
 it('cannot authorize a caller claim even when it repeats the exact event identifier', () => {
  const f = fixture(); expect(() => assertProdatDateEventAuthority({ ...f, facts: { ...f.facts, dateEventSource: { kind: 'caller_selection', reference: source.eventId } } })).toThrow()
 })
 it('does not accept date-only or simultaneous start and end', () => {
  const f = fixture(); f.rawSegments.splice(10, 0, 'DTM+93:202610011300:203')
  expect(validateProdatDateEvents({ ...f, requireAuthority: true, dateEventContext: f.expected }).some(x => x.code === 'PRODAT_DATE_EVENT_XOR')).toBe(true)
  f.rawSegments = fixture().rawSegments; f.rawSegments[9] = 'DTM+92:20261001:203'
  expect(validateProdatDateEvents({ ...f, requireAuthority: true, dateEventContext: f.expected }).some(x => x.code === 'PRODAT_DATE_EVENT_FORMAT_INVALID')).toBe(true)
 })
 it('copies live source without fabricated test settings or unrelated private fields', () => {
  expect(copyProdatDateEventSource(source)).toEqual(source)
  expect(() => copyProdatDateEventSource({ ...source, runId: 'forged' })).toThrow()
 })
})
