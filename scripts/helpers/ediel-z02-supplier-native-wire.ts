import {line, characteristic, type Parts} from '../../__tests__/fixtures/prodat-register'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite, tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {escapeEdifactData} from '@/lib/ediel/core/una'
import {originalAckPartyIdentities, originalAckLegalNadSegment} from '@/lib/ediel/core/originalAckPartyIdentities'
import {renderContrl2Ediel2} from '@/lib/ediel/contrlEngine'

/** Counterparty bytes only. No persisted source, assessment, permission or
 * readiness evidence is produced here. The caller supplies an actually sent
 * Z01 and declares the synthetic external response data independently.
 * P26.A r3: pp16–23,47,57,79–81,114–116; APERAK pp92–95.
 * Frozen source: annex/prodat_field_matrix_source.json and source_tables.json.
 */
export type SentZ01WireSource = Readonly<{rawPayload: string; point?: string}>
export type ExternalZ01ReplyEnvelope = Readonly<{
  source: SentZ01WireSource
  interchangeReference: string
  messageReference: string
  createdAt?: Date
}>
export type ExternalZ02Address = Readonly<{
  street: string
  city: string
  postalCode: string
  country: string
}>
export type ExternalZ02CustomerIdentity = Readonly<{id: string; qualifier: string; agency: string}>

function required(value: string | null | undefined, label: string): string {
  if (!value) throw new Error(`sent_z01_wire_${label}_required`)
  return value
}

/** Physical source observation, never an admission/authorization assertion.
 * A singleton source/object is intentional: sibling LI borrowing is refused.
 */
export function observeSentZ01Wire(source: SentZ01WireSource) {
  const wire = tokenizeEdifact(source.rawPayload)
  const envelope = EdifactEnvelopeCodec.decode(source.rawPayload)
  const parties = originalAckPartyIdentities({rawPayload: source.rawPayload, expectedFamily: 'PRODAT'})
  const one = (tag: string) => {
    const matches = wire.segments.filter(segment => segment.tag === tag)
    if (matches.length !== 1) throw new Error(`sent_z01_wire_${tag}_ambiguous`)
    return matches[0]
  }
  const unh = one('UNH'), bgm = one('BGM'), lin = one('LIN')
  if (segmentComposite(bgm, 1, wire.una)[0] !== 'Z01') throw new Error('sent_z01_wire_not_z01')
  const object = wire.segments.filter(segment => segment.index > lin.index && segment.index < one('UNT').index)
  const reference = (qualifier: string) => {
    const matches = object.filter(segment => segment.tag === 'RFF' && segmentComposite(segment, 1, wire.una)[0] === qualifier)
    if (matches.length !== 1) throw new Error(`sent_z01_wire_${qualifier}_ambiguous`)
    return required(segmentComposite(matches[0], 1, wire.una)[1], qualifier)
  }
  const customers = object.filter(segment => segment.tag === 'NAD' && segmentComposite(segment, 1, wire.una)[0] === 'UD')
  if (customers.length !== 1) throw new Error('sent_z01_wire_customer_ambiguous')
  const identity = segmentComposite(customers[0], 2, wire.una)
  const reasons = object.filter(segment => segment.tag === 'CCI' && segmentComposite(segment, 2, wire.una)[0] === 'Z13')
  if (reasons.length !== 1) throw new Error('sent_z01_wire_reason_ambiguous')
  const cav = object.find(segment => segment.index === reasons[0].index + 1 && segment.tag === 'CAV')
  const reason = segmentComposite(cav, 1, wire.una)[0]
  if (reason !== 'Z22' && reason !== 'Z23') throw new Error('sent_z01_wire_subtype_unqualified')
  const starts = object.filter(segment => segment.tag === 'DTM' && segmentComposite(segment, 1, wire.una)[0] === '92')
  if (starts.length !== 1) throw new Error('sent_z01_wire_start_ambiguous')
  const point = required(segmentComposite(lin, 3, wire.una)[0], 'point')
  if (source.point && source.point !== point) throw new Error('sent_z01_wire_selected_point_mismatch')
  return {
    envelope, parties,
    interchangeReference: required(envelope.interchangeReference, 'interchange_reference'),
    messageReference: required(segmentComposite(unh, 1, wire.una)[0], 'message_reference'),
    messageTypeToken: segmentComposite(unh, 2, wire.una).map(value => escapeEdifactData(value)).join(':'),
    documentReference: required(segmentComposite(bgm, 2, wire.una)[0], 'document_reference'),
    lineReference: reference('LI'), gridAreaCode: reference('Z05'), point,
    identityAgency: required(segmentComposite(lin, 3, wire.una)[3], 'identity_agency'),
    customerIdentity: {id: required(identity[0], 'customer_id'), qualifier: identity[1] ?? '', agency: required(identity[2], 'customer_agency')},
    customerName: required(segmentComposite(customers[0], 4, wire.una)[0], 'customer_name'),
    reason, subtype: reason === 'Z22' ? 'L' as const : 'LK' as const,
    agreedStartMinute: required(segmentComposite(starts[0], 1, wire.una)[1], 'agreed_start'),
  }
}

