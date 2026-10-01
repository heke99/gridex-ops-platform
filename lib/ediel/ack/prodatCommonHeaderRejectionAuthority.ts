import {supabaseService} from '@/lib/supabase/service'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {AuthoritativeEdielGuide} from '@/lib/ediel/rulebook/guideRegistry'
import type {OriginalAckPartyIdentities} from '@/lib/ediel/core/originalAckPartyIdentities'

/** Common national header rejection, never a code profile or legal mandate. */
export type ProdatCommonHeaderRejectionEvidence=Readonly<{
 kind:'prodat_common_header_rejection';version:1;companyId:string;environment:'test'|'production'
 sourceMessageId:string;sourceHash:string;sourceReceivedAt:string;observedAt:string;syntaxAssessmentId:string
 field202:{fieldCode:'202';ercCode:'41'|'42';text:string};guide:AuthoritativeEdielGuide
 familyEdition:{version:string;rulePack:Record<string,unknown>;guideSources:readonly Record<string,unknown>[];sourceProjection:Record<string,unknown>}
 identities:OriginalAckPartyIdentities;authorizesBusinessEffect:false
}>
const evidenceSources=new WeakMap<object,EdielMessageRow>()
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value)}return value}
function decode(result:unknown,input:{companyId:string;environment:'test'|'production';sourceMessageId?:string;expectedRawPayload?:string}){
 const value=result as {version?:unknown;sourceMessage?:EdielMessageRow;evidence?:ProdatCommonHeaderRejectionEvidence}|null
 const source=value?.sourceMessage,e=value?.evidence
 if(value?.version!==1||!source||!e||e.kind!=='prodat_common_header_rejection'||e.version!==1||e.companyId!==input.companyId||e.environment!==input.environment
  ||e.sourceMessageId!==source.id||(input.sourceMessageId&&e.sourceMessageId!==input.sourceMessageId)||source.direction!=='inbound'||source.environment!==e.environment
  ||(source.company_id!==null&&source.company_id!==e.companyId)||typeof source.raw_payload!=='string'||(input.expectedRawPayload!==undefined&&source.raw_payload!==input.expectedRawPayload)
  ||!e.field202||!e.guide||!e.identities||!e.familyEdition||e.sourceHash!==evidenceHash(source.raw_payload)||e.sourceReceivedAt!==source.message_received_at||!e.syntaxAssessmentId||e.field202.fieldCode!=='202'||!['41','42'].includes(e.field202.ercCode)
  ||e.guide.family!=='PRODAT'||e.identities.family!=='PRODAT'||e.authorizesBusinessEffect!==false||!e.familyEdition.version||!e.field202.text)throw Error('ediel_common_header_rejection_basis_required')
 freeze(e);freeze(source);evidenceSources.set(e,source);return {sourceMessage:source,evidence:e}
}
export function prodatCommonHeaderRejectionQualification(input:{evidence:unknown;companyId:string;environment:'test'|'production';sourceMessageId?:string}){
 if(!input.evidence||typeof input.evidence!=='object'||!evidenceSources.has(input.evidence))return null
 const e=input.evidence as ProdatCommonHeaderRejectionEvidence
 return e.companyId===input.companyId&&e.environment===input.environment&&(!input.sourceMessageId||e.sourceMessageId===input.sourceMessageId)?e:null
}
export function commonHeaderOriginalSource(evidence:ProdatCommonHeaderRejectionEvidence):EdielMessageRow|null{return evidenceSources.get(evidence)??null}
export async function readProdatCommonHeaderRejectionEvidence(input:{companyId:string;environment:'test'|'production';sourceMessageId:string;expectedRawPayload:string;actorUserId:string}){
 await assertEdielTenantActor({companyId:input.companyId,actorUserId:input.actorUserId,permission:'communication.send'})
 const {data,error}=await supabaseService.rpc('ediel_read_prodat_common_header_rejection_v1',{p_company_id:input.companyId,p_environment:input.environment,p_source_message_id:input.sourceMessageId})
 if(error)throw Error('ediel_common_header_rejection_basis_required',{cause:error})
 return decode(data,input)
}
export async function prepareProdatCommonHeaderNegativeAckWitness(input:{evidence:ProdatCommonHeaderRejectionEvidence;actorUserId:string;rawPayload:string}){
 const e=prodatCommonHeaderRejectionQualification({evidence:input.evidence,companyId:input.evidence.companyId,environment:input.evidence.environment})
 if(!e)throw Error('ediel_common_header_rejection_basis_required')
 await assertEdielTenantActor({companyId:e.companyId,actorUserId:input.actorUserId,permission:'communication.send'})
 const {data,error}=await supabaseService.rpc('ediel_prepare_common_header_negative_ack_v1',{p_company_id:e.companyId,p_environment:e.environment,p_source_message_id:e.sourceMessageId,p_actor_user_id:input.actorUserId,p_raw_payload:input.rawPayload})
 if(error||typeof data?.witnessId!=='string'||data?.evidence?.sourceHash!==e.sourceHash)throw Error('ediel_common_header_negative_witness_required',{cause:error})
 return {witnessId:data.witnessId as string,evidence:e}
}
export async function readPersistedProdatCommonHeaderNegativeAckBasis(input:{companyId:string;environment:'test'|'production';ackMessageId:string;expectedRawPayload:string}){
 const {data,error}=await supabaseService.rpc('ediel_read_common_header_negative_ack_v1',{p_company_id:input.companyId,p_environment:input.environment,p_ack_message_id:input.ackMessageId})
 if(error||data?.ackMessage?.id!==input.ackMessageId||data?.ackMessage?.company_id!==input.companyId||data?.ackMessage?.environment!==input.environment||data?.ackMessage?.raw_payload!==input.expectedRawPayload)throw Error('ediel_common_header_negative_witness_required',{cause:error})
 const result=decode(data,{companyId:input.companyId,environment:input.environment,sourceMessageId:data.ackMessage.related_message_id})
 if(data.ackMessage.related_message_id!==result.evidence.sourceMessageId)throw Error('ediel_common_header_negative_witness_required')
 return {...result,ackMessage:data.ackMessage as EdielMessageRow}
}
