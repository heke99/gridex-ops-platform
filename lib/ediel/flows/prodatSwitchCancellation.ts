import { randomUUID } from 'node:crypto'
import { generateEdielInterchangeReference } from '@/lib/ediel/core/referenceGenerator'
import { supabaseService } from '@/lib/supabase/service'
import { tenantDb } from '@/lib/supabase/tenantDb'
type ScopedSelect = ReturnType<ReturnType<typeof supabaseService.from>['select']>
import { createOutboundRequest } from '@/lib/cis/db'
import { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import { resolveApplicationReference } from '@/lib/ediel/core/applicationReferenceResolver'
import { createEdielMessageIntent } from '@/lib/ediel/intent/intentEngine'
import { renderAndQueueSwitchCancellation } from '@/lib/ediel/intent/switchCancellationGateway'
import { readSwitchCancellationSource, assertSwitchCancellationRoute } from '@/lib/ediel/production/switchCancellationSource'

/** Withdraw one genuine own L/LK original. The source owner freezes its exact
 * customer/point/LI/start and deadline; no original or provider result is reset. */
export async function prepareAndQueueSwitchCancellation(input: { companyId: string; switchRequestId:string; actorUserId: string; preferredRouteId?:string|null;environment?:'test'|'production' }) {
  const basis = await readSwitchCancellationSource(input)
  if(basis.status==='held')return basis
  if(input.environment&&input.environment!==basis.environment)throw Error('switch_cancellation_source_environment_mismatch')
  const applicationReference = resolveApplicationReference({ messageFamily: 'PRODAT', businessCode: 'Z03', actorRole: 'supplier', market: 'electricity' })
  const route = await resolveCanonicalOutboundContext({ companyId: basis.companyId, environment: basis.environment, requestType:'supplier_switch',
    receiverEdielId: basis.legalReceiverId, preferredRouteId: input.preferredRouteId, applicationReference })
  assertSwitchCancellationRoute(basis, route)
  const routeProfileId = route.routeRuntime?.route_profile_id
  if (!routeProfileId) throw new Error('switch_cancellation_canonical_route_profile_required')
  const operationId=basis.operationId??randomUUID()
  const ref = generateEdielInterchangeReference()
  const intent = await createEdielMessageIntent({ companyId: basis.companyId, environment: basis.environment, market: 'electricity', messageFamily: 'PRODAT', messageCode: 'Z03',
    businessProcess:'supplier_switch', direction: 'outbound', senderEdielId: route.senderEdielId, senderSubaddress: route.senderSubAddress,
    receiverEdielId: route.receiverEdielId, receiverSubaddress: route.receiverMessageSubAddress ?? route.receiverSubAddress, applicationReference, routeProfileId,
    communicationRouteId: route.route.id, customerId:basis.customerId,customerSiteId:basis.siteId,supplierSwitchRequestId:basis.switchRequestId,meteringPointId:basis.pointId, gridAreaCode: basis.gridArea, operationId,
    interchangeReference: ref, messageReference: '1', transactionReference:basis.li, idempotencyKey:`switch-cancellation:${basis.originalMessageId}`,
    payload: { actorRole: 'supplier', switchCancellationOperationId:operationId,transactionSubtype:'C' }, actorUserId: input.actorUserId,
    routeProfile: { applicationReference: route.applicationReference, actorRole: 'supplier' } })
  const { data, error } = await (tenantDb(basis.companyId).from('outbound_requests').select('id') as ScopedSelect).eq('source_type', 'manual').eq('source_id', intent.id)
    .eq('request_type','supplier_switch').limit(2).returns<Array<{ id: string }>>()
  if (error) throw error
  if (data && data.length > 1) throw new Error('switch_cancellation_outbound_request_ambiguous')
  const requestId = data?.[0]?.id ?? (await createOutboundRequest({ actorUserId:input.actorUserId,customerId:basis.customerId,siteId:basis.siteId,meteringPointId:basis.meteringPointId,
    requestType:'supplier_switch', sourceType: 'manual', sourceId: intent.id, communicationRouteId:route.route.id,operationId:intent.operationId,
    environment: basis.environment, failOnMissingEnvironment: true, payload: { switchCancellationOperationId:operationId,transactionSubtype:'C', intentId: intent.id } })).id
  return renderAndQueueSwitchCancellation({ intentId: intent.id, actorUserId: input.actorUserId, companyId: basis.companyId, switchRequestId:basis.switchRequestId, routeContext: route, outboundRequestId: requestId })
}
