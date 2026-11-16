import {createHash} from 'node:crypto'
import {z} from 'zod'
import {createSupabaseServerClient} from '@/lib/supabase/server'

import {decisionEvidenceClasses,type DecisionEvidenceClass} from './decisionEvidenceClasses'
export {decisionEvidenceClasses,decisionEvidencePermission,type DecisionEvidenceClass} from './decisionEvidenceClasses'
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),kind=z.enum(decisionEvidenceClasses)
const reason=z.string().trim().min(1).max(4000)
const mutation=z.union([
 z.object({status:z.literal('submitted'),policyId:uuid,retentionClass:kind,targetId:uuid,documentHash:hash,sourceHash:hash,issuerQualified:z.boolean()}),
 z.object({status:z.enum(['approved','held','rejected']),policyId:uuid.optional(),reviewId:uuid.optional(),missing:z.array(z.string()).optional()}),
 z.object({status:z.literal('purged'),retentionClass:kind,targetId:uuid,sourceHash:hash,byteLength:z.number().int().positive(),bytesAvailable:z.literal(false),authority:z.literal('none'),replay:z.boolean()}),
])
const purgeResult=z.union([
 z.object({status:z.literal('disposed'),replay:z.boolean(),authority:z.literal('none')}).strict(),
 z.object({status:z.literal('expired'),authority:z.literal('none')}).strict(),
 z.object({status:z.literal('purged'),replay:z.literal(true),authority:z.literal('none')}).strict(),
 z.object({status:z.literal('unavailable'),authority:z.literal('none')}).strict(),
 z.object({status:z.literal('purged'),retentionClass:kind,targetId:uuid,sourceHash:hash,byteLength:z.number().int().positive(),bytesAvailable:z.literal(false),authority:z.literal('none'),replay:z.boolean()}).strict(),
 z.object({status:z.literal('held'),policyId:uuid,missing:z.array(z.string()).min(1)}).strict(),
])
export const decisionOriginalSchema=z.object({companyId:uuid,retentionClass:kind,targetId:uuid,targetMetadataHash:hash,documentHash:hash,documentByteLength:z.number().int().positive(),bytesAvailable:z.boolean(),documentBase64:z.string().nullable(),purgedAt:z.string().nullable(),authority:z.literal('none')})
export const decisionPolicySchema=z.object({companyId:uuid,policyId:uuid,retentionClass:kind,targetId:uuid,sourceHash:hash,targetMetadataHash:hash,documentHash:hash,documentByteLength:z.number().int().positive(),bytesAvailable:z.boolean(),documentPurgedAt:z.string().nullable(),documentBase64:z.string().nullable(),submittedBy:uuid,createdAt:z.string(),issuerQualified:z.boolean(),currentQualified:z.boolean(),revoked:z.boolean(),reviews:z.array(z.object({reviewId:uuid,actorUserId:uuid,outcome:z.enum(['approved','held','rejected']),reason:z.string(),createdAt:z.string()})),purge:z.object({purgedAt:z.string(),sourceHash:hash,byteLength:z.number().int().positive()}).nullable(),authority:z.literal('none')})
async function session(companyId:string){
 uuid.parse(companyId)
 const client=await createSupabaseServerClient(),auth=await client.auth.getUser()
 if(auth.error||!auth.data.user||auth.data.user.user_metadata?.must_change_password===true)throw Error('decision_evidence_authenticated_actor_required')
 return {client,actor:uuid.parse(auth.data.user.id)}
}
async function call(name:string,companyId:string,args:Record<string,unknown>){
 const {client,actor}=await session(companyId),{data,error}=await client.rpc(name,{p_company_id:companyId,p_actor_user_id:actor,...args})
 if(error)throw error
 return data
}
/** This is actual archive intake, never issuer/approval supplied by a caller.
 * The native owner hashes bytes and locks current own class/actor authority. */
