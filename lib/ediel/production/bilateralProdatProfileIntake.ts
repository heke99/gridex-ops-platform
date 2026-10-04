import {createHash} from 'node:crypto'
import {supabaseService} from '@/lib/supabase/service'

export const BILATERAL_PRODAT_SOURCE_MAX_BYTES=8*1024*1024
export type BilateralProdatSelector={environment:'test'|'production';kind:'normal_start_h'|'own_end_h'|'closure_request_lk';rulePackId:string;bilateralAgreementId:string;gridAreaCode:string;validFrom:string;validTo:string}
export type BilateralProdatIssuerReceipt={keyId:string;representationId:string;payloadBase64:string;signatureHex:string}
export type BilateralProdatSubmission=BilateralProdatSelector&{source:{bytesBase64:string;mimeType:'application/pdf'|'text/plain'|'application/json';reference:string;version:string};issuerReceipt?:BilateralProdatIssuerReceipt}
export type BilateralProdatReview={sourceHash:string;scopeHash:string;decision:'approve'|'hold'|'reject';reason:string}
type Scope={companyId:string;actorUserId:string}
type ArtifactScope=Scope&{artifactId:string}
type Rpc=(name:string,params:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
const rpc=()=>supabaseService.rpc.bind(supabaseService) as unknown as Rpc
const object=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
function result(value:unknown,statuses:string[],input:Scope,artifactId?:string){const r=object(value)
 if(!r||!statuses.includes(String(r.status))||r.companyId!==input.companyId||artifactId&&r.artifactId!==artifactId
  ||!Array.isArray(r.missing)||r.missing.some(item=>typeof item!=='string'))throw Error('bilateral_prodat_intake_result_unqualified')
 return r
}
/** A selector is never legal ground. This native read derives the exact current
 * tenant/contract/customer/point/DSO/registry tuple that an actual issuer signs. */
export async function readBilateralProdatGroundScope(input:Scope&BilateralProdatSelector):Promise<Record<string,unknown>>{
 const {companyId,actorUserId,...selector}=input
 const {data,error}=await rpc()('ediel_bilateral_prodat_ground_scope_v1',{p_company_id:companyId,p_actor_user_id:actorUserId,p_selector:selector});if(error)throw error
 const r=result(data,['scoped','held'],input)
 if(r.status==='scoped'&&(!hash(r.scopeHash)||!object(r.scope)||object(r.scope)!.companyId!==input.companyId||object(r.scope)!.rulePackId!==input.rulePackId||object(r.scope)!.gridArea!==input.gridAreaCode||object(r.scope)!.bilateralAgreementId!==input.bilateralAgreementId||object(r.scope)!.environment!==input.environment||object(r.scope)!.kind!==input.kind))throw Error('bilateral_prodat_scope_result_unqualified')
 return r
}
/** Original bytes are archived independently of separate review and signature
 * qualification. No caller digest, approved flag or private ground is written. */
export async function archiveBilateralProdatGround(input:Scope&BilateralProdatSubmission):Promise<Record<string,unknown>>{
 const bytes=Buffer.from(input.source.bytesBase64,'base64')
 if(!bytes.length||bytes.length>BILATERAL_PRODAT_SOURCE_MAX_BYTES||bytes.toString('base64')!==input.source.bytesBase64)throw Error('bilateral_prodat_source_bytes_invalid')
 const {companyId,actorUserId,...submission}=input
 const {data,error}=await rpc()('ediel_archive_bilateral_prodat_ground_v1',{p_company_id:companyId,p_actor_user_id:actorUserId,p_submission:submission});if(error)throw error
 const r=result(data,['archived','held'],input)
 if(r.status==='archived'&&(!uuid(r.artifactId)||r.sourceHash!==createHash('sha256').update(bytes).digest('hex')||!hash(r.scopeHash)))throw Error('bilateral_prodat_archive_result_unqualified')
 return r
}
export async function readBilateralProdatGroundArtifact(input:ArtifactScope):Promise<Record<string,unknown>>{
 const {data,error}=await rpc()('ediel_read_bilateral_prodat_ground_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_artifact_id:input.artifactId,p_include_bytes:false});if(error)throw error
 const r=result(data,['archived','held','rejected','authorized'],input,input.artifactId)
 if('bytesBase64'in r||!hash(r.sourceHash)||!hash(r.scopeHash))throw Error('bilateral_prodat_artifact_result_unqualified')
 return r
}
export async function readBilateralProdatGroundBytes(input:ArtifactScope):Promise<{bytes:Uint8Array;mimeType:string;sourceHash:string}>{
 const {data,error}=await rpc()('ediel_read_bilateral_prodat_ground_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_artifact_id:input.artifactId,p_include_bytes:true});if(error)throw error
 const r=result(data,['archived','held','rejected','authorized'],input,input.artifactId)
 if(typeof r.bytesBase64!=='string'||!hash(r.sourceHash)||!['application/pdf','text/plain','application/json'].includes(String(r.mimeType)))throw Error('bilateral_prodat_artifact_bytes_unqualified')
 const bytes=Buffer.from(r.bytesBase64,'base64')
 if(bytes.length!==r.byteLength||!bytes.length||bytes.length>BILATERAL_PRODAT_SOURCE_MAX_BYTES||createHash('sha256').update(bytes).digest('hex')!==r.sourceHash)throw Error('bilateral_prodat_artifact_bytes_unqualified')
 return {bytes,mimeType:String(r.mimeType),sourceHash:r.sourceHash}
}
export async function reviewBilateralProdatGround(input:ArtifactScope&BilateralProdatReview):Promise<Record<string,unknown>>{
 const {companyId,actorUserId,artifactId,...review}=input
 const {data,error}=await rpc()('ediel_review_bilateral_prodat_ground_v1',{p_company_id:companyId,p_actor_user_id:actorUserId,p_artifact_id:artifactId,p_review:review});if(error)throw error
 const r=result(data,['authorized','held','rejected'],input,artifactId)
 if(r.status==='authorized'&&(!uuid(r.profileVersionId)||(r.missing as string[]).length!==0))throw Error('bilateral_prodat_review_result_unqualified')
 return r
}
