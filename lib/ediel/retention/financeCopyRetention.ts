import 'server-only'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
import {FINANCE_COPY_CATALOG,FINANCE_COPY_CLASSES,type FinanceCopyClass} from './financeCopies.catalog'
export {FINANCE_COPY_CATALOG,FINANCE_COPY_CLASSES,type FinanceCopyClass}
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/)
export const financeRetentionSelector=z.object({retentionClass:z.enum(FINANCE_COPY_CLASSES),targetId:z.string().min(1).max(36)}).superRefine((value,ctx)=>{
 const valid=FINANCE_COPY_CATALOG.find(row=>row.retentionClass===value.retentionClass)?.idKind==='integer'?/^[1-9][0-9]{0,18}$/.test(value.targetId):uuid.safeParse(value.targetId).success
 if(!valid)ctx.addIssue({code:'custom',path:['targetId'],message:'Actual class target selector required'})
})
export const financeRetentionBasis=z.object({retentionClass:z.enum(FINANCE_COPY_CLASSES),targetId:z.string(),sourceTable:z.string(),bodyColumns:z.array(z.string()),periodStart:z.string(),periodEnd:z.string(),originalProducerHash:hash.nullable(),sourceBound:z.boolean(),sourceHash:hash,targetHash:hash,scopeHash:hash,byteLength:z.number().int().positive(),includedCustomers:z.array(uuid),allIncludedScopesClosed:z.boolean(),complete:z.literal(false),authority:z.literal('none')})
const receipt=z.union([
 z.object({status:z.literal('submitted'),decisionId:uuid,retentionClass:z.enum(FINANCE_COPY_CLASSES),targetId:z.string(),sourceHash:hash,targetHash:hash,scopeHash:hash,documentHash:hash,issuerQualified:z.boolean()}),
 z.object({status:z.enum(['approved','held','rejected']),decisionId:uuid.optional(),reviewId:uuid.optional(),missing:z.array(z.string()).optional()}),
 z.object({status:z.literal('redacted'),retentionClass:z.enum(FINANCE_COPY_CLASSES),targetId:z.string(),sourceHash:hash,byteLength:z.number().int().positive(),replay:z.boolean()}),
])
export async function financeRetentionCall(companyId:string,name:string,args:Record<string,unknown>){
 uuid.parse(companyId)
 const client=await createSupabaseServerClient(),auth=await client.auth.getUser()
 if(auth.error||!auth.data.user)throw Error('finance_retention_authenticated_actor_required')
 const reply=await client.rpc(name,{p_company_id:companyId,p_actor_user_id:auth.data.user.id,...args})
 if(reply.error)throw reply.error
 return reply.data
}
export async function inspectFinanceCopyRetention(input:{companyId:string;retentionClass:FinanceCopyClass;targetId:string}){
 const selector=financeRetentionSelector.parse(input)
 const basis=financeRetentionBasis.parse(await financeRetentionCall(input.companyId,'ediel_finance_copy_retention_basis_v1',{p_retention_class:selector.retentionClass,p_target_id:selector.targetId}))
 if(basis.retentionClass!==selector.retentionClass||basis.targetId!==selector.targetId)throw Error('finance_retention_native_source_binding_changed')
 return basis
}
export async function submitFinanceCopyRetention(input:{companyId:string;retentionClass:FinanceCopyClass;targetId:string;document:Buffer;issuerReceipt:Record<string,unknown>|null}){
 const selector=financeRetentionSelector.parse(input)
 if(!Buffer.isBuffer(input.document)||input.document.length<1||input.document.length>1048576)throw Error('finance_retention_document_limit')
 return receipt.parse(await financeRetentionCall(input.companyId,'ediel_submit_finance_copy_retention_v1',{p_retention_class:selector.retentionClass,p_target_id:selector.targetId,p_document_base64:input.document.toString('base64'),p_issuer_receipt:input.issuerReceipt}))
}
export async function reviewFinanceCopyRetention(input:{companyId:string;decisionId:string;outcome:'approve'|'hold'|'reject';reason:string}){
 uuid.parse(input.decisionId);z.enum(['approve','hold','reject']).parse(input.outcome);z.string().trim().min(1).max(4000).parse(input.reason)
 return receipt.parse(await financeRetentionCall(input.companyId,'ediel_review_finance_copy_retention_v1',{p_decision_id:input.decisionId,p_outcome:input.outcome,p_reason:input.reason}))
}
export async function purgeFinanceCopyRetention(input:{companyId:string;decisionId:string}){
 uuid.parse(input.decisionId)
 return receipt.parse(await financeRetentionCall(input.companyId,'ediel_purge_finance_copy_retention_v1',{p_decision_id:input.decisionId}))
}
/** Exact actual stored target only: this negative gate issues no business,
 * legal, completeness, provider, or historical byte-availability authority. */
export async function requireFinanceCopyAvailable(input:{companyId:string;retentionClass:FinanceCopyClass;targetId:string}){
 uuid.parse(input.companyId);const selector=financeRetentionSelector.parse(input)
 const reply=await supabaseService.rpc('ediel_require_finance_copy_available_v1',{p_company_id:input.companyId,p_retention_class:selector.retentionClass,p_target_id:selector.targetId})
 if(reply.error)throw reply.error
}

export async function requireInvoiceSourceCopiesAvailable(input:{companyId:string;underlayId:string|null;invoiceId?:string|null;exportItemId?:string|null}){
 uuid.parse(input.companyId);for(const id of [input.underlayId,input.invoiceId,input.exportItemId])if(id)uuid.parse(id)
 const reply=await supabaseService.rpc('ediel_require_invoice_source_copies_available_v1',{p_company_id:input.companyId,p_underlay_id:input.underlayId,p_invoice_id:input.invoiceId??null,p_export_item_id:input.exportItemId??null});if(reply.error)throw reply.error
}
