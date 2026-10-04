import {supabaseService} from '@/lib/supabase/service'
import {createHash} from 'node:crypto'
import type {RequestedChangeBasis} from './requestedChangeSource'
export const REQUESTED_CHANGE_SOURCE_MAX_BYTES=8*1024*1024
export type RequestedChangeSourceSubmission={supplyPeriodId:string;contractId:string;kind:'death'|'quarter_contract'|'method_contract';effectiveAt:string;source:{bytesBase64:string;mimeType:'application/pdf'|'text/plain'|'application/json';reference:string;version:string};customerIdentity:RequestedChangeBasis['customerIdentity'];invoiceeProfile:RequestedChangeBasis['invoiceeProfile'];issuerReceipt?:{keyId:string;representationId:string;payloadBase64:string;signatureHex:string}}
export type RequestedChangeReviewCommand={sourceHash:string;claimsHash:string;decision:'approve'|'hold'|'reject';reason:string;clause?:{locator:string;quote:string}}
/** The exact review command sent to the native owner. Callers may pass a wider
 * object (e.g. the archive result); its extra fields never reach the strict
 * native key set, which rejects unknown keys. */
export function requestedChangeReviewPayload(c:RequestedChangeReviewCommand):RequestedChangeReviewCommand{
 return {sourceHash:c.sourceHash,claimsHash:c.claimsHash,decision:c.decision,reason:c.reason,...(c.clause===undefined?{}:{clause:{locator:c.clause.locator,quote:c.clause.quote}})}
}
export type ArchivedRequestedChangeSource={status:'archived';artifactId:string;sourceHash:string;claimsHash:string;missing:string[]}
export type RequestedChangeReviewResult={status:'authorized';artifactId:string;eventId:string}|{status:'held'|'rejected';artifactId:string;missing:string[]}
export type RequestedChangeArtifact={artifactId:string;kind:RequestedChangeSourceSubmission['kind'];effectiveAt:string;sourceReference:string;sourceVersion:string;sourceHash:string;claimsHash:string;mimeType:RequestedChangeSourceSubmission['source']['mimeType'];byteLength:number;customerIdentity:RequestedChangeBasis['customerIdentity'];invoiceeProfile:RequestedChangeBasis['invoiceeProfile'];status:'archived'|'held'|'rejected'|'authorized';eventId:string|null;missing:string[]}
type Scope={companyId:string;actorUserId:string;artifactId:string}
type Rpc=(name:string,params:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
const rpc=()=>supabaseService.rpc.bind(supabaseService) as unknown as Rpc
const record=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null
function requireResult(data:unknown,statuses:string[]):Record<string,unknown>{const r=record(data);if(!r||!statuses.includes(String(r.status))||typeof r.artifactId!=='string')throw Error('requested_change_intake_result_invalid');return r}
export async function archiveRequestedChangeSource(input:RequestedChangeSourceSubmission&{companyId:string;actorUserId:string}):Promise<ArchivedRequestedChangeSource>{
 const source=input.source,bytes=Buffer.from(source.bytesBase64,'base64')
 if(!bytes.length||bytes.length>REQUESTED_CHANGE_SOURCE_MAX_BYTES||bytes.toString('base64')!==source.bytesBase64)throw Error('requested_change_source_bytes_invalid')
 const {companyId,actorUserId,...submission}=input
 const{data,error}=await rpc()('ediel_archive_requested_change_source_v1',{p_company_id:companyId,p_actor_user_id:actorUserId,p_submission:submission});if(error)throw error
 const r=requireResult(data,['archived']);if(typeof r.sourceHash!=='string'||typeof r.claimsHash!=='string'||!Array.isArray(r.missing))throw Error('requested_change_archive_result_invalid');return r as unknown as ArchivedRequestedChangeSource
}
async function read(input:Scope,bytes:boolean){const{data,error}=await rpc()('ediel_read_requested_change_artifact_v1',{p_company_id:input.companyId,p_artifact_id:input.artifactId,p_actor_user_id:input.actorUserId,p_include_bytes:bytes});if(error)throw error;const r=requireResult(data,['archived','held','rejected','authorized']);if(r.artifactId!==input.artifactId)throw Error('requested_change_artifact_scope_invalid');return r}
export async function readRequestedChangeArtifact(input:Scope):Promise<RequestedChangeArtifact>{const r=await read(input,false);if('bytesBase64'in r||typeof r.sourceHash!=='string'||typeof r.byteLength!=='number')throw Error('requested_change_artifact_result_invalid');return r as unknown as RequestedChangeArtifact}
export async function readRequestedChangeArtifactBytes(input:Scope):Promise<{mimeType:RequestedChangeArtifact['mimeType'];bytes:Uint8Array;sourceHash:string}>{const r=await read(input,true);if(typeof r.bytesBase64!=='string'||typeof r.sourceHash!=='string'||!['application/pdf','text/plain','application/json'].includes(String(r.mimeType)))throw Error('requested_change_artifact_bytes_invalid');const bytes=Buffer.from(r.bytesBase64,'base64');if(bytes.length!==r.byteLength||bytes.length>REQUESTED_CHANGE_SOURCE_MAX_BYTES||createHash('sha256').update(bytes).digest('hex')!==r.sourceHash)throw Error('requested_change_artifact_bytes_invalid');return{mimeType:r.mimeType as RequestedChangeArtifact['mimeType'],bytes,sourceHash:r.sourceHash}}
export async function reviewRequestedChangeArtifact(input:Scope&RequestedChangeReviewCommand):Promise<RequestedChangeReviewResult>{const{companyId,artifactId,actorUserId,...review}=input;const{data,error}=await rpc()('ediel_review_requested_change_artifact_v1',{p_company_id:companyId,p_artifact_id:artifactId,p_actor_user_id:actorUserId,p_review:requestedChangeReviewPayload(review)});if(error)throw error;const r=requireResult(data,['authorized','held','rejected']);if(r.artifactId!==artifactId||r.status==='authorized'&&typeof r.eventId!=='string'||r.status!=='authorized'&&!Array.isArray(r.missing))throw Error('requested_change_review_result_invalid');return r as unknown as RequestedChangeReviewResult}
