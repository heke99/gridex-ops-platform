import {readRequestedCustomerChangeFacts,requestedCustomerChangeRegisterFacts} from '@/lib/ediel/production/requestedCustomerChangeFacts'
import {createProdatRegisterEvidence} from '@/lib/ediel/prodat/prodatRegisterEvidence'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {supabaseService} from '@/lib/supabase/service'
import {getEdielMessageIntentById,evaluateIntentValidation,updateIntentLifecycle} from './intentEngine'
import {finalizeCanonicalOutboundDraft,type resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
import {queuePreparedEdielMessage} from '@/lib/ediel/flows/shared'
import {readCustomerLifeEventSource,reserveCustomerLifeEventSource,customerLifeEventContext} from '@/lib/ediel/production/lifeEventSource'
import {resolveCanonicalOutboundVersion} from '@/lib/ediel/core/versionRegistry'
import {deriveEdielAckDefaults} from '@/lib/ediel/references'
import type {EdielMessageRow,CreateEdielMessageInput} from '@/lib/ediel/types'

/** A qualified full source original is rendered through the same canonical
 * finalizer. Intent payload never chooses the event, legal purpose or fields. */
export async function renderAndQueueCustomerLifeEvent(input:{companyId:string;eventId:string;actorUserId:string;intentId:string;outboundRequestId:string;routeContext:Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>}){
 const intent=await getEdielMessageIntentById(input.intentId)
 if(!intent||intent.companyId!==input.companyId||intent.operationId!==input.eventId||intent.messageFamily!=='PRODAT'||intent.messageCode!=='Z09')throw new Error('customer_life_event_intent_scope_invalid')
 const validation=evaluateIntentValidation(intent)
 if(!validation.ok)return {status:'held' as const,missing:validation.blockingReasons.map(reason=>reason.code)}
 const selector={companyId:input.companyId,eventId:input.eventId,actorUserId:input.actorUserId}
 const basis=await readCustomerLifeEventSource(selector)
 if(basis.status==='held')return basis
 const selectedScope={...selector,basis}
 const selected=await readRequestedCustomerChangeFacts(selectedScope)
 if(selected?.status==='held')return selected
 const context=customerLifeEventContext(basis,input.routeContext,intent.id)
 let reservation=await reserveCustomerLifeEventSource({...selector,intentId:intent.id,outboundRequestId:input.outboundRequestId})
 if(reservation.status==='held')return reservation
 let message:EdielMessageRow|undefined
 if(reservation.messageId){
  const{data,error}=await supabaseService.from('ediel_messages').select('*').eq('company_id',basis.companyId).eq('id',reservation.messageId).maybeSingle()
  if(error)throw error
  if(!data||data.intent_id!==intent.id||data.outbound_request_id!==reservation.outboundRequestId||data.raw_payload!==basis.rawPayload)throw new Error('customer_life_event_original_conflict')
  message=data as EdielMessageRow
  if(message.status!=='draft')return {status:'existing' as const,message}
 }
 if(!message){
  const route=input.routeContext
  const version=await resolveCanonicalOutboundVersion({family:'PRODAT',code:'Z09',standard:'edifact',environment:basis.environment,routeDefaultMessageVersion:route.defaultMessageVersion})
  if(!version)throw new Error('customer_life_event_current_version_required')
  const draft:CreateEdielMessageInput={actorUserId:input.actorUserId,companyId:basis.companyId,intentId:intent.id,sourceOperationId:basis.eventId,routeProfileId:intent.routeProfileId,
   direction:'outbound',messageStandard:'edifact',messageFamily:'PRODAT',messageCode:'Z09',messageVersion:version,processType:'masterdata',environment:basis.environment,testFlag:basis.environment==='test'?1:0,status:'draft',transportType:'smtp',mailbox:route.mailbox,
   senderEdielId:route.senderEdielId,senderName:route.senderName,senderSubAddress:route.senderSubAddress,receiverEdielId:route.receiverEdielId,receiverName:route.receiverName,receiverSubAddress:route.receiverMessageSubAddress??route.receiverSubAddress,receiverEmail:route.receiverEmail,communicationRouteId:route.route.id,
   outboundRequestId:reservation.outboundRequestId,customerId:basis.customerId,siteId:basis.siteId,meteringPointId:basis.meteringPointId,externalReference:basis.documentReference,interchangeReference:basis.interchangeReference,transactionReference:basis.transactionReference,applicationReference:route.applicationReference,
   rawPayload:basis.rawPayload,subject:`PRODAT Z09 ${basis.documentReference}`,mimeType:'application/edifact',parsedPayload:{draftType:'customer_life_event',actorRole:'supplier',prodatVariant:'E',reasonForTransaction:'E34',customerLifeEventId:basis.eventId},syntaxCheckStatus:'not_checked',functionalCheckStatus:'not_checked',...deriveEdielAckDefaults({family:'PRODAT',code:'Z09'})}
  if(selected){
   const wire=tokenizeEdifact(basis.rawPayload)
   draft.parsedPayload={...draft.parsedPayload,prodatEngine:{registerEvidence:createProdatRegisterEvidence({code:'Z09',rawSegments:wire.segments.map(s=>s.raw),una:wire.una,facts:requestedCustomerChangeRegisterFacts(selected,selectedScope)})}}
  }
  const parameters={actorUserId:input.actorUserId,requestType:'customer_masterdata' as const,routeContext:route,draft,outboundRequestId:reservation.outboundRequestId,deathStatusContext:context,
   duplicateCheck:{sourceType:'manual',sourceId:intent.id,messageFamily:'PRODAT',messageCode:'Z09',receiverEdielId:basis.legalReceiverId}}
  try{message=await finalizeCanonicalOutboundDraft(parameters)}catch(error){
   if(!(error&&typeof error==='object'&&'code' in error&&error.code==='23505'))throw error
   const prior=await reserveCustomerLifeEventSource({...selector,intentId:intent.id,outboundRequestId:reservation.outboundRequestId})
   if(prior.status!=='reserved'||!prior.messageId)throw error
   const{data,error:readError}=await supabaseService.from('ediel_messages').select('*').eq('company_id',basis.companyId).eq('id',prior.messageId).maybeSingle()
   if(readError||!data)throw readError??error
   message=data as EdielMessageRow
  }
 }
 reservation=await reserveCustomerLifeEventSource({...selector,intentId:intent.id,outboundRequestId:input.outboundRequestId})
 if(reservation.status==='held')return reservation
 if(reservation.messageId!==message.id||message.intent_id!==intent.id||message.outbound_request_id!==reservation.outboundRequestId||message.raw_payload!==basis.rawPayload)throw new Error('customer_life_event_message_not_bound')
 if(message.status!=='draft')return {status:'existing' as const,message}
 await updateIntentLifecycle(intent.id,{renderStatus:'rendered',edielMessageId:message.id,outboundRequestId:reservation.outboundRequestId,actorUserId:input.actorUserId})
 await queuePreparedEdielMessage({actorUserId:input.actorUserId,messageId:message.id,intentId:intent.id,outboundRequestId:reservation.outboundRequestId,payload:{customerLifeEventId:basis.eventId,operationId:basis.eventId,intentId:intent.id}})
 await updateIntentLifecycle(intent.id,{outboxStatus:'queued',actorUserId:input.actorUserId})
 return {status:'queued' as const,message}
}
