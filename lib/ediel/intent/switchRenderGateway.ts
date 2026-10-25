import {createHash} from 'node:crypto'
import type {Database} from '@/supabase/database.types'
type ImmutableProjection=Partial<Pick<Database['public']['Tables']['ediel_messages']['Row'],'immutable_payload_hash'|'immutable_rendered_at'>>
import {buildProdatZ03FromSwitch} from '@/lib/ediel/prodat'
import {getEdielMessageById} from '@/lib/ediel/db'
import {getEdielMessageIntentById,evaluateIntentValidation,updateIntentLifecycle} from './intentEngine'
import {finalizeOutboundDraft} from '@/lib/ediel/flows/shared'
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
  ||!['L','LK','H'].includes(String(intent.payload.transactionSubtype))||typeof intent.payload.documentReference!=='string')throw new Error('switch_validated_source_intent_required')
 let message=intent.edielMessageId?await getEdielMessageById(intent.edielMessageId):null
 if(message&&(message.company_id!==intent.companyId||message.intent_id!==intent.id||message.outbound_request_id!==input.outboundRequestId))throw new Error('switch_original_intent_binding_conflict')
 if(!message){
  const draft=await buildProdatZ03FromSwitch({...input.source,wireReferences:{documentReference:intent.payload.documentReference,transactionReference:intent.transactionReference!,interchangeReference:intent.interchangeReference,messageReference:intent.messageReference}})
  draft.intentId=intent.id
  draft.outboundRequestId=input.outboundRequestId
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
 // Queueing may only use the persisted immutable original. A retry never
 // renders another wire or rebinds a non-draft original to recover queue state.
 const original=message as typeof message & ImmutableProjection
 const originalHash=original.immutable_payload_hash
 if(!message.raw_payload||typeof originalHash!=='string'||!original.immutable_rendered_at
  ||createHash('sha256').update(message.raw_payload,'utf8').digest('hex')!==originalHash)throw new Error('switch_original_immutable_payload_required')
 if(message.status==='draft'){
  const {data,error}=await supabaseService.rpc('ediel_bind_switch_original_v1',{p_company_id:intent.companyId,p_switch_id:input.source.switchRequest.id,p_message_id:message.id,p_actor_user_id:input.actorUserId})
  if(error)throw error
  if(!data||data.status!=='bound'||data.messageId!==message.id)throw new Error('switch_original_native_binding_required')
 }
 // This installed generated RPC owns all four queue projections and both
 // native history lanes. It never grants provider entry or delivery authority.
 const {data,error}=await supabaseService.rpc('gridex_enqueue_normal_supplier_switch_v1',{
  p_company_id:intent.companyId,p_switch_id:input.source.switchRequest.id,p_intent_id:intent.id,p_message_id:message.id,
  p_outbound_request_id:input.outboundRequestId,p_actor_user_id:input.actorUserId,p_expected_payload_hash:originalHash})
 if(error)throw error
 const outcome=data&&typeof data==='object'&&!Array.isArray(data)?data:null
 const outboxId=outcome?.outboxId
 if(!outcome||typeof outcome.status!=='string'||!['queued','in_progress','accepted'].includes(outcome.status)||outcome.messageId!==message.id
  ||outcome.authorizesProviderEntry!==false||outcome.deliveryProven!==false
  ||(outcome.status!=='accepted'&&(typeof outboxId!=='string'||!(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).test(outboxId))))throw new Error('switch_original_atomic_enqueue_unconfirmed')
 const persisted=await getEdielMessageById(message.id)
 if(!persisted||persisted.id!==message.id||persisted.company_id!==intent.companyId||persisted.intent_id!==intent.id
  ||persisted.outbound_request_id!==input.outboundRequestId||persisted.environment!==intent.environment
  ||persisted.raw_payload!==message.raw_payload||(persisted as typeof persisted & ImmutableProjection).immutable_payload_hash!==originalHash
  ||!['queued','sending','dispatching','provider_accepted','sent','acknowledged'].includes(persisted.status))throw new Error('switch_original_atomic_enqueue_readback_unconfirmed')
 return persisted
}
