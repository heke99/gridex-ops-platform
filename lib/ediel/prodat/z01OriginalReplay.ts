import {getEdielMessageById} from '@/lib/ediel/db'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {requireEdielSourceRulePackEvidence} from '@/lib/ediel/core/sourceRulePackEvidence'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import type {EdielMessageIntent} from '@/lib/ediel/intent/types'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {getEdielMessageIntentById} from '@/lib/ediel/intent/intentEngine'
import {supabaseService} from '@/lib/supabase/service'
import type {OutboundRequestRow} from '@/lib/cis/types'

/** Return only an already bound protected original. This read grants no new
 * render, write, queue, transport attempt, ACK or current market authority. */
export async function readExistingZ01Original(input:{intent:EdielMessageIntent;actorUserId:string;companyId:string|null;environment:'test'|'production';outboundRequestId:string;operationId:string|null;customerId:string|null;siteId:string|null;routeId:string;dataRequestId?:string}):Promise<EdielMessageRow|null>{
 const i=input.intent
 if(!i.edielMessageId)return null
 if(i.companyId!==input.companyId||i.environment!==input.environment||i.messageFamily!=='PRODAT'||i.messageCode!=='Z01'
  ||i.direction!=='outbound'||i.market!=='electricity'||i.outboundRequestId!==input.outboundRequestId
  ||i.operationId!==input.operationId||!i.operationId||i.customerId!==input.customerId||i.customerSiteId!==input.siteId||i.communicationRouteId!==input.routeId)throw new Error('z01_original_scope_changed')
 await assertEdielTenantActor({companyId:i.companyId,actorUserId:input.actorUserId,permissionAnyOf:['communication.read','metering.read']})
 const m=await getEdielMessageById(i.edielMessageId,{companyId:i.companyId})
 if(!m||m.id!==i.edielMessageId||m.company_id!==i.companyId||m.intent_id!==i.id||m.direction!=='outbound'||m.message_family!=='PRODAT'||m.message_code!=='Z01'||m.environment!==i.environment
  ||m.outbound_request_id!==input.outboundRequestId||m.source_operation_id!==i.operationId||m.customer_id!==input.customerId||m.site_id!==input.siteId
  ||m.sender_ediel_id!==i.senderEdielId||m.receiver_ediel_id!==i.receiverEdielId||m.communication_route_id!==i.communicationRouteId||m.route_profile_id!==i.routeProfileId||(input.dataRequestId!==undefined&&m.grid_owner_data_request_id!==input.dataRequestId)
  ||typeof m.raw_payload!=='string'||!m.raw_payload)throw new Error('z01_original_scope_changed')
 // The same private frozen source receipt checks the immutable raw SHA and all
 // six named-rule keys; today's registry/customer/version is never selected.
 const evidence=await requireEdielSourceRulePackEvidence(i.companyId,m.id)
 if(m.canonical_rule_pack_id!==evidence.rulePackId||m.rule_profile_version_id!==evidence.messageProfileId||m.rule_profile_key!==evidence.profileKey||m.rule_profile_version!==evidence.version||m.rule_pack_checksum!==evidence.sourceHash)throw new Error('z01_original_rule_scope_changed')
 const wire=tokenizeEdifact(m.raw_payload),tokens=wire.segments,unb=tokens.filter(s=>s.tag==='UNB'),unh=tokens.filter(s=>s.tag==='UNH'),bgm=tokens.filter(s=>s.tag==='BGM')
 const li=tokens.filter(s=>s.tag==='RFF'&&segmentComposite(s,1,wire.una)[0]==='LI')
 if(unb.length!==1||unh.length!==1||bgm.length!==1||li.length!==1||segmentComposite(unb[0],5,wire.una)[0]!==i.interchangeReference||segmentComposite(unh[0],1,wire.una)[0]!==i.messageReference
  ||segmentComposite(unh[0],2,wire.una)[0]!=='PRODAT'||segmentComposite(unb[0],2,wire.una)[0]!==i.senderEdielId||segmentComposite(unb[0],3,wire.una)[0]!==i.receiverEdielId||segmentComposite(unb[0],7,wire.una)[0]!==i.applicationReference||segmentComposite(bgm[0],1,wire.una)[0]!=='Z01'||segmentComposite(bgm[0],2,wire.una)[0]!==i.payload.documentReference||segmentComposite(li[0],1,wire.una)[1]!==i.transactionReference
  ||m.interchange_reference!==i.interchangeReference||m.external_reference!==i.payload.documentReference||m.transaction_reference!==i.transactionReference||m.application_reference!==i.applicationReference)throw new Error('z01_original_wire_scope_changed')
 return m
}

