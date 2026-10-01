import { supabaseService } from '@/lib/supabase/service'
import {assertCapturedServiceRequestTiming,type CapturedServiceRequestTiming} from './requestTiming'
import type { EdielMessageRow } from '@/lib/ediel/types'

export type ServicePermissionOriginInput = {
  providerCompanyId: string; assignmentId: string; actorUserId: string;
  expectedVersion: number; permissionId: string; code: 'Z13' | 'Z18'
}
export type ServicePermissionOriginBasis = {
  status: 'authorized'; companyId: string; assignmentId: string; assignmentVersion: number; scopeBasisVersion:number;
  permissionId: string; permissionStateVersion: number; code: 'Z13' | 'Z18'; environment: 'test' | 'production';
  providerActorId: string; dsoActorId: string; legalSenderId: string; legalReceiverId: string;
  customerId: string; customer: Record<string, unknown>; mode: 'V' | 'VH';
  requestTiming?: CapturedServiceRequestTiming;
  agreementReference?: string | null; requestedMethod?: string | null; purposeCode: string | null; frequency: string | null; terminationReason: string | null;
  evidenceId: string; evidenceSha256: string; evidenceVersion: string; li: string | null;
  reportingTerm: 'bounded' | 'indefinite' | null; customerClassification: 'private' | 'nonprivate' | null;
  objects: { point: string | null; permissionId: string | null; product: string;
    reportStart?: string; reportEnd?: string | null; gridArea?: string | null; permissionEnd?: string }[]
}
export type HeldPermissionOrigin = { status: 'held'; missing: string[] }
export type ServicePermissionExecutionPhase = 'prepare' | 'send'
export type ServicePermissionRecoveryOrigin = {
  /** The immediate failed original remains the new recovery operation's source. */
  originalMessage: EdielMessageRow;
  /** Only the native qualified lineage may select this terminal service source. */
  sourceMessage: EdielMessageRow;
  basis: ServicePermissionOriginBasis; sourceIntentId: string; sourceActorUserId: string;
  allowedObjects: {point:string|null;li:string|null;customerIdentity:string|null;reason:string|null}[]
}

function args(input: ServicePermissionOriginInput) {
  return { p_company_id: input.providerCompanyId, p_assignment_id: input.assignmentId,
    p_actor_user_id: input.actorUserId, p_expected_version: input.expectedVersion,
    p_permission_id: input.permissionId, p_code: input.code }
}
export async function readServicePermissionOrigin(input: ServicePermissionOriginInput): Promise<ServicePermissionOriginBasis | HeldPermissionOrigin> {
  const { data, error } = await supabaseService.rpc('ediel_service_permission_origin_v1', args(input))
  if (error) throw error
  if (!data || !['authorized', 'held'].includes(data.status)) throw new Error('ediel_permission_origin_result_invalid')
  if(data.status==='authorized')assertCapturedServiceRequestTiming(data)
  return data
}
export async function reserveServicePermissionOrigin(input: ServicePermissionOriginInput & { intentId: string }): Promise<{ status: 'reserved'; messageId: string | null } | HeldPermissionOrigin> {
  const { data, error } = await supabaseService.rpc('ediel_reserve_service_permission_origin_v1', { ...args(input), p_intent_id: input.intentId })
  if (error) throw error
  if (!data || !['reserved', 'held'].includes(data.status)) throw new Error('ediel_permission_origin_reservation_invalid')
  return data
}

/** A correction keeps its own intent and operation. Only the qualified private
 * recovery link may select the original's current service authority. */
