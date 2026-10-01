import { supabaseService } from '@/lib/supabase/service'
import type { AckFamily } from '@/lib/ediel/core/ackPolicy'
import type { EdielMessageRow } from '@/lib/ediel/types'

/** Current native actor/original owner supplies the list. Only actual private
 * duplicate-response receipt IDs are excluded, including failed/cancelled ACKs. */
export async function listBusinessAckMessagesForSource(input: {
  companyId: string | null | undefined
  sourceMessageId: string
  actorUserId: string
  environment?: string | null
  ackFamily?: AckFamily | null
}): Promise<EdielMessageRow[]> {
  if (!input.companyId || !input.sourceMessageId || !input.actorUserId) throw new Error('ediel_business_ack_scope_required')
  const { data, error } = await supabaseService.rpc('ediel_list_business_acks_for_source_v1', {
    p_company_id: input.companyId, p_source_message_id: input.sourceMessageId, p_actor_user_id: input.actorUserId,
    p_environment: input.environment ?? null, p_ack_family: input.ackFamily ?? null,
  })
  if (error) throw error
  const result = data as { version?: number; companyId?: string; sourceMessageId?: string; environment?: string; ackFamily?: string | null; messages?: EdielMessageRow[] } | null
  if (!result || result.version !== 1 || result.companyId !== input.companyId || result.sourceMessageId !== input.sourceMessageId ||
      !['test', 'production'].includes(result.environment ?? '') || (input.environment && result.environment !== input.environment) ||
      result.ackFamily !== (input.ackFamily ?? null) || !Array.isArray(result.messages) || result.messages.some(m =>
        m.company_id !== input.companyId || m.environment !== result.environment || m.related_message_id !== input.sourceMessageId ||
        m.direction !== 'outbound' || !['CONTRL', 'APERAK', 'UTILTS_ERR'].includes(m.message_family) ||
        (input.ackFamily && m.message_family !== input.ackFamily))) throw new Error('ediel_business_ack_native_scope_mismatch')
  return result.messages
}
