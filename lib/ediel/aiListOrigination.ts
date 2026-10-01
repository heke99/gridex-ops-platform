import {supabaseService} from '@/lib/supabase/service'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {resolveCanonicalTenantEdielIdentityWithEvidence} from '@/lib/ediel/tenant/tenantEdielIdentity'
import {projectAiListHistory,type AiListSupplyPeriod} from '@/lib/ediel/aiListHistory'
import {inspectStructuralReadset} from '@/lib/ediel/sources/structuralSourceReadset'
import {getGridOwnerById} from '@/lib/masterdata/db'
import type {CustomerSiteRow} from '@/lib/masterdata/types'
import type {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'

export type AiListOriginRequest={companyId:string;actorUserId:string;environment:'test'|'production';customerId:string;siteId:string;meteringPointId?:string|null;fromDate:string;toDate:string}
export async function loadAiListOriginBasis(input:AiListOriginRequest,route:Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>){
 await assertEdielTenantActor({companyId:input.companyId,actorUserId:input.actorUserId,permissionAnyOf:['communication.write','ediel_testing.write']})
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
 const history=projectAiListHistory({...input,legalSupplier:tenant.identity.legalEdielId,legalNetwork:gridOwner.ediel_id,cutoffAt},(periods??[]) as AiListSupplyPeriod[],inspectStructuralReadset({companyId:input.companyId,environment:input.environment,cutoffAt},snapshot))
 return {request:input,site,history,gridOwner}
}
