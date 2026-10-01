import {buildProdatZ03FromSwitch} from '@/lib/ediel/prodat'
import {getEdielMessageById} from '@/lib/ediel/db'
import {getEdielMessageIntentById,evaluateIntentValidation,updateIntentLifecycle} from './intentEngine'
import {finalizeOutboundDraft,queuePreparedEdielMessage} from '@/lib/ediel/flows/shared'
import {supabaseService} from '@/lib/supabase/service'
import type {DecisionBackedOutboundContext} from '@/lib/ediel/flows/routeDecisionContext'

/** Normal switch business operations supply their source facts and an intent.
 * Only this gateway renders, binds the actual original, then queues it. */
export async function renderAndQueueNormalSwitch(input:{intentId:string;actorUserId:string;outboundRequestId:string;
 routeContext:DecisionBackedOutboundContext;source:Parameters<typeof buildProdatZ03FromSwitch>[0]}){
 const intent=await getEdielMessageIntentById(input.intentId)
 if(!intent||intent.validationStatus!=='validated'||!evaluateIntentValidation(intent).ok
  ||intent.companyId!==input.source.switchRequest.company_id||intent.messageFamily!=='PRODAT'||intent.messageCode!=='Z03'
  ||intent.environment!==input.routeContext.environment||intent.customerId!==input.source.switchRequest.customer_id
  ||intent.operationId!==input.source.switchRequest.id||intent.customerSiteId!==input.source.switchRequest.site_id||intent.supplierSwitchRequestId!==input.source.switchRequest.id
  ||intent.communicationRouteId!==input.routeContext.route.id||intent.routeProfileId!==input.routeContext.routeDecision.edielRouteProfileId
  ||(intent.senderSubaddress??null)!==(input.routeContext.senderSubAddress??null)||(intent.receiverSubaddress??null)!==(input.routeContext.receiverSubAddress??null)
  ||intent.senderEdielId!==input.routeContext.senderEdielId||intent.receiverEdielId!==input.routeContext.receiverEdielId
  ||!intent.interchangeReference||!intent.messageReference||!intent.transactionReference
  ||!['L','LK'].includes(String(intent.payload.transactionSubtype))||typeof intent.payload.documentReference!=='string')throw new Error('switch_validated_source_intent_required')
 let message=intent.edielMessageId?await getEdielMessageById(intent.edielMessageId):null
 if(message&&(message.company_id!==intent.companyId||message.intent_id!==intent.id||message.outbound_request_id!==input.outboundRequestId))throw new Error('switch_original_intent_binding_conflict')
 if(message&&message.status!=='draft')return message
 if(!message){
  const draft=await buildProdatZ03FromSwitch({...input.source,wireReferences:{documentReference:intent.payload.documentReference,transactionReference:intent.transactionReference!,interchangeReference:intent.interchangeReference,messageReference:intent.messageReference}})
  draft.intentId=intent.id
  draft.sourceOperationId=input.source.switchRequest.id
  draft.parsedPayload={...(draft.parsedPayload??{}),
   prodatVariant:intent.payload.transactionSubtype,reasonForTransaction:intent.payload.reasonForTransaction,
   authorization_document_id:intent.payload.authorization_document_id??null,power_of_attorney_id:intent.payload.power_of_attorney_id??null,
   canonical_rule_pack_id:intent.payload.canonical_rule_pack_id,canonical_message_profile_id:intent.payload.canonical_message_profile_id,
   canonical_profile_key:intent.payload.canonical_profile_key}
  message=await finalizeOutboundDraft({actorUserId:input.actorUserId,requestType:'supplier_switch',routeContext:input.routeContext,draft,outboundRequestId:input.outboundRequestId,
   duplicateCheck:{sourceType:'supplier_switch_request',sourceId:input.source.switchRequest.id,receiverEdielId:intent.receiverEdielId,messageFamily:'PRODAT',messageCode:'Z03',messageVersion:draft.messageVersion}})
  if(message.intent_id!==intent.id||message.company_id!==intent.companyId||message.outbound_request_id!==input.outboundRequestId)throw new Error('switch_original_intent_binding_conflict')
  await updateIntentLifecycle(intent.id,{renderStatus:'rendered',edielMessageId:message.id,outboundRequestId:input.outboundRequestId,actorUserId:input.actorUserId})
 }
 const {data,error}=await supabaseService.rpc('ediel_bind_switch_original_v1',{p_company_id:intent.companyId,p_switch_id:input.source.switchRequest.id,p_message_id:message.id,p_actor_user_id:input.actorUserId})
 if(error)throw error
 if(!data||data.status!=='bound'||data.messageId!==message.id)throw new Error('switch_original_native_binding_required')
 await queuePreparedEdielMessage({actorUserId:input.actorUserId,messageId:message.id,intentId:intent.id,outboundRequestId:input.outboundRequestId,externalReference:message.external_reference})
 await updateIntentLifecycle(intent.id,{outboxStatus:'queued',actorUserId:input.actorUserId})
 return message
}
