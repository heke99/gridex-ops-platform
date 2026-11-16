import { supabaseService } from '@/lib/supabase/service'
import { tenantDb } from '@/lib/supabase/tenantDb'
type ScopedSelect = ReturnType<ReturnType<typeof supabaseService.from>['select']>
import { getEdielMessageIntentById, evaluateIntentValidation, updateIntentLifecycle } from '@/lib/ediel/intent/intentEngine'
import { buildBrpChangeDraft } from '@/lib/ediel/intent/renderers/brpChange'
import { finalizeCanonicalOutboundDraft, type resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import { queuePreparedEdielMessage } from '@/lib/ediel/flows/shared'
import { readBrpChangeSource, reserveBrpChangeSource } from '@/lib/ediel/production/brpChangeSource'
import type { EdielMessageRow } from '@/lib/ediel/types'

/** The BRP-change gateway is a narrow delegate of the same canonical
 * finalizer/outbox. It never renders from the intent's saved descriptive basis. */
export async function renderAndQueueBrpChange(input: { intentId: string; actorUserId: string; companyId: string; eventId: string;
  routeContext: Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>; outboundRequestId: string }) {
  const intent = await getEdielMessageIntentById(input.intentId)
  if (!intent || intent.companyId !== input.companyId || intent.messageFamily !== 'PRODAT' || intent.messageCode !== 'Z09' || intent.operationId !== input.eventId) throw new Error('brp_change_intent_scope_mismatch')
  const validation = evaluateIntentValidation(intent)
  if (!validation.ok) return { status: 'held' as const, missing: validation.blockingReasons.map(r => r.code) }
  const source = { companyId: input.companyId, eventId: input.eventId, actorUserId: input.actorUserId }
  const basis = await readBrpChangeSource(source)
  if (basis.status === 'held') return basis
  let reservation = await reserveBrpChangeSource({ ...source, intentId: intent.id, outboundRequestId: input.outboundRequestId })
  if (reservation.status === 'held') return reservation
  const outboundRequestId = reservation.outboundRequestId
  if (reservation.messageId) {
    const { data, error } = await (tenantDb(input.companyId).from('ediel_messages').select('*') as ScopedSelect).eq('id', reservation.messageId).returns<EdielMessageRow[]>().maybeSingle()
    if (error) throw error
    if (!data || data.intent_id !== intent.id || data.outbound_request_id !== outboundRequestId || data.source_operation_id !== input.eventId) throw new Error('brp_change_existing_message_conflict')
    if (data.status !== 'draft') return { status: 'existing' as const, message: data as EdielMessageRow }
  }
  const { draft } = await buildBrpChangeDraft({ actorUserId: input.actorUserId, basis, intent, routeContext: input.routeContext, outboundRequestId })
  const params = { actorUserId: input.actorUserId, requestType: 'customer_masterdata' as const, routeContext: input.routeContext, draft,
    outboundRequestId,
    duplicateCheck: { sourceType: 'manual', sourceId: intent.id, messageFamily: 'PRODAT', messageCode: 'Z09', receiverEdielId: basis.legalReceiverId } }
  let message: EdielMessageRow
  try { message = await finalizeCanonicalOutboundDraft(params) } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === '23505')) throw error
    const current = await reserveBrpChangeSource({ ...source, intentId: intent.id, outboundRequestId })
    if (current.status !== 'reserved' || !current.messageId) throw error
    const { data, error: readError } = await (tenantDb(input.companyId).from('ediel_messages').select('*') as ScopedSelect).eq('id', current.messageId).returns<EdielMessageRow[]>().maybeSingle()
    if (readError || !data) throw readError ?? error
    message = data as EdielMessageRow
  }
  reservation = await reserveBrpChangeSource({ ...source, intentId: intent.id, outboundRequestId: input.outboundRequestId })
  if (reservation.status === 'held') return reservation
  if (reservation.messageId !== message.id || message.intent_id !== intent.id || message.outbound_request_id !== outboundRequestId) throw new Error('brp_change_final_message_unbound')
  if (message.status !== 'draft') return { status: 'existing' as const, message }
  await updateIntentLifecycle(intent.id, { renderStatus: 'rendered', edielMessageId: message.id, outboundRequestId, actorUserId: input.actorUserId })
  await queuePreparedEdielMessage({ actorUserId: input.actorUserId, messageId: message.id, outboundRequestId, intentId: intent.id,
    payload: { brpChangeEventId: basis.eventId, intentId: intent.id, operationId: basis.eventId, messageFamily: 'PRODAT', messageCode: 'Z09', routeId: input.routeContext.route.id } })
  await updateIntentLifecycle(intent.id, { outboxStatus: 'queued', actorUserId: input.actorUserId })
  return { status: 'queued' as const, message }
}
