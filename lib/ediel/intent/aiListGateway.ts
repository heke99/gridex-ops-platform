import {supabaseService} from '@/lib/supabase/service'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {getEdielMessageIntentById,evaluateIntentValidation,updateIntentLifecycle} from '@/lib/ediel/intent/intentEngine'
import {buildAiListIntentDraft} from '@/lib/ediel/intent/renderers/aiList'
import {finalizeOutboundDraft,queuePreparedEdielMessage} from '@/lib/ediel/flows/shared'
import {getEdielMessageById} from '@/lib/ediel/db'
import {AI_LIST_FORMAT_VERSION,parseAiBiTechnicalFile} from '@/lib/ediel/aiListFormat'
import type {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
import type {CreateEdielMessageInput} from '@/lib/ediel/types'

/** AI joins the mandatory intent/render/finalize/outbox chain through its own
 * physical technical codec. No EDIFACT application/envelope references exist. */
export async function renderAndQueueAiList(input:{companyId:string;actorUserId:string;intentId:string;routeContext:Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>}){
 await assertEdielTenantActor({companyId:input.companyId,actorUserId:input.actorUserId,permissionAnyOf:['communication.write','ediel_testing.write']})
 const intent=await getEdielMessageIntentById(input.intentId)
 if(!intent||intent.companyId!==input.companyId||!evaluateIntentValidation(intent).ok)throw new Error('ai_list_validated_technical_intent_required')
 const route=input.routeContext
 if(intent.environment!==route.environment||intent.senderEdielId!==route.senderEdielId||intent.receiverEdielId!==route.receiverEdielId||intent.communicationRouteId!==route.route.id)throw new Error('ai_list_intent_route_customer_scope_mismatch')
 const {data:status,error:statusError}=await supabaseService.rpc('gridex_ai_outbound_origin_status_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_intent_id:intent.id}).abortSignal(AbortSignal.timeout(2000))
 if(statusError||!status)throw new Error('ai_list_original_status_unconfirmed')
 let message=status.status==='bound'?await getEdielMessageById(String(status.messageId)):null
 if(status.status==='bound'&&!message)throw new Error('ai_list_bound_original_unavailable')
 if(message&&(message.company_id!==input.companyId||message.intent_id!==intent.id||(message as typeof message&{immutable_payload_hash?:unknown}).immutable_payload_hash!==status.payloadHash))throw new Error('ai_list_existing_original_scope_mismatch')
 if(!message){
  let draft:CreateEdielMessageInput
  if(status.status==='original'){
   const parsed=parseAiBiTechnicalFile(String(status.rawPayload),'AI')
   draft={actorUserId:input.actorUserId,companyId:input.companyId,direction:'outbound',messageStandard:'ai_list',messageFamily:'AI_LIST',messageCode:'AI',messageVersion:AI_LIST_FORMAT_VERSION,processType:'ai_list_export',environment:intent.environment,status:'draft',intentId:intent.id,routeProfileId:intent.routeProfileId,communicationRouteId:route.route.id,customerId:intent.customerId,siteId:intent.customerSiteId,meteringPointId:intent.meteringPointId,senderEdielId:parsed.header.supplierEdielId,receiverEdielId:parsed.header.networkEdielId,receiverEmail:route.receiverEmail,mailbox:route.mailbox,fileName:String(status.fileName),mimeType:String(status.mimeType),rawPayload:String(status.rawPayload),applicationReference:null,interchangeReference:null,requiresContrl:false,requiresAperak:false,contrlStatus:'not_required',aperakStatus:'not_required',utiltsErrStatus:'not_required'}
  }else{
   const rendered=await buildAiListIntentDraft({intent,actorUserId:input.actorUserId,routeContext:route})
   draft=rendered.draft
   const proof=rendered.basis.history.evidence
   const {data:receipt,error}=await supabaseService.rpc('gridex_ai_record_outbound_original_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_intent_id:intent.id,p_snapshot_id:proof.snapshotId,p_readset_hash:proof.readsetHash,p_raw_payload:draft.rawPayload,p_file_name:draft.fileName,p_mime_type:draft.mimeType,p_row_sources:JSON.stringify(proof.rowSources)}).abortSignal(AbortSignal.timeout(2000))
   if(error||receipt?.status!=='original')throw new Error('ai_list_original_receipt_unconfirmed')
  }
  message=await finalizeOutboundDraft({actorUserId:input.actorUserId,requestType:'meter_values',routeContext:route,draft,duplicateCheck:{sourceType:'manual',sourceId:intent.id,receiverEdielId:route.receiverEdielId,messageFamily:'AI_LIST',messageCode:'AI',messageVersion:AI_LIST_FORMAT_VERSION}})
  await updateIntentLifecycle(intent.id,{renderStatus:'rendered',edielMessageId:message.id,actorUserId:input.actorUserId})
 }
 if(['sent','dispatching','provider_accepted','delivered','acknowledged','queued'].includes(message.status))return message
 await queuePreparedEdielMessage({actorUserId:input.actorUserId,messageId:message.id,intentId:intent.id,externalReference:message.external_reference})
 await updateIntentLifecycle(intent.id,{outboxStatus:'queued',actorUserId:input.actorUserId})
 return message
}
