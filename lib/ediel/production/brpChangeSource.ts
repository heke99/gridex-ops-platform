import {supabaseService} from '@/lib/supabase/service'
import type {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
export type BrpChangeBasis={status:'authorized';companyId:string;environment:'test'|'production';eventId:string;supplyPeriodId:string;supplyStateVersion:number;supplySourceMessageId:string;customerId:string;siteId:string;meteringPointId:string;legalActorId:string;legalSenderId:string;legalReceiverId:string;brpActorId:string;brpEdielId:string;pointId:string;identityAgency:'9'|'89';gridArea:string;effectiveAt:string;registryGroundId:string;registryVersion:string;registrySha256:string;sourceReference:string;sourceVersion:string;sourceDigest:string}
export type BrpChangeHeld={status:'held';missing:string[]}
export async function readBrpChangeSource(input:{companyId:string;eventId:string;actorUserId:string}):Promise<BrpChangeBasis|BrpChangeHeld>{
 const{data,error}=await supabaseService.rpc('ediel_brp_change_source_v1',{p_company_id:input.companyId,p_event_id:input.eventId,p_actor_user_id:input.actorUserId})
 if(error)throw error
 if(!data||!['authorized','held'].includes(data.status))throw Error('brp_change_source_result_invalid')
 return data
}
export async function reserveBrpChangeSource(input:{companyId:string;eventId:string;actorUserId:string;intentId:string;outboundRequestId:string}):Promise<{status:'reserved';messageId:string|null;outboundRequestId:string}|BrpChangeHeld>{
 const{data,error}=await supabaseService.rpc('ediel_reserve_brp_change_origin_v1',{p_company_id:input.companyId,p_event_id:input.eventId,p_actor_user_id:input.actorUserId,p_intent_id:input.intentId,p_outbound_request_id:input.outboundRequestId})
 if(error)throw error
 if(!data||!['reserved','held'].includes(data.status))throw Error('brp_change_origin_result_invalid')
 return data
}
export function assertBrpChangeCanonicalRoute(b:BrpChangeBasis,route:Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>){
 if(route.companyId!==b.companyId||route.environment!==b.environment||route.actor.tenantIdentity?.legalActorId!==b.legalActorId||route.actor.legalActorEdielId!==b.legalSenderId||route.receiverEdielId!==b.legalReceiverId||!route.actor.marketRoles.includes('electricity_supplier')||route.applicationReference!=='23-DDQ-PRODAT')throw Error('brp_change_canonical_legal_route_mismatch')
}

/** The message ID is only a selector. Native origin/raw/source checks own the
 * authority; production Z09B cannot fall back to a company BRP default. */
export async function assertBrpChangeSendSource(message:import('@/lib/ediel/types').EdielMessageRow,actorUserId:string){
 if(!message.company_id||message.direction!=='outbound'||message.message_family!=='PRODAT'||message.message_code!=='Z09')return
 const{data,error}=await supabaseService.rpc('ediel_brp_change_message_basis_v1',{p_company_id:message.company_id,p_message_id:message.id,p_actor_user_id:actorUserId})
 if(error)throw error
 if(data?.status==='held')throw Error('brp_change_current_source_held')
 if(data&&(data.basis?.status!=='authorized'||data.intentId!==message.intent_id))throw Error('brp_change_message_origin_mismatch')
 const{error:guardError}=await supabaseService.rpc('ediel_require_brp_change_source_current_v1',{p_company_id:message.company_id,p_message_id:message.id})
 if(guardError)throw guardError
}
