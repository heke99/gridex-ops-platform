import 'server-only'
import {createHash} from 'node:crypto'
import {z} from 'zod'
import {createSupabaseServerClient} from '@/lib/supabase/server'
import {supabaseService} from '@/lib/supabase/service'
import {INVOICE_FILE_CLASSES,INVOICE_FILE_BUCKETS,type InvoiceFileClass} from './invoiceFiles.catalog'
export {INVOICE_FILE_CLASSES,INVOICE_FILE_BUCKETS,type InvoiceFileClass}
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),selector=z.object({retentionClass:z.enum(INVOICE_FILE_CLASSES),targetId:uuid})
const pending=z.object({status:z.literal('storage_purge_pending'),sourceId:uuid,sourceHash:hash,byteLength:z.number().int().min(1).max(20971520),storageBucket:z.enum(INVOICE_FILE_BUCKETS),storagePath:z.string().min(1).max(1024),replay:z.boolean()})
const completed=z.object({status:z.literal('purged'),sourceId:uuid,sourceHash:hash,byteLength:z.number().int().positive(),bytesAvailable:z.literal(false),replay:z.boolean()})
async function session(companyId:string){uuid.parse(companyId);const client=await createSupabaseServerClient(),auth=await client.auth.getUser();if(auth.error||!auth.data.user)throw Error('invoice_file_authenticated_actor_required');return {client,actor:auth.data.user.id}}
export async function invoiceFileRetentionCall(companyId:string,name:string,args:Record<string,unknown>){const {client,actor}=await session(companyId),reply=await client.rpc(name,{p_company_id:companyId,p_actor_user_id:actor,...args});if(reply.error)throw reply.error;return reply.data}
/** The authenticated native locator selects an actual own row. Its Storage
 * bytes are read by the server and their hash/length captured via a service-only
 * port. No caller-provided URL, bucket, hash or ready flag enters this producer. */
export async function registerInvoiceFileSource(input:{companyId:string;retentionClass:InvoiceFileClass;targetId:string}){
 const chosen=selector.parse(input),{client,actor}=await session(input.companyId)
 const reply=await client.rpc('ediel_invoice_file_locator_v1',{p_company_id:input.companyId,p_actor_user_id:actor,p_retention_class:chosen.retentionClass,p_target_id:chosen.targetId});if(reply.error)throw reply.error
 const locator=z.object({retentionClass:z.enum(INVOICE_FILE_CLASSES),targetId:uuid,targetHash:hash,storageBucket:z.enum(INVOICE_FILE_BUCKETS),storagePath:z.string().min(1).max(1024),storageObjectId:uuid,storageByteLength:z.number().int().min(1).max(20971520)}).parse(reply.data)
 if(locator.retentionClass!==chosen.retentionClass||locator.targetId!==chosen.targetId||locator.storagePath.split('/').some(part=>!part||part==='.'||part==='..')||/^[a-z]+:/i.test(locator.storagePath))throw Error('invoice_file_exact_native_locator_required')
 const download=await supabaseService.storage.from(locator.storageBucket).download(locator.storagePath,{transform:undefined})
 if(download.error||!download.data)throw download.error??Error('invoice_file_actual_storage_bytes_required')
 const bytes=await boundedPdfBytes(download.data)
 if(bytes.length!==locator.storageByteLength)throw Error('invoice_file_native_storage_length_changed')
 const captured=await supabaseService.rpc('ediel_register_invoice_file_source_v1',{p_company_id:input.companyId,p_actor_user_id:actor,p_retention_class:chosen.retentionClass,p_target_id:chosen.targetId,p_target_hash:locator.targetHash,p_storage_object_id:locator.storageObjectId,p_source_hash:createHash('sha256').update(bytes).digest('hex'),p_byte_length:bytes.length})
 if(captured.error)throw captured.error
 const result=z.object({sourceId:uuid,sourceHash:hash,byteLength:z.number().int().positive(),retentionClass:z.enum(INVOICE_FILE_CLASSES),targetId:uuid,authority:z.literal('none')}).parse(captured.data)
 if(result.retentionClass!==chosen.retentionClass||result.targetId!==chosen.targetId||result.byteLength!==bytes.length||result.sourceHash!==createHash('sha256').update(bytes).digest('hex'))throw Error('invoice_file_native_capture_response_changed')
 return result
}
export async function boundedPdfBytes(blob:Blob):Promise<Buffer>{
 if(blob.size<1||blob.size>20971520)throw Error('invoice_file_storage_size_limit')
 const reader=blob.stream().getReader(),chunks:Uint8Array[]=[],deadline=setTimeout(()=>{void reader.cancel('invoice_file_storage_timeout')},10000)
 let size=0
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>20971520){await reader.cancel();throw Error('invoice_file_storage_size_limit')}chunks.push(part.value)}if(size!==blob.size)throw Error('invoice_file_storage_read_incomplete')}
 finally{clearTimeout(deadline);reader.releaseLock()}
 const bytes=Buffer.concat(chunks);if(bytes.subarray(0,5).toString('ascii')!=='%PDF-')throw Error('invoice_file_pdf_bytes_required');return bytes
}
export async function inspectInvoiceFileRetention(input:{companyId:string;retentionClass:InvoiceFileClass;targetId:string}){
 const chosen=selector.parse(input);return invoiceFileRetentionCall(input.companyId,'ediel_invoice_file_retention_basis_v1',{p_retention_class:chosen.retentionClass,p_target_id:chosen.targetId})
}
export async function submitInvoiceFileRetention(input:{companyId:string;retentionClass:InvoiceFileClass;targetId:string;document:Buffer;issuerReceipt:Record<string,unknown>|null}){
 const chosen=selector.parse(input);if(input.document.length<1||input.document.length>1048576)throw Error('invoice_file_policy_document_limit')
 return invoiceFileRetentionCall(input.companyId,'ediel_submit_invoice_file_retention_v1',{p_retention_class:chosen.retentionClass,p_target_id:chosen.targetId,p_document_base64:input.document.toString('base64'),p_issuer_receipt:input.issuerReceipt})
}
export async function reviewInvoiceFileRetention(input:{companyId:string;decisionId:string;outcome:'approve'|'hold'|'reject';reason:string}){
 uuid.parse(input.decisionId);z.enum(['approve','hold','reject']).parse(input.outcome);z.string().trim().min(1).max(4000).parse(input.reason)
 return invoiceFileRetentionCall(input.companyId,'ediel_review_invoice_file_retention_v1',{p_decision_id:input.decisionId,p_outcome:input.outcome,p_reason:input.reason})
}
const missingObject=(error:unknown)=>error!==null&&typeof error==='object'&&'statusCode' in error&&String(error.statusCode)==='404'
/** Tombstones and every shared-reference decision precede actual Storage
 * removal. The session JWT repeats current grant/legal checks in DELETE. A
 * physical claim requires an authenticated delete and actual HTTP404 readback. */
