import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
// lib/ediel/flows/aiListFlow.ts

import { getGridOwnerById } from '@/lib/masterdata/db'
import {randomUUID} from 'node:crypto'
import {createEdielMessageIntent} from '@/lib/ediel/intent/intentEngine'
import {renderAndQueueAiList} from '@/lib/ediel/intent/aiListGateway'
import type {CreateAiListMessageIntentInput} from '@/lib/ediel/intent/types'
import { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import {assertAiListOutboundType,AI_LIST_SOURCE_PROFILE} from '@/lib/ediel/aiListFormat'
import {resolveCanonicalTenantEdielIdentityWithEvidence} from '@/lib/ediel/tenant/tenantEdielIdentity'
import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import type {CustomerSiteRow} from '@/lib/masterdata/types'
import type { EdielEnvironment } from '@/lib/ediel/types'
import {
  ensureActorUserId,
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
  const routeProfileId=routeContext.routeRuntime?.route_profile_id
  if(!routeProfileId)throw new Error('ai_list_canonical_route_profile_required')
  const requestId=randomUUID()
  const request:CreateAiListMessageIntentInput={actorUserId,companyId:params.companyId,environment,market:'electricity',messageFamily:'AI_LIST',messageCode:'AI',businessProcess:'reconciliation',direction:'outbound',senderEdielId:routeContext.senderEdielId,receiverEdielId:routeContext.receiverEdielId,applicationReference:'',interchangeReference:'',messageReference:'',transactionReference:null,routeProfileId,communicationRouteId:routeContext.route.id,customerId:params.customerId,customerSiteId:params.siteId,meteringPointId:params.meteringPointId??null,idempotencyKey:`ai-list-request:${requestId}`,payload:{owner:'ai-list-export-request-v1',fromDate:params.fromDate,toDate:params.toDate,sourceSha256:AI_LIST_SOURCE_PROFILE.sourceSha256,technicalVersion:AI_LIST_SOURCE_PROFILE.technicalVersion,requestId,...(params.balanceResponsibleEdielId?{expectedBalanceResponsibleEdielId:params.balanceResponsibleEdielId}:{})}}
  const intent=await createEdielMessageIntent(request)
  return renderAndQueueAiList({companyId:params.companyId,actorUserId,intentId:intent.id,routeContext})
}
