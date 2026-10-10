import {createHash} from 'node:crypto'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {supabaseService} from '@/lib/supabase/service'
import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {END_USER_ADDRESS_CODES} from '@/lib/ediel/prodat/prodatEndUserAddress'
export type SourceQualifiedCustomerMasterdataProjection={status:'authorized';companyId:string;customerId:string;environment:'test'|'production'|null;asOf:string;
 sourceKind:'registered_customer_address'|'signed_contract_masterdata'|'confirmed_customer_history';sourceReference:string;sourceDigest:string;sourceContextId:string;
 customerIdentity:{id:string;qualifier:'SE1'|'SE2';agency:'260'};endUserMasterdata:{nameParts:string[];streetParts:string[];postalCode:string;city:string;country:string}}
export async function prepareCustomerMasterdataSource(input:{companyId:string;customerId:string;actorUserId:string;asOf?:string;environment?:'test'|'production'}):Promise<SourceQualifiedCustomerMasterdataProjection>{
 const asOf=input.asOf??new Date().toISOString()
 if(!/(?:Z|[+-]\d{2}:\d{2})$/.test(asOf)||!Number.isFinite(Date.parse(asOf)))throw Error('customer_masterdata_source_date_required')
 const{data,error}=await supabaseService.rpc('ediel_prepare_customer_masterdata_v1',{p_company_id:input.companyId,p_customer_id:input.customerId,p_actor_user_id:input.actorUserId,p_as_of:asOf,p_environment:input.environment??null})
 if(error)throw error
 if(data?.status==='held')throw Error(`customer_masterdata_source_held:${Array.isArray(data.missing)?data.missing.join(','):'unknown'}`)
 return checkedProjection(data,{...input,asOf})
}

export type CustomerMasterdataValidationContext={kind:'customer_masterdata';companyId:string;customerId:string;environment:'test'|'production';rawPayload:string;intentId:string;routeId:string;projection:SourceQualifiedCustomerMasterdataProjection}
const projections=new WeakSet<object>(),contexts=new WeakSet<object>()
export function isQualifiedCustomerMasterdataProjection(value:unknown):value is SourceQualifiedCustomerMasterdataProjection{return !!value&&typeof value==='object'&&projections.has(value)}
function rememberProjection(value:SourceQualifiedCustomerMasterdataProjection):SourceQualifiedCustomerMasterdataProjection{
 Object.freeze(value.customerIdentity);Object.freeze(value.endUserMasterdata.nameParts);Object.freeze(value.endUserMasterdata.streetParts);Object.freeze(value.endUserMasterdata);Object.freeze(value);projections.add(value);return value
}
export function bindCustomerMasterdataValidationContext(input:CustomerMasterdataValidationContext):CustomerMasterdataValidationContext{
 const p=input.projection
 if(!projections.has(p)||input.kind!=='customer_masterdata'||p.companyId!==input.companyId||p.customerId!==input.customerId||(p.environment!==null&&p.environment!==input.environment)||!input.rawPayload||!input.intentId||!input.routeId)throw Error('customer_masterdata_validation_context_unqualified')
 const context=Object.freeze({...input});contexts.add(context);return context
}
export function isQualifiedCustomerMasterdataValidationContext(value:unknown):value is CustomerMasterdataValidationContext{return !!value&&typeof value==='object'&&contexts.has(value)}

function checkedProjection(value:unknown,input:{companyId:string;customerId:string;asOf:string;environment?:'test'|'production'}):SourceQualifiedCustomerMasterdataProjection{
 const asOf=input.asOf
 const data=value as Partial<SourceQualifiedCustomerMasterdataProjection>|null
 const identity=data?.customerIdentity,d=data?.endUserMasterdata,parts=(v:unknown,max:number,allowEmptyFirst=false)=>Array.isArray(v)&&v.length>=1&&v.length<=max&&v.every(item=>typeof item==='string'&&(item.length>=1||allowEmptyFirst)&&item.length<=35&&!/[\x00-\x1f\x7f]/.test(item))&&(!allowEmptyFirst||v.some(item=>item.trim()&&item!=='.'))
 if(data?.status!=='authorized'||data.companyId!==input.companyId||data.customerId!==input.customerId||data.environment!==(input.environment??null)||typeof data.asOf!=='string'||Date.parse(data.asOf)!==Date.parse(asOf)||typeof data.sourceKind!=='string'||!['registered_customer_address','signed_contract_masterdata','confirmed_customer_history'].includes(data.sourceKind)||!data.sourceReference||typeof data.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(data.sourceDigest)||!isEvidenceUuid(data.sourceContextId)||!identity||!['SE1','SE2'].includes(identity.qualifier)||identity.agency!=='260'||typeof identity.id!=='string'||!identity.id||identity.id!==identity.id.trim()||identity.id.length>35||!d||!parts(d.nameParts,2)||!parts(d.streetParts,3,true)||typeof d.postalCode!=='string'||!d.postalCode||d.postalCode.length>9||typeof d.city!=='string'||!d.city||d.city.length>35||typeof d.country!=='string'||!/^[A-Z]{2}$/.test(d.country)||[identity.id,d.postalCode,d.city].some(value=>/[\x00-\x1f\x7f]/.test(value)))throw Error('customer_masterdata_source_result_invalid')
 return rememberProjection(data as SourceQualifiedCustomerMasterdataProjection)
}

