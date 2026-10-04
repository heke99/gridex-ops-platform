import { supabaseService } from '@/lib/supabase/service'
import { tenantDb } from '@/lib/supabase/tenantDb'
type ScopedSelect = ReturnType<ReturnType<typeof supabaseService.from>['select']>
import { getEdielMessageIntentById, evaluateIntentValidation, updateIntentLifecycle } from '@/lib/ediel/intent/intentEngine'
import { buildSwitchCancellationDraft } from '@/lib/ediel/intent/renderers/switchCancellation'
import { finalizeCanonicalOutboundDraft, type resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import { queuePreparedEdielMessage } from '@/lib/ediel/flows/shared'
import { readSwitchCancellationSource, reserveSwitchCancellationSource } from '@/lib/ediel/production/switchCancellationSource'
import type { EdielMessageRow } from '@/lib/ediel/types'

/** The cancellation gateway is a narrow delegate of the same canonical
 * finalizer/outbox; it preserves the previously sent L/LK original. It never renders from the intent's saved descriptive basis. */
export async function renderAndQueueSwitchCancellation(input: { intentId: string; actorUserId: string; companyId: string; switchRequestId:string;
  routeContext: Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>; outboundRequestId: string }) {
  const intent = await getEdielMessageIntentById(input.intentId)
  if (!intent || intent.companyId !== input.companyId || intent.messageFamily !== 'PRODAT' || intent.messageCode !== 'Z03' || !intent.operationId||intent.supplierSwitchRequestId!==input.switchRequestId) throw new Error('switch_cancellation_intent_scope_mismatch')
  const validation = evaluateIntentValidation(intent)
  if (!validation.ok) return { status: 'held' as const, missing: validation.blockingReasons.map(r => r.code) }
  const source = { companyId: input.companyId, switchRequestId:input.switchRequestId, actorUserId: input.actorUserId }
  const basis = await readSwitchCancellationSource(source)
  if (basis.status === 'held') return basis
  let reservation = await reserveSwitchCancellationSource({ ...source, intentId: intent.id, outboundRequestId: input.outboundRequestId })
  if (reservation.status === 'held') return reservation
  const outboundRequestId = reservation.outboundRequestId
  if (reservation.messageId) {
    const { data, error } = await (tenantDb(input.companyId).from('ediel_messages').select('*') as ScopedSelect).eq('id', reservation.messageId).returns<EdielMessageRow[]>().maybeSingle()
    if (error) throw error
    if (!data || data.intent_id !== intent.id || data.outbound_request_id !== outboundRequestId || data.source_operation_id !== intent.operationId) throw new Error('switch_cancellation_existing_message_conflict')
    if (data.status !== 'draft') return { status: 'existing' as const, message: data as EdielMessageRow }
  }
  const { draft } = await buildSwitchCancellationDraft({ actorUserId: input.actorUserId, basis, intent, routeContext: input.routeContext, outboundRequestId })
  const params = { actorUserId: input.actorUserId, requestType:'supplier_switch' as const, routeContext: input.routeContext, draft,
    outboundRequestId,
    duplicateCheck: { sourceType: 'manual', sourceId: intent.id, messageFamily: 'PRODAT', messageCode: 'Z03', receiverEdielId: basis.legalReceiverId } }
  let message: EdielMessageRow
  try { message = await finalizeCanonicalOutboundDraft(params) } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === '23505')) throw error
    const current = await reserveSwitchCancellationSource({ ...source, intentId: intent.id, outboundRequestId })
    if (current.status !== 'reserved' || !current.messageId) throw error
    const { data, error: readError } = await (tenantDb(input.companyId).from('ediel_messages').select('*') as ScopedSelect).eq('id', current.messageId).returns<EdielMessageRow[]>().maybeSingle()
    if (readError || !data) throw readError ?? error
    message = data as EdielMessageRow
  }
  reservation = await reserveSwitchCancellationSource({ ...source, intentId: intent.id, outboundRequestId: input.outboundRequestId })
  if (reservation.status === 'held') return reservation
  if (reservation.messageId !== message.id || message.intent_id !== intent.id || message.outbound_request_id !== outboundRequestId) throw new Error('switch_cancellation_final_message_unbound')
  if (message.status !== 'draft') return { status: 'existing' as const, message }
  await updateIntentLifecycle(intent.id, { renderStatus: 'rendered', edielMessageId: message.id, outboundRequestId, actorUserId: input.actorUserId })
  await queuePreparedEdielMessage({ actorUserId: input.actorUserId, messageId: message.id, outboundRequestId, intentId: intent.id,
    payload: { switchCancellationOperationId:intent.operationId, intentId: intent.id, operationId: intent.operationId, messageFamily: 'PRODAT', messageCode: 'Z03', routeId: input.routeContext.route.id } })
  await updateIntentLifecycle(intent.id, { outboxStatus: 'queued', actorUserId: input.actorUserId })
  return { status: 'queued' as const, message }
}
