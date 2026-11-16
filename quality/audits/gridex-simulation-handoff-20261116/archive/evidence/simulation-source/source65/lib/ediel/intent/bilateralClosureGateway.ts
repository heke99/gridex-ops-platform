import {supabaseService} from '@/lib/supabase/service'
import {tenantDb} from '@/lib/supabase/tenantDb'
type ScopedSelect=ReturnType<ReturnType<typeof supabaseService.from>['select']>
import {getEdielMessageIntentById,evaluateIntentValidation,updateIntentLifecycle} from '@/lib/ediel/intent/intentEngine'
import type {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
import {finalizeOutboundDraft,queuePreparedEdielMessage} from '@/lib/ediel/flows/shared'
import {readBilateralClosureOperation} from '@/lib/ediel/production/bilateralProdatClosureOperation'
import {buildBilateralClosureDraft} from '@/lib/ediel/intent/renderers/bilateralClosure'
import type {EdielMessageRow} from '@/lib/ediel/types'

export async function renderAndQueueBilateralClosure(input:{companyId:string;actorUserId:string;operationId:string;intentId:string;outboundRequestId:string;routeContext:Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>}){
 const intent=await getEdielMessageIntentById(input.intentId)
 if(!intent||intent.companyId!==input.companyId||intent.environment!==input.routeContext.environment||intent.operationId!==input.operationId||intent.messageFamily!=='PRODAT'||intent.messageCode!=='Z08'||intent.communicationRouteId!==input.routeContext.route.id)throw Error('bilateral_closure_intent_scope_mismatch')
 if(intent.edielMessageId){
  const{data,error}=await(tenantDb(input.companyId).from('ediel_messages').select('*') as ScopedSelect).eq('id',intent.edielMessageId).returns<EdielMessageRow[]>().maybeSingle();if(error)throw error
  if(!data||data.intent_id!==intent.id||data.source_operation_id!==input.operationId||data.outbound_request_id!==input.outboundRequestId||data.environment!==intent.environment)throw Error('bilateral_closure_existing_original_scope_mismatch')
  const{data:cap,error:readError}=await supabaseService.rpc('ediel_read_bilateral_prodat_outbound_original_v1',{p_company_id:input.companyId,p_message_id:data.id});if(readError)throw readError
  if(cap?.owner!=='immutable-bilateral-prodat-outbound-profile-v1'||cap.messageCode!=='Z08')throw Error('bilateral_closure_existing_original_unqualified')
  if(data.status!=='draft')return{status:'existing' as const,message:data}
 }
 const validation=evaluateIntentValidation(intent);if(!validation.ok)return{status:'held' as const,missing:validation.blockingReasons.map(r=>r.code)}
 const basis=await readBilateralClosureOperation(input);if(basis.status==='held')return basis
 const{draft}=await buildBilateralClosureDraft({actorUserId:input.actorUserId,basis,intent,routeContext:input.routeContext,outboundRequestId:input.outboundRequestId})
 const message=await finalizeOutboundDraft({actorUserId:input.actorUserId,requestType:'supplier_switch',routeContext:input.routeContext,draft,outboundRequestId:input.outboundRequestId,duplicateCheck:{sourceType:'manual',sourceId:intent.id,messageFamily:'PRODAT',messageCode:'Z08',receiverEdielId:basis.legalReceiverId}})
 if(message.intent_id!==intent.id||message.source_operation_id!==basis.operationId||message.outbound_request_id!==input.outboundRequestId)throw Error('bilateral_closure_final_original_scope_mismatch')
 if(message.status!=='draft')return{status:'existing' as const,message}
 await updateIntentLifecycle(intent.id,{renderStatus:'rendered',edielMessageId:message.id,outboundRequestId:input.outboundRequestId,actorUserId:input.actorUserId})
 await queuePreparedEdielMessage({actorUserId:input.actorUserId,messageId:message.id,outboundRequestId:input.outboundRequestId,intentId:intent.id,payload:{bilateralClosureOperationId:basis.operationId,intentId:intent.id,operationId:basis.operationId,messageFamily:'PRODAT',messageCode:'Z08',routeId:input.routeContext.route.id}})
 await updateIntentLifecycle(intent.id,{outboxStatus:'queued',actorUserId:input.actorUserId});return{status:'queued' as const,message}
}
