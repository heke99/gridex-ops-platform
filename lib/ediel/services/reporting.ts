import { supabaseService } from '@/lib/supabase/service'
import { loadServicePermissionRecoveryOrigin, loadServicePermissionMessageOrigin, type ServicePermissionOriginBasis, type ServicePermissionExecutionPhase, type ServicePermissionRecoveryOrigin } from './permissionOrigin'
import { assertEdielTenantActor } from './authorization'
import { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import { resolveSwedishProdatCustomerIdentity } from '@/lib/ediel/prodat/customerIdentity'
import { copyReportingExpected, copyReportingSelection, reportingBusinessMinute, type ExpectedContext, type ServiceReportingEvidence, type ServiceReportingSource, type ReportingObject, type Ref } from '@/lib/ediel/prodat/prodatReportingPermissionContext'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { EdielMessageIntent } from '@/lib/ediel/intent/types'

/** Call only with the private origin RPC's freshly authorized basis. Unknown
 * classification/term remains held, even when a wire purpose was supplied. */
export function buildServiceReportingContext(b: ServicePermissionOriginBasis, i: Pick<EdielMessageIntent,'id'|'transactionReference'|'payload'|'routeProfileId'>, route: Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>, actorUserId: string, evaluationUtcMs = Date.now()): ExpectedContext & {source: ServiceReportingSource} {
  if (b.code !== 'Z13' || !b.reportingTerm || !b.customerClassification || !b.purposeCode || !i.transactionReference || b.objects.length !== 1 || route.companyId !== b.companyId || route.environment !== b.environment || route.actor.tenantIdentity?.legalActorId !== b.providerActorId || route.actor.legalActorEdielId !== b.legalSenderId || route.receiverEdielId !== b.legalReceiverId) throw new Error('ediel_service_reporting_source_unqualified')
  const identity=resolveSwedishProdatCustomerIdentity(b.customer)
  if (!identity.id || !identity.qualifier) throw new Error('ediel_service_reporting_customer_unqualified')
  const customer={id:identity.id,qualifier:identity.qualifier,agency:'260'},legalRequester={id:b.legalSenderId,qualifier:'160',agency:'SVK'}
  const ref=(kind: Ref['kind'], key=b.evidenceId): Ref=>({kind,key,revision:b.evidenceId,requestKey:b.permissionId})
  const end=b.objects[0].reportEnd == null ? null : reportingBusinessMinute(b.objects[0].reportEnd)
  if (b.reportingTerm === 'bounded' && !end || b.reportingTerm === 'indefinite' && b.objects[0].reportEnd != null) throw new Error('ediel_service_reporting_term_unqualified')
  const object: ReportingObject={objectKey:b.permissionId,requestKey:b.permissionId,selector:null,
    process:ref('process',b.permissionId),authorization:ref('authorization'),li:i.transactionReference,
    anj:String(i.payload.authorizationReference ?? ''),customer,legalRequester,expectedReason:b.mode==='V'?'S17':'S18',code:'Z13',installation:null,requestAssociation:null,
    term:b.reportingTerm==='bounded'?{kind:'bounded',endMinute:end!,declaration:ref('declaration')}:{kind:'indefinite',declaration:ref('declaration')},
    classification:{kind:b.customerClassification,record:ref('classification')},
    purpose:{kind:'assessed',code:b.purposeCode as 'B71'|'B72'|'B73'|'B74'|'B75'|'B76',assessment:ref('assessment'),customer,legalActor:legalRequester}}
  const evidence: ServiceReportingEvidence={source:{kind:'service_permission',companyId:b.companyId,assignmentId:b.assignmentId,assignmentVersion:b.assignmentVersion,scopeBasisVersion:b.scopeBasisVersion,
    permissionId:b.permissionId,evidenceId:b.evidenceId,evidenceSha256:b.evidenceSha256,evidenceVersion:b.evidenceVersion,actorId:actorUserId,intentId:i.id,environment:b.environment,code:'Z13',
    route:{routeProfileId:i.routeProfileId,communicationRouteId:route.route.id,legalSender:legalRequester,legalRecipient:{id:b.legalReceiverId,qualifier:'160',agency:'SVK'},
      senderId:route.senderEdielId,receiverId:route.receiverEdielId,senderQualifier:'ZZ',receiverQualifier:'ZZ',senderSubaddress:route.senderSubAddress,receiverSubaddress:route.receiverMessageSubAddress??route.receiverSubAddress,
      applicationReference:route.applicationReference!,transportType:'smtp',mailbox:route.mailbox,receiverEmail:route.receiverEmail}},objects:[object]}
  const copied=copyReportingExpected({...evidence,evaluationUtcMs})
  if(copied.source.kind!=='service_permission')throw new Error('ediel_service_reporting_source_kind_invalid')
  return {...copied,source:copied.source}
}

/** SMTP/API/replay loads current server-owned evidence anew. Stored payload is a
 * selector and immutable snapshot comparison, never current authorization. */
async function loadOriginalServiceReportingContext(message: EdielMessageRow, actorUserId: string, phase: ServicePermissionExecutionPhase = 'send'): Promise<ExpectedContext | undefined> {
  const snapshot=message.parsed_payload?.sourcePermissionBasis as ServicePermissionOriginBasis | undefined
  if (!snapshot) return undefined
  if (!message.company_id || message.direction !== 'outbound' || message.message_code !== 'Z13' || !message.intent_id) throw new Error('ediel_service_reporting_message_scope_invalid')
  if(phase==='prepare')await assertEdielTenantActor({companyId:message.company_id,actorUserId,permission:'communication.write'})
  else await assertEdielTenantActor({companyId:message.company_id,actorUserId,permissionAnyOf:['ediel.send','communication.send']})
  const {data:bound,error:boundError}=await supabaseService.rpc('ediel_service_permission_message_basis_v1',{p_company_id:message.company_id,p_message_id:message.id,p_actor_user_id:actorUserId,p_phase:phase})
  if(boundError)throw boundError
  const current=bound?.basis as ServicePermissionOriginBasis|undefined
  if(!current||current.status!=='authorized'||bound.intentId!==message.intent_id||JSON.stringify(current)!==JSON.stringify(snapshot))throw new Error('ediel_service_reporting_source_stale')
  const {data:intent,error}=await supabaseService.from('ediel_message_intents').select('id,company_id,payload,route_profile_id,transaction_reference').eq('company_id',message.company_id).eq('id',message.intent_id).maybeSingle()
  if(error)throw error
  if(!intent||intent.company_id!==message.company_id||JSON.stringify(intent.payload.sourcePermissionBasis)!==JSON.stringify(current))throw new Error('ediel_service_reporting_intent_scope_invalid')
  const route=await resolveCanonicalOutboundContext({requestType:'metering_access',companyId:message.company_id,environment:message.environment,preferredRouteId:message.communication_route_id,receiverEdielId:current.legalReceiverId,applicationReference:message.application_reference})
  const expected=buildServiceReportingContext(current,{id:intent.id,payload:intent.payload,routeProfileId:intent.route_profile_id,transactionReference:intent.transaction_reference},route,bound.actorUserId)
  const persisted=copyReportingSelection((message.parsed_payload?.prodatEngine as {registerEvidence?:{facts?:{reportingPermission?:unknown}}})?.registerEvidence?.facts?.reportingPermission)
  if(persisted.source.kind!=='service_permission'||JSON.stringify(persisted.source)!==JSON.stringify(expected.source)||JSON.stringify(persisted.objects)!==JSON.stringify(expected.objects))throw new Error('ediel_service_reporting_source_kind_invalid')
  return copyReportingExpected(expected)
}

function assertReportingRecoveryScope(basis:Pick<ServicePermissionRecoveryOrigin,'allowedObjects'>,context:ExpectedContext){
 if(context.source.kind!=='service_permission'||!Array.isArray(basis.allowedObjects)||basis.allowedObjects.length!==1||context.objects.length!==1)throw new Error('ediel_reporting_recovery_scope_invalid')
 const expected=context.objects[0],own=basis.allowedObjects[0]
 if(expected.code!=='Z13'||own.point!==null||own.li!==expected.li||own.customerIdentity!==expected.customer.id||own.reason!==expected.expectedReason)throw new Error('ediel_reporting_recovery_scope_invalid')
}
/** Pre-insert correction adapter reads a qualified private recovery operation,
 * then the actual original's current source authority. A new intent/request
 * remains the correction's identity; the source intent is only its evidence. */
export async function loadServiceReportingRecoveryContext(input:{companyId:string;operationId:string;actorUserId:string;phase?:ServicePermissionExecutionPhase}):Promise<{originalMessage:EdielMessageRow;context:ExpectedContext}|undefined>{
 const phase=input.phase??'prepare'
 const origin=await loadServicePermissionRecoveryOrigin({...input,phase})
 if(!origin)return undefined
 const context=await loadOriginalServiceReportingContext(origin.sourceMessage,input.actorUserId,phase)
 if(!context)return undefined
 assertReportingRecoveryScope(origin,context)
 return {originalMessage:origin.originalMessage,context}
}
/** Ordinary originals and corrections share the same current source authority.
 * Mutable parsed claims are only selectors; the private exact new-message/hash
 * binding is the sole permission to follow a recovery's original. */
export async function loadServiceReportingValidationContext(message:EdielMessageRow,actorUserId:string):Promise<ExpectedContext|undefined>{
 if(!message.source_operation_id)return loadOriginalServiceReportingContext(message,actorUserId)
 if(!message.company_id||message.direction!=='outbound'||message.message_family!=='PRODAT'||message.message_code!=='Z13')return undefined
 const origin=await loadServicePermissionMessageOrigin(message,actorUserId)
 if(!origin)return undefined
 const context=await loadOriginalServiceReportingContext(origin.sourceMessage,actorUserId,'send')
 if(!context)return undefined
 assertReportingRecoveryScope(origin,context)
 const persisted=copyReportingSelection((message.parsed_payload?.prodatEngine as {registerEvidence?:{facts?:{reportingPermission?:unknown}}})?.registerEvidence?.facts?.reportingPermission)
 if(JSON.stringify(persisted.source)!==JSON.stringify(context.source)||JSON.stringify(persisted.objects)!==JSON.stringify(context.objects))throw new Error('ediel_reporting_recovery_protected_evidence_changed')
 return context
}