type ReplyRouteOverrides = Readonly<{
  transportSender?: string
  transportReceiver?: string
  legalSender?: string
  legalReceiver?: string
  applicationReference?: string
}>

function encodeReply(input: ExternalZ01ReplyEnvelope, messageTypeToken: string, businessSegments: readonly string[],
  overrides: ReplyRouteOverrides = {}, acknowledgementRequest = false, omitApplication = false) {
  const original = observeSentZ01Wire(input.source).envelope
  return EdifactEnvelopeCodec.encode({
    sender: overrides.transportSender ?? required(original.receiver, 'transport_receiver'),
    receiver: overrides.transportReceiver ?? required(original.sender, 'transport_sender'),
    senderQualifier: original.receiverQualifier, receiverQualifier: original.senderQualifier,
    senderSubAddress: original.receiverSubAddress, receiverSubAddress: original.senderSubAddress,
    applicationReference: omitApplication ? null : overrides.applicationReference ?? original.applicationReference,
    acknowledgementRequest, environment: original.environment, createdAt: input.createdAt,
    interchangeReference: input.interchangeReference,
    messages: [{messageReference: input.messageReference, messageTypeToken, businessSegments}],
  })
}

export function externalZ01Contrl(input: ExternalZ01ReplyEnvelope & Readonly<{outcome?: 'positive' | 'negative'}>): string {
  // T §2.1 p16/0020: renderer copies first14 into UCI, while input retains
  // every original interchange byte. No full-reference correlation oracle.
  const result = renderContrl2Ediel2({source: {rawPayload: input.source.rawPayload}, outcome: input.outcome ?? 'positive'})
  return encodeReply(input, 'CONTRL:2:2:UN:EDIEL2', result.segments)
}

export function externalZ01Aperak(input: ExternalZ01ReplyEnvelope & Readonly<{
  outcome: 'positive' | 'negative'
  documentMinute: string
  error?: Readonly<{ercCode: string; fieldCode: string; text: string}>
}>): string {
  const original = observeSentZ01Wire(input.source)
  if (input.outcome === 'negative' && !input.error) throw new Error('external_z01_negative_aperak_error_required')
  const error = input.error
  // External object outcome, not a locally manufactured validation finding.
  // Positive APERAK is optional and does not authorize Z02/start by itself.
  const business = [
    'BGM+++34', `DTM+137:${escapeEdifactData(input.documentMinute)}:203`,
    `RFF+ACW:${escapeEdifactData(original.documentReference)}`,
    originalAckLegalNadSegment('FR', original.parties.legalReceiver),
    originalAckLegalNadSegment('DO', original.parties.legalSender),
    `ERC+${escapeEdifactData(input.outcome === 'positive' ? '100' : error!.ercCode)}::260`,
    input.outcome === 'positive' ? 'FTX+AAO+++OK' : `FTX+AAO++${escapeEdifactData(error!.fieldCode)}::260+${escapeEdifactData(error!.text)}`,
    `RFF+Z07:${escapeEdifactData(original.point)}`, `RFF+LI:${escapeEdifactData(original.lineReference)}`,
  ]
  return encodeReply(input, 'APERAK:D:96A:UN:E2SE6A', business)
}

