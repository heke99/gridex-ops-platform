import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {tokenizeEdifact,segmentComposite} from './edifactTokenizer'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'
declare const sourceCapabilityBrand:unique symbol
export type SourceQualifiedProdatBilateralCapability=Readonly<{companyId:string;environment:string;sourceMessageId:string;sourcePayloadHash:string;messageCode:string;subtype:'A'|'D'|'H'|'LK';owner:'immutable-bilateral-prodat-profile-v1'|'immutable-regulated-supply-ground-v1';objects:readonly Readonly<{objectId:string;identityAgency:'9'|'89';firstLineIndex:number;lineItemReference:string;profileVersionId:string;process:string;sourceHash:string;sourceGrammarHash:string}>[];[sourceCapabilityBrand]:true}>
const capabilities=new WeakMap<SourceQualifiedProdatBilateralCapability,{raw:string;sourceBasis:string}>()
const object=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
const contextKeys=['version','contextOrigin','sourceMessageId','companyId','environment','messageCode','payloadHash','sourceReceivedAt','capturedAt']
/** Compare the actual insertion context and clocks at PostgreSQL precision.
 * UTC spellings may differ between SQL snapshots and PostgREST rows. */
function sourceBasis(value:unknown):string|null{
 const row=object(value),context=object(object(row?.execution_context_snapshot)?.receivedProdatContext)
 if(!row||row.direction!=='inbound'||row.message_standard!=='edifact'||row.message_family!=='PRODAT'||typeof row.raw_payload!=='string'
  ||!context||Object.keys(context).length!==contextKeys.length||!contextKeys.every(key=>Object.hasOwn(context,key))
  ||context.version!==1||context.contextOrigin!=='database_insert'||context.sourceMessageId!==row.id||context.companyId!==row.company_id
  ||context.environment!==row.environment||context.messageCode!==row.message_code||context.payloadHash!==evidenceHash(row.raw_payload))return null
 const received=parseSourceReceiptInstant(row.message_received_at),created=parseSourceReceiptInstant(row.created_at),captured=parseSourceReceiptInstant(context.capturedAt)
 const document=row.message_created_at===null?null:parseSourceReceiptInstant(row.message_created_at)
 if(received===null||created===null||captured===null||parseSourceReceiptInstant(context.sourceReceivedAt)!==received
  ||(row.message_created_at!==null&&document===null)
  ||!(row.message_version===null||typeof row.message_version==='string')||!(row.application_reference===null||typeof row.application_reference==='string'))return null
 return JSON.stringify([row.id,row.company_id,row.environment,row.direction,row.message_standard,row.message_family,row.message_code,
  row.message_version,row.application_reference,evidenceHash(row.raw_payload),document?.toString()??null,received.toString(),created.toString(),
  context.version,context.contextOrigin,context.sourceMessageId,context.companyId,context.environment,context.messageCode,context.payloadHash,captured.toString()])
}
/** The native original/context/rule owners and current archived issuer/reviewer
 * receipts establish only this physical source's process capability. Full
 * canonical fields, functional checks and committed own outcomes remain gates. */
export async function readSourceQualifiedProdatBilateralCapability(message:EdielMessageRow):Promise<SourceQualifiedProdatBilateralCapability|null>{
 if(message.direction!=='inbound'||message.message_standard!=='edifact'||message.message_family!=='PRODAT'||!uuid(message.id)||!uuid(message.company_id)||!message.raw_payload||!['test','production'].includes(message.environment))return null
 const rpc=supabaseService.rpc.bind(supabaseService) as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
 const {data,error}=await rpc('ediel_read_prodat_bilateral_source_capability_v1',{p_company_id:message.company_id,p_source_message_id:message.id});if(error)throw error;if(data===null)return null
 const r=object(data),raw=message.raw_payload
 if(r?.version!==1||!['immutable-bilateral-prodat-profile-v1','immutable-regulated-supply-ground-v1'].includes(String(r.owner))||r.companyId!==message.company_id||r.environment!==message.environment||r.sourceMessageId!==message.id||r.sourcePayloadHash!==evidenceHash(raw)||r.messageCode!==message.message_code||!['A','D','H','LK'].includes(String(r.subtype))||!Array.isArray(r.objects))throw Error('prodat_bilateral_source_receipt_unqualified')
 const wire=tokenizeEdifact(raw),groups=prodatRegisterGroups(wire.segments,wire.una).groups.filter(g=>g.validRegisterChain&&g.firstLineIndex===g.lineIndex)
 if(r.objects.length!==groups.length||!groups.length)throw Error('prodat_bilateral_whole_physical_scope_required')
 for(const [index,group]of groups.entries()){
  const own=object(r.objects[index]),refs=group.segments.filter(t=>t.tag==='RFF'&&segmentComposite(t,1,wire.una)[0]==='LI'),li=refs.length===1?segmentComposite(refs[0],1,wire.una)[1]:null
  const process=r.subtype==='A'?'assigned_supply':r.subtype==='D'?'production_receipt_obligation':r.subtype==='H'?(r.messageCode==='Z04'?'normal_start_h':'own_end_h'):'closure_request_lk'
  if(group.messageIndex!==0||!own||own.objectId!==group.itemId||own.identityAgency!==group.identityAgency||own.firstLineIndex!==group.firstLineIndex||own.lineItemReference!==li||!li||!uuid(own.profileVersionId)||own.process!==process||!hash(own.sourceHash)||!hash(own.sourceGrammarHash))throw Error('prodat_bilateral_own_physical_scope_required')
 }
 // The receipt authenticates the stored original, not initially supplied row
 // metadata. Read its clocks/version/context before creating the private basis.
 const stored=await supabaseService.from('ediel_messages').select('id,company_id,environment,direction,message_standard,message_family,message_code,message_version,application_reference,raw_payload,message_created_at,message_received_at,created_at,execution_context_snapshot').eq('id',message.id).eq('company_id',message.company_id).single()
 if(stored.error)throw stored.error
 const basis=sourceBasis(stored.data)
 if(!basis||basis!==sourceBasis(message))throw Error('prodat_bilateral_original_metadata_unqualified')
 const qualification=Object.freeze({...r,objects:Object.freeze(r.objects.map(own=>Object.freeze({...object(own)!})))}) as unknown as SourceQualifiedProdatBilateralCapability
 capabilities.set(qualification,{raw,sourceBasis:basis});return qualification
}
/** Copies, public JSON and altered original rows cannot redeem a capability. */
export function sourceQualifiedProdatBilateralCapability(message:EdielMessageRow,qualification?:SourceQualifiedProdatBilateralCapability|null):SourceQualifiedProdatBilateralCapability|null{
 const basis=qualification?capabilities.get(qualification):null
 return basis&&basis.raw===message.raw_payload&&basis.sourceBasis===sourceBasis(message)&&qualification!.companyId===message.company_id&&qualification!.environment===message.environment&&qualification!.sourceMessageId===message.id&&qualification!.sourcePayloadHash===evidenceHash(message.raw_payload??'')&&qualification!.messageCode===message.message_code?qualification!:null
}
