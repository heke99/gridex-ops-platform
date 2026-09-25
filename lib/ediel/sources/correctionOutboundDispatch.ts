import {createHash,randomUUID} from 'node:crypto'
import {supabaseService} from '@/lib/supabase/service'
import {sendEdielEmail,type SendEdielEmailInput} from '@/lib/email/sendEdielEmail'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {SmtpDeliveryUncertainError} from '@/lib/ediel/transport/smtpOutcome'
import type {EdielMessageRow} from '@/lib/ediel/types'

export type OutboundDispatchOwner={kind:'direct'}|{kind:'worker';outboxId:string;sendAttemptId:string;workerId:string}
type Receipt={scoped:boolean;unscopedReason?:string;proceed?:boolean;eventId?:string;witnessed?:boolean;facts?:{classification?:string};acceptedReceipt?:unknown}
type ProviderResult=Awaited<ReturnType<typeof sendEdielEmail>> & {dispatchReplay?:boolean;dispatchObservedAt?:string}
class ReplayAccepted extends Error {constructor(readonly result:ProviderResult){super('outbound_dispatch_projection_repair')}}
function acceptedReceipt(value:unknown):ProviderResult|null{
 if(!value||typeof value!=='object')return null
 const r=value as Record<string,unknown>
 if(!Array.isArray(r.accepted)||r.accepted.length===0||!r.accepted.every(v=>typeof v==='string'&&v.trim())||!Array.isArray(r.rejected)||r.rejected.length!==0)return null
 if(typeof r.observedAt!=='string'||!Number.isFinite(Date.parse(r.observedAt)))return null
 if(r.messageId!==null&&typeof r.messageId!=='string'||r.response!==null&&typeof r.response!=='string')return null
 return {dispatchReplay:true,dispatchObservedAt:r.observedAt,accepted:r.accepted,rejected:r.rejected,messageId:r.messageId as string|null ?? undefined,response:r.response as string|null ?? undefined}
}
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
function receipt(value:unknown):Receipt{
 if(!value||typeof value!=='object'||typeof (value as Receipt).scoped!=='boolean')throw Error('outbound_dispatch_invalid_receipt')
 return value as Receipt
}
export async function sendCorrectionFencedEmail(input:SendEdielEmailInput,context:{message:EdielMessageRow;actorUserId:string;owner?:OutboundDispatchOwner;mimeMode:string;payload:Buffer;encoding:string}){
 const {message}=context
 // Existing non-Z08 families keep their original transport contract. Inspect
 // the sealed raw grammar as well as the row code, never parsed subtype/status.
 let potential=message.message_code==='Z08'
 try{const t=tokenizeEdifact(message.raw_payload);potential ||= t.segments.some(s=>s.tag==='BGM'&&segmentComposite(s,1,t.una)[0]==='Z08')}
 catch{potential=true} // malformed originals cannot use the uninstrumented lane
 if(!potential)return sendEdielEmail(input)
 const identity={companyId:message.company_id,environment:message.environment,messageId:message.id,actorUserId:context.actorUserId,
  attemptId:randomUUID()}
 let callbackUsed=false,entryAttempted=false,prepared=false,scoped=false,resultCaptured=false
 const call=async(action:string,extra:Record<string,unknown>={})=>{
  const {data,error}=await supabaseService.rpc('gridex_outbound_dispatch_v1',{p_input:{...identity,action,...extra}})
  if(error)throw error
  return receipt(data)
 }
 const witness=async(r:Receipt)=>{
  if(!r.eventId)throw Error('outbound_dispatch_event_missing')
  const w=await call('witness',{eventId:r.eventId})
  if(w.eventId!==r.eventId||w.witnessed!==true)throw Error('outbound_dispatch_witness_missing')
 }
 try{
  const result=await sendEdielEmail(input,{beforeProviderCall:async actual=>{
   if(callbackUsed)throw Error('outbound_dispatch_callback_reused')
   callbackUsed=true
   const binding={...actual,originalHash:hash(Buffer.from(message.raw_payload ?? '','utf8')),routeId:message.communication_route_id,
    mimeMode:context.mimeMode,encoding:context.encoding,payloadBase64:context.payload.toString('base64'),payloadHash:hash(context.payload),payloadLength:context.payload.length}
   const reservation=await call('prepare',{owner:context.owner ?? {kind:'direct'},binding})
   scoped=reservation.scoped
   if(!scoped){
    if(potential && !(reservation.unscopedReason==='canonical_lk_exemption' && message.rule_profile_key==='PRODAT:Z08:LK:26.A:r3'))
     throw Error('outbound_dispatch_scope_mismatch')
    return
   }
   if(reservation.proceed!==true){
    const prior=acceptedReceipt(reservation.acceptedReceipt)
    if(prior)throw new ReplayAccepted(prior) // helper aborts; repair projections only
    throw new SmtpDeliveryUncertainError(Error('outbound_dispatch_resend_suppressed'))
   }
   prepared=true
   await witness(reservation)
   // Set before RPC: response loss after commit is not proof that entry failed.
   entryAttempted=true
   const entered=await call('enter')
   if(entered.proceed!==true)throw Error('outbound_dispatch_entry_denied')
   await witness(entered)
  }})
  if(!callbackUsed)throw Error('outbound_dispatch_callback_missing')
  if(scoped){
   const captured=await call('result',{result:{accepted:result.accepted,rejected:result.rejected,messageId:result.messageId ?? null,response:result.response ?? null}})
   resultCaptured=true
   await witness(captured)
   if(captured.facts?.classification!=='accepted')throw new SmtpDeliveryUncertainError(Error(`outbound_dispatch_${captured.facts?.classification ?? 'uncertain'}`),result.messageId ?? null)
  }
  return result
 }catch(error){
  if(error instanceof ReplayAccepted)return error.result
  if(scoped&&entryAttempted){
   if(!resultCaptured){
    const e=error as {message?:unknown;code?:unknown;command?:unknown;responseCode?:unknown;syscall?:unknown}
    // Failure to capture this observation leaves an entered, unresolved attempt.
    try{const captured=await call('result',{result:{error:{message:String(e?.message ?? error),code:e?.code ?? null,command:e?.command ?? null,responseCode:e?.responseCode ?? null,syscall:e?.syscall ?? null}}});await witness(captured)}catch{/* durable entry remains the no-resend fence */}
   }
   throw error instanceof SmtpDeliveryUncertainError?error:new SmtpDeliveryUncertainError(error)
  }
  if(scoped&&prepared){try{const released=await call('release');await witness(released)}catch{/* stale/ambiguous owner cannot release */}}
  throw error
 }
}
