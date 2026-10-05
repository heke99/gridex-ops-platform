import { supabaseService } from '@/lib/supabase/service'
import { finalizeCanonicalOutboundDraft } from '@/lib/ediel/core/kernel'
import { evaluateIntentValidation, getEdielMessageIntentById, updateIntentLifecycle } from './intentEngine'
import { queuePreparedEdielMessage } from '@/lib/ediel/flows/shared'
import type { EdielMessageIntent } from './types'
import type { EdielMessageRow } from '@/lib/ediel/types'
import {loadRecoveryMeteringMethodContext,assertRecoveryMeteringMethodRoute} from '@/lib/ediel/recovery/meteringMethodContext'
import {prepareRecoveryCustomerMasterdataContext} from '@/lib/ediel/production/customerMasterdataSource'
import {createCustomerMasterdataAddressFacts} from '@/lib/ediel/prodat/customerMasterdataAuthority'
import {createProdatRegisterEvidence} from '@/lib/ediel/prodat/prodatRegisterEvidence'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {copyReportingSelection} from '@/lib/ediel/prodat/prodatReportingPermissionContext'
import {readContractInvoicee} from '@/lib/ediel/production/contractInvoicee'
import {tenantDb} from '@/lib/supabase/tenantDb'

type DraftParams = Parameters<typeof finalizeCanonicalOutboundDraft>[0]
type ScopedSelect=ReturnType<ReturnType<typeof supabaseService.from>['select']>
type InvoiceeSwitch={id:string;company_id:string|null;customer_id:string;customer_contract_id:string|null;contract_id:string|null}
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
  if(['Z01','Z03'].includes(input.intent.messageCode)){
    const draft=params.draft,routeId=draft.communicationRouteId??input.params.routeContext.route.id
    if(!draft.customerId||!draft.rawPayload||(draft.environment!=='test'&&draft.environment!=='production'))throw Error('prodat_recovery_customer_source_scope_required')
    const context=await prepareRecoveryCustomerMasterdataContext({companyId:input.companyId,operationId:input.operationId,actorUserId:input.actorUserId,intentId:input.intent.id,routeId,customerId:draft.customerId,environment:draft.environment,rawPayload:draft.rawPayload})
    // Source preview/parsed selectors from the caller are replaced only by the
    // fresh native credential for this reserved intent and exact correction.
    params.customerMasterdataContext=context
    const parsed=draft.parsedPayload&&typeof draft.parsedPayload==='object'&&!Array.isArray(draft.parsedPayload)?draft.parsedPayload:{}
    params.draft={...draft,parsedPayload:{...parsed,customerMasterdataSourceContextId:context?.projection.sourceContextId??null}}
    if(context){
      const wire=tokenizeEdifact(draft.rawPayload)
      // The native operation and fresh customer preparation have already
      // qualified these exact corrected bytes. Physical LIN selectors scope
      // facts; their presence cannot supply a customer/address credential.
      const objects=prodatRegisterGroups(wire.segments,wire.una,input.intent.messageCode).groups.map(group=>{
        if(!group.itemId||(group.identityAgency!=='9'&&group.identityAgency!=='89'))throw Error('prodat_recovery_customer_object_required')
        return {meteringPointId:group.itemId,identityAgency:group.identityAgency as '9'|'89'}
      })
      const endUserAddressObjects=objects.flatMap(object=>createCustomerMasterdataAddressFacts({...object,projection:context.projection}))
      const invoiceeObjects=[]
      if(input.intent.messageCode==='Z03'){
        if(!draft.switchRequestId||input.intent.supplierSwitchRequestId!==draft.switchRequestId)throw Error('prodat_recovery_invoicee_switch_required')
        const{data:source,error}=await(tenantDb(input.companyId).from('supplier_switch_requests')
          .select('id,company_id,customer_id,customer_contract_id,contract_id') as ScopedSelect)
          .eq('id',draft.switchRequestId).returns<InvoiceeSwitch[]>().maybeSingle()
        if(error)throw error
        const contractId=source?.customer_contract_id??source?.contract_id
        if(!source||source.id!==draft.switchRequestId||source.company_id!==input.companyId||source.customer_id!==draft.customerId||!contractId
          ||source.customer_contract_id&&source.contract_id&&source.customer_contract_id!==source.contract_id)throw Error('prodat_recovery_invoicee_contract_required')
        for(const object of objects){
          const invoicee=await readContractInvoicee({companyId:input.companyId,customerId:draft.customerId,contractId,...object,
            endUser:{identity:context.projection.customerIdentity,...context.projection.endUserMasterdata}})
          invoiceeObjects.push(invoicee.fact)
        }
      }
      // Rebuild from current protected contexts and the independent tenant
      // contract source. Never relabel the original's body-bound facts or a
      // caller's old customer/source selectors as this fresh correction.
      const engine=parsed.prodatEngine&&typeof parsed.prodatEngine==='object'&&!Array.isArray(parsed.prodatEngine)?parsed.prodatEngine:{}
      params.draft.parsedPayload={...params.draft.parsedPayload,prodatEngine:{...engine,registerEvidence:createProdatRegisterEvidence({code:input.intent.messageCode,rawSegments:wire.segments.map(s=>s.raw),una:wire.una,facts:{market:'electricity',endUserAddressObjects,invoiceeObjects,
        ...(params.dateEventContext?{dateEventSource:params.dateEventContext.source,dateEventObjects:params.dateEventContext.objects}:{}),
        ...(params.reportingContext?{reportingPermission:copyReportingSelection({source:params.reportingContext.source,objects:params.reportingContext.objects})}:{})}})}}
    }
  }
  if(input.intent.messageCode==='Z09'){const raw=params.draft.rawPayload;if(!raw)throw Error('prodat_recovery_physical_source_required');const context=await loadRecoveryMeteringMethodContext({companyId:input.companyId,operationId:input.operationId,actorUserId:input.actorUserId,rawPayload:raw});if(context)assertRecoveryMeteringMethodRoute(context,params.routeContext)}
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
