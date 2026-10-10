import {loadPreparedSwitchCancellationCustomerMasterdataContext,prepareSwitchCancellationCustomerMasterdataContext} from '@/lib/ediel/production/customerMasterdataSource'
import {customerMasterdataSendIssue,createCustomerMasterdataAddressFacts} from '@/lib/ediel/prodat/customerMasterdataAuthority'
import {createProdatRegisterEvidence} from '@/lib/ediel/prodat/prodatRegisterEvidence'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import { supabaseService } from '@/lib/supabase/service'
import { tenantDb } from '@/lib/supabase/tenantDb'
type ScopedSelect = ReturnType<ReturnType<typeof supabaseService.from>['select']>
import { getEdielMessageIntentById, evaluateIntentValidation, updateIntentLifecycle } from '@/lib/ediel/intent/intentEngine'
import { buildSwitchCancellationDraft } from '@/lib/ediel/intent/renderers/switchCancellation'
import { finalizeCanonicalOutboundDraft, type resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import { queuePreparedEdielMessage } from '@/lib/ediel/flows/shared'
import { assertSwitchCancellationRoute, readSwitchCancellationSource, reserveSwitchCancellationSource, type SwitchCancellationBasis } from '@/lib/ediel/production/switchCancellationSource'
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
    await recheckBoundSwitchCancellationDraft(input,basis,data,intent.operationId,outboundRequestId)
    return queueBoundSwitchCancellation(input,data,intent.operationId,outboundRequestId)

  }
  const { draft, sourceCustomerMasterdataContext, dependentConditionFacts } = await buildSwitchCancellationDraft({ actorUserId: input.actorUserId, basis, intent, routeContext: input.routeContext, outboundRequestId })
  const customerMasterdataContext=await prepareSwitchCancellationCustomerMasterdataContext({companyId:input.companyId,operationId:intent.operationId,
    actorUserId:input.actorUserId,intentId:intent.id,routeId:input.routeContext.route.id,customerId:basis.customerId,environment:basis.environment,
    switchRequestId:basis.switchRequestId,originalMessageId:basis.originalMessageId,originalHash:basis.originalHash,rawPayload:draft.rawPayload??'',sourceContext:sourceCustomerMasterdataContext})
  const wire=tokenizeEdifact(draft.rawPayload??'')
  const parsed=draft.parsedPayload as {prodatEngine:Record<string,unknown>}
  draft.parsedPayload={...parsed,customerMasterdataSourceContextId:customerMasterdataContext.projection.sourceContextId,
    prodatEngine:{...parsed.prodatEngine,registerEvidence:createProdatRegisterEvidence({code:'Z03',rawSegments:wire.segments.map(segment=>segment.raw),una:wire.una,
      facts:{...dependentConditionFacts,endUserAddressObjects:createCustomerMasterdataAddressFacts({projection:customerMasterdataContext.projection,meteringPointId:basis.pointId,identityAgency:basis.identityAgency})}})}}
  const params = { customerMasterdataContext, actorUserId: input.actorUserId, requestType:'supplier_switch' as const, routeContext: input.routeContext, draft,
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
  await recheckBoundSwitchCancellationDraft(input,basis,message,intent.operationId,outboundRequestId)
  return queueBoundSwitchCancellation(input,message,intent.operationId,outboundRequestId)
}
async function recheckBoundSwitchCancellationDraft(input:{companyId:string;intentId:string;actorUserId:string;routeContext:Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>},basis:SwitchCancellationBasis,message:EdielMessageRow,operationId:string,outboundRequestId:string){
  assertSwitchCancellationRoute(basis,input.routeContext)
  if(message.company_id!==input.companyId||message.intent_id!==input.intentId||message.outbound_request_id!==outboundRequestId||message.source_operation_id!==operationId
    ||message.communication_route_id!==input.routeContext.route.id||message.environment!==basis.environment||message.original_message_id!==basis.originalMessageId||message.switch_request_id!==basis.switchRequestId)throw Error('switch_cancellation_existing_message_conflict')
  const context=await loadPreparedSwitchCancellationCustomerMasterdataContext(message,input.actorUserId,basis.originalHash)
  const issue=customerMasterdataSendIssue(message,context)
  if(issue)throw Error(issue.code)
}
async function queueBoundSwitchCancellation(input:{intentId:string;actorUserId:string;routeContext:Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>},message:EdielMessageRow,operationId:string,outboundRequestId:string){
  await updateIntentLifecycle(input.intentId, { renderStatus: 'rendered', edielMessageId: message.id, outboundRequestId, actorUserId: input.actorUserId })
  await queuePreparedEdielMessage({ actorUserId: input.actorUserId, messageId: message.id, outboundRequestId, intentId: input.intentId,
    payload: { switchCancellationOperationId:operationId, intentId: input.intentId, operationId, messageFamily: 'PRODAT', messageCode: 'Z03', routeId: input.routeContext.route.id } })
  await updateIntentLifecycle(input.intentId, { outboxStatus: 'queued', actorUserId: input.actorUserId })
  return { status: 'queued' as const, message }
}
