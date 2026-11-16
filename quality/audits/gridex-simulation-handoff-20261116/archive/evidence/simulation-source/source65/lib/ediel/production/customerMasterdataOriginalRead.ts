import type {EdielMessageRow} from '@/lib/ediel/types'
import {supabaseService} from '@/lib/supabase/service'
import {evidenceHash,isEvidenceRecord,isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {prodatEndUserWireSubtype} from '@/lib/ediel/rulebook/prodatEndUserPolicy'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'

/** Observational original READ only. Neither this token nor its projection is
 * registered with the customer masterdata preparation/sender context owner. */
declare const originalReadBrand:unique symbol
export type CustomerMasterdataOriginalRead=Readonly<{[originalReadBrand]:true}>
declare const acceptedReadBrand:unique symbol
export type AcceptedProdatHOriginalRead=Readonly<{[acceptedReadBrand]:true}>
type AcceptedReadProjection=Readonly<{status:'accepted_projection';companyId:string;environment:'test'|'production';messageId:string;
 originalHash:string;observedAt:string;authorizesProviderEntry:false}>
type ReadProjection=Readonly<{
 status:'authorized';companyId:string;customerId:string;environment:'test'|'production'|null;asOf:string;
 sourceKind:'registered_customer_address'|'signed_contract_masterdata'|'confirmed_customer_history';
 sourceReference:string;sourceDigest:string;sourceContextId:string;
 customerIdentity:Readonly<{id:string;qualifier:'SE1'|'SE2';agency:'260'}>;
 endUserMasterdata:Readonly<{nameParts:readonly string[];streetParts:readonly string[];postalCode:string;city:string;country:string}>;
}>
const issued=new WeakMap<CustomerMasterdataOriginalRead,{identity:string;actor:string;readAt:number;projection:ReadProjection}>()
const acceptedReads=new WeakMap<AcceptedProdatHOriginalRead,{identity:string;actor:string;readAt:number;projection:AcceptedReadProjection}>()
const fresh=(readAt:number)=>Date.now()>=readAt&&Date.now()-readAt<=2000
function originalIdentity(source:EdielMessageRow):string|null {
 const stored=source as EdielMessageRow&{immutable_payload_hash?:unknown;immutable_rendered_at?:unknown}
 if(![source.id,source.company_id,source.created_by,source.customer_id,source.intent_id,source.communication_route_id].every(isEvidenceUuid)
  ||source.direction!=='outbound'||source.message_standard!=='edifact'||source.message_family!=='PRODAT'||source.message_code!=='Z03'
  ||!['test','production'].includes(source.environment)||typeof source.raw_payload!=='string'
  ||Buffer.byteLength(source.raw_payload,'utf8')>262144||stored.immutable_payload_hash!==evidenceHash(source.raw_payload)
  ||parseSourceReceiptInstant(stored.immutable_rendered_at)===null)return null
 return evidenceHash(JSON.stringify([source.id,source.company_id,source.environment,source.direction,source.message_standard,
  source.message_family,source.message_code,source.message_version,source.application_reference,source.raw_payload,
  stored.immutable_payload_hash,stored.immutable_rendered_at,source.created_by,source.created_at,source.customer_id,
  source.intent_id,source.communication_route_id,source.switch_request_id,source.metering_point_id,source.site_id,
  source.canonical_rule_pack_id,source.rule_profile_key,source.rule_profile_version_id,source.rule_profile_version,
  source.rule_pack_checksum,source.rule_pack_snapshot,source.execution_context_snapshot]))
}
function actualH(source:EdielMessageRow):boolean {
 if(!validateEdifactSyntax({...source,status:'received',syntax_check_status:'not_checked',validation_report:{},failure_reason:null}).ok)return false
 const wire=tokenizeEdifact(source.raw_payload!),groups=prodatRegisterGroups(wire.segments,wire.una,'Z03')
 const first=groups.groups.filter(group=>group.registerPosition===1)
 return !groups.problems.length&&first.length>0&&groups.groups.every(group=>group.messageIndex===0&&group.validRegisterChain)
  &&first.every(group=>prodatEndUserWireSubtype('Z03',group.segments,wire.una)==='H')
}
function checkedProjection(value:unknown,source:EdielMessageRow,actor:string):ReadProjection {
 if(!isEvidenceRecord(value))throw Error('customer_masterdata_original_read_result_invalid')
 const data=value,identity=data.customerIdentity,d=data.endUserMasterdata,binding=data.messageBinding
 const parts=(v:unknown,max:number,allowEmptyFirst=false):v is string[]=>Array.isArray(v)&&v.length>=1&&v.length<=max
  &&v.every(item=>typeof item==='string'&&(item.length>=1||allowEmptyFirst)&&item.length<=35&&!/[\x00-\x1f\x7f]/.test(item))
  &&(!allowEmptyFirst||v.some(item=>item.trim()&&item!=='.'))
 if(data.version!==1||data.owner!=='immutable-prodat-customer-masterdata-original-read-v1'
  ||data.actorUserId!==actor||data.originalActorUserId!==source.created_by||data.status!=='authorized'
  ||data.companyId!==source.company_id||data.customerId!==source.customer_id||(data.environment!==null&&data.environment!==source.environment)
  ||parseSourceReceiptInstant(data.asOf)===null||typeof data.sourceKind!=='string'
  ||!['registered_customer_address','signed_contract_masterdata','confirmed_customer_history'].includes(data.sourceKind)
  ||typeof data.sourceReference!=='string'||!data.sourceReference||typeof data.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(data.sourceDigest)
  ||!isEvidenceUuid(data.sourceContextId)||!isEvidenceRecord(binding)||binding.id!==source.id||binding.environment!==source.environment
  ||binding.intentId!==source.intent_id||binding.routeId!==source.communication_route_id||binding.payloadHash!==evidenceHash(source.raw_payload!)
  ||!isEvidenceRecord(identity)||(identity.qualifier!=='SE1'&&identity.qualifier!=='SE2')||identity.agency!=='260'
  ||typeof identity.id!=='string'||!identity.id||identity.id!==identity.id.trim()||identity.id.length>35
  ||!isEvidenceRecord(d)||!parts(d.nameParts,2)||!parts(d.streetParts,3,true)
  ||typeof d.postalCode!=='string'||!d.postalCode||d.postalCode.length>9||typeof d.city!=='string'||!d.city||d.city.length>35
  ||typeof d.country!=='string'||!/^[A-Z]{2}$/.test(d.country)||[identity.id,d.postalCode,d.city].some(value=>/[\x00-\x1f\x7f]/.test(value)))
  throw Error('customer_masterdata_original_read_result_invalid')
 return Object.freeze({status:'authorized',companyId:source.company_id!,customerId:source.customer_id!,environment:data.environment as ReadProjection['environment'],
  asOf:data.asOf as string,sourceKind:data.sourceKind as ReadProjection['sourceKind'],sourceReference:data.sourceReference,sourceDigest:data.sourceDigest,
  sourceContextId:data.sourceContextId,customerIdentity:Object.freeze({id:identity.id,qualifier:identity.qualifier as 'SE1'|'SE2',agency:'260'}),
  endUserMasterdata:Object.freeze({nameParts:Object.freeze([...d.nameParts]),streetParts:Object.freeze([...d.streetParts]),postalCode:d.postalCode,city:d.city,country:d.country})})
}
/** The native READ owns original/current source/profile/retention and actor
 * guards. Unknown original knowledge yields no observational requirement. */
export async function loadCustomerMasterdataOriginalRead(source:EdielMessageRow,actor:string):Promise<CustomerMasterdataOriginalRead|undefined> {
 const before=originalIdentity(source)
 if(!before||!isEvidenceUuid(actor)||!actualH(source))return undefined
 const companyId=source.company_id!,messageId=source.id,readAt=Date.now()
 const rpc=supabaseService.rpc.bind(supabaseService) as unknown as(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
 const {data,error}=await rpc('ediel_read_prodat_customer_masterdata_original_v1',{p_company_id:companyId,p_message_id:messageId,p_actor_user_id:actor})
 if(error)throw error
 if(data===null||originalIdentity(source)!==before||!fresh(readAt))return undefined
 const projection=checkedProjection(data,source,actor),token=Object.freeze({}) as CustomerMasterdataOriginalRead
 issued.set(token,{identity:before,actor,readAt,projection});return token
}
/** Redeem once for this exact original and reader. Copies, changed sources,
 * changed readers and expired tokens do not disclose a qualified projection. */
export function readCustomerMasterdataOriginalProjection(token:CustomerMasterdataOriginalRead|undefined,source:EdielMessageRow,actor:string):ReadProjection|undefined {
 const state=token?issued.get(token):undefined
 if(token)issued.delete(token)
 return state&&fresh(state.readAt)&&state.actor===actor&&state.identity===originalIdentity(source)?state.projection:undefined
}

/** Accepted transport knowledge has its own READ brand, independent of
 * customer availability and every preparation/sender or provider authority. */
export async function loadAcceptedProdatHOriginalRead(source:EdielMessageRow,actor:string):Promise<AcceptedProdatHOriginalRead|undefined> {
 const before=originalIdentity(source)
 if(!before||!isEvidenceUuid(actor)||!actualH(source))return undefined
 const companyId=source.company_id!,messageId=source.id,readAt=Date.now()
 const rpc=supabaseService.rpc.bind(supabaseService) as unknown as(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
 const {data,error}=await rpc('ediel_read_prodat_h_accepted_original_v1',{p_company_id:companyId,p_message_id:messageId,p_actor_user_id:actor})
 if(error)throw error
 if(data===null||originalIdentity(source)!==before||!fresh(readAt))return undefined
 const binding=isEvidenceRecord(data)?data.messageBinding:null
 if(!isEvidenceRecord(data)||data.version!==1||data.owner!=='immutable-prodat-h-accepted-original-read-v1'
  ||data.actorUserId!==actor||data.originalActorUserId!==source.created_by||data.status!=='accepted_projection'
  ||data.companyId!==companyId||data.environment!==source.environment||data.messageId!==messageId
  ||data.originalHash!==evidenceHash(source.raw_payload!)||parseSourceReceiptInstant(data.observedAt)===null||data.authorizesProviderEntry!==false
  ||!isEvidenceRecord(binding)||binding.id!==messageId||binding.environment!==source.environment||binding.intentId!==source.intent_id
  ||binding.routeId!==source.communication_route_id||binding.payloadHash!==evidenceHash(source.raw_payload!))
  throw Error('prodat_h_accepted_original_read_result_invalid')
 const projection:AcceptedReadProjection=Object.freeze({status:'accepted_projection',companyId,environment:source.environment,messageId,
  originalHash:data.originalHash as string,observedAt:data.observedAt as string,authorizesProviderEntry:false})
 const token=Object.freeze({}) as AcceptedProdatHOriginalRead
 acceptedReads.set(token,{identity:before,actor,readAt,projection});return token
}
export function readAcceptedProdatHOriginalProjection(token:AcceptedProdatHOriginalRead|undefined,source:EdielMessageRow,actor:string):AcceptedReadProjection|undefined {
 const state=token?acceptedReads.get(token):undefined
 if(token)acceptedReads.delete(token)
 return state&&fresh(state.readAt)&&state.actor===actor&&state.identity===originalIdentity(source)?state.projection:undefined
}
