import {supabaseService} from '@/lib/supabase/service'
import type {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
export type SwitchCancellationBasis={status:'authorized';companyId:string;environment:'test'|'production';switchRequestId:string;originalMessageId:string;originalHash:string;
 operationId:string|null;intentId:string|null;outboundRequestId:string|null;messageId:string|null;customerId:string;siteId:string;meteringPointId:string;
 legalActorId:string;legalSenderId:string;legalReceiverId:string;pointId:string;identityAgency:'9'|'89';gridArea:string;li:string;startAt:string;originalSubtype:'L'|'LK';deadline:string;
 customerIdentity:string;customerQualifier:'SE1'|'SE2';customerName:string;sourceObject:Record<string,unknown>;requestedMethod:string}
export type SwitchCancellationHeld={status:'held';missing:string[]}
export async function readSwitchCancellationSource(input:{companyId:string;switchRequestId:string;actorUserId:string}):Promise<SwitchCancellationBasis|SwitchCancellationHeld>{
 const{data,error}=await supabaseService.rpc('ediel_switch_cancellation_source_v1',{p_company_id:input.companyId,p_switch_id:input.switchRequestId,p_actor_user_id:input.actorUserId})
 if(error)throw error
 if(!data||!['authorized','held'].includes(data.status))throw Error('switch_cancellation_source_result_invalid')
 if(data.status==='authorized'&&(typeof data.requestedMethod!=='string'||!data.requestedMethod))throw Error('switch_cancellation_source_requested_method_invalid')
 return data
}
export async function reserveSwitchCancellationSource(input:{companyId:string;switchRequestId:string;actorUserId:string;intentId:string;outboundRequestId:string}):Promise<{status:'reserved';operationId:string;intentId:string;outboundRequestId:string;messageId:string|null}|SwitchCancellationHeld>{
 const{data,error}=await supabaseService.rpc('ediel_reserve_switch_cancellation_v1',{p_company_id:input.companyId,p_switch_id:input.switchRequestId,p_actor_user_id:input.actorUserId,p_intent_id:input.intentId,p_outbound_request_id:input.outboundRequestId})
 if(error)throw error
 if(!data||!['reserved','held'].includes(data.status))throw Error('switch_cancellation_reservation_result_invalid')
 return data
}
export function assertSwitchCancellationRoute(b:SwitchCancellationBasis,route:Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>){
 if(route.companyId!==b.companyId||route.environment!==b.environment||route.actor.tenantIdentity?.legalActorId!==b.legalActorId||route.actor.legalActorEdielId!==b.legalSenderId
  ||route.receiverEdielId!==b.legalReceiverId||!route.actor.marketRoles.includes('electricity_supplier')||route.applicationReference!=='23-DDQ-PRODAT')throw Error('switch_cancellation_canonical_legal_route_mismatch')
}
