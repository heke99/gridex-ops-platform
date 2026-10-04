import {createSupabaseServerClient} from '@/lib/supabase/server'
import {z} from 'zod'
const uuid=z.string().uuid()
const result=z.union([
 z.object({status:z.literal('submitted'),decisionId:uuid,documentHash:z.string().regex(/^[a-f0-9]{64}$/),sourceHash:z.string().regex(/^[a-f0-9]{64}$/),issuerQualified:z.boolean()}),
 z.object({status:z.enum(['approved','held','rejected']),decisionId:uuid.optional(),reviewId:uuid.optional(),missing:z.array(z.string()).optional()}),
 z.object({status:z.literal('purged'),artifactId:uuid,sourceHash:z.string().regex(/^[a-f0-9]{64}$/),byteLength:z.number().int().positive(),purgedAt:z.string().datetime({offset:true}),replay:z.boolean()}),
])
/** This port preserves the actual authenticated JWT. The native owner repeats
 * and locks the current company/grant, issuer, review and artifact checks.
 * A service-role caller cannot nominate another user as retention authority. */
async function call(name:string,companyId:string,args:Record<string,unknown>){
 uuid.parse(companyId)
 const client=await createSupabaseServerClient()
 const {data:{user},error:authError}=await client.auth.getUser()
 if(authError||!user)throw Error('ediel_retention_authenticated_actor_required')
 const {data,error}=await client.rpc(name,{p_company_id:companyId,p_actor_user_id:user.id,...args})
 if(error)throw error
 return data
}
export async function submitArtifactRetention(input:{companyId:string;artifactId:string;document:Buffer;issuerReceipt:Record<string,unknown>|null}){
 uuid.parse(input.artifactId)
 if(!Buffer.isBuffer(input.document)||input.document.length<1||input.document.length>1048576)throw Error('ediel_retention_document_limit')
 return result.parse(await call('ediel_submit_artifact_retention_v1',input.companyId,{p_artifact_id:input.artifactId,p_document_base64:input.document.toString('base64'),p_issuer_receipt:input.issuerReceipt}))
}
export async function reviewArtifactRetention(input:{companyId:string;decisionId:string;outcome:'approve'|'hold'|'reject';reason:string}){
 uuid.parse(input.decisionId);z.enum(['approve','hold','reject']).parse(input.outcome);z.string().min(1).max(4000).parse(input.reason)
 return result.parse(await call('ediel_review_artifact_retention_v1',input.companyId,{p_decision_id:input.decisionId,p_outcome:input.outcome,p_reason:input.reason}))
}
export async function revokeArtifactRetention(input:{companyId:string;decisionId:string;reason:string}){
 uuid.parse(input.decisionId);z.string().min(1).max(4000).parse(input.reason)
 await call('ediel_revoke_artifact_retention_v1',input.companyId,{p_decision_id:input.decisionId,p_reason:input.reason})
}
export async function purgeArtifactRetention(input:{companyId:string;decisionId:string}){
 uuid.parse(input.decisionId)
 return result.parse(await call('ediel_purge_artifact_retention_v1',input.companyId,{p_decision_id:input.decisionId}))
}