export async function submitDecisionEvidenceRetention(input:{companyId:string;retentionClass:DecisionEvidenceClass;targetId:string;document:Buffer;issuerReceipt:Record<string,unknown>|null}){
 kind.parse(input.retentionClass);uuid.parse(input.targetId)
 if(!Buffer.isBuffer(input.document)||input.document.length<1||input.document.length>1048576)throw Error('decision_evidence_document_limit')
 const result=mutation.parse(await call('ediel_submit_decision_evidence_retention_v1',input.companyId,{p_retention_class:input.retentionClass,p_target_id:input.targetId,p_document_base64:input.document.toString('base64'),p_issuer_receipt:input.issuerReceipt}))
 if(result.status!=='submitted'||result.retentionClass!==input.retentionClass||result.targetId!==input.targetId||result.documentHash!==createHash('sha256').update(input.document).digest('hex'))throw Error('decision_evidence_submit_scope_mismatch')
 return result
}
export async function reviewDecisionEvidenceRetention(input:{companyId:string;policyId:string;outcome:'approve'|'hold'|'reject';reason:string}){
 uuid.parse(input.policyId);z.enum(['approve','hold','reject']).parse(input.outcome);reason.parse(input.reason)
 const result=mutation.parse(await call('ediel_review_decision_evidence_retention_v1',input.companyId,{p_policy_id:input.policyId,p_outcome:input.outcome,p_reason:input.reason}))
 if(!['approved','held','rejected'].includes(result.status)||('policyId' in result&&result.policyId!==input.policyId))throw Error('decision_evidence_review_scope_mismatch')
 return result
}
export async function revokeDecisionEvidenceRetention(input:{companyId:string;policyId:string;reason:string}){uuid.parse(input.policyId);reason.parse(input.reason);await call('ediel_revoke_decision_evidence_retention_v1',input.companyId,{p_policy_id:input.policyId,p_reason:input.reason})}
/** Revocation, current separate review, exact signed deadline and byte erasure
 * share one native transaction. A durable replay is historical, not approval. */
export async function purgeDecisionEvidenceRetention(input:{companyId:string;policyId:string}){
 uuid.parse(input.policyId)
 const parsed=purgeResult.safeParse(await call('ediel_purge_decision_evidence_retention_v1',input.companyId,{p_policy_id:input.policyId}))
 if(!parsed.success)throw Error('decision_evidence_purge_result_invalid')
 const result=parsed.data
 if(result.status==='held'&&result.policyId!==input.policyId)throw Error('decision_evidence_purge_scope_mismatch')
 return result
}
function verifyBytes(value:{documentHash:string;documentByteLength:number;documentBase64:string|null;bytesAvailable:boolean},requested:boolean){
 if(!value.bytesAvailable){if(value.documentBase64!==null)throw Error('decision_evidence_tombstone_bytes_present');return}
 if(!requested){if(value.documentBase64!==null)throw Error('decision_evidence_unrequested_bytes');return}
 if(!value.documentBase64)throw Error('decision_evidence_original_unavailable')
 const bytes=Buffer.from(value.documentBase64,'base64')
 if(bytes.toString('base64')!==value.documentBase64||bytes.length!==value.documentByteLength||createHash('sha256').update(bytes).digest('hex')!==value.documentHash)throw Error('decision_evidence_original_hash_mismatch')
}
export async function readRetentionDecisionOriginal(input:{companyId:string;retentionClass:DecisionEvidenceClass;targetId:string;includeDocument?:boolean}){
 kind.parse(input.retentionClass);uuid.parse(input.targetId)
 const includeDocument=input.includeDocument===true,result=decisionOriginalSchema.parse(await call('ediel_read_retention_decision_original_v1',input.companyId,{p_retention_class:input.retentionClass,p_target_id:input.targetId,p_include_document:includeDocument}))
 if(result.companyId!==input.companyId||result.retentionClass!==input.retentionClass||result.targetId!==input.targetId||!result.bytesAvailable&&result.purgedAt===null)throw Error('decision_evidence_original_scope_mismatch')
 verifyBytes(result,includeDocument);return result
}
export async function readDecisionEvidencePolicy(input:{companyId:string;policyId:string;includeDocument?:boolean}){
 uuid.parse(input.policyId)
 const includeDocument=input.includeDocument===true,result=decisionPolicySchema.parse(await call('ediel_read_decision_evidence_policy_v1',input.companyId,{p_policy_id:input.policyId,p_include_document:includeDocument}))
 if(result.companyId!==input.companyId||result.policyId!==input.policyId)throw Error('decision_evidence_policy_scope_mismatch')
 verifyBytes(result,includeDocument);return result
}