export async function loadCustomerMasterdataValidationContext(message:EdielMessageRow,actorUserId:string):Promise<CustomerMasterdataValidationContext|undefined>{
 if(message.direction!=='outbound'||message.message_family!=='PRODAT'||!END_USER_ADDRESS_CODES.includes(message.message_code??''))return undefined
 if(!message.company_id||!message.raw_payload)throw Error('customer_masterdata_message_scope_required')
 const{data,error}=await supabaseService.rpc('ediel_customer_masterdata_message_basis_v1',{p_company_id:message.company_id,p_message_id:message.id,p_actor_user_id:actorUserId});if(error)throw error;if(data===null)return undefined
 if(!message.customer_id||!message.intent_id||!message.communication_route_id)throw Error('customer_masterdata_message_scope_required')
 const binding=data?.messageBinding
 if(binding?.id!==message.id||binding.environment!==message.environment||binding.intentId!==message.intent_id||binding.routeId!==message.communication_route_id||binding.payloadHash!==createHash('sha256').update(message.raw_payload).digest('hex'))throw Error('customer_masterdata_message_basis_invalid')
 const projection=checkedProjection(data,{companyId:message.company_id,customerId:message.customer_id,asOf:data.asOf,...(data.environment===null?{}:{environment:message.environment})})
 return bindCustomerMasterdataValidationContext({kind:'customer_masterdata',companyId:message.company_id,customerId:message.customer_id,environment:message.environment,rawPayload:message.raw_payload,intentId:message.intent_id,routeId:message.communication_route_id,projection})
}

/** The reserved native correction selects the terminal customer's original
 * dated proof. It creates a new current actor/operation preparation and checks
 * the corrected bytes; a copied old context or raw UD flag cannot grant it. */
