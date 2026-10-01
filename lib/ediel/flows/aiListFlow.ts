import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
// lib/ediel/flows/aiListFlow.ts

import { getGridOwnerById } from '@/lib/masterdata/db'
import { buildAiListOutboundDraft } from '@/lib/ediel/aiList'
import { linkEdielMessage, updateEdielMessageStatus } from '@/lib/ediel/db'
import { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import {assertAiListOutboundType} from '@/lib/ediel/aiListFormat'
import {projectAiListHistory,type AiListSupplyPeriod} from '@/lib/ediel/aiListHistory'
import {inspectStructuralReadset} from '@/lib/ediel/sources/structuralSourceReadset'
import {resolveCanonicalTenantEdielIdentityWithEvidence} from '@/lib/ediel/tenant/tenantEdielIdentity'
import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import type {CustomerSiteRow} from '@/lib/masterdata/types'
import type { EdielEnvironment } from '@/lib/ediel/types'
import {
  ensureActorUserId,
  finalizeOutboundDraft,
  makeServerClient,
  resolveOutboundRuntimeEnvironment,
} from '@/lib/ediel/flows/shared'

export async function prepareAndQueueAiList(params: {
  actorUserId: string
  companyId: string
  listType: 'AI' | 'BI'
  customerId: string
  siteId: string
  meteringPointId?: string | null
  supplierEdielId?: string | null
  balanceResponsibleEdielId?: string | null
  receiverEdielId: string
  receiverEmail?: string | null
  fromDate: string
  toDate: string
  communicationRouteId?: string | null
  environment?: EdielEnvironment | null
}) {
  assertAiListOutboundType(params.listType)
  if(!isEvidenceUuid(params.actorUserId)||!isEvidenceUuid(params.companyId))throw new Error('ai_list_actor_company_context_required')
  const actorUserId = ensureActorUserId(params.actorUserId)
  const supabase = await makeServerClient()
  await assertEdielTenantActor({companyId:params.companyId,actorUserId,permissionAnyOf:['communication.write','ediel_testing.write']})
  const {data:siteData,error:siteError}=await supabase.from('customer_sites').select('*').eq('id',params.siteId).eq('company_id',params.companyId).eq('customer_id',params.customerId).abortSignal(AbortSignal.timeout(2000)).maybeSingle()
  if(siteError||!siteData)throw new Error('ai_list_customer_site_scope_mismatch')
  const site=siteData as unknown as CustomerSiteRow
  if(params.meteringPointId){
    const {data:point,error:pointError}=await supabase.from('metering_points').select('id,company_id,customer_id,customer_site_id,site_id').eq('id',params.meteringPointId).eq('company_id',params.companyId).eq('customer_id',params.customerId).abortSignal(AbortSignal.timeout(2000)).maybeSingle()
    if(pointError||!point||(point.customer_site_id??point.site_id)!==site.id)throw new Error('ai_list_metering_point_scope_mismatch')
  }

  const gridOwner = site.grid_owner_id
    ? await getGridOwnerById(supabase, site.grid_owner_id)
    : null

  const environment = await resolveOutboundRuntimeEnvironment({
    preferredRouteId: params.communicationRouteId ?? null,
    explicitEnvironment: params.environment ?? null,
  })

  const routeContext = await resolveCanonicalOutboundContext({
    requestType: 'meter_values',
    gridOwner,
    preferredRouteId: params.communicationRouteId ?? null,
    companyId: params.companyId,
    environment,
    messageStandard: 'ai_list',
  })

  const cutoffAt=new Date().toISOString()
  const tenant=await resolveCanonicalTenantEdielIdentityWithEvidence({companyId:params.companyId,environment,asOf:cutoffAt,requireExactCounts:true})
  if(!tenant.identity.roleCodes.includes('electricity_supplier')||tenant.identity.legalEdielId!==routeContext.senderEdielId||params.supplierEdielId&&params.supplierEdielId!==tenant.identity.legalEdielId||!gridOwner?.ediel_id||gridOwner.ediel_id!==routeContext.receiverEdielId||params.receiverEdielId!==routeContext.receiverEdielId)throw new Error('ai_list_verified_supplier_network_context_required')
  // Complete all-status supply history; an active-only query would omit ended
  // periods. This is a scope index, never authority for historical field values.
  let periodsQuery=supabase.from('customer_supply_periods').select('id,company_id,customer_id,metering_point_id,start_date,end_date',{count:'exact'}).eq('company_id',params.companyId).eq('customer_id',params.customerId)
  if(params.meteringPointId)periodsQuery=periodsQuery.eq('metering_point_id',params.meteringPointId)
  const {data:periods,error:periodError,count:periodCount}=await periodsQuery.limit(1001).abortSignal(AbortSignal.timeout(2000))
  if(periodError||periodCount===null||periodCount>1000||periods?.length!==periodCount)throw new Error('ai_list_supply_history_read_incomplete')
  const {data:snapshot,error:snapshotError}=await supabase.rpc('gridex_source_object_snapshot_v1',{p_company_id:params.companyId,p_environment:environment,p_cutoff:cutoffAt}).abortSignal(AbortSignal.timeout(2000))
  if(snapshotError)throw new Error('ai_list_source_history_read_unconfirmed')
  const historyScope={companyId:params.companyId,environment,customerId:params.customerId,siteId:params.siteId,meteringPointId:params.meteringPointId,legalSupplier:tenant.identity.legalEdielId,legalNetwork:gridOwner.ediel_id,fromDate:params.fromDate,toDate:params.toDate,cutoffAt}
  const history=projectAiListHistory(historyScope,(periods??[]) as AiListSupplyPeriod[],inspectStructuralReadset({companyId:params.companyId,environment,cutoffAt},snapshot))
  if(params.balanceResponsibleEdielId&&history.details.some(detail=>detail.balansansvarsId!==params.balanceResponsibleEdielId))throw new Error('ai_list_balance_party_override_not_authorized')

  const draft = await buildAiListOutboundDraft({
    actorUserId,
    companyId: params.companyId,
    listType: params.listType,
    senderEdielId: routeContext.senderEdielId,
    senderName: routeContext.senderName,
    receiverEdielId: routeContext.receiverEdielId,
    receiverName: routeContext.receiverName,
    receiverEmail: params.receiverEmail ?? routeContext.receiverEmail,
    communicationRouteId: routeContext.route.id,
    customerId: params.customerId,
    siteId: params.siteId,
    meteringPointId: params.meteringPointId ?? null,
    gridOwnerId: site.grid_owner_id,
    fromDate: params.fromDate,
    toDate: params.toDate,
    details: history.details,
    environment,
    mailbox: routeContext.mailbox,
    routeDefaultMessageVersion: routeContext.defaultMessageVersion,
  })

  draft.parsedPayload={...draft.parsedPayload,historyEvidence:history.evidence}

  const message = await finalizeOutboundDraft({
    actorUserId,
    requestType: 'meter_values',
    routeContext,
    draft,
    duplicateCheck: {
      receiverEdielId: routeContext.receiverEdielId,
      messageFamily: draft.messageFamily,
      messageCode: String(draft.messageCode),
      messageVersion: draft.messageVersion ?? null,
    },
  })

  await linkEdielMessage({
    actorUserId,
    edielMessageId: message.id,
    customerId: params.customerId,
    siteId: params.siteId,
    meteringPointId: params.meteringPointId ?? null,
    gridOwnerId: site.grid_owner_id,
    communicationRouteId: routeContext.route.id,
  })

  await updateEdielMessageStatus({
    actorUserId,
    edielMessageId: message.id,
    status: 'queued',
  })

  return message
}