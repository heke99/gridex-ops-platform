import { supabaseService } from '@/lib/supabase/service'
import { createOutboundRequest } from '@/lib/cis/db'
import { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import { buildCanonicalParsedPayload, parseCanonicalEdielPayload } from '@/lib/ediel/core/canonicalMessage'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { createEdielMessageIntent } from '@/lib/ediel/intent/intentEngine'
import { finalizeRecoveryDraft, queueRecoveryDraft } from '@/lib/ediel/intent/prodatRecoveryGateway'
import { readRecoveryOperationBasis } from './sourceContext'
import {loadRecoveryMeteringMethodContext,assertRecoveryMeteringMethodRoute} from './meteringMethodContext'
import { loadProdatDateEventValidationContext, recoveryDateEventScope } from '@/lib/ediel/production/dateEventContext'
import { loadRecoveryReportingContext } from './reportingContext'
import { loadServicePermissionRecoveryOrigin } from '@/lib/ediel/services/permissionOrigin'
import {loadCustomerLifeEventRecoveryContext} from '@/lib/ediel/production/lifeEventSource'
import { copyReportingSelection } from '@/lib/ediel/prodat/prodatReportingPermissionContext'
import { createProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { canonicalEdielActorRole } from '@/lib/ediel/actorRole'
import { deriveEdielAckDefaults } from '@/lib/ediel/references'
import type { CanonicalRouteRequestType } from '@/lib/ediel/core/routeRegistry'
import type { CreateEdielMessageInput, EdielMessageRow } from '@/lib/ediel/types'

type RecoveryRequest = { companyId: string; actorUserId: string; originalMessageId: string; operationId: string } & (
  { previousAttemptId: string; sourceAckMessageId?: never; correctedRawPayload?: never } |
  { previousAttemptId?: never; sourceAckMessageId: string; correctedRawPayload: string }
)
type Authorization = { status: 'authorized'; operationId: string; originalMessageId: string;
  kind: 'verified_transfer_loss' | 'contrl_correction' | 'aperak_correction'; previousAttemptId: string | null; newMessageId: string | null }
type Held = { status: 'held'; reason: string }

async function authorize(input: RecoveryRequest): Promise<Authorization | Held> {
  const { data, error } = await supabaseService.rpc('ediel_prepare_prodat_recovery_v1', {
    p_company_id: input.companyId, p_original_message_id: input.originalMessageId,
    p_actor_user_id: input.actorUserId, p_operation_id: input.operationId,
    p_source_ack_message_id: input.sourceAckMessageId ?? null, p_previous_attempt_id: input.previousAttemptId ?? null,
    p_corrected_raw_payload: input.correctedRawPayload ?? null,
  })
  if (error) throw error
  if (!data || typeof data !== 'object') throw new Error('prodat_recovery_authorization_invalid')
  if (data.status === 'held' && typeof data.reason === 'string') return data
  if (data.status !== 'authorized' || typeof data.operationId !== 'string' || data.originalMessageId !== input.originalMessageId
    || !['verified_transfer_loss', 'contrl_correction', 'aperak_correction'].includes(data.kind)) throw new Error('prodat_recovery_authorization_invalid')
  return data
}
async function ownMessage(companyId: string, id: string): Promise<EdielMessageRow> {
  const { data, error } = await supabaseService.from('ediel_messages').select('*').eq('company_id', companyId).eq('id', id).maybeSingle()
  if (error) throw error
  if (!data || data.company_id !== companyId) throw new Error('prodat_recovery_message_unavailable')
  return data as EdielMessageRow
}
function requestType(code: string): CanonicalRouteRequestType {
  return ['Z03', 'Z08'].includes(code) ? 'supplier_switch' : ['Z13', 'Z18'].includes(code) ? 'metering_access' : 'customer_masterdata'
}
async function boundMessage(input: RecoveryRequest, authorization: Authorization): Promise<EdielMessageRow | null> {
  if (!authorization.newMessageId) return null
  const message = await ownMessage(input.companyId, authorization.newMessageId)
  if (message.direction !== 'outbound' || message.message_family !== 'PRODAT' || message.source_operation_id !== authorization.operationId
    || message.original_message_id !== input.originalMessageId || message.raw_payload !== input.correctedRawPayload) throw new Error('prodat_recovery_bound_message_conflict')
  return message
}

/** Manual, source-qualified recovery. A timer and an operator's claimed ACK
 * outcome are deliberately absent from the command contract. Nothing sends here. */
export async function prepareAndQueueProdatRecovery(input: RecoveryRequest) {
  if (![input.companyId, input.actorUserId, input.originalMessageId, input.operationId].every(value => typeof value === 'string' && value.trim())) throw new Error('prodat_recovery_scope_required')
  let authorization = await authorize(input)
  if (authorization.status === 'held') return authorization
  if (authorization.kind === 'verified_transfer_loss') {
    if (!input.previousAttemptId || authorization.previousAttemptId !== input.previousAttemptId) throw new Error('prodat_recovery_attempt_conflict')
    const { data, error } = await supabaseService.rpc('ediel_queue_prodat_retry_v1', {
      p_company_id: input.companyId, p_message_id: input.originalMessageId,
      p_actor_user_id: input.actorUserId, p_operation_id: authorization.operationId,
    })
    if (error) throw error
    if (!data || !['queued', 'existing'].includes(data.status) || typeof data.outboxId !== 'string') throw new Error('prodat_recovery_retry_queue_invalid')
    return { status: data.status as 'queued' | 'existing', kind: authorization.kind, operationId: authorization.operationId, messageId: input.originalMessageId, outboxId: data.outboxId }
  }
  if (!input.correctedRawPayload || !input.sourceAckMessageId) throw new Error('prodat_recovery_correction_required')
  let message = await boundMessage(input, authorization)
  if (message && message.status !== 'draft') return { status: 'existing' as const, kind: authorization.kind, operationId: authorization.operationId, messageId: message.id }
  if (!message) {
    const original = await ownMessage(input.companyId, input.originalMessageId)
    if (original.direction !== 'outbound' || original.message_family !== 'PRODAT' || !original.customer_id) throw new Error('prodat_recovery_original_context_required')
    const canonical = parseCanonicalEdielPayload({ rawPayload: input.correctedRawPayload, direction: 'outbound', standardHint: 'edifact' })
    const envelope = EdifactEnvelopeCodec.decode(input.correctedRawPayload)
    if (canonical.family !== 'PRODAT' || !canonical.messageCode || !canonical.documentReference || !canonical.version
      || !canonical.interchangeReference || !canonical.sender || !canonical.receiver || !canonical.applicationReference
      || envelope.environment !== original.environment) throw new Error('prodat_recovery_physical_context_required')
    const type = requestType(canonical.messageCode)
    const route = await resolveCanonicalOutboundContext({ companyId: input.companyId, environment: original.environment, requestType: type,
      receiverEdielId: canonical.receiver, preferredRouteId: original.communication_route_id, applicationReference: canonical.applicationReference })
    const basis = await readRecoveryOperationBasis({ companyId: input.companyId,operationId: authorization.operationId,actorUserId: input.actorUserId })
    if (!basis || basis.originalMessageId !== original.id) throw new Error('prodat_recovery_current_basis_required')
    const methodContext=canonical.messageCode==='Z09'?await loadRecoveryMeteringMethodContext({companyId:input.companyId,operationId:authorization.operationId,actorUserId:input.actorUserId,rawPayload:input.correctedRawPayload}):undefined
    if(methodContext){if(methodContext.originalMessageId!==original.id||methodContext.customerId!==original.customer_id||methodContext.environment!==original.environment)throw Error('prodat_recovery_metering_method_origin_conflict');assertRecoveryMeteringMethodRoute(methodContext,route)}
    const dateEventContext = recoveryDateEventScope(await loadProdatDateEventValidationContext(original, input.actorUserId), basis)
    const reporting = await loadRecoveryReportingContext({ companyId: input.companyId,operationId: authorization.operationId,actorUserId: input.actorUserId })
    const reportingContext = reporting.context
    if (reporting.originalMessage.id !== original.id) throw new Error('prodat_recovery_reporting_original_conflict')
    const serviceOrigin = type === 'metering_access' ? await loadServicePermissionRecoveryOrigin({
      companyId: input.companyId,operationId: authorization.operationId,actorUserId: input.actorUserId,
    }) : undefined
    if (serviceOrigin && (serviceOrigin.originalMessage.id !== original.id || serviceOrigin.basis.environment !== original.environment
      || serviceOrigin.basis.code !== canonical.messageCode)) throw new Error('prodat_recovery_service_origin_conflict')
    const routeProfileId = route.routeRuntime?.route_profile_id
    const legalRoles = (route.actor.marketRoles ?? []).map(canonicalEdielActorRole)
    const actorRole = type === 'metering_access' && legalRoles.includes('esco') ? 'esco' : legalRoles.includes('supplier') ? 'supplier' : null
    if (!actorRole || !routeProfileId || !canonical.messageReference) throw new Error('prodat_recovery_current_route_intent_required')
    const intent = await createEdielMessageIntent({ companyId: input.companyId,environment: original.environment,market: 'electricity',messageFamily: 'PRODAT',messageCode: canonical.messageCode,
      businessProcess: type === 'metering_access' ? 'metering_permission' : type === 'supplier_switch' ? 'supplier_switch' : 'customer_masterdata',direction: 'outbound',
      senderEdielId: canonical.sender,senderSubaddress: canonical.senderSubAddress,receiverEdielId: canonical.receiver,receiverSubaddress: canonical.receiverSubAddress,
      applicationReference: canonical.applicationReference,routeProfileId,communicationRouteId: route.route.id,customerId: original.customer_id,
      customerSiteId: original.site_id,meteringPointId: original.metering_point_id,supplierSwitchRequestId: original.switch_request_id,operationId: authorization.operationId,interchangeReference: canonical.interchangeReference,
      messageReference: canonical.messageReference,transactionReference: canonical.transactionReference,idempotencyKey: `prodat-recovery:${authorization.operationId}`,
      payload: { actorRole,recoveryOperationId: authorization.operationId,originalMessageId: original.id },actorUserId: input.actorUserId,
      routeProfile: { applicationReference: route.applicationReference,actorRole } })
    const deathStatusContext=canonical.messageCode==='Z09'
      ? await loadCustomerLifeEventRecoveryContext({companyId:input.companyId,operationId:authorization.operationId,actorUserId:input.actorUserId,intentId:intent.id,routeContext:route}) : undefined
    // The new intent UUID is the request identity. Shared permission/switch
    // identity would deduplicate into an older sent message.
    const outbound = await createOutboundRequest({ actorUserId: input.actorUserId, customerId: original.customer_id,
      siteId: original.site_id, meteringPointId: original.metering_point_id, gridOwnerId: original.grid_owner_id,
      communicationRouteId: route.route.id, requestType: type === 'supplier_switch' ? 'supplier_switch' : type === 'metering_access' ? 'metering_access' : 'customer_masterdata',
      sourceType: 'manual', sourceId: intent.id, operationId: authorization.operationId,
      environment: original.environment, failOnMissingEnvironment: true, payload: { recoveryOperationId: authorization.operationId, originalMessageId: original.id } })
    const wire = tokenizeEdifact(input.correctedRawPayload)
    const protectedFacts = { market: 'electricity' as const,
      ...(dateEventContext ? { dateEventSource: dateEventContext.source,dateEventObjects: dateEventContext.objects } : {}),
      ...(reportingContext ? { reportingPermission: copyReportingSelection({ source: reportingContext.source,objects: reportingContext.objects }) } : {}) }
    const draft: CreateEdielMessageInput = { actorUserId: input.actorUserId, companyId: input.companyId,intentId: intent.id,routeProfileId, direction: 'outbound', messageStandard: 'edifact',
      messageFamily: 'PRODAT', messageCode: canonical.messageCode, messageVersion: canonical.version, processType: type, environment: original.environment,
      testFlag: original.environment === 'test' ? 1 : 0, status: 'draft', transportType: 'smtp', rawPayload: input.correctedRawPayload,
      originalMessageId: original.id, originalMessageCode: original.message_code, sourceOperationId: authorization.operationId,
      customerId: original.customer_id, siteId: original.site_id, meteringPointId: original.metering_point_id, gridOwnerId: original.grid_owner_id,switchRequestId: original.switch_request_id,
      outboundRequestId: outbound.id, externalReference: canonical.documentReference, interchangeReference: canonical.interchangeReference,
      transactionReference: canonical.transactionReference, applicationReference: canonical.applicationReference,
      senderEdielId: canonical.sender, senderSubAddress: canonical.senderSubAddress, receiverEdielId: canonical.receiver, receiverSubAddress: canonical.receiverSubAddress,
      parsedPayload: { ...buildCanonicalParsedPayload(canonical), recoveryOperationId: authorization.operationId,
        ...(serviceOrigin ? { serviceAssignmentId: serviceOrigin.basis.assignmentId } : {}),
        ...(methodContext?{meteringMethodChangeEventId:methodContext.eventId}:{}),
        ...(dateEventContext?.source.kind === 'tgt' ? { testRunId: dateEventContext.source.runId,stepNo: dateEventContext.source.stepNo } : {}),
        ...(reportingContext?.source.kind === 'tgt' ? { testRunId: reportingContext.source.scope.runId,stepNo: reportingContext.source.scope.stepNo } : {}),
        ...(dateEventContext || reportingContext ? { prodatEngine: { registerEvidence: createProdatRegisterEvidence({ code: canonical.messageCode,rawSegments: wire.segments.map(s => s.raw),una: wire.una,facts: protectedFacts }) } } : {}) },
      ...deriveEdielAckDefaults({ family: 'PRODAT', code: canonical.messageCode }) }
    try {
      message = await finalizeRecoveryDraft({ companyId: input.companyId,operationId: authorization.operationId,actorUserId: input.actorUserId,intent,
        params: { actorUserId: input.actorUserId, requestType: type, routeContext: route, draft, outboundRequestId: outbound.id,reportingContext,dateEventContext,deathStatusContext,
          duplicateCheck: { sourceType: 'manual', sourceId: intent.id, messageFamily: 'PRODAT', messageCode: canonical.messageCode, receiverEdielId: canonical.receiver } } })
    } catch (error) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')) throw error
      authorization = await authorize(input)
      if (authorization.status !== 'authorized') return authorization
      message = await boundMessage(input, authorization)
      if (!message) throw error
    }
    // Reject a generic dedupe result until the private exact operation binding
    // independently names that same message. Never queue another operation's row.
    authorization = await authorize(input)
    if (authorization.status !== 'authorized') return authorization
    const exact = await boundMessage(input, authorization)
    if (!exact || exact.id !== message.id) throw new Error('prodat_recovery_final_message_unbound')
    message = exact
  }
  if (message.status !== 'draft') return { status: 'existing' as const, kind: authorization.kind, operationId: authorization.operationId, messageId: message.id }
  await queueRecoveryDraft({ companyId: input.companyId,operationId: authorization.operationId,actorUserId: input.actorUserId,message })
  return { status: 'queued' as const, kind: authorization.kind, operationId: authorization.operationId, messageId: message.id }
}
