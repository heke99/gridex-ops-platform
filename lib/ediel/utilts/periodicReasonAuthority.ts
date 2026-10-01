import {createHash} from 'node:crypto'
import {supabaseService} from '@/lib/supabase/service'
import {segmentComposite,segmentUntrimmedRaw,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import type {CanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import type {EdielMessageRow} from '@/lib/ediel/types'
export type PeriodicReasonFacts=Readonly<{status:'qualified'|'held'|'not_applicable';holdReason:string|null;expectedReasons:readonly Readonly<{transactionIndex:number;transactionId:string;reasonCode:'E23'|'E88';receivedReasonCode:string;scopeHash:string;agreementReviewIds:readonly string[]}>[]}>
declare const periodicReasonBrand:unique symbol
export type PeriodicReasonAuthority=Readonly<{[periodicReasonBrand]:true}>
const owners=new WeakMap<object,{source:string;policy:CanonicalEdielPolicy;facts:PeriodicReasonFacts}>()
const hash=(raw:string)=>createHash('sha256').update(raw,'utf8').digest('hex')
const sourceIdentity=(m:EdielMessageRow)=>JSON.stringify([m.id,m.company_id,m.environment,m.direction,m.message_standard,m.raw_payload?hash(m.raw_payload):null])
function mint(message:EdielMessageRow,policy:CanonicalEdielPolicy,facts:PeriodicReasonFacts):PeriodicReasonAuthority{
 const authority=Object.freeze({}) as PeriodicReasonAuthority
 owners.set(authority,{source:sourceIdentity(message),policy,facts:Object.freeze({...facts,expectedReasons:Object.freeze(facts.expectedReasons.map(x=>Object.freeze({...x,agreementReviewIds:Object.freeze([...x.agreementReviewIds])})))})});return authority
}
export function periodicReasonFacts(input:{authority:PeriodicReasonAuthority;message:EdielMessageRow;policy:CanonicalEdielPolicy}){
 const owner=input.authority&&typeof input.authority==='object'?owners.get(input.authority):undefined
 if(!owner||owner.policy!==input.policy||owner.source!==sourceIdentity(input.message))throw Error('ediel_periodic_reason_authority_invalid')
 return owner.facts
}
/** The physical profile selects whether a protected read is needed. It cannot
 * itself qualify a receiver, assignment, contract or reason exception. */
export function needsPeriodicDgiReason(message:EdielMessageRow,policy:CanonicalEdielPolicy){
 if(policy.family!=='UTILTS'||policy.code!=='E66'||message.direction!=='inbound'||message.message_standard!=='edifact'||!message.raw_payload)return false
 try{const wire=tokenizeEdifact(message.raw_payload),unbs=wire.segments.filter(x=>x.tag==='UNB');return unbs.length===1&&/^23-DGI-E66-(S|T)$/.test(segmentComposite(unbs[0],7,wire.una)[0]??'')}catch{return false}
}
export async function readPeriodicReasonAuthority(input:{message:EdielMessageRow;policy:CanonicalEdielPolicy}):Promise<PeriodicReasonAuthority|undefined>{
 const {message,policy}=input;if(!needsPeriodicDgiReason(message,policy))return undefined
 const held=(reason:string)=>mint(message,policy,{status:'held',holdReason:reason,expectedReasons:[]})
 if(!message.company_id)return held('ediel_periodic_reason_tenant_required')
 const wire=tokenizeEdifact(message.raw_payload!),transactions=wire.segments.filter(x=>x.tag==='IDE').map((x,transactionIndex)=>{
  const end=wire.segments.find(next=>next.index>x.index&&['IDE','SEQ','UNT'].includes(next.tag))?.index??Infinity
  const reasons=wire.segments.filter(next=>next.tag==='STS'&&next.index>x.index&&next.index<end&&segmentComposite(next,1,wire.una)[0]==='7')
  return {transactionIndex,transactionId:segmentComposite({...x,raw:segmentUntrimmedRaw(x)},2,wire.una)[0],receivedReasonCode:reasons.length===1?segmentComposite(reasons[0],3,wire.una)[0]:null}
 })
 let reply:Awaited<ReturnType<typeof supabaseService.rpc>>
 try{reply=await supabaseService.rpc('gridex_read_periodic_dgi_e66_reason_v1',{p_company_id:message.company_id,p_message_id:message.id})}catch{return held('ediel_periodic_reason_read_failed')}
 if(reply.error||!reply.data)return held('ediel_periodic_reason_source_unavailable')
 const r=reply.data as Record<string,unknown>
 if(r.version!==1||r.companyId!==message.company_id||r.environment!==message.environment||r.sourceMessageId!==message.id||r.sourcePayloadHash!==hash(message.raw_payload!)||!['qualified','held','not_applicable'].includes(String(r.status))||!Array.isArray(r.expectedReasons))throw Error('ediel_periodic_reason_read_scope_invalid')
 const expected=r.expectedReasons as PeriodicReasonFacts['expectedReasons']
 if(expected.some(x=>!x||!Number.isInteger(x.transactionIndex)||!transactions.some(t=>t.transactionIndex===x.transactionIndex&&t.transactionId===x.transactionId&&t.receivedReasonCode===x.receivedReasonCode)||!['E23','E88'].includes(x.reasonCode)||typeof x.receivedReasonCode!=='string'||!/^[a-f0-9]{64}$/.test(x.scopeHash)||!Array.isArray(x.agreementReviewIds)||x.agreementReviewIds.some(id=>typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))||x.agreementReviewIds.length<2||new Set(x.agreementReviewIds).size!==x.agreementReviewIds.length)||new Set(expected.map(x=>x.transactionIndex)).size!==expected.length||r.status==='qualified'&&(expected.length!==transactions.length||transactions.length===0)||r.status==='held'&&(expected.length!==0||typeof r.holdReason!=='string'||!r.holdReason))throw Error('ediel_periodic_reason_read_scope_invalid')
 if(r.status==='not_applicable'&&(expected.length!==0||r.holdReason!==null))throw Error('ediel_periodic_reason_read_scope_invalid')
 return mint(message,policy,{status:r.status as PeriodicReasonFacts['status'],holdReason:r.status==='held'?r.holdReason as string:null,expectedReasons:expected})
}
