import {supabaseService} from '@/lib/supabase/service'
import {tenantDb} from '@/lib/supabase/tenantDb'
type ScopedSelect=ReturnType<ReturnType<typeof supabaseService.from>['select']>
import {createOutboundRequest} from '@/lib/cis/db'
import {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
import {generateEdielInterchangeReference} from '@/lib/ediel/core/referenceGenerator'
import {createEdielMessageIntent} from '@/lib/ediel/intent/intentEngine'
import {readBilateralClosureOperation,assertBilateralClosureRoute} from '@/lib/ediel/production/bilateralProdatClosureOperation'
import {renderAndQueueBilateralClosure} from '@/lib/ediel/intent/bilateralClosureGateway'

/** Agreed LK closes only the existing own relation after its matched Z05. The
 * archived reviewed profile and native operation precede the first intent. */
export async function prepareAndQueueBilateralClosureZ08(input:{companyId:string;actorUserId:string;operationId:string;preferredRouteId?:string|null}){
 const b=await readBilateralClosureOperation(input);if(b.status==='held')return b
 const applicationReference='23-DDQ-PRODAT',route=await resolveCanonicalOutboundContext({companyId:b.companyId,environment:b.environment,requestType:'supplier_switch',receiverEdielId:b.legalReceiverId,preferredRouteId:input.preferredRouteId,applicationReference})
 assertBilateralClosureRoute(b,route);const routeProfileId=route.routeRuntime?.route_profile_id;if(!routeProfileId)throw Error('bilateral_closure_route_profile_required')
 const intent=await createEdielMessageIntent({companyId:b.companyId,environment:b.environment,market:'electricity',messageFamily:'PRODAT',messageCode:'Z08',businessProcess:'supplier_switch',direction:'outbound',senderEdielId:route.senderEdielId,senderSubaddress:route.senderSubAddress,receiverEdielId:route.receiverEdielId,receiverSubaddress:route.receiverMessageSubAddress??route.receiverSubAddress,applicationReference,routeProfileId,communicationRouteId:route.route.id,customerId:b.customerId,customerSiteId:b.siteId,meteringPointId:b.pointId,gridAreaCode:b.gridArea,operationId:b.operationId,interchangeReference:generateEdielInterchangeReference(),messageReference:'1',transactionReference:b.lineItemReference,idempotencyKey:`bilateral-closure:${b.operationId}`,payload:{transactionSubtype:'LK',actorRole:'supplier',bilateralClosureOperationId:b.operationId},actorUserId:input.actorUserId,routeProfile:{applicationReference,actorRole:'supplier'}})
 const{data,error}=await(tenantDb(b.companyId).from('outbound_requests').select('id') as ScopedSelect).eq('source_type','manual').eq('source_id',intent.id).eq('request_type','supplier_switch_cancellation').limit(2).returns<Array<{id:string}>>();if(error)throw error;if(data&&data.length>1)throw Error('bilateral_closure_outbound_request_ambiguous')
 const requestId=data?.[0]?.id??(await createOutboundRequest({actorUserId:input.actorUserId,customerId:b.customerId,siteId:b.siteId,meteringPointId:b.pointId,requestType:'supplier_switch_cancellation',sourceType:'manual',sourceId:intent.id,communicationRouteId:route.route.id,operationId:b.operationId,environment:b.environment,failOnMissingEnvironment:true,payload:{bilateralClosureOperationId:b.operationId,intentId:intent.id}})).id
 return renderAndQueueBilateralClosure({...input,intentId:intent.id,routeContext:route,outboundRequestId:requestId})
}
