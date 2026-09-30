import { supabaseService } from '@/lib/supabase/service'
import { createOutboundRequest } from '@/lib/cis/db'
import { finalizeCanonicalOutboundDraft, resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import { buildCanonicalParsedPayload, parseCanonicalEdielPayload } from '@/lib/ediel/core/canonicalMessage'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { queuePreparedEdielMessage } from '@/lib/ediel/flows/shared'
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
      || !canonical.interchangeReference || envelope.environment !== original.environment) throw new Error('prodat_recovery_physical_context_required')
    const type = requestType(canonical.messageCode)
    const route = await resolveCanonicalOutboundContext({ companyId: input.companyId, environment: original.environment, requestType: type,
      receiverEdielId: canonical.receiver, preferredRouteId: original.communication_route_id, applicationReference: canonical.applicationReference })
    // The actual authorization UUID is the new request's identity. A permission
    // or switch-wide request would deduplicate into an older sent message.
    const outbound = await createOutboundRequest({ actorUserId: input.actorUserId, customerId: original.customer_id,
      siteId: original.site_id, meteringPointId: original.metering_point_id, gridOwnerId: original.grid_owner_id,
      communicationRouteId: route.route.id, requestType: type === 'supplier_switch' ? 'supplier_switch' : type === 'metering_access' ? 'metering_access' : 'customer_masterdata',
      sourceType: 'manual', sourceId: authorization.operationId, operationId: authorization.operationId,
      environment: original.environment, failOnMissingEnvironment: true, payload: { recoveryOperationId: authorization.operationId, originalMessageId: original.id } })
    const draft: CreateEdielMessageInput = { actorUserId: input.actorUserId, companyId: input.companyId, direction: 'outbound', messageStandard: 'edifact',
      messageFamily: 'PRODAT', messageCode: canonical.messageCode, messageVersion: canonical.version, processType: type, environment: original.environment,
      testFlag: original.environment === 'test' ? 1 : 0, status: 'draft', transportType: 'smtp', rawPayload: input.correctedRawPayload,
      originalMessageId: original.id, originalMessageCode: original.message_code, sourceOperationId: authorization.operationId,
      customerId: original.customer_id, siteId: original.site_id, meteringPointId: original.metering_point_id, gridOwnerId: original.grid_owner_id,
      outboundRequestId: outbound.id, externalReference: canonical.documentReference, interchangeReference: canonical.interchangeReference,
      transactionReference: canonical.transactionReference, applicationReference: canonical.applicationReference,
      senderEdielId: canonical.sender, senderSubAddress: canonical.senderSubAddress, receiverEdielId: canonical.receiver, receiverSubAddress: canonical.receiverSubAddress,
      parsedPayload: { ...buildCanonicalParsedPayload(canonical), recoveryOperationId: authorization.operationId },
      ...deriveEdielAckDefaults({ family: 'PRODAT', code: canonical.messageCode }) }
    try {
      message = await finalizeCanonicalOutboundDraft({ actorUserId: input.actorUserId, requestType: type, routeContext: route, draft, outboundRequestId: outbound.id,
        duplicateCheck: { sourceType: 'manual', sourceId: authorization.operationId, messageFamily: 'PRODAT', messageCode: canonical.messageCode, receiverEdielId: canonical.receiver } })
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
  await supabaseService.rpc('ediel_require_prodat_recovery_current_v1', { p_company_id: input.companyId, p_message_id: message.id }).then(({ error }) => { if (error) throw error })
  await queuePreparedEdielMessage({ actorUserId: input.actorUserId, messageId: message.id, outboundRequestId: message.outbound_request_id,
    payload: { recoveryOperationId: authorization.operationId, originalMessageId: input.originalMessageId } })
  return { status: 'queued' as const, kind: authorization.kind, operationId: authorization.operationId, messageId: message.id }
}
