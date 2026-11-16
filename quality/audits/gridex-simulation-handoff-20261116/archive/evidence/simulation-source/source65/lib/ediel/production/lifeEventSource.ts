import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
import {copyDeathSelection,type DeathSelection} from '@/lib/ediel/prodat/prodatDeathStatus'
import {prepareQualifiedBrpSource,type BrpFieldScope} from '@/lib/ediel/production/brpFieldSource'
import {certificationCustomerLifeEventContext} from './lifeEventCertificationSource'
import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {bindDeathStatusSourceContext,type DeathStatusValidationContext} from '@/lib/ediel/prodat/prodatDeathStatusAuthority'

export type CustomerLifeEventBasis={status:'authorized';companyId:string;environment:'test'|'production';eventId:string;sourceVersion:string;sourceDigest:string;sourceReference:string;
 classification:'death'|'bankruptcy'|'other_masterdata';bilateralCapabilityVerified:boolean;legalActorId:string;legalSenderId:string;legalReceiverId:string;
 customerId:string;siteId:string|null;meteringPointId:string|null;pointId:string|null;gridArea:string|null;rawPayload:string;selection:DeathSelection;
 interchangeReference:string;messageReference:string;documentReference:string;transactionReference:string;informationKnownAt:string}
export type CustomerLifeEventHeld={status:'held';missing:string[]}
export async function readCustomerLifeEventSource(input:{companyId:string;eventId:string;actorUserId:string}):Promise<CustomerLifeEventBasis|CustomerLifeEventHeld>{
 const read=async()=>{
  const {data,error}=await supabaseService.rpc('ediel_customer_life_event_source_v1',{p_company_id:input.companyId,p_event_id:input.eventId,p_actor_user_id:input.actorUserId})
  if(error)throw error
  if(!data||!['authorized','held'].includes(data.status))throw new Error('customer_life_event_source_result_invalid')
  return data as CustomerLifeEventBasis|CustomerLifeEventHeld
 }
 const current=await read()
 if(current.status!=='held'||!current.missing.includes('same_dated_structural_owner_brp_candidate'))return current
 const{data,error}=await supabaseService.rpc('ediel_customer_life_event_brp_scope_v1',{p_company_id:input.companyId,p_event_id:input.eventId,p_actor_user_id:input.actorUserId})
 if(error)throw error
 if(data?.status==='held')return data
 if(data?.status!=='authorized'||data.companyId!==input.companyId||data.eventId!==input.eventId||!Array.isArray(data.scopes)||!data.scopes.length)throw new Error('customer_life_event_brp_scope_invalid')
 for(const scope of data.scopes){
  if(scope.companyId!==input.companyId||!['test','production'].includes(scope.environment)||scope.contractId!==null||![scope.customerId,scope.siteId,scope.meteringPointId,scope.supplyPeriodId].every(isEvidenceUuid)||!Number.isFinite(Date.parse(scope.at)))throw new Error('customer_life_event_brp_scope_invalid')
  const result=await prepareQualifiedBrpSource({...scope,actorUserId:input.actorUserId} as BrpFieldScope)
  if(result.status==='held')return result
 }
 return read()
}
export async function reserveCustomerLifeEventSource(input:{companyId:string;eventId:string;actorUserId:string;intentId:string;outboundRequestId:string}):Promise<{status:'reserved';messageId:string|null;outboundRequestId:string}|CustomerLifeEventHeld>{
 const {data,error}=await supabaseService.rpc('ediel_reserve_customer_life_event_v1',{p_company_id:input.companyId,p_event_id:input.eventId,p_actor_user_id:input.actorUserId,p_intent_id:input.intentId,p_outbound_request_id:input.outboundRequestId})
 if(error)throw error
 if(!data||!['reserved','held'].includes(data.status))throw new Error('customer_life_event_reservation_invalid')
 return data
}
export function customerLifeEventContext(basis:CustomerLifeEventBasis,route:Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>,intentId:string):DeathStatusValidationContext{
 if(route.companyId!==basis.companyId||route.environment!==basis.environment||route.actor.tenantIdentity?.legalActorId!==basis.legalActorId||route.actor.legalActorEdielId!==basis.legalSenderId||route.receiverEdielId!==basis.legalReceiverId||!route.actor.marketRoles.includes('electricity_supplier'))throw new Error('customer_life_event_canonical_source_scope_mismatch')
 return bindDeathStatusSourceContext({kind:'customer_life_event',direction:'outbound',companyId:basis.companyId,environment:basis.environment,intentId,routeId:route.route.id,code:'Z09',rawPayload:basis.rawPayload,
  sourceEventId:basis.eventId,sourceRevision:basis.sourceVersion,sourceDigest:basis.sourceDigest,businessContext:basis.classification,bilateralCapabilityVerified:basis.bilateralCapabilityVerified,selection:copyDeathSelection(basis.selection)})
}
/** The correction selector is qualified by the immutable negative-ACK operation
 * and the current original life-event source. The new intent keeps its own ID. */
