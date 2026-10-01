import {supabaseService} from '@/lib/supabase/service'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {resolveCanonicalTenantEdielIdentityWithEvidence} from '@/lib/ediel/tenant/tenantEdielIdentity'
import {projectAiListHistory,type AiListSupplyPeriod} from '@/lib/ediel/aiListHistory'
import {inspectStructuralReadset} from '@/lib/ediel/sources/structuralSourceReadset'
import {getGridOwnerById} from '@/lib/masterdata/db'
import type {CustomerSiteRow} from '@/lib/masterdata/types'
import type {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
import {requireAiListAppliedHistory} from '@/lib/ediel/aiListAppliedHistory'

export type AiListOriginRequest={companyId:string;actorUserId:string;environment:'test'|'production';customerId:string;siteId:string;meteringPointId?:string|null;fromDate:string;toDate:string}
export async function loadAiListOriginBasis(input:AiListOriginRequest,route:Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>){
 await assertEdielTenantActor({companyId:input.companyId,actorUserId:input.actorUserId,permission:'communication.write'})
 const {data:decision,error:decisionError}=await supabaseService.rpc('gridex_ai_export_decision_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId}).abortSignal(AbortSignal.timeout(2000))
 if(decisionError||decision?.status!=='authorized'||decision?.decision?.purpose!=='ediel_list_export')throw new Error('ai_list_export_decision_required')
 const {data:siteData,error:siteError}=await supabaseService.from('customer_sites').select('*').eq('id',input.siteId).eq('company_id',input.companyId).eq('customer_id',input.customerId).abortSignal(AbortSignal.timeout(2000)).maybeSingle()
 if(siteError||!siteData)throw new Error('ai_list_customer_site_scope_mismatch')
 const site=siteData as unknown as CustomerSiteRow
 if(input.meteringPointId){
  const {data:point,error}=await supabaseService.from('metering_points').select('id,company_id,customer_id,customer_site_id,site_id').eq('id',input.meteringPointId).eq('company_id',input.companyId).eq('customer_id',input.customerId).abortSignal(AbortSignal.timeout(2000)).maybeSingle()
  if(error||!point||(point.customer_site_id??point.site_id)!==site.id)throw new Error('ai_list_metering_point_scope_mismatch')
 }
 const gridOwner=site.grid_owner_id?await getGridOwnerById(supabaseService,site.grid_owner_id):null
 const cutoffAt=new Date().toISOString()
 const tenant=await resolveCanonicalTenantEdielIdentityWithEvidence({companyId:input.companyId,environment:input.environment,asOf:cutoffAt,requireExactCounts:true})
 if(route.environment!==input.environment||!tenant.identity.roleCodes.includes('electricity_supplier')||tenant.identity.legalEdielId!==route.senderEdielId||!gridOwner?.ediel_id||gridOwner.ediel_id!==route.receiverEdielId)throw new Error('ai_list_verified_supplier_network_context_required')
 let query=supabaseService.from('customer_supply_periods').select('id,company_id,customer_id,metering_point_id,start_date,end_date,actual_start_date,actual_end_date',{count:'exact'}).eq('company_id',input.companyId).eq('customer_id',input.customerId)
 if(input.meteringPointId)query=query.eq('metering_point_id',input.meteringPointId)
 const {data:periods,error:periodError,count}=await query.limit(1001).abortSignal(AbortSignal.timeout(2000))
 if(periodError||count===null||count>1000||periods?.length!==count)throw new Error('ai_list_supply_history_read_incomplete')
 const {data:snapshot,error:snapshotError}=await supabaseService.rpc('gridex_source_object_snapshot_v1',{p_company_id:input.companyId,p_environment:input.environment,p_cutoff:cutoffAt}).abortSignal(AbortSignal.timeout(2000))
 if(snapshotError)throw new Error('ai_list_source_history_read_unconfirmed')
 const scope={...input,legalSupplier:tenant.identity.legalEdielId,legalNetwork:gridOwner.ediel_id,cutoffAt}
 const readset=inspectStructuralReadset({companyId:input.companyId,environment:input.environment,cutoffAt},snapshot)
 const history=projectAiListHistory(scope,(periods??[]) as AiListSupplyPeriod[],readset)
 await requireAiListAppliedHistory({actorUserId:input.actorUserId,scope,history,readset})
 return {request:input,site,history,gridOwner}
}

export type AiListProspectiveOriginalReceipt={owner:'ai-list-private-original-v1';companyId:string;environment:'test'|'production';intentId:string;operationId:string;sourceHash:string;snapshotId:string;readsetHash:string;sourceSha256:string;technicalVersion:string;processingDecisionId:string;headerBasis:Record<string,unknown>}
/** Fresh protected native read before ordinary message INSERT. No caller history,
 * parsed metadata or EDIFACT rule-pack witness can substitute for this original. */
export async function qualifyAiListProspectiveOriginal(input:{draft:import('@/lib/ediel/types').CreateEdielMessageInput;actorUserId:string}):Promise<AiListProspectiveOriginalReceipt>{
 const d=input.draft
 const {assertAiListOutboundMessage,AI_LIST_SOURCE_PROFILE}=await import('@/lib/ediel/aiListFormat')
 const {isEvidenceUuid}=await import('@/lib/ediel/utilts/durableSourceDiscovery')
 const {createHash}=await import('node:crypto')
 if(!isEvidenceUuid(input.actorUserId)||!isEvidenceUuid(d.companyId)||!isEvidenceUuid(d.intentId)||!isEvidenceUuid(d.sourceOperationId)||d.actorUserId!==input.actorUserId)throw new Error('ai_list_prospective_actor_operation_required')
 assertAiListOutboundMessage({message_standard:d.messageStandard,message_family:d.messageFamily,raw_payload:d.rawPayload,sender_ediel_id:d.senderEdielId,receiver_ediel_id:d.receiverEdielId,file_name:d.fileName,mime_type:d.mimeType})
 const {data,error}=await supabaseService.rpc('gridex_ai_prepare_outbound_original_v1',{p_company_id:d.companyId,p_actor_user_id:input.actorUserId,p_intent_id:d.intentId,p_draft_text:JSON.stringify(d)}).abortSignal(AbortSignal.timeout(2000))
 if(error||!data||data.owner!=='ai-list-private-original-v1'||data.companyId!==d.companyId||data.environment!==d.environment||data.intentId!==d.intentId||data.operationId!==d.sourceOperationId||data.sourceHash!==createHash('sha256').update(d.rawPayload??'','utf8').digest('hex')||data.sourceSha256!==AI_LIST_SOURCE_PROFILE.sourceSha256||data.technicalVersion!==AI_LIST_SOURCE_PROFILE.technicalVersion||!isEvidenceUuid(data.snapshotId)||!isEvidenceUuid(data.processingDecisionId)||!(/^[a-f0-9]{64}$/.test(String(data.readsetHash)))||!data.headerBasis||typeof data.headerBasis!=='object'||Array.isArray(data.headerBasis))throw new Error('ai_list_prospective_original_unconfirmed')
 return data as AiListProspectiveOriginalReceipt
}
