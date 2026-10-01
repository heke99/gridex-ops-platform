import {supabaseService} from '@/lib/supabase/service'
import {createOutboundRequest} from '@/lib/cis/db'
import {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
import {createEdielMessageIntent} from '@/lib/ediel/intent/intentEngine'
import {renderAndQueueCustomerLifeEvent} from '@/lib/ediel/intent/customerLifeEventGateway'
import {readCustomerLifeEventSource,customerLifeEventContext} from '@/lib/ediel/production/lifeEventSource'

/** Desired customer changes remain distinct from received confirmations. The
 * only client selector is an owned approved event, never asserted death/mandate. */
export async function prepareAndQueueCustomerLifeEventZ09(input:{companyId:string;eventId:string;actorUserId:string;preferredRouteId?:string|null}){
 const basis=await readCustomerLifeEventSource(input)
 if(basis.status==='held')return basis
 const route=await resolveCanonicalOutboundContext({companyId:basis.companyId,environment:basis.environment,requestType:'customer_masterdata',receiverEdielId:basis.legalReceiverId,preferredRouteId:input.preferredRouteId,applicationReference:'23-DDQ-PRODAT'})
 const routeProfileId=route.routeRuntime?.route_profile_id
 if(!routeProfileId)throw new Error('customer_life_event_route_profile_required')
 if(route.applicationReference!=='23-DDQ-PRODAT')throw new Error('customer_life_event_application_reference_required')
 const intent=await createEdielMessageIntent({companyId:basis.companyId,environment:basis.environment,market:'electricity',messageFamily:'PRODAT',messageCode:'Z09',businessProcess:'customer_masterdata',direction:'outbound',senderEdielId:route.senderEdielId,senderSubaddress:route.senderSubAddress,receiverEdielId:route.receiverEdielId,receiverSubaddress:route.receiverMessageSubAddress??route.receiverSubAddress,applicationReference:route.applicationReference,routeProfileId,communicationRouteId:route.route.id,customerId:basis.customerId,customerSiteId:basis.siteId,meteringPointId:basis.pointId,gridAreaCode:basis.gridArea,operationId:basis.eventId,
  interchangeReference:basis.interchangeReference,messageReference:basis.messageReference,transactionReference:basis.transactionReference,idempotencyKey:`customer-life-event:${basis.eventId}`,payload:{actorRole:'supplier',transactionSubtype:'E',reasonForTransaction:'E34',documentReference:basis.documentReference},actorUserId:input.actorUserId,routeProfile:{applicationReference:route.applicationReference,actorRole:'supplier'}})
 customerLifeEventContext(basis,route,intent.id)
 const{data,error}=await supabaseService.from('outbound_requests').select('id').eq('company_id',basis.companyId).eq('source_type','manual').eq('source_id',intent.id).eq('operation_id',basis.eventId).eq('request_type','customer_masterdata').order('created_at',{ascending:false}).limit(1)
 if(error)throw error
 const requestId=data?.[0]?.id??(await createOutboundRequest({actorUserId:input.actorUserId,customerId:basis.customerId,siteId:basis.siteId,meteringPointId:basis.meteringPointId,requestType:'customer_masterdata',sourceType:'manual',sourceId:intent.id,communicationRouteId:route.route.id,operationId:basis.eventId,environment:basis.environment,failOnMissingEnvironment:true,payload:{environment:basis.environment,customerLifeEventId:basis.eventId,intentId:intent.id}})).id
 return renderAndQueueCustomerLifeEvent({...input,intentId:intent.id,outboundRequestId:requestId,routeContext:route})
}
