import {createHash} from 'node:crypto'
import {z} from 'zod'
import {supabaseService} from '@/lib/supabase/service'

export const EDIEL_SERVICE_EVIDENCE_MAX_BYTES=8*1024*1024
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),version=z.number().int().positive().safe()
const date=z.string().datetime({offset:true})
const terms=z.object({valid_from:date,valid_to:date.nullable(),permission_agreement_reference:z.string().min(1).max(35).refine(value=>value===value.trim()).nullable().optional(),permission_requested_method:z.enum(['Z03','Z04']).nullable().optional(),permission_purpose_code:z.enum(['B71','B72','B73','B74','B75','B76']).nullable().optional(),permission_reporting_frequency:z.string().max(35).nullable().optional(),permission_request_grid_area:z.string().max(35).nullable().optional(),permission_reporting_term_kind:z.enum(['bounded','indefinite']).nullable().optional(),permission_customer_classification:z.enum(['private','nonprivate']).nullable().optional(),permission_termination_reason:z.enum(['B77','B78','B79','B80','E37']).nullable().optional(),permission_termination_at:date.nullable().optional()}).strict()
const kinds=z.enum(['end_user_contract','dso_contract','service_contract','downstream_use','privacy_roles','transport_mandate'])
export const serviceEvidenceArchiveSchema=z.object({assignmentId:uuid,scopeBasisVersion:version,kind:kinds,terms,
 source:z.object({bytesBase64:z.string().min(1).max(12*1024*1024),mimeType:z.literal('application/pdf'),reference:z.string().min(1).max(2000),version:z.string().min(1).max(200)}).strict(),
 issuerReceipt:z.object({keyId:uuid,representationId:uuid,payloadBase64:z.string().min(1).max(65536),signatureHex:hash}).strict().optional(),
 transportRelationId:uuid.nullable().optional(),transportActorId:uuid.nullable().optional(),
}).strict()
export const serviceEvidenceReviewSchema=z.object({decision:z.enum(['approve','hold','reject']),reason:z.string().trim().min(1).max(2000),sourceHash:hash,scopeHash:hash}).strict()
export type ServiceEvidenceArchiveSubmission=z.infer<typeof serviceEvidenceArchiveSchema>
export type ServiceEvidenceReviewCommand=z.infer<typeof serviceEvidenceReviewSchema>
type Scope={companyId:string;actorUserId:string}
type Rpc=(name:string,params:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
const call=(name:string,params:Record<string,unknown>)=>(supabaseService.rpc.bind(supabaseService) as unknown as Rpc)(name,params)
const archiveResult=z.object({status:z.literal('archived'),companyId:uuid,assignmentId:uuid,artifactId:uuid,sourceHash:hash,scopeHash:hash,scopeBasisVersion:version,missing:z.array(z.string())})
const reviewResult=z.object({status:z.enum(['verified','held','rejected']),companyId:uuid,reviewId:uuid,reviewSequence:version,artifactId:uuid,evidenceId:uuid,scopeBasisVersion:version,missing:z.array(z.string()),marketActivationGranted:z.literal(false)})
const readResult=z.object({artifactId:uuid,companyId:uuid,assignmentId:uuid,scopeBasisVersion:version,kind:kinds,mimeType:z.literal('application/pdf'),sourceHash:hash,sourceReference:z.string(),sourceVersion:z.string(),scopeHash:hash,scope:z.record(z.string(),z.unknown()),evidenceTerms:z.record(z.string(),z.unknown()),byteLength:version,issuerCurrent:z.boolean(),reviewStatus:z.enum(['unreviewed','approved','held','rejected']),marketActivationGranted:z.literal(false),bytesBase64:z.string().optional()})
export type ArchivedServiceEvidence=z.infer<typeof archiveResult>
export type ReviewedServiceEvidence=z.infer<typeof reviewResult>
export type ServiceEvidenceArchive=z.infer<typeof readResult>
function scope(input:Scope){uuid.parse(input.companyId);uuid.parse(input.actorUserId)}
function decodePdf(base64:string){const bytes=Buffer.from(base64,'base64');if(bytes.length<5||bytes.length>EDIEL_SERVICE_EVIDENCE_MAX_BYTES||bytes.toString('base64')!==base64||bytes.subarray(0,5).toString('ascii')!=='%PDF-')throw Error('ediel_service_archive_bytes_invalid');return bytes}
/** Custody is separate from issuer authority and reviewer approval. Native SQL
 * rereads actual current scope and authenticates the detached issuer receipt. */
export async function archiveEdielServiceEvidence(input:Scope&{submission:unknown}):Promise<ArchivedServiceEvidence>{
 scope(input);const submission=serviceEvidenceArchiveSchema.parse(input.submission),bytes=decodePdf(submission.source.bytesBase64)
 const {data,error}=await call('ediel_archive_service_evidence_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_submission:submission});if(error)throw error
 const r=archiveResult.parse(data);if(r.companyId!==input.companyId||r.assignmentId!==submission.assignmentId||r.scopeBasisVersion!==submission.scopeBasisVersion||r.sourceHash!==createHash('sha256').update(bytes).digest('hex'))throw Error('ediel_service_archive_actual_scope_mismatch');return r
}
/** Native authority requires an explicit current company grant for the separate
 * reviewer; body booleans and platform administrator inheritance cannot approve. */
export async function reviewEdielServiceEvidence(input:Scope&{artifactId:string;evidenceId:string;review:unknown}):Promise<ReviewedServiceEvidence>{
 scope(input);uuid.parse(input.artifactId);uuid.parse(input.evidenceId);const review=serviceEvidenceReviewSchema.parse(input.review)
 const {data,error}=await call('ediel_review_service_evidence_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_artifact_id:input.artifactId,p_evidence_id:input.evidenceId,p_review:review});if(error)throw error
 const r=reviewResult.parse(data);if(r.companyId!==input.companyId||r.artifactId!==input.artifactId||r.evidenceId!==input.evidenceId)throw Error('ediel_service_review_actual_scope_mismatch');return r
}
export async function readEdielServiceEvidenceArchive(input:Scope&{artifactId:string}):Promise<ServiceEvidenceArchive>{
 scope(input);uuid.parse(input.artifactId);const {data,error}=await call('ediel_read_service_evidence_archive_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_artifact_id:input.artifactId,p_include_bytes:false});if(error)throw error
 const r=readResult.parse(data);if(r.companyId!==input.companyId||r.artifactId!==input.artifactId||r.bytesBase64!==undefined)throw Error('ediel_service_archive_read_scope_mismatch');return r
}
export async function readEdielServiceEvidenceBytes(input:Scope&{artifactId:string}):Promise<{mimeType:'application/pdf';bytes:Uint8Array;sourceHash:string}>{
 scope(input);uuid.parse(input.artifactId);const {data,error}=await call('ediel_read_service_evidence_archive_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_artifact_id:input.artifactId,p_include_bytes:true});if(error)throw error
 const r=readResult.parse(data);if(r.companyId!==input.companyId||r.artifactId!==input.artifactId||r.bytesBase64===undefined)throw Error('ediel_service_archive_read_scope_mismatch')
 const bytes=decodePdf(r.bytesBase64);if(bytes.length!==r.byteLength||createHash('sha256').update(bytes).digest('hex')!==r.sourceHash)throw Error('ediel_service_archive_bytes_integrity_mismatch');return{mimeType:r.mimeType,bytes,sourceHash:r.sourceHash}
}
