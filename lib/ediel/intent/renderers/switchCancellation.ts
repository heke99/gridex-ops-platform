import { renderProdat } from '@/lib/ediel/prodat/engine'
import { prodatMessageTypeToken } from '@/lib/ediel/prodat/registry'
import { resolveCanonicalOutboundVersion } from '@/lib/ediel/core/versionRegistry'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { deriveEdielAckDefaults } from '@/lib/ediel/references'
import { createProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import type { EdielMessageIntent } from '@/lib/ediel/intent/types'
import type { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import type { CreateEdielMessageInput } from '@/lib/ediel/types'
import {assertSwitchCancellationRoute,type SwitchCancellationBasis} from '@/lib/ediel/production/switchCancellationSource'
import {escapeEdifactValue} from '@/lib/ediel/core/edifactSerializer'

export async function buildSwitchCancellationDraft(input: { actorUserId: string; basis: SwitchCancellationBasis; intent: EdielMessageIntent;
  routeContext: Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>; outboundRequestId: string }) {
  const { basis: b, intent: i, routeContext: route } = input
  assertSwitchCancellationRoute(b, route)
  if(!b.requestedMethod)throw new Error('switch_cancellation_source_requested_method_required')
  const version = await resolveCanonicalOutboundVersion({ family: 'PRODAT', code: 'Z03', standard: 'edifact', environment: b.environment, routeDefaultMessageVersion: route.defaultMessageVersion })
  if(!version||!i.operationId||i.companyId!==b.companyId||i.environment!==b.environment||i.messageCode!=='Z03'||i.transactionReference!==b.li||(b.operationId&&b.operationId!==i.operationId)) throw new Error('switch_cancellation_canonical_version_reference_required')
  const facts = {market:'electricity' as const}
  const rendered = renderProdat({ code: 'Z03', variant: 'C', mode: b.environment,
    actor: { senderEdielId: route.senderEdielId, receiverEdielId: route.receiverEdielId },
    route: { applicationReference: i.applicationReference, senderSubAddress: route.senderSubAddress, receiverSubAddress: route.receiverMessageSubAddress ?? route.receiverSubAddress },
    version: { selectedVersion: version, messageTypeToken: prodatMessageTypeToken(version) },
    context: { code: 'Z03', bgmReference: i.interchangeReference, transactionReference: b.li,
      senderEdielId: route.senderEdielId, receiverEdielId: route.receiverEdielId, legalSenderId: b.legalSenderId, legalReceiverId: b.legalReceiverId,
      customerName:b.customerName,customerId:b.customerIdentity,customerIdCodeListQualifier:b.customerQualifier,customerIdAgency:'260',meterPointId:b.pointId, meterPointIdAgency: b.identityAgency, gridAreaId: b.gridArea, reasonForTransaction:'Z24',startDate:b.startAt,
      meteringMethod:b.requestedMethod,dependentConditionFacts: facts } })
  // The source owner's LI is an exact protocol identity. The ordinary renderer's
  // compact-reference helper must not rewrite an escaped existing identity.
  const segments=rendered.segments.map(s=>s.startsWith('RFF+LI:')?`RFF+LI:${escapeEdifactValue(b.li)}`:s)
  const ack = deriveEdielAckDefaults({ family: 'PRODAT', code: 'Z03' })
  const raw = EdifactEnvelopeCodec.encode({ sender: route.senderEdielId, receiver: route.receiverEdielId, senderSubAddress: route.senderSubAddress,
    receiverSubAddress: route.receiverMessageSubAddress ?? route.receiverSubAddress, interchangeReference: i.interchangeReference,
    applicationReference: i.applicationReference, environment: b.environment, acknowledgementRequest: ack.requiresContrl,
    messages: [{ messageReference: i.messageReference, messageTypeToken: prodatMessageTypeToken(version), businessSegments:segments }] })
  const draft: CreateEdielMessageInput = { actorUserId: input.actorUserId, companyId: b.companyId, intentId: i.id, sourceOperationId:i.operationId,originalMessageId:b.originalMessageId,switchRequestId:b.switchRequestId,siteId:b.siteId,
    routeProfileId: i.routeProfileId, direction: 'outbound', messageStandard: 'edifact', messageFamily: 'PRODAT', messageCode: 'Z03', messageVersion: version,
    processType:'supplier_switch', environment: b.environment, testFlag: b.environment === 'test' ? 1 : 0, status: 'draft', transportType: 'smtp', mailbox: route.mailbox,
    senderEdielId: route.senderEdielId, senderName: route.senderName, senderSubAddress: route.senderSubAddress, receiverEdielId: route.receiverEdielId,
    receiverName: route.receiverName, receiverSubAddress: route.receiverMessageSubAddress ?? route.receiverSubAddress, receiverEmail: route.receiverEmail,
    communicationRouteId: route.route.id, outboundRequestId: input.outboundRequestId, customerId: b.customerId, meteringPointId: b.meteringPointId,
    externalReference: i.interchangeReference, interchangeReference: i.interchangeReference, transactionReference: b.li, applicationReference: i.applicationReference,
    rawPayload: raw, parsedPayload: { draftType:'switch_cancellation',actorRole:'supplier',
      prodatEngine: { ...rendered.diagnostics, registerEvidence: createProdatRegisterEvidence({ code: 'Z03', rawSegments:segments, facts }) } },
    subject: `PRODAT Z03 C ${i.interchangeReference}`, mimeType: 'application/edifact', ...ack, syntaxCheckStatus: 'not_checked', functionalCheckStatus: 'not_checked' }
  return {draft}
}
