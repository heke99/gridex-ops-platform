import {createHash} from 'node:crypto'
import {supabaseService} from '@/lib/supabase/service'
import {segmentComposite,segmentUntrimmedRaw,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import type {CanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import type {EdielMessageRow} from '@/lib/ediel/types'

export type UtiltsIssuerIdentityFacts=Readonly<{
 status:'qualified'|'held';authorityVersionId:string|null;namespaceEpoch:string|null
 messageReferenceCollision:boolean
 transactionReferenceCollisions:readonly Readonly<{transactionIndex:number;transactionId:string}>[]
 holdReason:string|null
}>
declare const issuerIdentityAuthorityBrand:unique symbol
/** Only an actual source-bound protected read can mint this capability. A
 * visible shape, copied object or current platform actor cannot qualify it. */
export type UtiltsIssuerIdentityAuthority=Readonly<{[issuerIdentityAuthorityBrand]:true}>
const authorities=new WeakMap<object,{source:string;policy:CanonicalEdielPolicy;facts:UtiltsIssuerIdentityFacts}>()
function sourceIdentity(message:EdielMessageRow){return JSON.stringify([message.id,message.company_id,message.environment,message.direction,message.message_standard,
 message.raw_payload?createHash('sha256').update(message.raw_payload,'utf8').digest('hex'):null])}
function mint(message:EdielMessageRow,policy:CanonicalEdielPolicy,facts:UtiltsIssuerIdentityFacts):UtiltsIssuerIdentityAuthority{
 const authority=Object.freeze({}) as UtiltsIssuerIdentityAuthority
 const frozen=Object.freeze({...facts,transactionReferenceCollisions:Object.freeze(facts.transactionReferenceCollisions.map(own=>Object.freeze({...own})))})
 authorities.set(authority,{source:sourceIdentity(message),policy,facts:frozen});return authority
}
function held(message:EdielMessageRow,policy:CanonicalEdielPolicy,reason:string){return mint(message,policy,{status:'held',authorityVersionId:null,namespaceEpoch:null,
 messageReferenceCollision:false,transactionReferenceCollisions:[],holdReason:reason})}

/** Same selected policy and immutable physical original are required on the
 * initial and final engine invocation. Matching customer/site projections may
 * change; neither the original nor the selected national edition may change. */
export function utiltsIssuerIdentityFacts(input:{authority:UtiltsIssuerIdentityAuthority;message:EdielMessageRow;policy:CanonicalEdielPolicy}):UtiltsIssuerIdentityFacts{
 const owner=input.authority&&typeof input.authority==='object'?authorities.get(input.authority):null
 if(!owner||owner.policy!==input.policy||owner.source!==sourceIdentity(input.message))throw new Error('ediel_utilts_issuer_identity_authority_invalid')
 return owner.facts
}

/** Read-only operational identity admission. Authentic foreign legal issuer,
 * transport mandate, retained originals, complete history and lawful retention
 * are separate unseeded versioned grounds. Missing absence evidence is a local
 * hold; it is never a national duplicate. A known authenticated observation
 * can prove a collision without claiming complete historical coverage. */
export async function readUtiltsIssuerIdentityAuthority(input:{message:EdielMessageRow;policy:CanonicalEdielPolicy}):Promise<UtiltsIssuerIdentityAuthority>{
 const {message,policy}=input
 if(policy.family!=='UTILTS'||message.direction!=='inbound'||message.message_standard!=='edifact'||!message.raw_payload||!message.company_id)
  return held(message,policy,'ediel_utilts_foreign_issuer_basis_unavailable')
 let physical:{messageReference:string|null;transactions:readonly {transactionIndex:number;transactionId:string}[]}
 try{
  const wire=tokenizeEdifact(message.raw_payload),unhs=wire.segments.filter(t=>t.tag==='UNH'),bgms=wire.segments.filter(t=>t.tag==='BGM')
  if(unhs.length!==1||bgms.length!==1||segmentComposite(unhs[0],2,wire.una)[0]!=='UTILTS')return held(message,policy,'ediel_utilts_issuer_source_scope_unavailable')
  physical={messageReference:segmentComposite({...bgms[0],raw:segmentUntrimmedRaw(bgms[0])},2,wire.una)[0]||null,
   transactions:wire.segments.filter(t=>t.tag==='IDE').map((t,transactionIndex)=>({transactionIndex,transactionId:segmentComposite({...t,raw:segmentUntrimmedRaw(t)},2,wire.una)[0]}))}
 }catch{return held(message,policy,'ediel_utilts_issuer_source_scope_unavailable')}
 let reply:Awaited<ReturnType<typeof supabaseService.rpc>>
 try{
  reply=await supabaseService.rpc('gridex_read_utilts_issuer_identity_authority_v1',{p_company_id:message.company_id,p_message_id:message.id})
 }catch{
  // This local transport incident proves no namespace/history fact. Preserve
  // the one operational owner's independent national guide diagnostics while
  // holding only otherwise accepted own transactions without an absence claim.
  return held(message,policy,'ediel_utilts_issuer_identity_read_failed')
 }
 const {data,error}=reply
 if(error||!data)return held(message,policy,'ediel_utilts_foreign_issuer_basis_unavailable')
 const result=data as {version?:unknown;companyId?:unknown;environment?:unknown;sourceMessageId?:unknown;sourcePayloadHash?:unknown;
  status?:unknown;authorityVersionId?:unknown;namespaceEpoch?:unknown;messageReferenceCollision?:unknown;transactionReferenceCollisions?:unknown;holdReason?:unknown}
 if(result.version!==1||result.companyId!==message.company_id||result.environment!==message.environment||result.sourceMessageId!==message.id
  ||result.sourcePayloadHash!==createHash('sha256').update(message.raw_payload,'utf8').digest('hex')||!['qualified','held'].includes(String(result.status))
  ||typeof result.messageReferenceCollision!=='boolean'||!Array.isArray(result.transactionReferenceCollisions))throw new Error('ediel_utilts_issuer_identity_read_scope_invalid')
 const collisions=result.transactionReferenceCollisions as {transactionIndex?:unknown;transactionId?:unknown}[]
 if(collisions.some(own=>!Number.isInteger(own.transactionIndex)||typeof own.transactionId!=='string'||!physical.transactions.some(actual=>actual.transactionIndex===own.transactionIndex&&actual.transactionId===own.transactionId))
  ||new Set(collisions.map(own=>own.transactionIndex)).size!==collisions.length||result.messageReferenceCollision&&!physical.messageReference)
  throw new Error('ediel_utilts_issuer_identity_read_scope_invalid')
 const version=typeof result.authorityVersionId==='string'&&/^[0-9a-f-]{36}$/i.test(result.authorityVersionId)?result.authorityVersionId:null
 const epoch=typeof result.namespaceEpoch==='string'&&/^\d+$/.test(result.namespaceEpoch)?result.namespaceEpoch:null
 if((result.status==='qualified'||result.messageReferenceCollision||collisions.length)&&(!version||epoch===null))throw new Error('ediel_utilts_issuer_identity_read_scope_invalid')
 if(result.status==='held'&&(typeof result.holdReason!=='string'||!result.holdReason))throw new Error('ediel_utilts_issuer_identity_read_scope_invalid')
 return mint(message,policy,{status:result.status as 'qualified'|'held',authorityVersionId:version,namespaceEpoch:epoch,messageReferenceCollision:result.messageReferenceCollision,
  transactionReferenceCollisions:collisions as {transactionIndex:number;transactionId:string}[],holdReason:result.status==='held'?result.holdReason as string:null})
}