export async function loadServicePermissionRecoveryOrigin(input: {companyId:string;operationId:string;actorUserId:string;phase?:ServicePermissionExecutionPhase}):Promise<ServicePermissionRecoveryOrigin|undefined>{
 const {assertEdielTenantActor}=await import('./authorization')
 const phase=input.phase??'prepare'
 if(phase==='prepare')await assertEdielTenantActor({companyId:input.companyId,actorUserId:input.actorUserId,permission:'communication.write'})
 else if(phase==='send')await assertEdielTenantActor({companyId:input.companyId,actorUserId:input.actorUserId,permissionAnyOf:['ediel.send','communication.send']})
 else throw new Error('ediel_service_recovery_phase_invalid')
 const {data:recovery,error}=await supabaseService.rpc('ediel_prodat_recovery_operation_basis_v1',{p_company_id:input.companyId,p_operation_id:input.operationId,p_actor_user_id:input.actorUserId})
 if(error)throw error
 if(recovery===null)return undefined
 if(!recovery||recovery.operationId!==input.operationId||typeof recovery.originalMessageId!=='string'||typeof recovery.sourceOriginMessageId!=='string'||!Array.isArray(recovery.allowedObjects)||recovery.allowedObjects.length===0)throw new Error('ediel_service_recovery_operation_unqualified')
 const ownMessage=async(id:string):Promise<EdielMessageRow>=>{
  const {data,error}=await supabaseService.from('ediel_messages').select('*').eq('company_id',input.companyId).eq('id',id).maybeSingle()
  if(error)throw error
  if(!data||data.company_id!==input.companyId||data.id!==id||data.direction!=='outbound'||data.message_family!=='PRODAT')throw new Error('ediel_service_recovery_original_not_owned')
  return data as EdielMessageRow
 }
 const original=await ownMessage(recovery.originalMessageId)
 const sourceMessage=recovery.sourceOriginMessageId===original.id?original:await ownMessage(recovery.sourceOriginMessageId)
 if(sourceMessage.environment!==original.environment||sourceMessage.message_code!==original.message_code||sourceMessage.customer_id!==original.customer_id)throw new Error('ediel_service_recovery_origin_scope_invalid')
 if(!['Z13','Z18'].includes(sourceMessage.message_code))return undefined
 const {data:source,error:sourceError}=await supabaseService.rpc('ediel_service_permission_message_basis_v1',{p_company_id:input.companyId,p_message_id:sourceMessage.id,p_actor_user_id:input.actorUserId,p_phase:phase})
 if(sourceError)throw sourceError
 // Ordinary TGT originals have no service binding. Parsed claims cannot select
 // a service origin, and a failed private qualification is never a fallback.
 if(source===null)return undefined
 const basis=source?.basis as ServicePermissionOriginBasis|undefined
 if(!basis||basis.status!=='authorized'||basis.companyId!==input.companyId||basis.customerId!==sourceMessage.customer_id||basis.environment!==sourceMessage.environment||basis.code!==sourceMessage.message_code||!source.intentId||!source.actorUserId||source.intentId!==sourceMessage.intent_id||JSON.stringify(basis)!==JSON.stringify(sourceMessage.parsed_payload?.sourcePermissionBasis))throw new Error('ediel_service_recovery_origin_stale')
 const {resolveSwedishProdatCustomerIdentity}=await import('@/lib/ediel/prodat/customerIdentity')
 const customer=resolveSwedishProdatCustomerIdentity(basis.customer)
 const expectedReason=basis.code==='Z13'?(basis.mode==='V'?'S17':'S18'):basis.terminationReason
 const expectedLi=basis.code==='Z18'?basis.li:sourceMessage.transaction_reference
 if(!customer.id||!expectedReason||!expectedLi||recovery.allowedObjects.some((object:{point:string|null;li:string|null;customerIdentity:string|null;reason:string|null})=>object.customerIdentity!==customer.id||object.reason!==expectedReason||object.li!==expectedLi||!basis.objects.some(own=>own.point===object.point)))throw new Error('ediel_service_recovery_object_scope_invalid')
 return {originalMessage:original,sourceMessage,basis,sourceIntentId:source.intentId,sourceActorUserId:source.actorUserId,allowedObjects:recovery.allowedObjects}
}

/** Send/readiness follows a recovery only after its exact new raw hash has a
 * qualified private operation-to-message binding. */
export async function loadServicePermissionMessageOrigin(message:import('@/lib/ediel/types').EdielMessageRow,actorUserId:string){
 if(!message.company_id||message.direction!=='outbound'||message.message_family!=='PRODAT'||!['Z13','Z18'].includes(message.message_code)||!message.source_operation_id)return undefined
 const {assertEdielTenantActor}=await import('./authorization')
 await assertEdielTenantActor({companyId:message.company_id,actorUserId,permissionAnyOf:['ediel.send','communication.send']})
 const {data:recovery,error}=await supabaseService.rpc('ediel_prodat_recovery_original_basis_v1',{p_company_id:message.company_id,p_message_id:message.id,p_actor_user_id:actorUserId})
 if(error)throw error
 if(recovery===null)return undefined
 const {createHash}=await import('node:crypto')
 if(!recovery||recovery.operationId!==message.source_operation_id||recovery.originalMessageId!==message.original_message_id||!message.raw_payload||recovery.correctedPayloadHash!==createHash('sha256').update(message.raw_payload,'utf8').digest('hex'))throw new Error('ediel_service_recovery_message_unqualified')
 return loadServicePermissionRecoveryOrigin({companyId:message.company_id,operationId:recovery.operationId,actorUserId,phase:'send'})
}
