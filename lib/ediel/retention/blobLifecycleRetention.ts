import {createHash} from 'node:crypto'
import {z} from 'zod'
import {createSupabaseServerClient} from '@/lib/supabase/server'
import {supabaseService} from '@/lib/supabase/service'

const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/)
const retentionClass=z.enum(['received_ediel_message_content','transport_raw_mime_bytes'])
const result=z.union([
 z.object({status:z.literal('submitted'),decisionId:uuid,sourceHash:hash,targetHash:hash,messageId:uuid,documentHash:hash,issuerQualified:z.boolean()}),
 z.object({status:z.enum(['approved','held','rejected']),decisionId:uuid.optional(),reviewId:uuid.optional(),missing:z.array(z.string()).optional()}),
 z.object({status:z.enum(['purged','storage_purge_pending']),targetId:uuid,sourceHash:hash,byteLength:z.number().int().positive(),storagePath:z.string().nullable().optional(),replay:z.boolean().optional()}),
])
async function session(companyId:string){
 uuid.parse(companyId)
 const client=await createSupabaseServerClient(),auth=await client.auth.getUser()
 if(auth.error||!auth.data.user)throw Error('blob_retention_authenticated_actor_required')
 return {client,actor:auth.data.user.id}
}
async function call(name:string,companyId:string,args:Record<string,unknown>){
 const {client,actor}=await session(companyId)
 const {data,error}=await client.rpc(name,{p_company_id:companyId,p_actor_user_id:actor,...args})
 if(error)throw error
 return data
}
export async function submitBlobRetention(input:{companyId:string;retentionClass:z.infer<typeof retentionClass>;targetId:string;document:Buffer;issuerReceipt:Record<string,unknown>|null}){
 uuid.parse(input.targetId);retentionClass.parse(input.retentionClass)
 if(!Buffer.isBuffer(input.document)||input.document.length<1||input.document.length>1048576)throw Error('blob_retention_document_limit')
 return result.parse(await call('ediel_submit_blob_retention_v1',input.companyId,{p_retention_class:input.retentionClass,p_target_id:input.targetId,p_document_base64:input.document.toString('base64'),p_issuer_receipt:input.issuerReceipt}))
}
export async function reviewBlobRetention(input:{companyId:string;decisionId:string;outcome:'approve'|'hold'|'reject';reason:string}){
 uuid.parse(input.decisionId);z.enum(['approve','hold','reject']).parse(input.outcome);z.string().min(1).max(4000).parse(input.reason)
 return result.parse(await call('ediel_review_blob_retention_v1',input.companyId,{p_decision_id:input.decisionId,p_outcome:input.outcome,p_reason:input.reason}))
}
export async function revokeBlobRetention(input:{companyId:string;decisionId:string;reason:string}){
 uuid.parse(input.decisionId);z.string().min(1).max(4000).parse(input.reason)
 await call('ediel_revoke_blob_retention_v1',input.companyId,{p_decision_id:input.decisionId,p_reason:input.reason})
}
function missingObject(error:unknown){
 return error!==null&&typeof error==='object'&&'statusCode' in error&&String(error.statusCode)==='404'
}
/** Native policy qualification and the tombstone precede any physical action.
 * Storage.remove uses the actual session JWT: its DELETE transaction repeats
 * and locks current legal/reviewer/grant checks. Service role is used only for
 * exact readback, never to bypass Storage deletion authority. */
export async function purgeBlobRetention(input:{companyId:string;decisionId:string}){
 uuid.parse(input.decisionId)
 const {client,actor}=await session(input.companyId),parameters={p_company_id:input.companyId,p_actor_user_id:actor,p_decision_id:input.decisionId}
 const begin=await client.rpc('ediel_begin_blob_purge_v1',parameters)
 if(begin.error)throw begin.error
 const command=result.parse(begin.data)
 if(command.status!=='storage_purge_pending')return command
 const path=command.storagePath
 if(!path||!new RegExp(`^transport/${input.companyId}/[a-f0-9-]{36}/${command.sourceHash}\\.eml$`).test(path))throw Error('blob_retention_storage_target_invalid')
 const reader=supabaseService.storage.from('ediel-files'),before=await reader.download(path)
 if(before.error&&!missingObject(before.error))throw before.error
 if(before.data){
  const bytes=Buffer.from(await before.data.arrayBuffer())
  if(bytes.length!==command.byteLength||createHash('sha256').update(bytes).digest('hex')!==command.sourceHash)throw Error('blob_retention_storage_exact_bytes_changed')
 }else if(!missingObject(before.error))throw Error('blob_retention_storage_readback_missing')
 const removed=await client.storage.from('ediel-files').remove([path])
 if(removed.error)throw removed.error
 const after=await reader.download(path)
 if(after.data||!missingObject(after.error))throw Error('blob_retention_storage_bytes_still_available')
 const finish=await client.rpc('ediel_finish_blob_storage_purge_v1',parameters)
 if(finish.error)throw finish.error
 const completed=result.parse(finish.data)
 if(completed.status!=='purged'||completed.targetId!==command.targetId||completed.sourceHash!==command.sourceHash||completed.byteLength!==command.byteLength)throw Error('blob_retention_native_completion_mismatch')
 return completed
}
