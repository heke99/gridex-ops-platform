import {prodatCommonHeaderNegativeAckRouteQualification,type ProdatCommonHeaderNegativeAckRoute} from './prodatCommonHeaderNegativeAckRoute'
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
 field202?:{fieldCode:'202';ercCode:'41'|'42';text:string}
 negativeField?:{fieldCode:'202'|'311'|'223';ercCode:'41'|'42';text:string}
 replyApplicationReference?:string|null
 applicationReferenceCorrection?:Readonly<{sourceEdition:string;sourceSha256:string;tableIndex:105;page:120;fieldCode:'311';
  originalApplicationReference:null;expectedApplicationReference:'23-DDQ-PRODAT';processEdition:string;canonicalProjection:Record<string,unknown>;
  actorRole:'electricity_supplier';market:'electricity'}>
 guide:AuthoritativeEdielGuide
 familyEdition:{version:string;rulePack:Record<string,unknown>;guideSources:readonly Record<string,unknown>[];sourceProjection:Record<string,unknown>}
 identities:OriginalAckPartyIdentities;authorizesBusinessEffect:false
}>
const evidenceSources=new WeakMap<object,EdielMessageRow>()
export function commonHeaderRejectionField(e:ProdatCommonHeaderRejectionEvidence){
 const field=e.negativeField??e.field202
 if(!field||!['202','311','223'].includes(field.fieldCode)||!['41','42'].includes(field.ercCode)||!field.text
  ||e.field202&&JSON.stringify(e.field202)!==JSON.stringify(field))return null
 return field
}
/** Only the frozen private source READ can qualify the P page120 field311
 * exception. The original APP stays physically absent. Ordinary replies copy it. */
export function commonHeaderReplyApplicationReference(e:ProdatCommonHeaderRejectionEvidence):string|null {
 const qualified=evidenceSources.has(e),field=commonHeaderRejectionField(e)
 if(!qualified||!field)throw Error('ediel_common_header_rejection_basis_required')
 const actual=e.identities.applicationReference,reply=e.replyApplicationReference??actual
 if(reply===actual)return actual
 const p=e.applicationReferenceCorrection,projection=p?.canonicalProjection
 if(field.fieldCode!=='311'||field.ercCode!=='41'||actual!==null||reply!=='23-DDQ-PRODAT'||!p
  ||p.sourceSha256!=='83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95'
  ||p.tableIndex!==105||p.page!==120||p.fieldCode!=='311'||p.originalApplicationReference!==null
  ||p.expectedApplicationReference!==reply||p.actorRole!=='electricity_supplier'||p.market!=='electricity'
  ||p.processEdition!=='111385d7f0a83dd865de369ccee9aae3dc52098a5d3105cb3bacb4070ff7579b'
  ||p.sourceEdition!=='068e8f82c082c2d3513ead62f4833fa89884488cbd0347fa499a0949a4c9e3c6'||projection?.family!=='PRODAT'||projection.code!=='Z04'||projection.subtype!=='H'
  ||projection.transactionReasonCode!=='Z25'||!Array.isArray(projection.receiverRoles)||projection.receiverRoles.length!==1||projection.receiverRoles[0]!=='supplier'
  ||!Array.isArray(projection.applicationReferences)||projection.applicationReferences.length!==1||projection.applicationReferences[0]!==reply)
  throw Error('ediel_common_header_application_correction_required')
 return reply
}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value)}return value}
function decode(result:unknown,input:{companyId:string;environment:'test'|'production';sourceMessageId?:string;expectedRawPayload?:string}){
 const value=result as {version?:unknown;sourceMessage?:EdielMessageRow;evidence?:ProdatCommonHeaderRejectionEvidence}|null
 const source=value?.sourceMessage,e=value?.evidence,field=e?commonHeaderRejectionField(e):null
 if(value?.version!==1||!source||!e||e.kind!=='prodat_common_header_rejection'||e.version!==1||e.companyId!==input.companyId||e.environment!==input.environment
  ||e.sourceMessageId!==source.id||(input.sourceMessageId&&e.sourceMessageId!==input.sourceMessageId)||source.direction!=='inbound'||source.environment!==e.environment
  ||(source.company_id!==null&&source.company_id!==e.companyId)||typeof source.raw_payload!=='string'||(input.expectedRawPayload!==undefined&&source.raw_payload!==input.expectedRawPayload)
  ||!field||!e.guide||!e.identities||!e.familyEdition||e.sourceHash!==evidenceHash(source.raw_payload)||e.sourceReceivedAt!==source.message_received_at||!e.syntaxAssessmentId
  ||e.guide.family!=='PRODAT'||e.identities.family!=='PRODAT'||e.authorizesBusinessEffect!==false||!e.familyEdition.version)throw Error('ediel_common_header_rejection_basis_required')
 freeze(e);freeze(source);evidenceSources.set(e,source);try{commonHeaderReplyApplicationReference(e)}catch(error){evidenceSources.delete(e);throw error}return {sourceMessage:source,evidence:e}
}
export function prodatCommonHeaderRejectionQualification(input:{evidence:unknown;companyId:string;environment:'test'|'production';sourceMessageId?:string}){
 if(!input.evidence||typeof input.evidence!=='object'||!evidenceSources.has(input.evidence))return null
 const e=input.evidence as ProdatCommonHeaderRejectionEvidence
 return e.companyId===input.companyId&&e.environment===input.environment&&(!input.sourceMessageId||e.sourceMessageId===input.sourceMessageId)?e:null
}
export function commonHeaderOriginalSource(evidence:ProdatCommonHeaderRejectionEvidence):EdielMessageRow|null{return evidenceSources.get(evidence)??null}
export async function readProdatCommonHeaderRejectionEvidence(input:{companyId:string;environment:'test'|'production';sourceMessageId:string;expectedRawPayload:string;actorUserId:string}){
 await assertEdielTenantActor({companyId:input.companyId,actorUserId:input.actorUserId,permissionAnyOf:input.environment==='test'?['communication.write','ediel_testing.write']:['communication.write']})
 const {data,error}=await supabaseService.rpc('ediel_read_prodat_common_header_rejection_v1',{p_company_id:input.companyId,p_environment:input.environment,p_source_message_id:input.sourceMessageId})
 if(error)throw Error('ediel_common_header_rejection_basis_required',{cause:error})
 return decode(data,input)
}
export async function prepareProdatCommonHeaderNegativeAckWitness(input:{evidence:ProdatCommonHeaderRejectionEvidence;actorUserId:string;rawPayload:string;route:ProdatCommonHeaderNegativeAckRoute}){
 const e=prodatCommonHeaderRejectionQualification({evidence:input.evidence,companyId:input.evidence.companyId,environment:input.evidence.environment})
 const route=e?prodatCommonHeaderNegativeAckRouteQualification(input.route,e):null
 if(!e||!route)throw Error('ediel_common_header_rejection_basis_required')
 await assertEdielTenantActor({companyId:e.companyId,actorUserId:input.actorUserId,permissionAnyOf:e.environment==='test'?['communication.write','ediel_testing.write']:['communication.write']})
 const {data,error}=await supabaseService.rpc('ediel_prepare_common_header_negative_ack_v2',{p_company_id:e.companyId,p_environment:e.environment,p_source_message_id:e.sourceMessageId,p_actor_user_id:input.actorUserId,p_raw_payload:input.rawPayload,p_smtp_from:route.senderEmail,p_smtp_host:route.smtpHost,p_smtp_port:route.smtpPort})
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