export async function loadCustomerLifeEventRecoveryContext(input:{companyId:string;operationId:string;actorUserId:string;intentId:string;routeContext:Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>}):Promise<DeathStatusValidationContext|undefined>{
 const{data,error}=await supabaseService.rpc('ediel_customer_life_event_recovery_basis_v1',{p_company_id:input.companyId,p_operation_id:input.operationId,p_actor_user_id:input.actorUserId})
 if(error)throw error
 if(data===null)return undefined
 if(data?.status!=='authorized'||data.recoveryOperationId!==input.operationId||data.companyId!==input.companyId)throw new Error('customer_life_event_recovery_basis_invalid')
 return customerLifeEventContext(data,input.routeContext,input.intentId)
}
/** Source selection is an immutable native origin, never parsed metadata or a
 * caller life-event ID. Historical rows without an authentic basis remain held. */
export async function loadCustomerLifeEventValidationContext(message:EdielMessageRow,actorUserId:string):Promise<DeathStatusValidationContext|undefined>{
 if(message.company_id&&message.direction==='inbound'&&message.message_family==='PRODAT'&&message.message_code==='Z06'){
  const{data,error}=await supabaseService.rpc('ediel_customer_life_event_inbound_basis_v1',{p_company_id:message.company_id,p_message_id:message.id,p_actor_user_id:actorUserId})
  if(error)throw error
  if(!data||data.status==='held')return undefined
  if(data.status!=='authorized'||data.messageId!==message.id||data.companyId!==message.company_id||data.environment!==message.environment||data.rawPayload!==message.raw_payload)throw new Error('customer_life_event_inbound_basis_invalid')
  return bindDeathStatusSourceContext({kind:'customer_life_event',direction:'inbound',code:'Z06',sourceMessageId:message.id,sourceContextReceiptId:data.sourceContextReceiptId,sourceContextFactsHash:data.sourceContextFactsHash,companyId:data.companyId,environment:data.environment,rawPayload:data.rawPayload,sourceEventId:message.id,sourceRevision:data.sourcePayloadHash,sourceDigest:data.sourcePayloadHash,businessContext:data.classification,bilateralCapabilityVerified:data.bilateralCapabilityVerified,selection:data.selection})
 }
 if(!message.company_id||message.direction!=='outbound'||message.message_family!=='PRODAT'||message.message_code!=='Z09')return undefined
 const {data,error}=await supabaseService.rpc('ediel_customer_life_event_message_basis_v1',{p_company_id:message.company_id,p_message_id:message.id,p_actor_user_id:actorUserId})
 if(error)throw error
 if(!data)return undefined
 if(data.certification===true){
  const intentId=message.intent_id??null
  if(data.intentId!==intentId||message.environment!=='test'||!message.communication_route_id||!message.raw_payload)throw new Error('customer_event_certification_message_basis_invalid')
  return certificationCustomerLifeEventContext({basis:data.basis,companyId:message.company_id,rawPayload:message.raw_payload,intentId,routeId:message.communication_route_id})
 }
 if(data.status==='held')throw new Error('customer_life_event_current_source_held')
 if(data.basis?.status!=='authorized'||data.intentId!==message.intent_id||data.basis.companyId!==message.company_id||data.basis.environment!==message.environment||data.basis.rawPayload!==message.raw_payload)throw new Error('customer_life_event_message_basis_invalid')
 const basis:CustomerLifeEventBasis=data.basis
 const route=await resolveCanonicalOutboundContext({companyId:basis.companyId,environment:basis.environment,requestType:'customer_masterdata',receiverEdielId:basis.legalReceiverId,
  preferredRouteId:message.communication_route_id,applicationReference:message.application_reference})
 return customerLifeEventContext(basis,route,data.intentId)
}
