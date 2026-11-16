import 'server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { supabaseService } from '@/lib/supabase/service'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { beginCustomerRecordRetention } from './customerRecordClasses'

const bucket='customer-contract-documents',uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/)
/** Actual Storage remove plus exact-hash pre-read and unavailability readback.
 * SQL metadata absence by itself never proves physical Storage byte removal.
 * The native deletion trigger re-locks current JWT/issuer/reviewer/class grants
 * and exact object source inside Storage's own DELETE transaction. */
export async function purgeRetainedContractDocument(input:{companyId:string;decisionId:string}){
 uuid.parse(input.companyId);uuid.parse(input.decisionId)
 const pending=await beginCustomerRecordRetention(input)
 if(pending.status!=='storage_purge_pending')return pending
 if(pending.retentionClass!=='contract_signed_pdf_bytes'||!pending.storagePath)throw Error('contract_pdf_retention_native_storage_target_required')
 const path=pending.storagePath
 if(!path.startsWith(input.companyId+'/')||!new RegExp('^[0-9a-f-]{36}/[0-9a-f-]{36}/signed-contract-'+pending.sourceHash+'\\.pdf$').test(path))throw Error('contract_pdf_retention_native_path_binding_changed')
 const before=await supabaseService.storage.from(bucket).download(path)
 const absent=(value:typeof before)=>!value.data&&value.error&&['404','400'].includes(String(value.error.statusCode))&&/not found|does not exist|object not found/i.test(value.error.message)
 if(before.data){
  const bytes=Buffer.from(await before.data.arrayBuffer())
  if(bytes.length!==pending.byteLength||bytes.length>2097152||createHash('sha256').update(bytes).digest('hex')!==pending.sourceHash)throw Error('contract_pdf_retention_actual_hash_length_changed')
 }else if(!absent(before))throw before.error??Error('contract_pdf_retention_actual_pre_read_required')
 const client=await createSupabaseServerClient(),auth=await client.auth.getUser()
 if(auth.error||!auth.data.user)throw Error('customer_record_retention_authenticated_actor_required')
 if(before.data){const removed=await client.storage.from(bucket).remove([path]);if(removed.error)throw removed.error}
 const after=await supabaseService.storage.from(bucket).download(path)
 if(!absent(after))throw Error('contract_pdf_retention_actual_unavailability_readback_required')
 const {data,error}=await client.rpc('ediel_finish_contract_document_retention_v1',{p_company_id:input.companyId,p_actor_user_id:auth.data.user.id,p_decision_id:input.decisionId})
 if(error)throw error
 const receipt=z.object({status:z.literal('storage_object_absent'),retentionClass:z.literal('contract_signed_pdf_bytes'),targetId:uuid,sourceHash:hash,byteLength:z.number().int().positive(),replay:z.boolean()}).parse(data)
 if(receipt.targetId!==pending.targetId||receipt.sourceHash!==pending.sourceHash||receipt.byteLength!==pending.byteLength)throw Error('contract_pdf_retention_actual_receipt_binding_changed')
 return {...receipt,physicalBytesObservedUnavailable:true as const}
}
