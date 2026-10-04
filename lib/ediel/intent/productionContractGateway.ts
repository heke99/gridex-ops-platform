import { supabaseService } from '@/lib/supabase/service'
import { getEdielMessageIntentById, evaluateIntentValidation, updateIntentLifecycle } from '@/lib/ediel/intent/intentEngine'
import { buildProductionContractDraft } from '@/lib/ediel/intent/renderers/productionContract'
import { finalizeCanonicalOutboundDraft, type resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import { queuePreparedEdielMessage } from '@/lib/ediel/flows/shared'
import { readProductionContractSource, reserveProductionContractSource } from '@/lib/ediel/production/contractSource'
import type { EdielMessageRow } from '@/lib/ediel/types'

/** The production-contract gateway is a narrow delegate of the same canonical
 * finalizer/outbox. It never renders from the intent's saved descriptive basis. */
export async function renderAndQueueProductionContract(input: { intentId: string; actorUserId: string; companyId: string; eventId: string;
  routeContext: Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>; outboundRequestId: string }) {
  const intent = await getEdielMessageIntentById(input.intentId)
  if (!intent || intent.companyId !== input.companyId || intent.messageFamily !== 'PRODAT' || intent.messageCode !== 'Z09' || intent.operationId !== input.eventId) throw new Error('production_contract_intent_scope_mismatch')
  const validation = evaluateIntentValidation(intent)
  if (!validation.ok) return { status: 'held' as const, missing: validation.blockingReasons.map(r => r.code) }
  const source = { companyId: input.companyId, eventId: input.eventId, actorUserId: input.actorUserId }
  const basis = await readProductionContractSource(source)
  if (basis.status === 'held') return basis
  let reservation = await reserveProductionContractSource({ ...source, intentId: intent.id, outboundRequestId: input.outboundRequestId })
  if (reservation.status === 'held') return reservation
  const outboundRequestId = reservation.outboundRequestId
  if (reservation.messageId) {
    const { data, error } = await supabaseService.from('ediel_messages').select('*').eq('company_id', input.companyId).eq('id', reservation.messageId).maybeSingle()
    if (error) throw error
    if (!data || data.intent_id !== intent.id || data.outbound_request_id !== outboundRequestId || data.source_operation_id !== input.eventId) throw new Error('production_contract_existing_message_conflict')
    if (data.status !== 'draft') return { status: 'existing' as const, message: data as EdielMessageRow }
  }
  const { draft, dateEventContext } = await buildProductionContractDraft({ actorUserId: input.actorUserId, basis, intent, routeContext: input.routeContext, outboundRequestId })
  const params = { actorUserId: input.actorUserId, requestType: 'customer_masterdata' as const, routeContext: input.routeContext, draft,
    outboundRequestId, dateEventContext,
    duplicateCheck: { sourceType: 'manual', sourceId: intent.id, messageFamily: 'PRODAT', messageCode: 'Z09', receiverEdielId: basis.legalReceiverId } }
  let message: EdielMessageRow
  try { message = await finalizeCanonicalOutboundDraft(params) } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === '23505')) throw error
    const current = await reserveProductionContractSource({ ...source, intentId: intent.id, outboundRequestId })
    if (current.status !== 'reserved' || !current.messageId) throw error
    const { data, error: readError } = await supabaseService.from('ediel_messages').select('*').eq('company_id', input.companyId).eq('id', current.messageId).maybeSingle()
    if (readError || !data) throw readError ?? error
    message = data as EdielMessageRow
  }
  reservation = await reserveProductionContractSource({ ...source, intentId: intent.id, outboundRequestId: input.outboundRequestId })
  if (reservation.status === 'held') return reservation
  if (reservation.messageId !== message.id || message.intent_id !== intent.id || message.outbound_request_id !== outboundRequestId) throw new Error('production_contract_final_message_unbound')
  if (message.status !== 'draft') return { status: 'existing' as const, message }
  await updateIntentLifecycle(intent.id, { renderStatus: 'rendered', edielMessageId: message.id, outboundRequestId, actorUserId: input.actorUserId })
  await queuePreparedEdielMessage({ actorUserId: input.actorUserId, messageId: message.id, outboundRequestId, intentId: intent.id,
    payload: { productionContractEventId: basis.eventId, intentId: intent.id, operationId: basis.eventId, messageFamily: 'PRODAT', messageCode: 'Z09', routeId: input.routeContext.route.id } })
  await updateIntentLifecycle(intent.id, { outboxStatus: 'queued', actorUserId: input.actorUserId })
  return { status: 'queued' as const, message }
}
