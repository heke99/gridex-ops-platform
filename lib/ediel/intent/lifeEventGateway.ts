import {supabaseService} from '@/lib/supabase/service'
import {getEdielMessageIntentById,evaluateIntentValidation,updateIntentLifecycle} from '@/lib/ediel/intent/intentEngine'
import {buildRequestedChangeDraft} from './renderers/lifeEvent'
import {readRequestedChangeSource,assertRequestedChangeSendSource} from '@/lib/ediel/production/requestedChangeSource'
import {finalizeCanonicalOutboundDraft,type resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
import {resolveCanonicalOutboundVersion} from '@/lib/ediel/core/versionRegistry'
import {queuePreparedEdielMessage} from '@/lib/ediel/flows/shared'
import type {EdielMessageRow} from '@/lib/ediel/types'
export async function renderAndQueueRequestedChange(input:{companyId:string;eventId:string;actorUserId:string;intentId:string;outboundRequestId:string;routeContext:Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>}){
 const intent=await getEdielMessageIntentById(input.intentId)
 if(!intent||intent.companyId!==input.companyId||intent.operationId!==input.eventId||intent.messageFamily!=='PRODAT'||intent.messageCode!=='Z09'||intent.businessProcess!=='customer_masterdata')throw Error('requested_change_intent_scope_mismatch')
 const validation=evaluateIntentValidation(intent);if(!validation.ok)return{status:'held' as const,missing:validation.blockingReasons.map(x=>x.code)}
 const b=await readRequestedChangeSource(input);if(b.status==='held')return b
 const{data:existing,error:readError}=await supabaseService.from('ediel_messages').select('*').eq('company_id',input.companyId).eq('intent_id',intent.id).maybeSingle();if(readError)throw readError
 if(existing){await assertRequestedChangeSendSource(existing as EdielMessageRow,input.actorUserId);if(existing.outbound_request_id!==input.outboundRequestId||existing.source_operation_id!==input.eventId)throw Error('requested_change_existing_message_conflict');if(existing.status!=='draft')return {status:'existing' as const,message:existing as EdielMessageRow}}
 const version=await resolveCanonicalOutboundVersion({family:'PRODAT',code:'Z09',standard:'edifact',environment:b.environment,routeDefaultMessageVersion:input.routeContext.defaultMessageVersion});if(!version)throw Error('requested_change_canonical_version_required')
 const draft=buildRequestedChangeDraft({basis:b,intent,actorUserId:input.actorUserId,outboundRequestId:input.outboundRequestId,routeContext:input.routeContext,messageVersion:version})
 let message:EdielMessageRow
 try{message=await finalizeCanonicalOutboundDraft({actorUserId:input.actorUserId,requestType:'customer_masterdata',routeContext:input.routeContext,draft,outboundRequestId:input.outboundRequestId,requestedChangeBasis:b,duplicateCheck:{sourceType:'manual',sourceId:intent.id,messageFamily:'PRODAT',messageCode:'Z09',receiverEdielId:b.legalReceiverId}})}catch(error){
  if(!(error&&typeof error==='object'&&'code'in error&&error.code==='23505'))throw error
  const{data,error:duplicateError}=await supabaseService.from('ediel_messages').select('*').eq('company_id',input.companyId).eq('intent_id',intent.id).maybeSingle();if(duplicateError||!data)throw duplicateError??error;message=data as EdielMessageRow
 }
 await assertRequestedChangeSendSource(message,input.actorUserId)
 if(message.intent_id!==intent.id||message.outbound_request_id!==input.outboundRequestId)throw Error('requested_change_final_message_conflict')
 if(message.status!=='draft')return{status:'existing' as const,message}
 await updateIntentLifecycle(intent.id,{validationStatus:validation.status,validationResult:{...validation},blockingReasons:validation.blockingReasons,renderStatus:'rendered',edielMessageId:message.id,outboundRequestId:input.outboundRequestId,actorUserId:input.actorUserId})
 await queuePreparedEdielMessage({actorUserId:input.actorUserId,messageId:message.id,outboundRequestId:input.outboundRequestId,intentId:intent.id,payload:{requestedChangeEventId:b.eventId,intentId:intent.id,operationId:b.eventId,messageFamily:'PRODAT',messageCode:'Z09',routeId:input.routeContext.route.id}})
 await updateIntentLifecycle(intent.id,{outboxStatus:'queued',actorUserId:input.actorUserId});return{status:'queued' as const,message}
}
