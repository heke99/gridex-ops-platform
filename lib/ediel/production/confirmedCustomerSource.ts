import {supabaseService} from '@/lib/supabase/service'
import {parseProdatMessage} from '@/lib/ediel/prodat/parser'
import type {EdielMessageRow} from '@/lib/ediel/types'

type Rpc=(name:string,params:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
const rpc=()=>supabaseService.rpc.bind(supabaseService) as unknown as Rpc
const record=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null
/** Physical selector only. Approval stays with the original native source,
 * current own actor and separately qualified life-event owner. */
export function isConfirmedCustomerSourceCandidate(message:EdielMessageRow):boolean{
 if(message.direction!=='inbound'||message.message_family!=='PRODAT'||message.message_code!=='Z06')return false
 const source=parseProdatMessage(message.raw_payload??'')
 return source.messageCode==='Z06'&&source.lineItems.some(item=>item.reasonForTransaction==='E34')
}
export type ConfirmedCustomerSourceResult={applied:true;sourceMessageId:string;appliedCount:1;owner:'confirmed-customer-source-v1';payloadHash:string;eventId:string;objects:{meteringPointId:string;siteId:string;effectiveAt:string;sourceReceivedAt:string}[]}|{applied:false;reason:string}
/** These two separate awaited RPCs are essential: a same-transaction append
 * cannot witness that its version was actually committed and available. */
export async function applyConfirmedCustomerSource(input:{companyId:string;sourceMessageId:string;actorUserId:string}):Promise<ConfirmedCustomerSourceResult>{
 const args={p_company_id:input.companyId,p_source_message_id:input.sourceMessageId,p_actor_user_id:input.actorUserId}
 const{data,error}=await rpc()('ediel_apply_reviewed_customer_source_v1',args);if(error)throw error
 const r=record(data)
 if(r?.applied===false&&typeof r.reason==='string')return r as ConfirmedCustomerSourceResult
 if(r?.applied!==true||r.owner!=='confirmed-customer-source-v1'||r.sourceMessageId!==input.sourceMessageId||r.appliedCount!==1||!Array.isArray(r.objects)||r.objects.length!==1||typeof r.eventId!=='string'||! /^[a-f0-9]{64}$/.test(String(r.payloadHash)))throw Error('customer_source_receipt_invalid')
 const{data:witness,error:witnessError}=await rpc()('ediel_witness_confirmed_customer_source_v1',args);if(witnessError)throw witnessError
 const w=record(witness)
 if(w?.owner!=='confirmed-customer-source-availability-v1'||w.sourceMessageId!==input.sourceMessageId||w.payloadHash!==r.payloadHash||typeof w.availableAt!=='string'||!Number.isFinite(Date.parse(w.availableAt)))throw Error('customer_source_availability_unconfirmed')
 return r as unknown as ConfirmedCustomerSourceResult
}
