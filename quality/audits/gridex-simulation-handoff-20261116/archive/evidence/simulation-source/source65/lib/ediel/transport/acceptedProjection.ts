import {supabaseService} from '@/lib/supabase/service'

export type AcceptedEdielTransportProjection = {
 status:'accepted_projection';companyId:string;environment:'test'|'production';messageId:string;attemptId:string;
 lane:'generic_journal'|'sealed_z08';originalHash:string;observedAt:string;frozenRecipient:string;
 providerReceipt:{accepted:string[];rejected:never[];messageId:string|null;response:string|null};
 businessExpectationPlan:Readonly<Record<string,unknown>>|null;authorizesProviderEntry:false;deliveryProven:false
}
/** Invoke before current render/admission loaders. This can only repair a
 * projection of a unique immutable accepted observation; it never permits I/O. */
export async function readAcceptedEdielTransportProjection(input:{companyId:string;environment:'test'|'production';actorUserId:string;messageId:string}):Promise<AcceptedEdielTransportProjection|null>{
 const {data,error}=await supabaseService.rpc('gridex_ediel_accepted_transport_projection_v1',{p_company_id:input.companyId,p_environment:input.environment,p_actor_user_id:input.actorUserId,p_message_id:input.messageId})
 if(error)throw error
 if(data===null)return null
 if(!data||data.status!=='accepted_projection'||data.companyId!==input.companyId||data.environment!==input.environment||data.messageId!==input.messageId||data.authorizesProviderEntry!==false||typeof data.observedAt!=='string'||!Number.isFinite(Date.parse(data.observedAt)))throw new Error('ediel_accepted_projection_result_invalid')
 return data
}

/** Repair under the database's own message lock so final ACK state survives. */
export async function repairAcceptedEdielTransportProjection(input:{companyId:string;environment:'test'|'production';actorUserId:string;messageId:string}):Promise<(AcceptedEdielTransportProjection & {projectionStatus:string})|null>{
 const {data,error}=await supabaseService.rpc('gridex_ediel_repair_accepted_transport_projection_v1',{p_company_id:input.companyId,p_environment:input.environment,p_actor_user_id:input.actorUserId,p_message_id:input.messageId})
 if(error)throw error
 if(data===null)return null
 if(!data||data.status!=='accepted_projection'||data.companyId!==input.companyId||data.environment!==input.environment||data.messageId!==input.messageId||data.authorizesProviderEntry!==false||typeof data.projectionStatus!=='string'||typeof data.observedAt!=='string'||!Number.isFinite(Date.parse(data.observedAt)))throw new Error('ediel_accepted_projection_result_invalid')
 return data
}
