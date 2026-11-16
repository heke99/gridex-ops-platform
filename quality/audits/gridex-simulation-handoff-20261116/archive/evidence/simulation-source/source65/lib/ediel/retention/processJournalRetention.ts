import 'server-only'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
export const PROCESS_JOURNAL_RETENTION_CLASSES=['correction_process_fact_body','correction_process_readset_body','correction_process_combined_readset_body'] as const
export type ProcessJournalRetentionClass=typeof PROCESS_JOURNAL_RETENTION_CLASSES[number]
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/)
export const processRetentionSelector=z.object({retentionClass:z.enum(PROCESS_JOURNAL_RETENTION_CLASSES),targetId:z.string().min(1).max(36)}).superRefine((value,ctx)=>{
 const valid=value.retentionClass==='correction_process_fact_body'?/^[1-9][0-9]{0,18}$/.test(value.targetId):uuid.safeParse(value.targetId).success
 if(!valid)ctx.addIssue({code:'custom',path:['targetId'],message:'Actual class target selector required'})
})
export const processRetentionBasis=z.object({retentionClass:z.enum(PROCESS_JOURNAL_RETENTION_CLASSES),targetId:z.string(),sourceTable:z.enum(['facts','readsets','combined_snapshots']),sourceHash:hash,targetHash:hash,scopeHash:hash,byteLength:z.number().int().positive(),includedCustomers:z.array(uuid),allIncludedScopesClosed:z.boolean(),unknownScopeExpandedToCompany:z.boolean(),complete:z.literal(false),authority:z.literal('none')})
const receipt=z.union([
 z.object({status:z.literal('submitted'),decisionId:uuid,retentionClass:z.enum(PROCESS_JOURNAL_RETENTION_CLASSES),targetId:z.string(),sourceHash:hash,targetHash:hash,scopeHash:hash,documentHash:hash,issuerQualified:z.boolean()}),
 z.object({status:z.enum(['approved','held','rejected']),decisionId:uuid.optional(),reviewId:uuid.optional(),missing:z.array(z.string()).optional()}),
 z.object({status:z.literal('redacted'),retentionClass:z.enum(PROCESS_JOURNAL_RETENTION_CLASSES),targetId:z.string(),sourceHash:hash,byteLength:z.number().int().positive(),replay:z.boolean()}),
])
export async function processRetentionCall(companyId:string,name:string,args:Record<string,unknown>){
 uuid.parse(companyId)
 const client=await createSupabaseServerClient(),auth=await client.auth.getUser()
 if(auth.error||!auth.data.user)throw Error('process_retention_authenticated_actor_required')
 const reply=await client.rpc(name,{p_company_id:companyId,p_actor_user_id:auth.data.user.id,...args})
 if(reply.error)throw reply.error
 return reply.data
}
export async function inspectProcessJournalRetention(input:{companyId:string;retentionClass:ProcessJournalRetentionClass;targetId:string}){
 const selector=processRetentionSelector.parse(input)
 const basis=processRetentionBasis.parse(await processRetentionCall(input.companyId,'ediel_process_journal_retention_basis_v1',{p_retention_class:selector.retentionClass,p_target_id:selector.targetId}))
 if(basis.retentionClass!==selector.retentionClass||basis.targetId!==selector.targetId)throw Error('process_retention_native_source_binding_changed')
 return basis
}
export async function submitProcessJournalRetention(input:{companyId:string;retentionClass:ProcessJournalRetentionClass;targetId:string;document:Buffer;issuerReceipt:Record<string,unknown>|null}){
 const selector=processRetentionSelector.parse(input)
 if(!Buffer.isBuffer(input.document)||input.document.length<1||input.document.length>1048576)throw Error('process_retention_document_limit')
 return receipt.parse(await processRetentionCall(input.companyId,'ediel_submit_process_journal_retention_v1',{p_retention_class:selector.retentionClass,p_target_id:selector.targetId,p_document_base64:input.document.toString('base64'),p_issuer_receipt:input.issuerReceipt}))
}
export async function reviewProcessJournalRetention(input:{companyId:string;decisionId:string;outcome:'approve'|'hold'|'reject';reason:string}){
 uuid.parse(input.decisionId);z.enum(['approve','hold','reject']).parse(input.outcome);z.string().trim().min(1).max(4000).parse(input.reason)
 return receipt.parse(await processRetentionCall(input.companyId,'ediel_review_process_journal_retention_v1',{p_decision_id:input.decisionId,p_outcome:input.outcome,p_reason:input.reason}))
}
export async function purgeProcessJournalRetention(input:{companyId:string;decisionId:string}){
 uuid.parse(input.decisionId)
 return receipt.parse(await processRetentionCall(input.companyId,'ediel_purge_process_journal_retention_v1',{p_decision_id:input.decisionId}))
}
/** Exact actual stored target only: this negative gate issues no business,
 * legal, completeness, provider, or historical byte-availability authority. */
export async function requireProcessJournalAvailable(input:{companyId:string;retentionClass:ProcessJournalRetentionClass;targetId:string}){
 uuid.parse(input.companyId);const selector=processRetentionSelector.parse(input)
 const reply=await supabaseService.rpc('ediel_require_process_journal_available_v1',{p_company_id:input.companyId,p_retention_class:selector.retentionClass,p_target_id:selector.targetId})
 if(reply.error)throw reply.error
}
