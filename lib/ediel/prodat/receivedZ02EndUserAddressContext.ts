import {createHash} from 'node:crypto'
import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterGroups} from './prodatRegisterGroups'
import {evaluateProdatTransactionReason} from './prodatTransactionReason'
import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'

export type ReceivedZ02EndUserAddressContext = Readonly<{kind:'received_z02_end_user_address'}>
export type ReceivedZ02AddressSourceClient = {rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>}
export type ReceivedZ02EndUserAddressFact = Readonly<{
 meteringPointId:string;identityAgency:'9'|'89';endUser:Readonly<{id:string;qualifier:string;agency:string}>;
 availability:'available'|'unavailable';source:Readonly<{kind:'received_z01';companyId:string;originalMessageId:string;originalPayloadHash:string;requestId:string;snapshotId:string}>
}>
export type ReceivedZ02AddressPolicy = {code:string;subtype:string|null;direction:string;applicationReference:string|null}
type EvidenceRecord=Record<string,unknown>
type OwnedContext={scope:string;subtype:'L'|'LK';facts:readonly ReceivedZ02EndUserAddressFact[]}
const contexts=new WeakMap<object,OwnedContext>()
const invalid=():never=>{throw Error('received_z02_end_user_address_source_invalid')}
const record=(v:unknown):EvidenceRecord=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as EvidenceRecord:invalid()
const digest=(v:string)=>createHash('sha256').update(v,'utf8').digest('hex')
/** Retain PostgreSQL microseconds; Date.parse alone would lose clock scope. */
function clock(value:unknown):bigint{
 if(typeof value!=='string')return invalid()
 const match=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/.exec(value)
 const instant=Date.parse(value)
 if(!match||!Number.isFinite(instant))return invalid()
 return BigInt(Math.floor(instant/1000))*BigInt(1_000_000)+BigInt((match[1]??'').padEnd(6,'0'))
}
function scope(row:EdielMessageRow):string{
 return JSON.stringify([row.id,row.company_id,row.environment,row.direction,row.message_standard,row.message_family,row.message_code,
  (row as EdielMessageRow&{immutable_payload_hash?:unknown}).immutable_payload_hash??null,
  row.customer_id,row.site_id,row.grid_owner_id,row.application_reference,clock(row.message_received_at).toString(),row.raw_payload])
}
function wire(raw:string,code:'Z01'|'Z02',environment:unknown){
 const t=tokenizeEdifact(raw),envelope=EdifactEnvelopeCodec.decode(raw)
 const own=(tag:string)=>{const found=t.segments.filter(s=>s.tag===tag);if(found.length!==1)return invalid();return found[0]}
 const unb=own('UNB'),unh=own('UNH'),unt=own('UNT'),unz=own('UNZ'),bgm=own('BGM')
 if(envelope.applicationReference!=='23-DDQ-PRODAT'||envelope.environment!==environment||!['',null,'1'].includes(envelope.testIndicator)
  ||segmentComposite(unh,2,t.una).join(':')!=='PRODAT:D:97A:UN:E2SE6A'||segmentComposite(bgm,1,t.una)[0]!==code
  ||segmentComposite(unt,1,t.una)[0]!==String(unt.index-unh.index+1)||segmentComposite(unt,2,t.una)[0]!==segmentComposite(unh,1,t.una)[0]
  ||segmentComposite(unz,1,t.una)[0]!=='1'||segmentComposite(unz,2,t.una)[0]!==segmentComposite(unb,5,t.una)[0])return invalid()
 const grouped=prodatRegisterGroups(t.segments,t.una,code)
 if(grouped.problems.length||grouped.groups.length!==1)return invalid()
 const group=grouped.groups[0]
 if(!group.itemId||!['9','89'].includes(group.identityAgency??'')||group.registerCount!==1||bgm.index>=group.segments[0].index)return invalid()
 if(evaluateProdatTransactionReason({code,rawSegments:t.segments.map(s=>s.raw),una:t.una}).issues.length)return invalid()
 const reasons=t.segments.filter(s=>s.tag==='CCI'&&segmentComposite(s,2,t.una)[0]==='Z13')
 if(reasons.length!==1||!group.segments.includes(reasons[0]))return invalid()
 const next=t.segments[reasons[0].index+1],reason=next?.tag==='CAV'?segmentComposite(next,1,t.una)[0]:null
 if(reason!=='Z22'&&reason!=='Z23')return invalid()
 const refs=group.segments.filter(s=>s.tag==='RFF'&&segmentComposite(s,1,t.una)[0]==='LI')
 if(refs.length!==1||segmentComposite(refs[0],1,t.una).length!==2||!segmentComposite(refs[0],1,t.una)[1])return invalid()
 const party=(role:string)=>{
  const found=t.segments.filter(s=>s.index<group.segments[0].index&&s.tag==='NAD'&&segmentComposite(s,1,t.una)[0]===role)
  if(found.length!==1)return invalid()
  const identity=segmentComposite(found[0],2,t.una)
  if(identity.length!==3||!identity[0]||identity[1]!=='160'||identity[2]!=='SVK')return invalid()
  return {id:identity[0],tuple:JSON.stringify([identity,segmentComposite(found[0],9,t.una)])}
 }
 if(!envelope.sender||!envelope.receiver)return invalid()
 return {group,una:t.una,reason,li:segmentComposite(refs[0],1,t.una)[1],sender:party('FR'),receiver:party('DO'),envelope,
  transportSender:JSON.stringify(segmentComposite(unb,2,t.una)),transportReceiver:JSON.stringify(segmentComposite(unb,3,t.una))}
}
function assertObject(value:unknown,physical:ReturnType<typeof wire>){
 const object=record(value)
 if(object.objectId!==physical.group.itemId||object.identityAgency!==physical.group.identityAgency
  ||object.lineReference!==physical.li||object.reason!==physical.reason)return invalid()
 return object
}
/** READ only. The RPC qualifies the sealed Z01/CIR/snapshot/accepted attempt;
 * the original physical C059 supplies availability, never the incoming UD. */
