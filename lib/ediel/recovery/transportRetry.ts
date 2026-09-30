import { supabaseService } from '@/lib/supabase/service'

export type ProdatTransportRetryBasis = Readonly<{
  operationId: string; previousAttemptId: string; messageId: string; outboxId: string; originalPayloadHash: string
}>

/** Editable outbox payload is never retry authority. The private operation
 * binds the actual original, observed negative attempt and new outbox once. */
export async function readProdatTransportRetryBasis(input: { companyId: string; messageId: string; outboxId: string; actorUserId: string }): Promise<ProdatTransportRetryBasis | null> {
  const { data, error } = await supabaseService.rpc('ediel_prodat_retry_outbox_basis_v1', {
    p_company_id: input.companyId, p_outbox_id: input.outboxId, p_actor_user_id: input.actorUserId,
  })
  if (error) throw error
  if (data === null) return null
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!data || data.messageId !== input.messageId || data.outboxId !== input.outboxId
    || !uuid.test(data.operationId) || !uuid.test(data.previousAttemptId) || !/^[0-9a-f]{64}$/.test(data.originalPayloadHash)) throw new Error('prodat_transport_retry_basis_invalid')
  return Object.freeze({ operationId: data.operationId, previousAttemptId: data.previousAttemptId, messageId: data.messageId,
    outboxId: data.outboxId, originalPayloadHash: data.originalPayloadHash })
}