/** Owned request/response IDs are selectors only. Resolve the exact immutable
 * message/intent/outbound source tuple before today's routing or masterdata. */
export async function readZ01OriginalForRequest(input:{actorUserId:string;companyId:string;requestId:string;requestKind:'facility_lookup'|'customer_masterdata';customerId:string|null;siteId:string|null;operationId:string|null;environment?:'test'|'production'|null;routeId?:string|null;messageIds:readonly (string|null|undefined)[];outboundIds?:readonly (string|null|undefined)[]}):Promise<{message:EdielMessageRow;outbound:OutboundRequestRow}|null>{
 await assertEdielTenantActor({companyId:input.companyId,actorUserId:input.actorUserId,permissionAnyOf:['communication.read','metering.read']})
 let query=supabaseService.from('outbound_requests').select('*').eq('company_id',input.companyId).eq('source_type',input.requestKind==='facility_lookup'?'manual':'grid_owner_data_request').eq('source_id',input.requestId).eq('request_type','customer_masterdata')
 if(input.operationId)query=query.eq('operation_id',input.operationId)
 const{data,error}=await query.limit(3)
 if(error)throw error
 const rows=(data??[]) as OutboundRequestRow[]
 if(rows.length>=3)throw new Error('z01_original_source_ambiguous')
 const selectors=new Set(input.messageIds.filter((value):value is string=>typeof value==='string'&&value.length>0))
 for(const row of rows){const id=row.response_payload?.edielMessageId;if(typeof id==='string'&&id)selectors.add(id)}
 if(selectors.size===0&&rows.length){
  // Crash between native original binding and public response publication:
  // discover only through these exact owned outbounds, never latest/new raw.
  const{data:originals,error:readError}=await supabaseService.from('ediel_messages').select('id,intent_id,outbound_request_id,source_operation_id')
   .eq('company_id',input.companyId).eq('direction','outbound').eq('message_family','PRODAT').eq('message_code','Z01').in('outbound_request_id',rows.map(row=>row.id)).limit(2)
  if(readError)throw readError
  if((originals??[]).length>1)throw new Error('z01_original_source_ambiguous')
  for(const candidate of originals??[]){
   if(typeof candidate.id!=='string'||!candidate.id||typeof candidate.intent_id!=='string'||!candidate.intent_id||!candidate.source_operation_id
    ||rows.filter(row=>row.id===candidate.outbound_request_id&&row.operation_id===candidate.source_operation_id).length!==1)throw new Error('z01_original_scope_changed')
   selectors.add(candidate.id)
  }
 }
 if(selectors.size===0)return null
 if(selectors.size!==1)throw new Error('z01_original_source_ambiguous')
 const m=await getEdielMessageById([...selectors][0],{companyId:input.companyId})
 if(!m?.intent_id||!m.outbound_request_id||(m.environment!=='test'&&m.environment!=='production')||input.environment&&input.environment!==m.environment||input.routeId&&input.routeId!==m.communication_route_id)throw new Error('z01_original_scope_changed')
 const selectedOutboundIds=(input.outboundIds??[]).filter((value):value is string=>typeof value==='string'&&value.length>0)
 if(selectedOutboundIds.some(id=>id!==m.outbound_request_id))throw new Error('z01_original_scope_changed')
 const matches=rows.filter(r=>r.id===m.outbound_request_id)
 if(matches.length!==1)throw new Error('z01_original_scope_changed')
 const outbound=matches[0],intent=await getEdielMessageIntentById(m.intent_id)
 if(!intent||intent.businessProcess!==input.requestKind||outbound.source_id!==input.requestId||outbound.source_type!==(input.requestKind==='facility_lookup'?'manual':'grid_owner_data_request')||outbound.request_type!=='customer_masterdata'||outbound.company_id!==input.companyId||outbound.customer_id!==input.customerId||outbound.site_id!==input.siteId||outbound.operation_id!==m.source_operation_id
  ||input.operationId&&input.operationId!==m.source_operation_id||input.requestKind==='facility_lookup'&&intent.gridOwnerInformationRequestId!==input.requestId)throw new Error('z01_original_scope_changed')
 const message=await readExistingZ01Original({intent,actorUserId:input.actorUserId,companyId:input.companyId,environment:m.environment,outboundRequestId:outbound.id,operationId:m.source_operation_id??null,
  customerId:input.customerId,siteId:input.siteId,routeId:m.communication_route_id??'',...(input.requestKind==='customer_masterdata'?{dataRequestId:input.requestId}:{})})
 if(!message||message.id!==m.id)throw new Error('z01_original_scope_changed')
 return{message,outbound}
}
