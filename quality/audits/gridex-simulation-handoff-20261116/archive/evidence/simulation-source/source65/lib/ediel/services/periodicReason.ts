import {z} from 'zod'
import {supabaseService} from '@/lib/supabase/service'
import {serviceEvidenceReviewSchema} from '@/lib/ediel/services/evidenceReview'
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/)
const result=z.object({version:z.literal(1),reviewId:uuid,companyId:uuid,artifactId:uuid,evidenceId:uuid,reviewSequence:z.number().int().positive().safe(),status:z.enum(['approved','held','rejected']),claimsHash:hash,reasonCode:z.enum(['E23','E88']),marketActivationGranted:z.literal(false)}).strict()
/** The reason comes from an authenticated archived contract payload, never
 * the review command. Native current reviewer/scope/representation gates apply. */
export async function reviewPeriodicDgiE66Reason(input:{companyId:string;actorUserId:string;artifactId:string;evidenceId:string;review:unknown}){
 for(const id of [input.companyId,input.actorUserId,input.artifactId,input.evidenceId])uuid.parse(id)
 const review=serviceEvidenceReviewSchema.parse(input.review)
 const {data,error}=await supabaseService.rpc('ediel_review_periodic_e66_reason_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_artifact_id:input.artifactId,p_evidence_id:input.evidenceId,p_review:review})
 if(error)throw error
 const receipt=result.parse(data)
 if(receipt.companyId!==input.companyId||receipt.artifactId!==input.artifactId||receipt.evidenceId!==input.evidenceId)throw Error('ediel_periodic_reason_review_actual_scope_mismatch')
 return receipt
}
