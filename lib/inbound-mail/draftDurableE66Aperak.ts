import { prepareSourceAckDraft } from '@/lib/ediel/ack/prepareSourceAckDraft'
import { createCanonicalAckMessage } from '@/lib/ediel/core/kernel'
import { getEdielMessageById } from '@/lib/ediel/db'
import type { DurableE66Scope } from '@/lib/inbound-mail/qualifyDurableE66'
import { supabaseService } from '@/lib/supabase/service'
import { finalizeUtiltsTransactionAck } from '@/lib/ediel/utilts/transactionPersistence'

type NativeScope = {
  p_company: string
  p_environment: DurableE66Scope['environment']
  p_mailbox: string
  p_actor: string
}

type AckOutcome =
  | { state: 'idle' }
  | { state: 'drafted'; sourceId: string; ackId: string }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function draftNextDurableE66Aperak(scope: DurableE66Scope): Promise<AckOutcome> {
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as (
    name: 'gridex_claim_e66_aperak_draft_v1',
    args: NativeScope,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  const { data, error } = await rpc('gridex_claim_e66_aperak_draft_v1', {
    p_company: scope.companyId, p_environment: scope.environment, p_mailbox: scope.mailboxId, p_actor: scope.actorUserId,
  })
  if (error) throw new Error(`e66_aperak_claim_failed:${error.message}`)
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('e66_aperak_claim_invalid')
  const { kind, sourceId, transactionId } = data as Record<string, unknown>
  if (kind === 'idle') return { state: 'idle' }
  if (kind !== 'claimed' || typeof sourceId !== 'string' || !uuid.test(sourceId) ||
      typeof transactionId !== 'string' || !transactionId.trim()) {
    throw new Error('e66_aperak_claim_invalid')
  }

  const sourceMessage = await getEdielMessageById(sourceId, { companyId: scope.companyId })
  if (!sourceMessage || sourceMessage.company_id !== scope.companyId || sourceMessage.environment !== scope.environment ||
      sourceMessage.direction !== 'inbound' || sourceMessage.message_family !== 'UTILTS' ||
      sourceMessage.message_code !== 'E66' || !sourceMessage.raw_payload) {
    throw new Error('e66_aperak_source_scope_invalid')
  }
  const request = {
    actorUserId: scope.actorUserId, sourceMessage, ackFamily: 'APERAK' as const, outcome: 'positive' as const,
    ackScope: 'transaction' as const, relatedTransactionReference: transactionId,
  }
  const prepared = await prepareSourceAckDraft(request)
  const ack = prepared.kind === 'existing' ? prepared.message : await createCanonicalAckMessage({
    actorUserId: scope.actorUserId, sourceMessage, ackFamily: 'APERAK', outcome: 'positive', draft: prepared.draft,
  })
  if (!uuid.test(ack.id) || ack.company_id !== scope.companyId || ack.environment !== scope.environment ||
      ack.related_message_id !== sourceId || ack.direction !== 'outbound' || ack.message_family !== 'APERAK') {
    throw new Error('e66_aperak_receipt_invalid')
  }
  // A persisted draft is eligible for sending only after its exact reservation
  // is finalized. Reopening an interrupted draft reuses the same ACK ID.
  await finalizeUtiltsTransactionAck({
    companyId: scope.companyId, environment: scope.environment, sourceMessageId: sourceId,
    transactionId, responseType: 'positive_aperak', responseMessageId: ack.id,
  })
  return { state: 'drafted', sourceId, ackId: ack.id }
}