/** A fresh signed physical-disposition bundle is independent of legacy review. */
export async function reviewCompletedWitnessDisposition(input:{companyId:string;policyId:string;outcome:'approve'|'revoke';issuerReceipt:Record<string,unknown>|null}){
 uuid.parse(input.policyId);z.enum(['approve','revoke']).parse(input.outcome)
 const result=z.object({status:z.enum(['approved','revoked']),authority:z.literal('none')}).strict().parse(await call('ediel_review_completed_witness_disposition_v1',input.companyId,{p_policy_id:input.policyId,p_outcome:input.outcome,p_receipt:input.issuerReceipt}))
 if(result.status!==(input.outcome==='approve'?'approved':'revoked'))throw Error('completed_witness_review_result_invalid')
 return result
}
const workerResult=z.object({scanned:z.number().int().min(0).max(100),disposed:z.number().int().min(0).max(100),expired:z.number().int().min(0).max(100),clearedApprovals:z.number().int().min(0).max(100),held:z.number().int().min(0).max(100),authority:z.literal('none')}).strict()
/** Uses the existing validated cron actor; never creates an auth.uid session. */
export async function advanceCompletedWitnessDisposition(input:{actorUserId:string;limit:number}){
 uuid.parse(input.actorUserId);z.number().int().min(1).max(100).parse(input.limit)
 const {supabaseService}=await import('@/lib/supabase/service')
 const rpc=supabaseService.rpc.bind(supabaseService) as unknown as (name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>
 const {data,error}=await rpc('ediel_advance_completed_witness_disposition_v1',{p_actor_user_id:input.actorUserId,p_limit:input.limit})
 if(error)throw Error('completed_witness_worker_failed')
 return workerResult.parse(data)
}

/** Signed external input is validated without constructing issuer/policy facts. */
export const completedParentReceiptSchema=z.object({issuerId:uuid,payloadBase64:z.string().min(4).max(65536).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),signatureHex:hash}).strict()
const parentPurposeAdmission=z.object({status:z.literal('purpose_admitted'),version:z.number().int().positive().max(999999999),authority:z.literal('none')}).strict()
export const completedParentPurposeStatusSchema=z.union([
 z.object({status:z.literal('unavailable'),authority:z.literal('none')}).strict(),
 z.object({status:z.enum(['active','ordinary_use_ended','POLICY_REVIEW_OVERDUE','POLICY_OVERDUE']),disposed:z.literal(false),authority:z.literal('none')}).strict(),
])
const parentApproval=z.object({status:z.literal('approved'),authority:z.literal('none')}).strict()
const parentDisposition=z.union([
 z.object({status:z.literal('disposed'),replay:z.literal(false),authority:z.literal('none')}).strict(),
 z.object({status:z.enum(['held','unavailable']),authority:z.literal('none')}).strict(),
])
export async function admitCompletedParentPurpose(input:{companyId:string;policyId:string;issuerReceipt:Record<string,unknown>}){
 uuid.parse(input.policyId);completedParentReceiptSchema.parse(input.issuerReceipt)
 return parentPurposeAdmission.parse(await call('ediel_admit_completed_parent_purpose_v1',input.companyId,{p_policy_id:input.policyId,p_receipt:input.issuerReceipt}))
}
export async function readCompletedParentPurposeStatus(input:{companyId:string;policyId:string}){
 uuid.parse(input.policyId)
 return completedParentPurposeStatusSchema.parse(await call('ediel_completed_parent_purpose_status_v1',input.companyId,{p_policy_id:input.policyId}))
}
export async function reviewCompletedParentDisposition(input:{companyId:string;policyId:string;issuerReceipt:Record<string,unknown>}){
 uuid.parse(input.policyId);completedParentReceiptSchema.parse(input.issuerReceipt)
 return parentApproval.parse(await call('ediel_review_completed_parent_v1',input.companyId,{p_policy_id:input.policyId,p_receipt:input.issuerReceipt}))
}
export async function disposeCompletedParent(input:{companyId:string;policyId:string}){
 uuid.parse(input.policyId)
 return parentDisposition.parse(await call('ediel_dispose_completed_parent_v1',input.companyId,{p_policy_id:input.policyId}))
}
const parentWorkerResult=z.object({scanned:z.number().int().min(0).max(100),disposed:z.number().int().min(0).max(100),clearedApprovals:z.number().int().min(0).max(100),held:z.number().int().min(0).max(100)}).strict()
/** Reuses the validated service actor; only safe schema codes survive errors. */
export async function advanceCompletedParent(input:{actorUserId:string;limit:number}){
 uuid.parse(input.actorUserId);z.number().int().min(1).max(100).parse(input.limit)
 const {supabaseService}=await import('@/lib/supabase/service')
 const rpc=supabaseService.rpc.bind(supabaseService) as unknown as (name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>
 const {data,error}=await rpc('ediel_advance_completed_parent_v1',{p_actor_user_id:input.actorUserId,p_limit:input.limit})
 if(error){
  const code=(error as {code?:unknown}).code
  throw Object.assign(Error('completed_parent_worker_failed'),typeof code==='string'&&['PGRST202','PGRST205','42883','42P01','3F000'].includes(code)?{code}:{})
 }
 return parentWorkerResult.parse(data)
}