/** These omissions target inbound Z02 only. They cannot qualify the outbound
 * Z01 R/D preflight contract, whose producer is exercised by the caller.
 */
export type Z02OmittableField = '311' | '312' | '202' | '203' | '205' | '206' | '207' | '208' | '209' | '217' | '223' | '226' | '227' | '228' | '229' | '231' | '232' | '233' | '234' | '314' | '313' | '316' | '260' | 'END_USER_GROUP' | 'INSTALLATION_GROUP'
export type ExternalZ02Overrides = ReplyRouteOverrides & Readonly<{
  code?: string
  point?: string
  identityAgency?: string
  lineReference?: string
  gridAreaCode?: string
  reason?: string
  customerIdentity?: ExternalZ02CustomerIdentity
}>
export type ExternalZ02ReplyInput = ExternalZ01ReplyEnvelope & Readonly<{
  documentReference: string
  documentMinute: string
  measurementMethod: string
  customerName?: string
  customerAddress: ExternalZ02Address
  installationAddress: ExternalZ02Address
  overrides?: ExternalZ02Overrides
  omitFields?: readonly Z02OmittableField[]
}>

function render(parts: Parts): string {
  return parts.map(element => typeof element === 'string' ? escapeEdifactData(element)
    : element.map(component => escapeEdifactData(component)).join(':')).join('+')
}

export function externalZ02Reply(input: ExternalZ02ReplyInput): string {
  const original = observeSentZ01Wire(input.source), overrides = input.overrides ?? {}
  const omitted = new Set(input.omitFields ?? [])
  const value = (field: Z02OmittableField, text: string) => omitted.has(field) ? '' : text
  const parts: Parts[] = []
  const add = (field: Z02OmittableField, ...segments: Parts[]) => {if (!omitted.has(field)) parts.push(...segments)}
  const point = overrides.point ?? original.point, agency = overrides.identityAgency ?? original.identityAgency
  const identity = overrides.customerIdentity ?? original.customerIdentity
  const customer = input.customerAddress, installation = input.installationAddress
  parts.push(['BGM', value('202', overrides.code ?? 'Z02'), value('203', input.documentReference), '9', value('313', 'AB')])
  add('205', ['DTM', ['137', input.documentMinute, '203']])
  add('206', ['DTM', ['ZZZ', '1', '805']])
  const legal = (role: 'FR' | 'DO', id?: string) => {
    const party = role === 'FR' ? original.parties.legalReceiver : original.parties.legalSender
    return originalAckLegalNadSegment(role, id === undefined ? party : {...party, id, identityComponents: [id, ...party.identityComponents.slice(1)]})
  }
  const header = parts.map(render)
  if (!omitted.has('207')) header.push(legal('FR', overrides.legalSender))
  if (!omitted.has('208')) header.push(legal('DO', overrides.legalReceiver))
  parts.length = 0
  parts.push(line(value('314', '1'), value('209', point), undefined, agency))
  add('223', ...characteristic('Z13', overrides.reason ?? original.reason))
  add('217', ...characteristic('Z04', input.measurementMethod))
  add('226', ['RFF', ['LI', overrides.lineReference ?? original.lineReference]])
  add('260', ['RFF', ['Z05', overrides.gridAreaCode ?? original.gridAreaCode]])
  add('END_USER_GROUP', ['NAD', 'UD', [identity.id, identity.qualifier, value('227', identity.agency)], '',
    value('228', input.customerName ?? original.customerName), value('229', customer.street), value('232', customer.city), '',
    value('231', customer.postalCode), value('316', customer.country)])
  add('INSTALLATION_GROUP', ['NAD', 'IT', [point, '', value('233', agency)], '', '', value('234', installation.street), installation.city, '', installation.postalCode, installation.country])
  // P field210 forbids DTM92 in Z02. The original agreedStartMinute is retained
  // by observation; no unrelated Z03 date/BRP/meter/reading fields are copied.
  const type = omitted.has('312') ? 'PRODAT:D:97A:UN' : original.messageTypeToken
  return encodeReply(input, type, [...header, ...parts.map(render)], overrides, true, omitted.has('311'))
}
