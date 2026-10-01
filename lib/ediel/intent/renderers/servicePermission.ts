import { renderProdat } from '@/lib/ediel/prodat/engine'
import { prodatMessageTypeToken } from '@/lib/ediel/prodat/registry'
import { resolveSwedishProdatCustomerIdentity } from '@/lib/ediel/prodat/customerIdentity'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { resolveCanonicalOutboundVersion } from '@/lib/ediel/core/versionRegistry'
import { deriveEdielAckDefaults, computeOutboundAckDueAt } from '@/lib/ediel/references'
import { inferEdielFileName } from '@/lib/ediel/classify'
import type { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import type { EdielMessageIntent } from '@/lib/ediel/intent/types'
import type { CreateEdielMessageInput } from '@/lib/ediel/types'
import type { ServicePermissionOriginBasis } from '@/lib/ediel/services/permissionOrigin'
import { buildServiceReportingContext } from '@/lib/ediel/services/reporting'
import { createProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence'

function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null }

/** One existing canonical renderer per physical object, one shared envelope.
 * No beneficiary identity is rendered as a market actor or customer. */
export async function buildServicePermissionDraft(input: {
  actorUserId: string; basis: ServicePermissionOriginBasis; intent: EdielMessageIntent;
  routeContext: Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>; outboundRequestId: string
}): Promise<CreateEdielMessageInput> {
  const { basis: b, intent: i, routeContext: route } = input
  if (route.companyId !== b.companyId || route.environment !== b.environment || route.actor.tenantIdentity?.legalActorId !== b.providerActorId || route.actor.legalActorEdielId !== b.legalSenderId || route.receiverEdielId !== b.legalReceiverId) throw new Error('ediel_permission_route_legal_scope_mismatch')
  const customer = b.customer
  if (text(customer.org_number) && text(customer.personal_number)) throw new Error('ediel_permission_customer_legal_identity_ambiguous')
  const identity = resolveSwedishProdatCustomerIdentity(customer)
  const name = text(customer.company_name) ?? text(customer.full_name) ?? [text(customer.first_name), text(customer.last_name)].filter(Boolean).join(' ')
  // The native origin returns the actual public.customers row. Its postal
  // fields are billing_*; retain explicit historic source aliases on replay.
  const country = text(customer.country) ?? text(customer.country_code) ?? text(customer.billing_country)
  if (!identity.id || !identity.qualifier || !name || country !== 'SE') throw new Error('ediel_permission_actual_customer_identity_required')
  const version = await resolveCanonicalOutboundVersion({ family: 'PRODAT', code: b.code, standard: 'edifact', environment: b.environment, routeDefaultMessageVersion: route.defaultMessageVersion })
  if (!version) throw new Error('ediel_permission_canonical_version_required')
  const token = prodatMessageTypeToken(version)
  const external = text(i.payload.externalReference)
  const li = b.code === 'Z18' ? b.li : i.transactionReference
  if (b.code === 'Z13' && !text(b.requestedMethod)) throw new Error('ediel_permission_source_requested_method_required')
  if (b.code === 'Z13' && !text(b.agreementReference)) throw new Error('ediel_permission_source_agreement_reference_required')
  if (!external || !li || !b.objects.length) throw new Error('ediel_permission_persisted_wire_references_required')
  const all: string[] = []
  const diagnostics = []
  const reporting=b.code==='Z13'?buildServiceReportingContext(b,i,route,input.actorUserId):undefined
  const reportingFacts=reporting?{source:reporting.source,objects:reporting.objects}:null
  for (const [index, object] of b.objects.entries()) {
    const rendered = renderProdat({ code: b.code, variant: b.mode, mode: b.environment,
      actor: { senderEdielId: route.senderEdielId, receiverEdielId: route.receiverEdielId },
      route: { applicationReference: i.applicationReference, senderSubAddress: route.senderSubAddress, receiverSubAddress: route.receiverMessageSubAddress ?? route.receiverSubAddress },
      version: { selectedVersion: version, messageTypeToken: token },
      context: { code: b.code, bgmReference: external, transactionReference: li,
        senderEdielId: route.senderEdielId, receiverEdielId: route.receiverEdielId,
        legalSenderId: b.legalSenderId, legalReceiverId: b.legalReceiverId,
        customerName: name, customerId: identity.id, customerIdCodeListQualifier: identity.qualifier,
        customerCountry: country, customerAddress: text(customer.street) ?? text(customer.billing_street), customerPostalCode: text(customer.postal_code) ?? text(customer.billing_postal_code), customerCity: text(customer.city) ?? text(customer.billing_city),
        meterPointId: object.point ?? '', gridAreaId: object.gridArea,
        reasonForTransaction: b.mode === 'V' ? 'S17' : 'S18',
        reportStartDate: b.code === 'Z13' ? object.reportStart : null,
        reportEndDate: b.code === 'Z13' ? object.reportEnd : null,
        reportingFrequency: b.code === 'Z13' ? b.frequency : null,
        meteringMethod: b.code === 'Z13' ? b.requestedMethod : null,
        energyProductId: b.code === 'Z13' ? object.product : null,
        permissionPurpose: b.code === 'Z13' ? b.purposeCode : null,
        permissionEndReason: b.code === 'Z18' ? b.terminationReason : null,
        permissionId: b.code === 'Z18' ? object.permissionId : null,
        permissionEndDate: b.code === 'Z18' ? object.permissionEnd : null,
        powerOfAttorneyReference: b.code === 'Z13' ? text(b.agreementReference) : null,
        dependentConditionFacts: reportingFacts ? {market:'electricity',reportingPermission:reportingFacts} : {market:'electricity'},
      } })
    const line = rendered.segments.findIndex(segment => segment === 'LIN+1' || segment.startsWith('LIN+1+'))
    if (line < 0) throw new Error('ediel_permission_canonical_object_line_required')
    const segments = index === 0 ? [...rendered.segments] : rendered.segments.slice(line)
    segments[index === 0 ? line : 0] = segments[index === 0 ? line : 0].replace(/^LIN\+1(?=\+|$)/, `LIN+${index + 1}`)
    all.push(...segments)
    diagnostics.push(rendered.diagnostics)
  }
  const ack = deriveEdielAckDefaults({ family: 'PRODAT', code: b.code })
  const raw = EdifactEnvelopeCodec.encode({ sender: route.senderEdielId, receiver: route.receiverEdielId,
    senderSubAddress: route.senderSubAddress, receiverSubAddress: route.receiverMessageSubAddress ?? route.receiverSubAddress,
    interchangeReference: i.interchangeReference, acknowledgementRequest: ack.requiresContrl,
    environment: b.environment, applicationReference: i.applicationReference,
    messages: [{ messageReference: i.messageReference, messageTypeToken: token, businessSegments: all }] })
  return { actorUserId: input.actorUserId, companyId: b.companyId, intentId: i.id,
    sourceOperationId: b.permissionId, routeProfileId: i.routeProfileId,
    direction: 'outbound', messageStandard: 'edifact', messageFamily: 'PRODAT', messageCode: b.code,
    messageVersion: version, processType: 'metering_access', environment: b.environment, testFlag: b.environment === 'test' ? 1 : 0,
    status: 'draft', transportType: 'smtp', mailbox: route.mailbox,
    senderEdielId: route.senderEdielId, senderName: route.senderName, senderSubAddress: route.senderSubAddress,
    receiverEdielId: route.receiverEdielId, receiverName: route.receiverName, receiverSubAddress: route.receiverMessageSubAddress ?? route.receiverSubAddress,
    receiverEmail: route.receiverEmail, communicationRouteId: route.route.id, outboundRequestId: input.outboundRequestId,
    customerId: b.customerId, externalReference: external, transactionReference: li,
    interchangeReference: i.interchangeReference, applicationReference: i.applicationReference,
    rawPayload: raw, parsedPayload: { draftType: 'service_permission', sourcePermissionBasis: b, actorRole: 'esco', prodatEngine: {...diagnostics[0],registerEvidence:createProdatRegisterEvidence({code:b.code,rawSegments:all,facts:reportingFacts?{market:'electricity',reportingPermission:reportingFacts}:{market:'electricity'}})} },
    subject: `PRODAT ${b.code} ${external}`, fileName: inferEdielFileName({ family: 'PRODAT', code: b.code, direction: 'outbound', extension: 'edi' }), mimeType: 'application/edifact',
    ...ack, ackDueAt: computeOutboundAckDueAt(ack), syntaxCheckStatus: 'not_checked', functionalCheckStatus: 'not_checked' }
}