export async function prepareRecoveryCustomerMasterdataContext(input:{companyId:string;operationId:string;actorUserId:string;intentId:string;routeId:string;customerId:string;environment:'test'|'production';rawPayload:string}):Promise<CustomerMasterdataValidationContext|undefined>{
 if(![input.companyId,input.operationId,input.actorUserId,input.intentId,input.routeId,input.customerId].every(isEvidenceUuid)||!input.rawPayload)throw Error('customer_masterdata_recovery_scope_required')
 const rpc=supabaseService.rpc.bind(supabaseService) as unknown as(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
 const{data,error}=await rpc('ediel_prepare_customer_masterdata_recovery_v1',{p_company_id:input.companyId,p_operation_id:input.operationId,p_actor_user_id:input.actorUserId,p_intent_id:input.intentId,p_route_id:input.routeId})
 if(error)throw error
 if(data===null)return undefined // Native physical wire contains no UD object.
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('customer_masterdata_recovery_binding_invalid')
 const value=data as Partial<SourceQualifiedCustomerMasterdataProjection>&{missing?:string[];recoveryBinding?:Record<string,unknown>}
 if((data as {status?:unknown}).status==='held')throw Error(`customer_masterdata_recovery_source_held:${Array.isArray(value.missing)?value.missing.join(','):'unknown'}`)
 const binding=value.recoveryBinding
 if(!binding||binding.operationId!==input.operationId||binding.actorUserId!==input.actorUserId||binding.intentId!==input.intentId||binding.routeId!==input.routeId||binding.environment!==input.environment||![binding.originalMessageId,binding.sourceOriginMessageId].every(isEvidenceUuid)||binding.payloadHash!==createHash('sha256').update(input.rawPayload).digest('hex')||typeof value.asOf!=='string')throw Error('customer_masterdata_recovery_binding_invalid')
 const projection=checkedProjection(value,{companyId:input.companyId,customerId:input.customerId,asOf:value.asOf,...(value.environment===null?{}:{environment:input.environment})})
 return bindCustomerMasterdataValidationContext({kind:'customer_masterdata',companyId:input.companyId,customerId:input.customerId,environment:input.environment,rawPayload:input.rawPayload,intentId:input.intentId,routeId:input.routeId,projection})
}

/** The cancellation owner reads the actual original's protected dated source
 * in prepare phase. Its creator can differ from this authorized preparer. */
export async function loadSwitchCancellationCustomerMasterdataValidationContext(message:EdielMessageRow,switchRequestId:string,actorUserId:string):Promise<CustomerMasterdataValidationContext|undefined>{
 if(message.direction!=='outbound'||message.message_family!=='PRODAT'||message.message_code!=='Z03')throw Error('customer_masterdata_cancellation_original_scope_required')
 if(![message.company_id,message.id,message.customer_id,message.intent_id,message.communication_route_id,message.created_by,switchRequestId,actorUserId].every(isEvidenceUuid)||!message.raw_payload)throw Error('customer_masterdata_cancellation_original_scope_required')
 const rpc=supabaseService.rpc.bind(supabaseService) as unknown as(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
 const{data,error}=await rpc('ediel_switch_cancellation_customer_masterdata_basis_v1',{p_company_id:message.company_id,p_switch_id:switchRequestId,p_actor_user_id:actorUserId})
 if(error)throw error
 if(data===null)return undefined
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('customer_masterdata_cancellation_original_binding_invalid')
 const value=data as Partial<SourceQualifiedCustomerMasterdataProjection>&{messageBinding?:Record<string,unknown>;cancellationSourceBinding?:Record<string,unknown>}
 const binding=value.messageBinding,source=value.cancellationSourceBinding,hash=createHash('sha256').update(message.raw_payload).digest('hex')
 if(!binding||binding.id!==message.id||binding.environment!==message.environment||binding.intentId!==message.intent_id||binding.routeId!==message.communication_route_id||binding.payloadHash!==hash
  ||!source||source.switchRequestId!==switchRequestId||source.actorUserId!==actorUserId||source.originalMessageId!==message.id||source.originalHash!==hash||source.environment!==message.environment||source.originalPreparerId!==message.created_by||typeof value.asOf!=='string')throw Error('customer_masterdata_cancellation_original_binding_invalid')
 const projection=checkedProjection(value,{companyId:message.company_id!,customerId:message.customer_id!,asOf:value.asOf,...(value.environment===null?{}:{environment:message.environment})})
 return bindCustomerMasterdataValidationContext({kind:'customer_masterdata',companyId:message.company_id!,customerId:message.customer_id!,environment:message.environment,rawPayload:message.raw_payload,intentId:message.intent_id!,routeId:message.communication_route_id!,projection})
}

/** A reserved cancellation receives a fresh current-preparer preparation.
 * The original read context is rendering input, never its INSERT credential. */
export async function prepareSwitchCancellationCustomerMasterdataContext(input:{companyId:string;operationId:string;actorUserId:string;intentId:string;routeId:string;customerId:string;environment:'test'|'production';switchRequestId:string;originalMessageId:string;originalHash:string;rawPayload:string;sourceContext:CustomerMasterdataValidationContext}):Promise<CustomerMasterdataValidationContext>{
 if(![input.companyId,input.operationId,input.actorUserId,input.intentId,input.routeId,input.customerId,input.switchRequestId,input.originalMessageId].every(isEvidenceUuid)||!input.rawPayload||!/^[a-f0-9]{64}$/.test(input.originalHash)
  ||!isQualifiedCustomerMasterdataValidationContext(input.sourceContext)||input.sourceContext.companyId!==input.companyId||input.sourceContext.customerId!==input.customerId||input.sourceContext.environment!==input.environment||createHash('sha256').update(input.sourceContext.rawPayload).digest('hex')!==input.originalHash)throw Error('customer_masterdata_cancellation_scope_required')
 const rpc=supabaseService.rpc.bind(supabaseService) as unknown as(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
 const{data,error}=await rpc('ediel_prepare_switch_cancellation_customer_masterdata_v1',{p_company_id:input.companyId,p_operation_id:input.operationId,p_actor_user_id:input.actorUserId,p_intent_id:input.intentId,p_route_id:input.routeId,p_raw_payload:input.rawPayload})
 if(error)throw error
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('customer_masterdata_cancellation_binding_invalid')
 const value=data as Partial<SourceQualifiedCustomerMasterdataProjection>&{cancellationBinding?:Record<string,unknown>},binding=value.cancellationBinding,source=input.sourceContext.projection
 if(!binding||binding.operationId!==input.operationId||binding.switchRequestId!==input.switchRequestId||binding.actorUserId!==input.actorUserId||binding.intentId!==input.intentId||binding.routeId!==input.routeId||binding.environment!==input.environment
  ||binding.originalMessageId!==input.originalMessageId||binding.originalHash!==input.originalHash||binding.payloadHash!==createHash('sha256').update(input.rawPayload).digest('hex')
  ||value.environment!==source.environment||value.sourceContextId===source.sourceContextId||value.sourceKind!==source.sourceKind||value.sourceReference!==source.sourceReference||value.sourceDigest!==source.sourceDigest)throw Error('customer_masterdata_cancellation_binding_invalid')
 const projection=checkedProjection(value,{companyId:input.companyId,customerId:input.customerId,asOf:source.asOf,...(value.environment===null?{}:{environment:input.environment})})
 const identity=projection.customerIdentity,originalIdentity=source.customerIdentity,d=projection.endUserMasterdata,original=source.endUserMasterdata
 if(identity.id!==originalIdentity.id||identity.qualifier!==originalIdentity.qualifier||identity.agency!==originalIdentity.agency||JSON.stringify(d.nameParts)!==JSON.stringify(original.nameParts)||JSON.stringify(d.streetParts)!==JSON.stringify(original.streetParts)||d.postalCode!==original.postalCode||d.city!==original.city||d.country!==original.country)throw Error('customer_masterdata_cancellation_source_changed')
 return bindCustomerMasterdataValidationContext({kind:'customer_masterdata',companyId:input.companyId,customerId:input.customerId,environment:input.environment,rawPayload:input.rawPayload,intentId:input.intentId,routeId:input.routeId,projection})
}

/** Recheck a real bound draft for a subsequent preparing actor, preserving
 * the preparation and immutable bytes of the user who created it. */
export async function loadPreparedSwitchCancellationCustomerMasterdataContext(message:EdielMessageRow,actorUserId:string,originalHash:string):Promise<CustomerMasterdataValidationContext>{
 if(message.status!=='draft'||message.direction!=='outbound'||message.message_family!=='PRODAT'||message.message_code!=='Z03'||!message.raw_payload
  ||![message.company_id,message.id,message.customer_id,message.intent_id,message.communication_route_id,message.created_by,message.source_operation_id,message.original_message_id,message.switch_request_id,actorUserId].every(isEvidenceUuid)||!/^[a-f0-9]{64}$/.test(originalHash))throw Error('customer_masterdata_cancellation_bound_draft_scope_required')
 const rpc=supabaseService.rpc.bind(supabaseService) as unknown as(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
 const{data,error}=await rpc('ediel_switch_cancellation_customer_masterdata_message_basis_v1',{p_company_id:message.company_id,p_message_id:message.id,p_actor_user_id:actorUserId})
 if(error)throw error
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('customer_masterdata_cancellation_bound_draft_binding_invalid')
 const value=data as Partial<SourceQualifiedCustomerMasterdataProjection>&{messageBinding?:Record<string,unknown>;cancellationBinding?:Record<string,unknown>},binding=value.messageBinding,source=value.cancellationBinding
 if(!binding||binding.id!==message.id||binding.environment!==message.environment||binding.intentId!==message.intent_id||binding.routeId!==message.communication_route_id||binding.payloadHash!==createHash('sha256').update(message.raw_payload).digest('hex')
  ||!source||source.operationId!==message.source_operation_id||source.switchRequestId!==message.switch_request_id||source.actorUserId!==actorUserId||source.originalMessageId!==message.original_message_id||source.originalHash!==originalHash||source.preparerId!==message.created_by||typeof value.asOf!=='string')throw Error('customer_masterdata_cancellation_bound_draft_binding_invalid')
 const projection=checkedProjection(value,{companyId:message.company_id!,customerId:message.customer_id!,asOf:value.asOf,...(value.environment===null?{}:{environment:message.environment})})
 return bindCustomerMasterdataValidationContext({kind:'customer_masterdata',companyId:message.company_id!,customerId:message.customer_id!,environment:message.environment,rawPayload:message.raw_payload,intentId:message.intent_id!,routeId:message.communication_route_id!,projection})
}
