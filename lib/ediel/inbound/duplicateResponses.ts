import { createHash } from 'node:crypto'
import { buildEdielInterchangeReference } from '@/lib/ediel/core/referenceRegistry'
import { supabaseService } from '@/lib/supabase/service'
import { assertEdielSmtpReadiness } from '@/lib/ediel/mailReadiness'
import { readSourceBoundOutboundAckRulePackEvidence } from '@/lib/ediel/core/ackSourceRulePackEvidence'
import { originalAckLegalNadSegment, originalAckPartyIdentities } from '@/lib/ediel/core/originalAckPartyIdentities'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { escapeEdifactValue } from '@/lib/ediel/core/edifactSerializer'
import { buildEdifactEnvelope } from '@/lib/ediel/messages'
import type { EdielMessageRow } from '@/lib/ediel/types'

type Input = { companyId: string; sourceMessageId: string; inboundEmailMessageId: string; actorUserId: string }
type Result = { status: 'protocol_response_prepared'; ackMessage: EdielMessageRow; outboxId: string; receptionId: string; responseRequestId: string; businessEffectAuthorized: false; replayed: boolean }
type Route = { companyId: string; environment: string; sourceMessageId: string; sourceHash: string; senderEdielId: string; senderQualifier: string | null; senderSubAddress: string | null; receiverEdielId: string; receiverQualifier: string | null; receiverSubAddress: string | null; applicationReference: string; senderEmail: string; receiverEmail: string; mailbox: string; smtpHost: string; smtpPort: number; route: { id: string; company_id: string; is_active: boolean }; routeRuntime: { route_profile_id: string; company_id: string; communication_route_id: string; environment: string; is_enabled: boolean }; authorizesBusinessEffect: false }
type Qualified = { status: 'qualified'; sourceMessage: EdielMessageRow; sourceHash: string; receptionId: string; responseRequestId: string; serverDate203: string; sourceReceivedDate203: string; businessEffectAuthorized: false; route: Route | null }
const hash = (raw: string) => createHash('sha256').update(raw, 'utf8').digest('hex')
function result(value: unknown, input: Input): Result {
  const r = value as Result | null, m = r?.ackMessage
  if (!r || r.status !== 'protocol_response_prepared' || !m || m.company_id !== input.companyId || m.related_message_id !== input.sourceMessageId ||
      m.direction !== 'outbound' || m.message_family !== 'APERAK' || m.ack_outcome !== 'negative' || !m.raw_payload ||
      typeof r.replayed !== 'boolean' || !r.outboxId || !r.receptionId || !r.responseRequestId || r.businessEffectAuthorized !== false) throw new Error('ediel_duplicate_native_result_mismatch')
  return r
}
/** This consumer only runs for a real NEW retained-mail reception. The native
 * owner determines 103; public reception classifications never authorize it. */
