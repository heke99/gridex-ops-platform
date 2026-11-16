import {generateEdielTransactionReference,generateEdielInterchangeReference} from '@/lib/ediel/core/referenceGenerator'
import { supabaseService } from '@/lib/supabase/service'
import { tenantDb } from '@/lib/supabase/tenantDb'
type ScopedSelect = ReturnType<ReturnType<typeof supabaseService.from>['select']>
import { createOutboundRequest } from '@/lib/cis/db'
import { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import { resolveApplicationReference } from '@/lib/ediel/core/applicationReferenceResolver'
import { createEdielMessageIntent } from '@/lib/ediel/intent/intentEngine'
import { renderAndQueueMeteringMethodChange } from '@/lib/ediel/intent/meteringMethodChangeGateway'
import { readMeteringMethodChangeSource, assertMeteringMethodChangeCanonicalRoute } from '@/lib/ediel/production/meteringMethodChangeSource'

/** Customer-agreed Z09F/G registers desired future method only. Earlier DSO
 * methods and caller contract claims are never new agreement evidence. */
export async function prepareAndQueueMeteringMethodChangeZ09(input: { companyId: string; eventId: string; actorUserId: string; preferredRouteId?: string | null }) {
  const basis = await readMeteringMethodChangeSource(input)
  if (basis.status === 'held') return basis
  const applicationReference = resolveApplicationReference({ messageFamily: 'PRODAT', businessCode: 'Z09', actorRole: 'supplier', market: 'electricity' })
  const route = await resolveCanonicalOutboundContext({ companyId: basis.companyId, environment: basis.environment, requestType: 'customer_masterdata',
    receiverEdielId: basis.legalReceiverId, preferredRouteId: input.preferredRouteId, applicationReference })
  assertMeteringMethodChangeCanonicalRoute(basis, route)
  const routeProfileId = route.routeRuntime?.route_profile_id
  if (!routeProfileId) throw new Error('metering_method_change_canonical_route_profile_required')
  const ref=generateEdielTransactionReference('Z09'),interchange=generateEdielInterchangeReference()
  const intent = await createEdielMessageIntent({ companyId: basis.companyId, environment: basis.environment, market: 'electricity', messageFamily: 'PRODAT', messageCode: 'Z09',
    businessProcess: 'customer_masterdata', direction: 'outbound', senderEdielId: route.senderEdielId, senderSubaddress: route.senderSubAddress,
    receiverEdielId: route.receiverEdielId, receiverSubaddress: route.receiverMessageSubAddress ?? route.receiverSubAddress, applicationReference, routeProfileId,
    communicationRouteId: route.route.id, customerId: basis.customerId, customerSiteId:basis.siteId, meteringPointId: basis.pointId, gridAreaCode: basis.gridArea, operationId: basis.eventId,
    interchangeReference: interchange, messageReference: '1', transactionReference: ref, idempotencyKey: `metering-method-change:${basis.eventId}`,
    payload: { actorRole: 'supplier', meteringMethodChangeEventId: basis.eventId }, actorUserId: input.actorUserId,
    routeProfile: { applicationReference: route.applicationReference, actorRole: 'supplier' } })
  const { data, error } = await (tenantDb(basis.companyId).from('outbound_requests').select('id') as ScopedSelect).eq('source_type', 'manual').eq('source_id', intent.id)
    .eq('request_type', 'customer_masterdata').limit(2).returns<Array<{ id: string }>>()
  if (error) throw error
  if (data && data.length > 1) throw new Error('metering_method_change_outbound_request_ambiguous')
  const requestId = data?.[0]?.id ?? (await createOutboundRequest({ actorUserId: input.actorUserId, customerId: basis.customerId, siteId: basis.siteId, meteringPointId: basis.meteringPointId,
    requestType: 'customer_masterdata', sourceType: 'manual', sourceId: intent.id, communicationRouteId: route.route.id, operationId: basis.eventId,
    environment: basis.environment, failOnMissingEnvironment: true, payload: { meteringMethodChangeEventId: basis.eventId, intentId: intent.id } })).id
  return renderAndQueueMeteringMethodChange({ intentId: intent.id, actorUserId: input.actorUserId, companyId: basis.companyId, eventId: basis.eventId, routeContext: route, outboundRequestId: requestId })
}