export async function purgeInvoiceFileRetention(input:{companyId:string;decisionId:string}){
 uuid.parse(input.decisionId);const {client,actor}=await session(input.companyId),args={p_company_id:input.companyId,p_actor_user_id:actor,p_decision_id:input.decisionId}
 const begin=await client.rpc('ediel_begin_invoice_file_purge_v1',args);if(begin.error)throw begin.error
 if(completed.safeParse(begin.data).success)return completed.parse(begin.data)
 const command=pending.parse(begin.data),reader=supabaseService.storage.from(command.storageBucket)
 if(!command.storagePath.startsWith(`companies/${input.companyId}/`)||command.storagePath.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('invoice_file_native_storage_scope_changed')
 const before=await reader.download(command.storagePath)
 if(before.data){const bytes=await boundedPdfBytes(before.data);if(bytes.length!==command.byteLength||createHash('sha256').update(bytes).digest('hex')!==command.sourceHash)throw Error('invoice_file_exact_storage_bytes_changed')}
 else if(!missingObject(before.error))throw before.error??Error('invoice_file_storage_readback_required')
 const removed=await client.storage.from(command.storageBucket).remove([command.storagePath]);if(removed.error)throw removed.error
 const after=await reader.download(command.storagePath);if(after.data||!missingObject(after.error))throw Error('invoice_file_storage_bytes_still_available')
 const finish=await client.rpc('ediel_finish_invoice_file_purge_v1',args);if(finish.error)throw finish.error
 const result=completed.parse(finish.data);if(result.sourceId!==command.sourceId||result.sourceHash!==command.sourceHash||result.byteLength!==command.byteLength)throw Error('invoice_file_native_completion_mismatch')
 return result
}
/** Negative exact-copy predicate only; retained scalar history stays readable. */
export async function requireInvoiceFileCopyAvailable(input:{companyId:string;retentionClass:InvoiceFileClass;targetId:string}){
 uuid.parse(input.companyId);const chosen=selector.parse(input),r=await supabaseService.rpc('ediel_require_invoice_file_copy_available_v1',{p_company_id:input.companyId,p_retention_class:chosen.retentionClass,p_target_id:chosen.targetId});if(r.error)throw r.error
}