export async function prepareDuplicate103Response(input: Input): Promise<Result> {
  const args = { p_company_id: input.companyId, p_source_message_id: input.sourceMessageId, p_inbound_email_message_id: input.inboundEmailMessageId, p_actor_user_id: input.actorUserId }
  const read = async (smtp: { from: string; host: string; port: number } | null) => {
    const { data, error } = await supabaseService.rpc('ediel_prepare_duplicate_103_response_v1', { ...args, p_smtp: smtp })
    if (error) throw error
    return data as Qualified | Result | null
  }
  // Immutable committed response is read before SMTP readiness, renderer,
  // route selection or any attempted insertion. No caller draft affects replay.
  let q = await read(null)
  if (q?.status === 'protocol_response_prepared') return result(q, input)
  if (!q || q.status !== 'qualified') throw new Error('ediel_duplicate_native_qualification_required')
  const smtp = assertEdielSmtpReadiness()
  q = await read({ from: smtp.from, host: smtp.host, port: smtp.port })
  if (q?.status === 'protocol_response_prepared') return result(q, input)
  if (!q || q.status !== 'qualified' || !q.route || q.businessEffectAuthorized !== false || q.sourceMessage.id !== input.sourceMessageId ||
      q.sourceMessage.company_id !== input.companyId || q.sourceMessage.direction !== 'inbound' || q.sourceMessage.message_family !== 'PRODAT' ||
      !q.sourceMessage.raw_payload || hash(q.sourceMessage.raw_payload) !== q.sourceHash || !/^[0-9]{12}$/.test(q.serverDate203) || !/^[0-9]{12}$/.test(q.sourceReceivedDate203)) throw new Error('ediel_duplicate_native_qualification_mismatch')
  const source = await readSourceBoundOutboundAckRulePackEvidence({ companyId: input.companyId, environment: q.sourceMessage.environment, sourceMessageId: input.sourceMessageId })
  if (source.sourceMessage.raw_payload !== q.sourceMessage.raw_payload) throw new Error('ediel_duplicate_original_changed')
  const parties = originalAckPartyIdentities({ rawPayload: source.sourceMessage.raw_payload, expectedFamily: 'PRODAT' }), route = q.route
  const original = parties.transport
  if (route.companyId !== input.companyId || route.environment !== q.sourceMessage.environment || route.sourceMessageId !== input.sourceMessageId || route.sourceHash !== q.sourceHash ||
      route.senderEdielId !== original.receiverComponents[0] || route.receiverEdielId !== original.senderComponents[0] ||
      route.senderQualifier !== (original.receiverComponents[1] || null) || route.senderSubAddress !== (original.receiverComponents[2] || null) || route.receiverQualifier !== (original.senderComponents[1] || null) || route.receiverSubAddress !== (original.senderComponents[2] || null) || route.applicationReference !== parties.applicationReference || route.senderEmail !== smtp.from || route.mailbox !== smtp.from || route.smtpHost !== smtp.host || route.smtpPort !== smtp.port ||
      route.route.company_id !== input.companyId || !route.route.is_active || route.routeRuntime.company_id !== input.companyId ||
      route.routeRuntime.communication_route_id !== route.route.id || route.routeRuntime.environment !== q.sourceMessage.environment || !route.routeRuntime.is_enabled || route.authorizesBusinessEffect !== false) throw new Error('ediel_duplicate_route_scope_mismatch')
  const wire = tokenizeEdifact(source.sourceMessage.raw_payload)
  const bgm = wire.segments.filter(s => s.tag === 'BGM')
  const document = segmentComposite(bgm[0], 2, wire.una)
  if (bgm.length !== 1 || document.length !== 1 || !document[0]) throw new Error('ediel_duplicate_original_document_required')
  // Every physically known own reference remains in the wire. The actual
  // complete directory guard truthfully holds dual Z07+LI; never drop one.
  const references = [...new Set(wire.segments.flatMap(s => s.tag === 'LIN' ? (segmentComposite(s, 3, wire.una)[0] ? [`RFF+Z07:${escapeEdifactValue(segmentComposite(s, 3, wire.una)[0])}`] : []) :
    s.tag === 'RFF' && segmentComposite(s, 1, wire.una)[0] === 'LI' && segmentComposite(s, 1, wire.una)[1] ? [`RFF+LI:${escapeEdifactValue(segmentComposite(s, 1, wire.una)[1])}`] : []))]
  const reference = buildEdielInterchangeReference()
  const built = buildEdifactEnvelope({ companyId: input.companyId, ackSourceQualification: source,
    senderEdielId: route.senderEdielId, senderQualifier: route.senderQualifier, senderSubAddress: route.senderSubAddress,
    receiverEdielId: route.receiverEdielId, receiverQualifier: route.receiverQualifier, receiverSubAddress: route.receiverSubAddress,
    applicationReference: route.applicationReference, acknowledgementRequest: false, testFlag: q.sourceMessage.environment === 'production' ? 0 : 1,
    interchangeReference: reference, messageReference: '1', messageTypeToken: 'APERAK:D:96A:UN:E2SE6A', segments: [
      `BGM+++27`, `DTM+137:${q.serverDate203}:203`, `DTM+178:${q.sourceReceivedDate203}:203`, `RFF+ACW:${escapeEdifactValue(document[0])}`,
      originalAckLegalNadSegment('FR', parties.legalReceiver), originalAckLegalNadSegment('DO', parties.legalSender),
      'ERC+40::260', 'FTX+AAO++103::260+Dubblett av meddelandet', ...references,
    ] })
  const { data, error } = await supabaseService.rpc('ediel_commit_duplicate_103_response_v1', { ...args, p_smtp: { from: smtp.from, host: smtp.host, port: smtp.port }, p_draft: {
    rawPayload: built.raw, messageVersion: 'D:96A:UN:E2SE6A', transportType: 'smtp', mailbox: route.mailbox,
    senderEmail: route.senderEmail, receiverEmail: route.receiverEmail, communicationRouteId: route.route.id, routeProfileId: route.routeRuntime.route_profile_id,
    subject: 'APERAK – Dubblett av meddelandet', fileName: `APERAK-${reference}.edi`, mimeType: 'application/EDIFACT',
    parsedPayload: {}, validationReport: built.payloadPreflight, syntaxCheckStatus: 'passed', functionalCheckStatus: 'passed',
  } })
  if (error) throw error
  return result(data, input)
}
