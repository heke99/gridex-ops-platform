import {parseAiBiTechnicalFile} from '@/lib/ediel/aiListFormat'
import {requireAiBiProcessingDecision} from '@/lib/ediel/aiBiProcessingDecision'
import {resolveCanonicalTenantEdielIdentityWithEvidence} from '@/lib/ediel/tenant/tenantEdielIdentity'
import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {supabaseService} from '@/lib/supabase/service'

/** Before the first container/body/attachment write, inspect the actual decoded
 * MIME sources. A shared mailbox, sender address, metadata or 'system' actor is
 * never a tenant/legal decision. Header recognition only protects storage;
 * complete files still use the one shared technical parser. */
export async function requireAiBiPersonalDataStorage(input:{companyId?:string|null;actorUserId?:string|null;environment?:string|null;candidates:readonly(string|null|undefined)[]}){
  const candidates=input.candidates.filter((candidate):candidate is string=>typeof candidate==='string')
  const headerLines=[...new Set(candidates.flatMap(candidate=>candidate.split(/\r?\n/).filter(line=>/^[\uFEFF\t ]*(AI|BI);/.test(line))))]
  if(!headerLines.length)return null
  const headers=headerLines.map(line=>{
    try{return parseAiBiTechnicalFile(line).header}catch{throw new Error('ai_bi_personal_storage_header_invalid')}
  })
  const types=[...new Set(headers.map(header=>header.listType))]
  if(types.length!==1)throw new Error('ai_bi_personal_storage_mixed_types')
  let canonicalPayload:string|null=null
  for(const candidate of candidates){
    if(!/^(?:\uFEFF)?(AI|BI);/.test(candidate))continue
    try{parseAiBiTechnicalFile(candidate,types[0])}catch{throw new Error('ai_bi_personal_storage_technical_source_invalid')}
    canonicalPayload??=candidate
  }
  if(!canonicalPayload)throw new Error('ai_bi_personal_storage_complete_source_required')
  if(!isEvidenceUuid(input.companyId)||!isEvidenceUuid(input.actorUserId)||(input.environment!=='test'&&input.environment!=='production'))throw new Error('ai_bi_personal_storage_tenant_actor_required')
  const companyId=input.companyId,actorUserId=input.actorUserId,environment=input.environment
  const processingDecision=await requireAiBiProcessingDecision({companyId,actorUserId,listType:types[0]})
  const tenant=await resolveCanonicalTenantEdielIdentityWithEvidence({companyId,environment,asOf:new Date().toISOString(),requireExactCounts:true})
  if(!tenant.identity.roleCodes.includes('electricity_supplier')||headers.some(header=>header.supplierEdielId!==tenant.identity.legalEdielId))throw new Error('ai_bi_header_supplier_tenant_mismatch')
  for(const headerLine of headerLines){
    const {data,error}=await supabaseService.rpc('gridex_ai_bi_personal_storage_scope_v1',{p_company_id:companyId,p_actor_user_id:actorUserId,p_environment:environment,p_header_line:headerLine.replace(/^\uFEFF/,'')})
    if(error)throw error
    if(!data||data.status!=='authorized')throw new Error(typeof data?.blocker==='string'?data.blocker:'ai_bi_personal_storage_scope_required')
    if(data.decision?.id!==processingDecision.id||data.headerBasis?.companyId!==companyId||data.headerBasis?.legalSupplier!==tenant.identity.legalEdielId)throw new Error('ai_bi_personal_storage_scope_invalid')
  }
  return {listType:types[0],processingDecision,canonicalPayload}
}
