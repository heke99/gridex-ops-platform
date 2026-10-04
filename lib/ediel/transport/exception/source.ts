import {AsyncLocalStorage} from 'node:async_hooks'
import {createHash} from 'node:crypto'
import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'
export type TransportExceptionCase='temporary_encryption_failure'|'recipient_certificate_unavailable'|'crl_refresh_failure'
export type TransportExceptionHeld={status:'held';missing:string[]}
export type TransportExceptionAuthorization=Readonly<{
 status:'authorized';version:1;approvalId:string;companyId:string;environment:'test'|'production';messageId:string;actorUserId:string;
 originalHash:string;routeId:string;senderEdielId:string;receiverEdielId:string;receiverEmail:string;case:TransportExceptionCase;
 sourceDigest:string;approvalDigest:string;tlsEvidenceDigest:string;validFrom:string;validTo:string;priorCrlSha256:readonly string[];
 certificateAuthorityId:string|null;cdpLocations:readonly string[];
}>
const issued=new WeakMap<object,string>(),certificateContext=new AsyncLocalStorage<TransportExceptionAuthorization>()
const hash=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex')
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v)
const sha=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null
function current(a:TransportExceptionAuthorization){
 return issued.get(a)===hash(JSON.stringify(a))&&Date.parse(a.validFrom)<=Date.now()&&Date.parse(a.validTo)>Date.now()
}
/** The selector never supplies approval or incident facts. Only this protected
 * current native owner can issue a capability; no deployment seeds its publisher. */
export async function readTransportExceptionAuthorization(input:{message:EdielMessageRow;actorUserId:string;exceptionId:string})
 :Promise<TransportExceptionAuthorization|TransportExceptionHeld>{
 const m=input.message
 if(!uuid(input.actorUserId)||!uuid(input.exceptionId)||!uuid(m.id)||!uuid(m.company_id)||m.direction!=='outbound'
  ||m.message_standard!=='edifact'||m.message_family!=='PRODAT'||!m.raw_payload)throw Error('transport_exception_selector_scope_invalid')
 const rpc=supabaseService.rpc.bind(supabaseService) as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
 const {data,error}=await rpc('ediel_read_transport_exception_v1',{p_company_id:m.company_id,p_message_id:m.id,
  p_actor_user_id:input.actorUserId,p_exception_id:input.exceptionId})
 if(error)throw error
 const v=object(data)
 if(v?.status==='held'&&Array.isArray(v.missing)&&v.missing.length>0&&v.missing.length<=16
  &&v.missing.every(x=>typeof x==='string'))return {status:'held',missing:[...v.missing] as string[]}
 if(v?.status!=='authorized'||v.version!==1||v.approvalId!==input.exceptionId||v.companyId!==m.company_id||v.messageId!==m.id
  ||v.actorUserId!==input.actorUserId||v.environment!==m.environment||!['test','production'].includes(String(v.environment))
  ||v.originalHash!==hash(m.raw_payload)||v.routeId!==m.communication_route_id||v.senderEdielId!==m.sender_ediel_id
  ||v.receiverEdielId!==m.receiver_ediel_id||v.receiverEmail!==m.receiver_email
  ||!['temporary_encryption_failure','recipient_certificate_unavailable','crl_refresh_failure'].includes(String(v.case))
  ||!sha(v.sourceDigest)||!sha(v.approvalDigest)||!sha(v.tlsEvidenceDigest)||typeof v.validFrom!=='string'||typeof v.validTo!=='string'
  ||!(Date.parse(v.validFrom)<=Date.now()&&Date.parse(v.validTo)>Date.now())||!Array.isArray(v.priorCrlSha256)
  ||v.priorCrlSha256.length>16||!v.priorCrlSha256.every(sha)||new Set(v.priorCrlSha256).size!==v.priorCrlSha256.length
  ||!Array.isArray(v.cdpLocations)||v.cdpLocations.length>16||!v.cdpLocations.every(x=>typeof x==='string'&&x.length>0&&x.length<=2048)
  ||new Set(v.cdpLocations).size!==v.cdpLocations.length
  ||(v.case==='crl_refresh_failure'?(!uuid(v.certificateAuthorityId)||v.cdpLocations.length===0):(v.certificateAuthorityId!==null||v.cdpLocations.length!==0))
  ||(v.case==='crl_refresh_failure'?v.priorCrlSha256.length===0:v.priorCrlSha256.length!==0))throw Error('transport_exception_source_result_invalid')
 const a=Object.freeze({...v,priorCrlSha256:Object.freeze([...v.priorCrlSha256]),cdpLocations:Object.freeze([...v.cdpLocations])}) as unknown as TransportExceptionAuthorization
 issued.set(a,hash(JSON.stringify(a)));return a
}
/** Unforgeable application-side receipt. Native prepare/enter still independently
 * reread the approval, grants, legal namespace and current immutable original. */
export function transportExceptionBinding(value:unknown,m:EdielMessageRow,actorUserId:string){
 const a=value as TransportExceptionAuthorization
 if(!a||!current(a)||a.companyId!==m.company_id||a.environment!==m.environment||a.messageId!==m.id||a.actorUserId!==actorUserId
  ||a.originalHash!==hash(m.raw_payload??'')||a.routeId!==m.communication_route_id||a.senderEdielId!==m.sender_ediel_id
  ||a.receiverEdielId!==m.receiver_ediel_id||a.receiverEmail!==m.receiver_email)throw Error('transport_exception_capability_scope_or_expiry_invalid')
 return {approvalId:a.approvalId,originalHash:a.originalHash,case:a.case,sourceDigest:a.sourceDigest,
  approvalDigest:a.approvalDigest,tlsEvidenceDigest:a.tlsEvidenceDigest,priorCrlSha256:[...a.priorCrlSha256],
  certificateAuthorityId:a.certificateAuthorityId,cdpLocations:[...a.cdpLocations]}
}
export function plaintextTransportException(a:TransportExceptionAuthorization,m:EdielMessageRow,actorUserId:string):boolean{
 transportExceptionBinding(a,m,actorUserId)
 return a.case==='temporary_encryption_failure'||a.case==='recipient_certificate_unavailable'
}
/** Scoped only across this actual certificate consumer. A clone, old capability
 * or a different recipient cannot turn ordinary trust verification into fallback. */
export function withTransportExceptionCertificateScope<T>(a:TransportExceptionAuthorization|null,operation:()=>Promise<T>):Promise<T>{
 if(a!==null&&!current(a))throw Error('transport_exception_certificate_capability_invalid')
 return a===null?operation():certificateContext.run(a,operation)
}
export function currentPreviousCrlException(scope:{companyId:string;environment:string;receiverEdielId:string},crls:readonly string[]){
 const a=certificateContext.getStore()
 if(!a||!current(a)||a.case!=='crl_refresh_failure'||a.companyId!==scope.companyId||a.environment!==scope.environment
  ||a.receiverEdielId!==scope.receiverEdielId||crls.length!==a.priorCrlSha256.length
  ||crls.some((crl,index)=>hash(crl)!==a.priorCrlSha256[index]))return null
 return a
}
