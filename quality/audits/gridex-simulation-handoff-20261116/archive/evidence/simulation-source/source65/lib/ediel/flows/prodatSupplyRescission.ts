import {supabaseService} from '@/lib/supabase/service'
import {tenantDb} from '@/lib/supabase/tenantDb'
type ScopedSelect=ReturnType<ReturnType<typeof supabaseService.from>['select']>
import {createOutboundRequest} from '@/lib/cis/db'
import {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
import {generateEdielInterchangeReference} from '@/lib/ediel/core/referenceGenerator'
import {createEdielMessageIntent} from '@/lib/ediel/intent/intentEngine'
import {readSupplyRescissionMandate,assertSupplyRescissionRoute} from '@/lib/ediel/production/supplyRescissionOperation'
import {renderAndQueueSupplyRescission} from '@/lib/ediel/intent/supplyRescissionGateway'

/** A reviewed current legal rescission requests the end of this own supply.
 * Only its exact actually sent H original can authorize a later Z05/L end. */
export async function prepareAndQueueSupplyRescissionZ08(input:{companyId:string;actorUserId:string;mandateId:string;preferredRouteId?:string|null}){
 const b=await readSupplyRescissionMandate(input);if(b.status==='held')return b
 const applicationReference='23-DDQ-PRODAT',route=await resolveCanonicalOutboundContext({companyId:b.companyId,environment:b.environment,requestType:'supplier_switch',receiverEdielId:b.legalReceiverId,preferredRouteId:input.preferredRouteId,applicationReference})
 assertSupplyRescissionRoute(b,route);const routeProfileId=route.routeRuntime?.route_profile_id;if(!routeProfileId)throw Error('supply_rescission_route_profile_required')
 const intent=await createEdielMessageIntent({companyId:b.companyId,environment:b.environment,market:'electricity',messageFamily:'PRODAT',messageCode:'Z08',businessProcess:'supplier_switch',direction:'outbound',senderEdielId:route.senderEdielId,senderSubaddress:route.senderSubAddress,receiverEdielId:route.receiverEdielId,receiverSubaddress:route.receiverMessageSubAddress??route.receiverSubAddress,applicationReference,routeProfileId,communicationRouteId:route.route.id,customerId:b.customerId,customerSiteId:b.siteId,meteringPointId:b.pointId,gridAreaCode:b.gridArea,operationId:b.mandateId,interchangeReference:generateEdielInterchangeReference(),messageReference:'1',transactionReference:b.lineItemReference,idempotencyKey:`national-rescission:${b.mandateId}`,payload:{transactionSubtype:'H',actorRole:'supplier',supplyRescissionMandateId:b.mandateId},actorUserId:input.actorUserId,routeProfile:{applicationReference,actorRole:'supplier'}})
 const{data,error}=await(tenantDb(b.companyId).from('outbound_requests').select('id') as ScopedSelect).eq('source_type','manual').eq('source_id',intent.id).eq('request_type','supplier_switch_cancellation').limit(2).returns<Array<{id:string}>>();if(error)throw error;if(data&&data.length>1)throw Error('supply_rescission_outbound_request_ambiguous')
 const requestId=data?.[0]?.id??(await createOutboundRequest({actorUserId:input.actorUserId,customerId:b.customerId,siteId:b.siteId,meteringPointId:b.pointId,requestType:'supplier_switch_cancellation',sourceType:'manual',sourceId:intent.id,communicationRouteId:route.route.id,operationId:b.mandateId,environment:b.environment,failOnMissingEnvironment:true,payload:{supplyRescissionMandateId:b.mandateId,intentId:intent.id}})).id
 return renderAndQueueSupplyRescission({...input,intentId:intent.id,routeContext:route,outboundRequestId:requestId})
}
