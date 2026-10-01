import { supabaseService } from '@/lib/supabase/service'
import { createOutboundRequest } from '@/lib/cis/db'
import { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import { resolveApplicationReference } from '@/lib/ediel/core/applicationReferenceResolver'
import { createEdielMessageIntent } from '@/lib/ediel/intent/intentEngine'
import { renderAndQueueProductionContract } from '@/lib/ediel/intent/productionContractGateway'
import { readProductionContractSource, productionContractDateContext } from '@/lib/ediel/production/contractSource'
import { allocateProdatSwitchWireReferences } from '@/lib/ediel/prodat/compatAdapter'

/** Supplier Z09D has its own production-contract event. A supplier-switch ID,
 * a date-only boundary or a caller's claimed signature is never accepted. */
export async function prepareAndQueueProductionContractZ09(input: { companyId: string; eventId: string; actorUserId: string; preferredRouteId?: string | null }) {
  const basis = await readProductionContractSource(input)
  if (basis.status === 'held') return basis
  const applicationReference = resolveApplicationReference({ messageFamily: 'PRODAT', businessCode: 'Z09', actorRole: 'supplier', market: 'electricity' })
  const route = await resolveCanonicalOutboundContext({ companyId: basis.companyId, environment: basis.environment, requestType: 'customer_masterdata',
    receiverEdielId: basis.legalReceiverId, preferredRouteId: input.preferredRouteId, applicationReference })
  productionContractDateContext(basis, route)
  const routeProfileId = route.routeRuntime?.route_profile_id
  if (!routeProfileId) throw new Error('production_contract_canonical_route_profile_required')
  const refs = allocateProdatSwitchWireReferences('Z09', basis.eventId, route.senderEdielId, route.receiverEdielId)
  const intent = await createEdielMessageIntent({ companyId: basis.companyId, environment: basis.environment, market: 'electricity', messageFamily: 'PRODAT', messageCode: 'Z09',
    businessProcess: 'customer_masterdata', direction: 'outbound', senderEdielId: route.senderEdielId, senderSubaddress: route.senderSubAddress,
    receiverEdielId: route.receiverEdielId, receiverSubaddress: route.receiverMessageSubAddress ?? route.receiverSubAddress, applicationReference, routeProfileId,
    communicationRouteId: route.route.id, customerId: basis.customerId, customerSiteId: basis.siteId, meteringPointId: basis.pointId, gridAreaCode: basis.gridArea, operationId: basis.eventId,
    interchangeReference: refs.interchangeReference, messageReference: refs.messageReference, transactionReference: refs.transactionReference, idempotencyKey: `production-contract:${basis.eventId}`,
    payload: { actorRole: 'supplier', productionContractEventId: basis.eventId }, actorUserId: input.actorUserId,
    routeProfile: { applicationReference: route.applicationReference, actorRole: 'supplier' } })
  const { data, error } = await supabaseService.from('outbound_requests').select('id').eq('company_id', basis.companyId).eq('source_type', 'manual').eq('source_id', intent.id)
    .eq('request_type', 'customer_masterdata').order('created_at', { ascending: false }).limit(1)
  if (error) throw error
  const requestId = data?.[0]?.id ?? (await createOutboundRequest({ actorUserId: input.actorUserId, customerId: basis.customerId, siteId: basis.siteId, meteringPointId: basis.meteringPointId,
    requestType: 'customer_masterdata', sourceType: 'manual', sourceId: intent.id, communicationRouteId: route.route.id, operationId: basis.eventId,
    environment: basis.environment, failOnMissingEnvironment: true, payload: { productionContractEventId: basis.eventId, intentId: intent.id } })).id
  return renderAndQueueProductionContract({ intentId: intent.id, actorUserId: input.actorUserId, companyId: basis.companyId, eventId: basis.eventId, routeContext: route, outboundRequestId: requestId })
}
