import 'server-only'
import {createHash} from 'node:crypto'
import {z} from 'zod'
import {createSupabaseServerClient} from '@/lib/supabase/server'
import {supabaseService} from '@/lib/supabase/service'
import {INVOICE_FILE_CLASSES,INVOICE_FILE_BUCKETS,type InvoiceFileClass} from './invoiceFiles.catalog'
export {INVOICE_FILE_CLASSES,INVOICE_FILE_BUCKETS,type InvoiceFileClass}
const MAX_INVOICE_PDF_BYTES = 20 * 1024 * 1024
const STORAGE_READ_TIMEOUT_MS = 10_000
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),selector=z.object({retentionClass:z.enum(INVOICE_FILE_CLASSES),targetId:uuid})
const pending=z.object({status:z.literal('storage_purge_pending'),sourceId:uuid,sourceHash:hash,byteLength:z.number().int().min(1).max(MAX_INVOICE_PDF_BYTES),storageBucket:z.enum(INVOICE_FILE_BUCKETS),storagePath:z.string().min(1).max(1024),replay:z.boolean()})
const completed=z.object({status:z.literal('purged'),sourceId:uuid,sourceHash:hash,byteLength:z.number().int().positive(),bytesAvailable:z.literal(false),replay:z.boolean()})
async function session(companyId:string){uuid.parse(companyId);const client=await createSupabaseServerClient(),auth=await client.auth.getUser();if(auth.error||!auth.data.user)throw Error('invoice_file_authenticated_actor_required');return {client,actor:auth.data.user.id}}
export async function invoiceFileRetentionCall(companyId:string,name:string,args:Record<string,unknown>){const {client,actor}=await session(companyId),reply=await client.rpc(name,{p_company_id:companyId,p_actor_user_id:actor,...args});if(reply.error)throw reply.error;return reply.data}
/** The authenticated native locator selects an actual own row. Its Storage
 * bytes are read by the server and their hash/length captured via a service-only
 * port. No caller-provided URL, bucket, hash or ready flag enters this producer. */
export async function registerInvoiceFileSource(input:{companyId:string;retentionClass:InvoiceFileClass;targetId:string}){
 const chosen=selector.parse(input),{client,actor}=await session(input.companyId)
 const reply=await client.rpc('ediel_invoice_file_locator_v1',{p_company_id:input.companyId,p_actor_user_id:actor,p_retention_class:chosen.retentionClass,p_target_id:chosen.targetId});if(reply.error)throw reply.error
 const locator=z.object({retentionClass:z.enum(INVOICE_FILE_CLASSES),targetId:uuid,targetHash:hash,storageBucket:z.enum(INVOICE_FILE_BUCKETS),storagePath:z.string().min(1).max(1024),storageObjectId:uuid,storageByteLength:z.number().int().min(1).max(MAX_INVOICE_PDF_BYTES)}).parse(reply.data)
 if(locator.retentionClass!==chosen.retentionClass||locator.targetId!==chosen.targetId||locator.storagePath.split('/').some(part=>!part||part==='.'||part==='..')||/^[a-z]+:/i.test(locator.storagePath))throw Error('invoice_file_exact_native_locator_required')
 const download=await readInvoiceStorage(locator.storageBucket,locator.storagePath,(stream,signal)=>
  readBoundedPdf(stream,locator.storageByteLength,'invoice_file_native_storage_length_changed',signal))
 if(download.error||!download.data)throw download.error??Error('invoice_file_actual_storage_bytes_required')
 const bytes=download.data,sourceHash=createHash('sha256').update(bytes).digest('hex')
 const captured=await supabaseService.rpc('ediel_register_invoice_file_source_v1',{p_company_id:input.companyId,p_actor_user_id:actor,p_retention_class:chosen.retentionClass,p_target_id:chosen.targetId,p_target_hash:locator.targetHash,p_storage_object_id:locator.storageObjectId,p_source_hash:sourceHash,p_byte_length:bytes.length})
 if(captured.error)throw captured.error
 const result=z.object({sourceId:uuid,sourceHash:hash,byteLength:z.number().int().positive(),retentionClass:z.enum(INVOICE_FILE_CLASSES),targetId:uuid,authority:z.literal('none')}).parse(captured.data)
 if(result.retentionClass!==chosen.retentionClass||result.targetId!==chosen.targetId||result.byteLength!==bytes.length||result.sourceHash!==sourceHash)throw Error('invoice_file_native_capture_response_changed')
 return result
}
async function withStorageReadDeadline<T>(read: (signal: AbortSignal) => Promise<T>): Promise<T> {
 const controller = new AbortController()
 let timer: ReturnType<typeof setTimeout> | undefined
 const deadline = new Promise<never>((_, reject) => {
  timer = setTimeout(() => {
   const error = new Error('invoice_file_storage_timeout')
   controller.abort(error)
   reject(error)
  }, STORAGE_READ_TIMEOUT_MS)
 })
 try {
  return await Promise.race([read(controller.signal), deadline])
 } finally {
  clearTimeout(timer)
 }
}

