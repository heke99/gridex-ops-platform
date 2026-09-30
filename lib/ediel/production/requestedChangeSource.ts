import {createHash} from 'node:crypto'
import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {copyProdatInvoiceeObjects,type ProdatInvoiceeObject} from '@/lib/ediel/prodat/prodatInvoicee'
import type {ProdatDependentConditionFacts} from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
export type RequestedChangeBasis={status:'authorized';companyId:string;environment:'test'|'production';eventId:string;variant:'E'|'F'|'G';eventKind:'death'|'quarter_contract'|'method_contract';supplyPeriodId:string;supplySourceMessageId:string;supplyStateVersion:number;customerId:string;meteringPointId:string;legalActorId:string;legalSenderId:string;legalReceiverId:string;pointId:string;identityAgency:'9'|'89';gridArea:string;brpEdielId:string;effectiveAt:string;sourceReference:string;sourceVersion:string;sourceDigest:string;invoiceeProfile:ProdatInvoiceeObject;customerIdentity:{id:string;qualifier:''|'1'|'SE1'|'SE2';agency:'89'|'260';name:string;addressLines:string[];city:string;postalCode:string;country:string}}
export type RequestedChangeHeld={status:'held';missing:string[]}
type Rpc=(name:string,params:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
const rpc=()=>supabaseService.rpc.bind(supabaseService) as unknown as Rpc
const qualified=new WeakMap<RequestedChangeBasis,{basisHash:string;messageId?:string;payloadHash?:string}>()
const record=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null
function parseBasis(value:unknown):RequestedChangeBasis|RequestedChangeHeld{
 const v=record(value);if(v?.status==='held'&&Array.isArray(v.missing)&&v.missing.every(s=>typeof s==='string'))return {status:'held',missing:v.missing as string[]}
 const identity=record(v?.customerIdentity)
 if(v?.status!=='authorized'||!['test','production'].includes(String(v.environment))||!['E','F','G'].includes(String(v.variant))
 ||!['death','quarter_contract','method_contract'].includes(String(v.eventKind))||!identity||!Array.isArray(identity.addressLines)||identity.addressLines.some(s=>typeof s!=='string')
 ||['companyId','eventId','customerId','meteringPointId','legalActorId','legalSenderId','legalReceiverId','pointId','gridArea','brpEdielId','effectiveAt','sourceReference','sourceVersion','sourceDigest','supplyPeriodId','supplySourceMessageId'].some(k=>typeof v[k]!=='string'||!v[k])
 ||!Number.isSafeInteger(v.supplyStateVersion)||!['9','89'].includes(String(v.identityAgency))
 ||['id','qualifier','agency','name','city','postalCode','country'].some(k=>typeof identity[k]!=='string')||!['','1','SE1','SE2'].includes(String(identity.qualifier))||!(identity.qualifier===''?identity.agency==='89':identity.agency==='260'))throw Error('requested_change_source_result_invalid')
 const at=new Date(v.effectiveAt as string),profile=copyProdatInvoiceeObjects([v.invoiceeProfile])[0]
 if(Number.isNaN(at.getTime())||at.getUTCSeconds()!==0||at.getUTCMilliseconds()!==0||!Number(v.supplyStateVersion)||! /^[a-f0-9]{64}$/.test(v.sourceDigest as string)||v.eventKind!==({E:'death',F:'quarter_contract',G:'method_contract'} as const)[v.variant as 'E'|'F'|'G']||profile.source.companyId!==v.companyId||profile.meteringPointId!==v.pointId||profile.identityAgency!==v.identityAgency)throw Error('requested_change_source_result_invalid')
 return v as unknown as RequestedChangeBasis
}
export async function readRequestedChangeSource(input:{companyId:string;eventId:string;actorUserId:string}):Promise<RequestedChangeBasis|RequestedChangeHeld>{
 const{data,error}=await rpc()('ediel_requested_change_source_v1',{p_company_id:input.companyId,p_event_id:input.eventId,p_actor_user_id:input.actorUserId});if(error)throw error
 const basis=parseBasis(data);if(basis.status==='authorized'){if(basis.companyId!==input.companyId||basis.eventId!==input.eventId)throw Error('requested_change_source_selector_mismatch');qualified.set(basis,{basisHash:createHash('sha256').update(JSON.stringify(basis)).digest('hex')})}return basis
}
/** This predicate recognizes only actual current private RPC results, never an
 * equivalent object, saved metadata or a boolean supplied by a caller. */
export function isRequestedChangeBasisQualified(basis:unknown,row:{company_id?:string|null;companyId?:string|null;environment?:string|null;direction?:string|null;message_family?:string|null;messageFamily?:string|null;message_code?:string|null;messageCode?:string|null;source_operation_id?:string|null;sourceOperationId?:string|null;customer_id?:string|null;customerId?:string|null;metering_point_id?:string|null;meteringPointId?:string|null;id?:string;raw_payload?:string|null;rawPayload?:string|null}):basis is RequestedChangeBasis{
 if(!basis||typeof basis!=='object')return false;const b=basis as RequestedChangeBasis,q=qualified.get(b);if(!q||q.basisHash!==createHash('sha256').update(JSON.stringify(b)).digest('hex'))return false
 if((row.company_id??row.companyId)!==b.companyId||row.environment!==b.environment||row.direction!=='outbound'||(row.message_family??row.messageFamily)!=='PRODAT'||(row.message_code??row.messageCode)!=='Z09'||(row.source_operation_id??row.sourceOperationId)!==b.eventId||(row.customer_id??row.customerId)!==b.customerId||(row.metering_point_id??row.meteringPointId)!==b.meteringPointId)return false
 return !q.messageId||(row.id===q.messageId&&createHash('sha256').update(row.raw_payload??row.rawPayload??'','utf8').digest('hex')===q.payloadHash)
}
export function requestedChangeRegisterFacts(b:RequestedChangeBasis):ProdatDependentConditionFacts{
 const user=b.customerIdentity
 return {market:'electricity',canonicalSubtype:b.variant,invoiceeObjects:b.variant==='E'?[b.invoiceeProfile]:[],endUserAddressObjects:b.variant==='E'?[{meteringPointId:b.pointId,identityAgency:b.identityAgency,endUser:{id:user.id,qualifier:user.qualifier,agency:user.agency},availability:user.addressLines.some(Boolean)?'available':'unavailable',addressLines:user.addressLines,source:{kind:'caller_selection',companyId:b.companyId,reference:b.sourceReference}}]:[]}
}
export async function originateRequestedChange(input:{companyId:string;eventId:string;actorUserId:string;route:Record<string,unknown>}):Promise<{status:'originated';intentId:string;outboundRequestId:string;messageId:string|null}|RequestedChangeHeld>{
 const{data,error}=await rpc()('ediel_originate_requested_change_v1',{p_company_id:input.companyId,p_event_id:input.eventId,p_actor_user_id:input.actorUserId,p_route:input.route});if(error)throw error
 const v=record(data);if(v?.status==='held'&&Array.isArray(v.missing))return v as unknown as RequestedChangeHeld
 if(v?.status!=='originated'||typeof v.intentId!=='string'||typeof v.outboundRequestId!=='string'||!(v.messageId===null||typeof v.messageId==='string'))throw Error('requested_change_origin_result_invalid');return v as unknown as {status:'originated';intentId:string;outboundRequestId:string;messageId:string|null}
}
export async function assertRequestedChangeSendSource(message:EdielMessageRow,actorUserId:string):Promise<RequestedChangeBasis|null>{
 if(!message.company_id||message.direction!=='outbound')return null
 const wire=tokenizeEdifact(message.raw_payload??'')
 if(!wire.segments.some(t=>t.tag==='BGM'&&segmentComposite(t,1,wire.una)[0]==='Z09')||!wire.segments.some(t=>t.tag==='CAV'&&['E34','E64','E32'].includes(segmentComposite(t,1,wire.una)[0]??'')))return null
 const{data,error}=await rpc()('ediel_requested_change_message_basis_v1',{p_company_id:message.company_id,p_message_id:message.id,p_actor_user_id:actorUserId});if(error)throw error
 const{error:guardError}=await rpc()('ediel_require_requested_change_source_current_v1',{p_company_id:message.company_id,p_message_id:message.id});if(guardError)throw guardError
 if(data===null)return null;const v=record(data),basis=parseBasis(v?.basis)
 if(basis.status!=='authorized'||v?.messageId!==message.id||v.intentId!==message.intent_id||v.payloadHash!==createHash('sha256').update(message.raw_payload??'','utf8').digest('hex'))throw Error('requested_change_current_message_basis_invalid')
 qualified.set(basis,{basisHash:createHash('sha256').update(JSON.stringify(basis)).digest('hex'),messageId:message.id,payloadHash:v.payloadHash as string});if(!isRequestedChangeBasisQualified(basis,message))throw Error('requested_change_current_message_scope_mismatch');return basis
}