export async function fetchReceivedZ02EndUserAddressContext(input:{message:EdielMessageRow;actorUserId:string;client?:ReceivedZ02AddressSourceClient}):Promise<ReceivedZ02EndUserAddressContext|undefined>{
 const m=input.message
 if(m.direction!=='inbound'||m.message_family!=='PRODAT'||m.message_code!=='Z02')return undefined
 if(!isEvidenceUuid(m.id)||!isEvidenceUuid(m.company_id)||!isEvidenceUuid(input.actorUserId)||!m.raw_payload||m.message_standard!=='edifact')return invalid()
 const client=input.client??supabaseService
 const {data,error}=await client.rpc('gridex_ediel_received_z02_address_source_basis_v1',{p_source_message_id:m.id,p_actor_user_id:input.actorUserId})
 if(error!==null)throw Error('received_z02_end_user_address_source_unavailable',{cause:error})
 if(data===null)return undefined
 const p=record(data),original=record(p.originalMessage),source=record(p.sourceMessage)
 if(p.status!=='z02_address_source_basis'||p.version!==1||p.companyId!==m.company_id||p.environment!==m.environment||p.sourceMessageId!==m.id
  ||p.sourceRawPayload!==m.raw_payload||p.sourcePayloadHash!==digest(m.raw_payload)||(m as EdielMessageRow&{immutable_payload_hash?:unknown}).immutable_payload_hash!==p.sourcePayloadHash||clock(p.sourceReceivedAt)!==clock(m.message_received_at)
  ||scope(source as EdielMessageRow)!==scope(m)||!isEvidenceUuid(p.originalMessageId)||original.id!==p.originalMessageId
  ||original.company_id!==m.company_id||original.environment!==m.environment||original.message_standard!=='edifact'||original.direction!=='outbound'||original.message_family!=='PRODAT'||original.message_code!=='Z01'
  ||typeof p.originalRawPayload!=='string'||original.raw_payload!==p.originalRawPayload||p.originalPayloadHash!==digest(p.originalRawPayload)
  ||original.immutable_payload_hash!==p.originalPayloadHash||clock(original.immutable_rendered_at)!==clock(p.originalRenderedAt))return invalid()
 const incoming=wire(m.raw_payload,'Z02',m.environment),outgoing=wire(p.originalRawPayload,'Z01',m.environment)
 if(incoming.sender.tuple!==outgoing.receiver.tuple||incoming.receiver.tuple!==outgoing.sender.tuple||incoming.envelope.sender!==outgoing.envelope.receiver
  ||incoming.envelope.receiver!==outgoing.envelope.sender||incoming.reason!==outgoing.reason||incoming.li!==outgoing.li
  ||incoming.transportSender!==outgoing.transportReceiver||incoming.transportReceiver!==outgoing.transportSender
  ||incoming.group.itemId!==outgoing.group.itemId||incoming.group.identityAgency!==outgoing.group.identityAgency)return invalid()
 assertObject(p.sourceObject,incoming);const originalObject=assertObject(p.originalObject,outgoing)
 const request=record(p.request),snapshot=record(p.requestSnapshot),customer=record(p.customer),site=record(p.site),attempt=record(p.acceptedTransport),receipt=record(p.acceptedTransportReceipt)
 const addressHash=typeof site.address_hash==='string'&&site.address_hash.trim()?site.address_hash.trim():[
  String(site.street??'').trim(),String(site.postal_code??'').replace(/[^0-9]/g,''),String(site.city??'').trim(),
 ].filter(Boolean).join('|').toLowerCase()
 for(const row of [request,snapshot,customer,site,attempt])if(row.company_id!==m.company_id)return invalid()
 if(!isEvidenceUuid(request.id)||!isEvidenceUuid(snapshot.id)||request.customer_id!==m.customer_id||request.site_id!==m.site_id||request.ediel_message_id!==original.id
  ||original.customer_id!==m.customer_id||original.site_id!==m.site_id||customer.id!==m.customer_id||site.id!==m.site_id||site.customer_id!==m.customer_id
  ||snapshot.customer_id!==m.customer_id||snapshot.customer_site_id!==m.site_id||snapshot.operation_id!==request.operation_id||!isEvidenceUuid(request.operation_id)
  ||snapshot.request_kind!=='customer_data_request'||snapshot.request_reference!==request.id||snapshot.superseded_at!==null
  ||snapshot.site_address_hash!==addressHash||snapshot.grid_owner_id!==site.grid_owner_id
  ||[request.grid_owner_id,original.grid_owner_id,m.grid_owner_id].some(grid=>grid!=null&&grid!==site.grid_owner_id)
  ||(String(site.normalized_facility_id??'').trim()||String(site.facility_id??'').trim())!==incoming.group.itemId||!isEvidenceUuid(attempt.id)||attempt.message_id!==original.id
  ||attempt.environment!==m.environment||attempt.classification!=='accepted'||record(attempt.binding).originalHash!==p.originalPayloadHash
  ||clock(p.originalRenderedAt)>clock(attempt.entered_at)||clock(attempt.entered_at)>clock(attempt.observed_at)||clock(attempt.observed_at)>clock(p.sourceReceivedAt)
  ||receipt.status!=='accepted_projection'||receipt.lane!=='generic_journal'||receipt.companyId!==m.company_id||receipt.environment!==m.environment
  ||receipt.messageId!==original.id||receipt.attemptId!==attempt.id||receipt.originalHash!==p.originalPayloadHash||clock(receipt.observedAt)!==clock(attempt.observed_at))return invalid()
 const parties=outgoing.group.segments.filter(s=>s.tag==='NAD'&&segmentComposite(s,1,outgoing.una)[0]==='UD')
 if(parties.length!==1)return invalid()
 const identity=segmentComposite(parties[0],2,outgoing.una),address=segmentComposite(parties[0],5,outgoing.una)
 const organizationId=String(customer.org_number??'').trim(),expectedId=organizationId||String(customer.personal_number??'').trim(),expectedQualifier=organizationId?'SE1':'SE2'
 if(identity.length!==3||identity[0]!==expectedId||identity[1]!==expectedQualifier||identity[2]!=='260'
  ||originalObject.customerId!==identity[0]||originalObject.customerQualifier!==identity[1]||originalObject.customerAgency!==identity[2]
  ||address.length>3||address.some(line=>line.length>35||/[\x00-\x1f\x7f]/.test(line)))return invalid()
 const fact:ReceivedZ02EndUserAddressFact=Object.freeze({meteringPointId:incoming.group.itemId!,identityAgency:incoming.group.identityAgency as '9'|'89',
  endUser:Object.freeze({id:identity[0],qualifier:identity[1],agency:identity[2]}),availability:address.some(line=>line.trim()&&line.trim()!=='.')?'available':'unavailable',
  source:Object.freeze({kind:'received_z01',companyId:m.company_id!,originalMessageId:original.id as string,originalPayloadHash:p.originalPayloadHash as string,requestId:request.id as string,snapshotId:snapshot.id as string})})
 const context:ReceivedZ02EndUserAddressContext=Object.freeze({kind:'received_z02_end_user_address'})
 contexts.set(context,{scope:scope(m),subtype:incoming.reason==='Z22'?'L':'LK',facts:Object.freeze([fact])})
 return context
}
export function redeemReceivedZ02EndUserAddressContext(input:{message:EdielMessageRow;context:ReceivedZ02EndUserAddressContext;policy?:ReceivedZ02AddressPolicy}):readonly ReceivedZ02EndUserAddressFact[]{
 const owned=contexts.get(input.context)
 if(!owned)throw Error('received_z02_end_user_address_context_unqualified')
 let actual:string
 try{actual=scope(input.message)}catch{throw Error('received_z02_end_user_address_context_scope_mismatch')}
 if(owned.scope!==actual)throw Error('received_z02_end_user_address_context_scope_mismatch')
 if(input.policy&&(input.policy.code!=='Z02'||input.policy.direction!=='inbound'||input.policy.subtype!==owned.subtype||input.policy.applicationReference!=='23-DDQ-PRODAT'))throw Error('received_z02_end_user_address_context_policy_mismatch')
 return owned.facts
}
