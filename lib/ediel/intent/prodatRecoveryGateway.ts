import { supabaseService } from '@/lib/supabase/service'
import { finalizeCanonicalOutboundDraft } from '@/lib/ediel/core/kernel'
import { evaluateIntentValidation, getEdielMessageIntentById, updateIntentLifecycle } from './intentEngine'
import { queuePreparedEdielMessage } from '@/lib/ediel/flows/shared'
import type { EdielMessageIntent } from './types'
import type { EdielMessageRow } from '@/lib/ediel/types'

type DraftParams = Parameters<typeof finalizeCanonicalOutboundDraft>[0]
async function reserve(input: { companyId: string; operationId: string; actorUserId: string; intentId: string; outboundRequestId: string }) {
  const { data, error } = await supabaseService.rpc('ediel_reserve_prodat_recovery_origin_v1', {
    p_company_id: input.companyId,p_operation_id: input.operationId,p_actor_user_id: input.actorUserId,p_intent_id: input.intentId,p_outbound_request_id: input.outboundRequestId,
  })
  if (error) throw error
  if (!data || data.status !== 'reserved' || data.intentId !== input.intentId || typeof data.outboundRequestId !== 'string') throw new Error('prodat_recovery_origin_reservation_invalid')
  return data as { status: 'reserved'; intentId: string; outboundRequestId: string; messageId: string | null }
}
/** Recovery delegates the same canonical finalizer. An intent and private first
 * request reservation belong to this correction, never to the sent original. */
export async function finalizeRecoveryDraft(input: { companyId: string; operationId: string; actorUserId: string; intent: EdielMessageIntent; params: DraftParams }) {
  if (input.intent.companyId !== input.companyId || input.intent.operationId !== input.operationId || input.intent.messageFamily !== 'PRODAT' || !evaluateIntentValidation(input.intent).ok || !input.params.outboundRequestId) throw new Error('prodat_recovery_validated_intent_required')
  const scope = { companyId: input.companyId, operationId: input.operationId, actorUserId: input.actorUserId, intentId: input.intent.id, outboundRequestId: input.params.outboundRequestId }
  const reservation = await reserve(scope)
  const params = { ...input.params, outboundRequestId: reservation.outboundRequestId, draft: { ...input.params.draft, intentId: input.intent.id, outboundRequestId: reservation.outboundRequestId },
    duplicateCheck: { ...input.params.duplicateCheck, sourceType: 'manual', sourceId: input.intent.id } }
  let message: EdielMessageRow
  try { message = await finalizeCanonicalOutboundDraft(params) } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === '23505')) throw error
    const current = await reserve(scope)
    if (!current.messageId) throw error
    const { data, error: readError } = await supabaseService.from('ediel_messages').select('*').eq('company_id', input.companyId).eq('id', current.messageId).maybeSingle()
    if (readError || !data) throw readError ?? error
    message = data as EdielMessageRow
  }
  const current = await reserve(scope)
  if (current.messageId !== message.id || message.intent_id !== input.intent.id || message.outbound_request_id !== current.outboundRequestId) throw new Error('prodat_recovery_final_message_unbound')
  return message
}
export async function queueRecoveryDraft(input: { companyId: string; operationId: string; actorUserId: string; message: EdielMessageRow }) {
  const message = input.message
  if (!message.intent_id || !message.outbound_request_id) throw new Error('prodat_recovery_bound_intent_required')
  const intent = await getEdielMessageIntentById(message.intent_id)
  if (!intent || intent.companyId !== input.companyId || intent.operationId !== input.operationId || intent.messageCode !== message.message_code || !evaluateIntentValidation(intent).ok) throw new Error('prodat_recovery_current_intent_required')
  const current = await reserve({ ...input, intentId: intent.id, outboundRequestId: message.outbound_request_id })
  if (current.messageId !== message.id || current.outboundRequestId !== message.outbound_request_id) throw new Error('prodat_recovery_final_message_unbound')
  await supabaseService.rpc('ediel_require_prodat_recovery_current_v1', { p_company_id: input.companyId, p_message_id: message.id }).then(({ error }) => { if (error) throw error })
  await updateIntentLifecycle(intent.id, { renderStatus: 'rendered', edielMessageId: message.id, outboundRequestId: message.outbound_request_id, actorUserId: input.actorUserId })
  if (message.message_code === 'Z03') {
    const { data, error } = await supabaseService.rpc('ediel_bind_switch_correction_v1', { p_company_id: input.companyId, p_message_id: message.id, p_actor_user_id: input.actorUserId })
    if (error) throw error
    if (!data || data.status !== 'bound' || data.messageId !== message.id) throw new Error('prodat_recovery_switch_correction_binding_required')
  }
  await queuePreparedEdielMessage({ actorUserId: input.actorUserId,messageId: message.id,outboundRequestId: message.outbound_request_id,intentId: intent.id,
    payload: { recoveryOperationId: input.operationId,originalMessageId: message.original_message_id,intentId: intent.id } })
  await updateIntentLifecycle(intent.id, { outboxStatus: 'queued', actorUserId: input.actorUserId })
}
