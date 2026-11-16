import { renderProdat } from '@/lib/ediel/prodat/engine'
import { prodatMessageTypeToken } from '@/lib/ediel/prodat/registry'
import { resolveCanonicalOutboundVersion } from '@/lib/ediel/core/versionRegistry'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { deriveEdielAckDefaults } from '@/lib/ediel/references'
import { createProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import type { EdielMessageIntent } from '@/lib/ediel/intent/types'
import type { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import type { CreateEdielMessageInput } from '@/lib/ediel/types'
import { productionContractDateContext, type ProductionContractBasis } from '@/lib/ediel/production/contractSource'

export async function buildProductionContractDraft(input: { actorUserId: string; basis: ProductionContractBasis; intent: EdielMessageIntent;
  routeContext: Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>; outboundRequestId: string }) {
  const { basis: b, intent: i, routeContext: route } = input
  const context = productionContractDateContext(b, route)
  const version = await resolveCanonicalOutboundVersion({ family: 'PRODAT', code: 'Z09', standard: 'edifact', environment: b.environment, routeDefaultMessageVersion: route.defaultMessageVersion })
  if (!version || !i.transactionReference) throw new Error('production_contract_canonical_version_reference_required')
  const facts = { market: 'electricity' as const, dateEventSource: context.source, dateEventObjects: context.objects }
  const rendered = renderProdat({ code: 'Z09', variant: 'D', mode: b.environment,
    actor: { senderEdielId: route.senderEdielId, receiverEdielId: route.receiverEdielId },
    route: { applicationReference: i.applicationReference, senderSubAddress: route.senderSubAddress, receiverSubAddress: route.receiverMessageSubAddress ?? route.receiverSubAddress },
    version: { selectedVersion: version, messageTypeToken: prodatMessageTypeToken(version) },
    context: { code: 'Z09', bgmReference: i.interchangeReference, transactionReference: i.transactionReference,
      senderEdielId: route.senderEdielId, receiverEdielId: route.receiverEdielId, legalSenderId: b.legalSenderId, legalReceiverId: b.legalReceiverId,
      customerName: '', balanceResponsibleId: b.brpEdielId, meterPointId: b.pointId, meterPointIdAgency: b.identityAgency, gridAreaId: b.gridArea, reasonForTransaction: 'Z70',
      contractStartDate: b.eventKind === 'signed' ? b.boundaryAt : null, contractEndDate: b.eventKind === 'ceased' ? b.boundaryAt : null,
      dependentConditionFacts: facts } })
  const ack = deriveEdielAckDefaults({ family: 'PRODAT', code: 'Z09' })
  const raw = EdifactEnvelopeCodec.encode({ sender: route.senderEdielId, receiver: route.receiverEdielId, senderSubAddress: route.senderSubAddress,
    receiverSubAddress: route.receiverMessageSubAddress ?? route.receiverSubAddress, interchangeReference: i.interchangeReference,
    applicationReference: i.applicationReference, environment: b.environment, acknowledgementRequest: ack.requiresContrl,
    messages: [{ messageReference: i.messageReference, messageTypeToken: prodatMessageTypeToken(version), businessSegments: rendered.segments }] })
  const draft: CreateEdielMessageInput = { actorUserId: input.actorUserId, companyId: b.companyId, intentId: i.id, sourceOperationId: b.eventId,
    routeProfileId: i.routeProfileId, direction: 'outbound', messageStandard: 'edifact', messageFamily: 'PRODAT', messageCode: 'Z09', messageVersion: version,
    processType: 'masterdata', environment: b.environment, testFlag: b.environment === 'test' ? 1 : 0, status: 'draft', transportType: 'smtp', mailbox: route.mailbox,
    senderEdielId: route.senderEdielId, senderName: route.senderName, senderSubAddress: route.senderSubAddress, receiverEdielId: route.receiverEdielId,
    receiverName: route.receiverName, receiverSubAddress: route.receiverMessageSubAddress ?? route.receiverSubAddress, receiverEmail: route.receiverEmail,
    communicationRouteId: route.route.id, outboundRequestId: input.outboundRequestId, customerId: b.customerId, siteId: b.siteId, meteringPointId: b.meteringPointId,
    externalReference: i.interchangeReference, interchangeReference: i.interchangeReference, transactionReference: i.transactionReference, applicationReference: i.applicationReference,
    rawPayload: raw, parsedPayload: { draftType: 'production_contract', actorRole: 'supplier', productionContractEventId: b.eventId,
      prodatEngine: { ...rendered.diagnostics, registerEvidence: createProdatRegisterEvidence({ code: 'Z09', rawSegments: rendered.segments, facts }) } },
    subject: `PRODAT Z09 ${i.interchangeReference}`, mimeType: 'application/edifact', ...ack, syntaxCheckStatus: 'not_checked', functionalCheckStatus: 'not_checked' }
  return { draft, dateEventContext: context }
}
