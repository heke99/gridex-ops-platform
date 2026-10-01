import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {canonicalProdatMethodChangeTuple} from '@/lib/ediel/rulebook/canonicalEdielFacade'
import {supabaseService} from '@/lib/supabase/service'
import type {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
export type MeteringMethodChangeBasis={status:'authorized';companyId:string;environment:'test'|'production';eventId:string;supplyPeriodId:string;supplyStateVersion:number;supplySourceMessageId:string;customerId:string;siteId:string;meteringPointId:string;legalActorId:string;legalSenderId:string;legalReceiverId:string;pointId:string;identityAgency:'9'|'89';gridArea:string;effectiveAt:string;subtype:'F'|'G';reason:string;method:string;contractId:string;contractRevision:string;sourceReference:string;sourceVersion:string;sourceDigest:string}
export type MeteringMethodChangeHeld={status:'held';missing:string[]}
export async function readMeteringMethodChangeSource(input:{companyId:string;eventId:string;actorUserId:string}):Promise<MeteringMethodChangeBasis|MeteringMethodChangeHeld>{
 const{data,error}=await supabaseService.rpc('ediel_metering_method_change_source_v1',{p_company_id:input.companyId,p_event_id:input.eventId,p_actor_user_id:input.actorUserId})
 if(error)throw error
 if(!data||!['authorized','held'].includes(data.status))throw Error('metering_method_change_source_result_invalid')
 if(data.status==='authorized'){if(data.companyId!==input.companyId||data.eventId!==input.eventId||!['F','G'].includes(data.subtype)||!['test','production'].includes(data.environment)||![data.customerId,data.siteId,data.meteringPointId,data.legalActorId,data.contractId,data.supplyPeriodId,data.supplySourceMessageId].every(isEvidenceUuid)||!['9','89'].includes(data.identityAgency)||!Number.isSafeInteger(data.supplyStateVersion)||data.supplyStateVersion<1)throw Error('metering_method_change_source_scope_invalid');const tuple=canonicalProdatMethodChangeTuple(data.subtype);if(tuple.reason!==data.reason||tuple.method!==data.method)throw Error('metering_method_change_canonical_tuple_mismatch')}
 return data
}
export async function reserveMeteringMethodChangeSource(input:{companyId:string;eventId:string;actorUserId:string;intentId:string;outboundRequestId:string}):Promise<{status:'reserved';messageId:string|null;outboundRequestId:string}|MeteringMethodChangeHeld>{
 const{data,error}=await supabaseService.rpc('ediel_reserve_metering_method_change_origin_v1',{p_company_id:input.companyId,p_event_id:input.eventId,p_actor_user_id:input.actorUserId,p_intent_id:input.intentId,p_outbound_request_id:input.outboundRequestId})
 if(error)throw error
 if(!data||!['reserved','held'].includes(data.status))throw Error('metering_method_change_origin_result_invalid')
 return data
}
export function assertMeteringMethodChangeCanonicalRoute(b:MeteringMethodChangeBasis,route:Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>){
 const tuple=canonicalProdatMethodChangeTuple(b.subtype)
 if(tuple.reason!==b.reason||tuple.method!==b.method)throw Error('metering_method_change_canonical_tuple_mismatch')
 if(route.companyId!==b.companyId||route.environment!==b.environment||route.actor.tenantIdentity?.legalActorId!==b.legalActorId||route.actor.legalActorEdielId!==b.legalSenderId||route.receiverEdielId!==b.legalReceiverId||!route.actor.marketRoles.includes('electricity_supplier')||route.applicationReference!=='23-DDQ-PRODAT')throw Error('metering_method_change_canonical_legal_route_mismatch')
}

/** The message ID is only a selector. Native origin/raw/source checks own the
 * authority; Z09F/G cannot fall back to a previously received or portal method. */
export async function assertMeteringMethodChangeSendSource(message:import('@/lib/ediel/types').EdielMessageRow,actorUserId:string){
 if(!message.company_id||message.direction!=='outbound'||message.message_family!=='PRODAT'||message.message_code!=='Z09')return
 const{data,error}=await supabaseService.rpc('ediel_metering_method_change_message_basis_v1',{p_company_id:message.company_id,p_message_id:message.id,p_actor_user_id:actorUserId})
 if(error)throw error
 if(data?.status==='held')throw Error('metering_method_change_current_source_held')
 if(data&&(data.basis?.status!=='authorized'||data.intentId!==message.intent_id))throw Error('metering_method_change_message_origin_mismatch')
 const{error:guardError}=await supabaseService.rpc('ediel_require_metering_method_change_source_current_v1',{p_company_id:message.company_id,p_message_id:message.id,p_actor_user_id:actorUserId})
 if(guardError)throw guardError
}