function cancelStorageRead(stream: { cancel(): Promise<void> }) {
 void stream.cancel().catch(() => undefined)
}

async function readInvoiceStorage<T>(
 bucket: (typeof INVOICE_FILE_BUCKETS)[number],
 path: string,
 read: (stream: ReadableStream<Uint8Array>, signal: AbortSignal) => T | Promise<T>,
) {
 return withStorageReadDeadline(async signal => {
  const { data, error } = await supabaseService.storage.from(bucket).download(path, {}, { signal }).asStream()
  if (data && signal.aborted) cancelStorageRead(data)
  signal.throwIfAborted()
  return { data: data ? await read(data, signal) : null, error }
 })
}

async function readBoundedPdf(
 stream: ReadableStream<Uint8Array>,
 expectedLength: number,
 lengthError: string,
 signal: AbortSignal,
): Promise<Buffer> {
 const bytes = Buffer.alloc(expectedLength)
 const reader = stream.getReader()
 const cancel = () => cancelStorageRead(reader)
 signal.addEventListener('abort', cancel, { once: true })
 let size = 0
 let finished = false
 try {
  for (;;) {
   const part = await reader.read()
   signal.throwIfAborted()
   if (part.done) {
    finished = true
    break
   }
   const nextSize = size + part.value.byteLength
   if (nextSize > MAX_INVOICE_PDF_BYTES) throw Error('invoice_file_storage_size_limit')
   if (nextSize > expectedLength) throw Error(lengthError)
   bytes.set(part.value, size)
   size = nextSize
  }
 } finally {
  signal.removeEventListener('abort', cancel)
  if (!finished && !signal.aborted) cancel()
  reader.releaseLock()
 }
 if (size === 0) throw Error('invoice_file_storage_size_limit')
 if (size !== expectedLength) throw Error(lengthError)
 if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw Error('invoice_file_pdf_bytes_required')
 return bytes
}

export async function boundedPdfBytes(blob: Blob): Promise<Buffer> {
 if (blob.size < 1 || blob.size > MAX_INVOICE_PDF_BYTES) throw Error('invoice_file_storage_size_limit')
 return withStorageReadDeadline(signal => readBoundedPdf(blob.stream(), blob.size, 'invoice_file_storage_read_incomplete', signal))
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
function missingObject(error: unknown) {
 if (error === null || typeof error !== 'object' || !('status' in error)) return false
 // The legacy Storage GET endpoint wraps a missing-object 404 as HTTP 400.
 return error.status === 404 || (error.status === 400 && 'statusCode' in error && String(error.statusCode) === '404')
}
/** Tombstones and every shared-reference decision precede actual Storage
 * removal. The session JWT repeats current grant/legal checks in DELETE. A
 * physical claim requires an authenticated delete and Storage 404 readback. */
export async function purgeInvoiceFileRetention(input:{companyId:string;decisionId:string}){
 uuid.parse(input.decisionId);const {client,actor}=await session(input.companyId),args={p_company_id:input.companyId,p_actor_user_id:actor,p_decision_id:input.decisionId}
 const begin=await client.rpc('ediel_begin_invoice_file_purge_v1',args);if(begin.error)throw begin.error
 if(completed.safeParse(begin.data).success)return completed.parse(begin.data)
 const command=pending.parse(begin.data)
 if(!command.storagePath.startsWith(`companies/${input.companyId}/`)||command.storagePath.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('invoice_file_native_storage_scope_changed')
 const before=await readInvoiceStorage(command.storageBucket,command.storagePath,(stream,signal)=>
  readBoundedPdf(stream,command.byteLength,'invoice_file_exact_storage_bytes_changed',signal))
 if(before.data){if(createHash('sha256').update(before.data).digest('hex')!==command.sourceHash)throw Error('invoice_file_exact_storage_bytes_changed')}
 else if(!missingObject(before.error))throw before.error??Error('invoice_file_storage_readback_required')
 const removed=await client.storage.from(command.storageBucket).remove([command.storagePath]);if(removed.error)throw removed.error
 const after=await readInvoiceStorage(command.storageBucket,command.storagePath,stream=>{
  cancelStorageRead(stream)
  return true
 });if(after.data||!missingObject(after.error))throw Error('invoice_file_storage_bytes_still_available')
 const finish=await client.rpc('ediel_finish_invoice_file_purge_v1',args);if(finish.error)throw finish.error
 const result=completed.parse(finish.data);if(result.sourceId!==command.sourceId||result.sourceHash!==command.sourceHash||result.byteLength!==command.byteLength)throw Error('invoice_file_native_completion_mismatch')
 return result
}
/** Negative exact-copy predicate only; retained scalar history stays readable. */
export async function requireInvoiceFileCopyAvailable(input:{companyId:string;retentionClass:InvoiceFileClass;targetId:string}){
 uuid.parse(input.companyId);const chosen=selector.parse(input),r=await supabaseService.rpc('ediel_require_invoice_file_copy_available_v1',{p_company_id:input.companyId,p_retention_class:chosen.retentionClass,p_target_id:chosen.targetId});if(r.error)throw r.error
}
