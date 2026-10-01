import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {publishSourceCustomerLifeEventCommit,type SourceCustomerLifeEventCommitObserver} from './sourceCustomerLifeEventCommit'
/** Complete own application and source-specific function/party evidence precede every first native
 * effect; native direct callers recheck it rather than trusting a caller flag. */
export async function applyInboundCustomerLifeEvent(input:{message:EdielMessageRow;actorUserId:string;onCustomerLifeEventCommitted?:SourceCustomerLifeEventCommitObserver}){
 if(!input.message.company_id)throw new Error('customer_life_event_company_required')
 const{data,error}=await supabaseService.rpc('ediel_apply_customer_life_event_source_v1',{p_company_id:input.message.company_id,p_source_message_id:input.message.id,p_actor_user_id:input.actorUserId})
 if(error)throw error
 if(!data||typeof data.applied!=='boolean')throw new Error('customer_life_event_native_result_invalid')
 if(data.applied){if(data.sourceMessageId!==input.message.id||!Array.isArray(data.scopes)||!data.scopes.length)throw new Error('customer_life_event_native_scope_invalid');await publishSourceCustomerLifeEventCommit(input.onCustomerLifeEventCommitted,{message:input.message,actorUserId:input.actorUserId})}
 return data
}
