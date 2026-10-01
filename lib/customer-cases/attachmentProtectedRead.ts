import 'server-only'
import {z}from'zod'
import {supabaseService}from'@/lib/supabase/service'
import {supportActorContext,type SupportReadContext}from'./customerRead'
import {supportScanLineageSchema}from'./scannerProof'
import {readSupportAttachmentPhysicalBytes}from'./attachmentScannerAdapter'
import {SupportCommandError}from'@/lib/customer-operations/supportCommand'
const contextSchema=z.object({companyId:z.string().uuid(),customerId:z.string().uuid(),actor:z.union([
  z.object({kind:z.enum(['ops','portal']),userId:z.string().uuid(),sessionId:z.string().uuid()}).strict(),
  z.object({kind:z.literal('api'),clientId:z.string().uuid(),subject:z.string().min(1).max(255)}).strict(),
])}).strict()
const nonceSchema=z.object({nonceId:z.string().uuid(),issuedAt:z.number().int().nonnegative(),expiresAt:z.number().int().positive(),
  binding:supportScanLineageSchema,releaseAllowed:z.literal(false)}).strict()
function fail(error:{code?:string;message?:string}|null=null):never{
  if(error?.code==='42501')throw new SupportCommandError('support_actor_forbidden',403)
  if(error?.code==='P0002')throw new SupportCommandError('resource_not_found',404)
  if(error?.code==='54000')throw new SupportCommandError('support_attachment_read_limit',429)
  throw new SupportCommandError('support_attachment_unavailable',503)
}
function checkNonce(value:unknown,context:SupportReadContext,attachmentId:string,nonceId?:string){
  const nonce=nonceSchema.safeParse(value),now=Math.floor(Date.now()/1000)
  if(!nonce.success||nonce.data.binding.companyId!==context.companyId||nonce.data.binding.customerId!==context.customerId
    ||nonce.data.binding.attachmentId!==attachmentId||(nonceId&&nonce.data.nonceId!==nonceId)
    ||nonce.data.issuedAt>now||nonce.data.expiresAt<=now||nonce.data.expiresAt-nonce.data.issuedAt>60)fail()
  return nonce.data
}
export async function prepareProtectedSupportAttachmentRead(context:SupportReadContext,attachmentId:string){
  const scoped=contextSchema.safeParse(context)
  if(!scoped.success||!z.string().uuid().safeParse(attachmentId).success)fail()
  const response=await supabaseService.rpc('gridex_prepare_support_attachment_read_v1',{
    p_context:supportActorContext(scoped.data),p_attachment_id:attachmentId,
  })
  if(response.error)fail(response.error)
  const nonce=checkNonce(response.data,scoped.data,attachmentId)
  return {nonceId:nonce.nonceId,expiresAt:nonce.expiresAt,releaseAllowed:false as const}
}
/** A current owner/session-bound denial consumes a short TTL nonce. File bytes
 * are inspected only internally, never returned or converted into a URL. */
export async function denyProtectedSupportAttachmentDownload(context:SupportReadContext,attachmentId:string,nonceId:string){
  const scoped=contextSchema.safeParse(context)
  if(!scoped.success||!z.string().uuid().safeParse(attachmentId).success||!z.string().uuid().safeParse(nonceId).success)fail()
  const p_context=supportActorContext(scoped.data)
  const initial=await supabaseService.rpc('gridex_get_support_attachment_read_nonce_v1',{p_context,p_nonce_id:nonceId})
  if(initial.error)fail(initial.error)
  const nonce=checkNonce(initial.data,scoped.data,attachmentId,nonceId)
  const physical=await readSupportAttachmentPhysicalBytes(nonce.binding).catch(()=>fail())
  const final=await supabaseService.rpc('gridex_finish_support_attachment_read_v1',{p_context,p_nonce_id:nonceId,p_witness:physical.witness})
  if(final.error)fail(final.error)
  const decision=z.object({releaseAllowed:z.literal(false),outcome:z.literal('blocked_scanner_qualification'),physicalHashVerified:z.literal(true)}).strict().safeParse(final.data)
  if(!decision.success)fail()
  return decision.data
}
