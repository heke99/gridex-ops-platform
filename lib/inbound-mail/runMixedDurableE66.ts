import { createHash } from 'node:crypto'
import { prepareSourceAckDraft } from '@/lib/ediel/ack/prepareSourceAckDraft'
import { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import { getEdielMessageById } from '@/lib/ediel/db'
import { finalizeUtiltsTransactionAck } from '@/lib/ediel/utilts/transactionPersistence'
import type { DurableE66Scope } from '@/lib/inbound-mail/qualifyDurableE66'
import { supabaseService } from '@/lib/supabase/service'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function runNextMixedDurableE66(scope: DurableE66Scope) {
  if (scope.environment !== 'test' || process.env.GRIDEX_EDIEL_DURABLE_E66_MIXED !== '1' ||
      process.env.GRIDEX_EDIEL_DURABLE_E66_SG11_REVIEW !== '1') return {state: 'idle' as const}

  const step = async (action: string, args?: Record<string, unknown>) => {
    const {data,error}=await supabaseService.rpc('gridex_step_mixed_e66_worker_v1' as never,{
      p_company:scope.companyId,p_environment:scope.environment,p_mailbox:scope.mailboxId,p_actor:scope.actorUserId,
      p_action:action,...args,
    } as never)
    if(error) throw new Error(`mixed_e66_worker_${action}_failed:${error.message}`)
    if(!data || typeof data!=='object' || Array.isArray(data)) throw new Error('mixed_e66_worker_invalid_receipt')
    return data as Record<string, unknown>
  }

  const claimed=await step('claim')
  if(claimed.kind==='idle') return {state:'idle' as const}
  const {sourceId,transactionId,lease}=claimed
  if(claimed.kind!=='claimed' || typeof sourceId!=='string' || !uuid.test(sourceId) ||
      typeof lease!=='string' || !uuid.test(lease) || typeof transactionId!=='string' || !transactionId.trim()) {
    throw new Error('mixed_e66_worker_invalid_claim')
  }
  const target={p_source:sourceId,p_ide:transactionId,p_worker_lease:lease}
  try {
    let next=await step('advance',target)
    if(next.kind==='held' || next.kind==='progress') return {state:next.kind}
    if (next.kind === 'render' || next.kind === 'render_e50') {
      const negative = next.kind === 'render_e50'
      const message = await getEdielMessageById(sourceId, {companyId: scope.companyId})
      if (!message?.raw_payload || message.company_id !== scope.companyId || message.environment !== 'test' ||
          message.direction !== 'inbound' || message.message_family !== 'UTILTS' || message.message_code !== 'E66' ||
          createHash('sha256').update(message.raw_payload, 'utf8').digest('hex') !== next.sourceHash ||
          (!negative && (typeof next.draftLease !== 'string' || !uuid.test(next.draftLease)))) {
        throw new Error('mixed_e66_worker_draft_scope_invalid')
      }
      const family = negative ? 'UTILTS_ERR' : 'APERAK'
      const prepared = await prepareSourceAckDraft({
        actorUserId: scope.actorUserId, sourceMessage: message, ackFamily: family,
        outcome: negative ? 'negative' : 'positive', messageText: negative ? 'E50' : undefined,
        ackScope: 'transaction', relatedTransactionReference: transactionId,
      })
      if (prepared.kind === 'existing' && !negative) throw new Error('mixed_e66_worker_draft_already_present')
      if (prepared.kind === 'existing') {
        next = await step('store', {...target, p_draft: {rawPayload: prepared.message.raw_payload}})
      } else {
        const route = await resolveCanonicalOutboundContext({
          requestType: 'ediel_ack', companyId: scope.companyId, environment: scope.environment,
          messageStandard: 'edifact', receiverEdielId: prepared.draft.receiverEdielId,
          applicationReference: message.application_reference,
          ackProfile: {family, code: prepared.draft.messageCode},
        })
        if (!route.routeRuntime?.route_profile_id) throw new Error('mixed_e66_worker_reply_route_unavailable')
        next = await step('store', {
          ...target, ...(negative ? {} : {p_draft_lease: next.draftLease}), p_draft: {
            rawPayload: prepared.draft.rawPayload, messageVersion: prepared.draft.messageVersion,
            processType: prepared.draft.processType, transportType: prepared.draft.transportType,
            communicationRouteId: route.route.id, routeProfileId: route.routeRuntime.route_profile_id,
            receiverEmail: route.receiverEmail ?? prepared.draft.receiverEmail ?? null,
            senderEmail: prepared.draft.senderEmail ?? null, mailbox: route.mailbox ?? prepared.draft.mailbox ?? null,
          },
        })
      }
      if (next.kind === 'held') {
        await step('defer', target)
        return {state: 'held' as const}
      }
    }
    if (next.kind === 'finalize_e50') {
      if (typeof next.responseId !== 'string' || !uuid.test(next.responseId)) throw new Error('mixed_e66_worker_invalid_advance')
      const finished = await step('finish', target)
      if (finished.kind !== 'e50_finalized' || finished.responseId !== next.responseId) throw new Error('mixed_e50_worker_invalid_finish')
      return {state: 'finalized' as const}
    }
    if(next.kind!=='finalize' || typeof next.responseId!=='string' || !uuid.test(next.responseId)) {
      throw new Error('mixed_e66_worker_invalid_advance')
    }
    await finalizeUtiltsTransactionAck({companyId:scope.companyId,environment:scope.environment,sourceMessageId:sourceId,
      transactionId,responseType:'positive_aperak',responseMessageId:next.responseId,
      mixedScope:{actorUserId:scope.actorUserId,mailboxId:scope.mailboxId}})
    await step('finish',target)
    return {state:'finalized' as const}
  } catch (error) {
    try { await step('defer',target) } catch { /* The authoritative lease can expire and be retried. */ }
    throw error
  }
}
