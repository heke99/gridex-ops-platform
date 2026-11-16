import 'server-only'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
import { CUSTOMER_RECORD_RETENTION_CLASSES, type CustomerRecordRetentionClass } from './recordClasses.catalog'

const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),retentionClass=z.enum(CUSTOMER_RECORD_RETENTION_CLASSES)
const result=z.union([
 z.object({status:z.literal('submitted'),decisionId:uuid,sourceHash:hash,targetHash:hash,documentHash:hash,retentionClass,issuerQualified:z.boolean()}),
 z.object({status:z.enum(['held','approved','rejected']),decisionId:uuid.optional(),reviewId:uuid.optional(),missing:z.array(z.string()).optional()}),
 z.object({status:z.enum(['redacted','storage_purge_pending','storage_object_absent']),retentionClass,targetId:uuid,sourceHash:hash,byteLength:z.number().int().positive(),storagePath:z.string().nullable().optional(),replay:z.boolean()}),
])
export type CustomerRecordRetentionResult=z.infer<typeof result>
async function call(name:string,companyId:string,args:Record<string,unknown>){
 uuid.parse(companyId)
 const client=await createSupabaseServerClient(),auth=await client.auth.getUser()
 if(auth.error||!auth.data.user)throw Error('customer_record_retention_authenticated_actor_required')
 const {data,error}=await client.rpc(name,{p_company_id:companyId,p_actor_user_id:auth.data.user.id,...args})
 if(error)throw error
 return result.parse(data)
}
export async function submitCustomerRecordRetention(input:{companyId:string;retentionClass:CustomerRecordRetentionClass;targetId:string;document:Buffer;issuerReceipt:Record<string,unknown>|null}){
 uuid.parse(input.targetId);retentionClass.parse(input.retentionClass)
 if(!Buffer.isBuffer(input.document)||input.document.length<1||input.document.length>1048576)throw Error('customer_record_retention_document_limit')
 return call('ediel_submit_customer_record_retention_v1',input.companyId,{p_retention_class:input.retentionClass,p_target_id:input.targetId,
  p_document_base64:input.document.toString('base64'),p_issuer_receipt:input.issuerReceipt})
}
export async function reviewCustomerRecordRetention(input:{companyId:string;decisionId:string;outcome:'approve'|'hold'|'reject';reason:string}){
 uuid.parse(input.decisionId);z.enum(['approve','hold','reject']).parse(input.outcome);z.string().trim().min(1).max(4000).parse(input.reason)
 return call('ediel_review_customer_record_retention_v1',input.companyId,{p_decision_id:input.decisionId,p_outcome:input.outcome,p_reason:input.reason})
}
export async function revokeCustomerRecordRetention(input:{companyId:string;decisionId:string;reason:string}){
 uuid.parse(input.companyId);uuid.parse(input.decisionId);z.string().trim().min(1).max(4000).parse(input.reason)
 const client=await createSupabaseServerClient(),auth=await client.auth.getUser()
 if(auth.error||!auth.data.user)throw Error('customer_record_retention_authenticated_actor_required')
 const {error}=await client.rpc('ediel_revoke_customer_record_retention_v1',{p_company_id:input.companyId,p_actor_user_id:auth.data.user.id,p_decision_id:input.decisionId,p_reason:input.reason})
 if(error)throw error
}
export async function beginCustomerRecordRetention(input:{companyId:string;decisionId:string}){
 uuid.parse(input.decisionId)
 return call('ediel_begin_customer_record_retention_v1',input.companyId,{p_decision_id:input.decisionId})
}

/** Only checks actual native tombstone/source scope. This read does not issue
 * a signing, market, legal or provider capability. Byte verification remains
 * the actual archive/download owner's responsibility. No public flag bypass. */
export async function requireCustomerRecordAvailable(input:{companyId:string;retentionClass:CustomerRecordRetentionClass;targetId:string}){
 uuid.parse(input.companyId);uuid.parse(input.targetId);retentionClass.parse(input.retentionClass)
 const {data,error}=await supabaseService.rpc('ediel_require_customer_record_available_v1',{p_company_id:input.companyId,p_retention_class:input.retentionClass,p_target_id:input.targetId})
 if(error)throw error
 const parsed=z.object({status:z.literal('not_tombstoned'),companyId:uuid,retentionClass,targetId:uuid,customerId:uuid,authorizesProviderEntry:z.literal(false)}).parse(data)
 if(parsed.companyId!==input.companyId||parsed.retentionClass!==input.retentionClass||parsed.targetId!==input.targetId)throw Error('customer_record_retention_source_binding_changed')
}
export async function requireContractRecordsAvailable(input:{companyId:string;contractId:string}){
 uuid.parse(input.companyId);uuid.parse(input.contractId)
 const {error}=await supabaseService.rpc('ediel_require_contract_records_available_v1',{p_company_id:input.companyId,p_contract_id:input.contractId})
 if(error)throw error
}
export async function readCustomerRecordTombstones(input:{companyId:string;customerId:string}){
 uuid.parse(input.companyId);uuid.parse(input.customerId)
 const {data,error}=await supabaseService.rpc('ediel_customer_record_tombstones_v1',{p_company_id:input.companyId,p_customer_id:input.customerId})
 if(error)throw error
 return z.array(z.object({retentionClass,targetId:uuid,sourceHash:hash,journalRetainUntil:z.string().datetime({offset:true}),personalDataAvailable:z.literal(false)})).parse(data)
}
export async function requirePortalRetentionAccess(input:{companyId:string;customerId:string}){
 uuid.parse(input.companyId);uuid.parse(input.customerId)
 const {error}=await supabaseService.rpc('ediel_require_portal_retention_access_v1',{p_company_id:input.companyId,p_customer_id:input.customerId})
 if(error)throw error
}
