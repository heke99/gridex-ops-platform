import { createHash } from 'node:crypto'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { supabaseService } from '@/lib/supabase/service'

export type CustomerInfoPostSendStatus = 'waiting_for_contrl' | 'waiting_for_aperak' | 'waiting_for_z02'
export function customerInfoPostSendStatus(
  _message: Pick<EdielMessageRow, 'requires_contrl' | 'contrl_status' | 'requires_aperak' | 'aperak_status'>,
): CustomerInfoPostSendStatus {
  void _message
  return 'waiting_for_z02'
}

type SourceProjection = { status: 'source_projection'; companyId: string; environment: string; messageId: string;
  originalHash: string; observedAt: string; authorizesProviderEntry: false }

/** One native transaction reads the genuine frozen receipt/plan, locks every
 * actual source consumer and preserves current ACK/business/terminal results.
 * Caller timestamps and a mutable message status never authorize this repair. */
export async function projectSentEdielSourceState(params: {
  message: Pick<EdielMessageRow, 'id' | 'company_id' | 'environment' | 'direction' | 'raw_payload'>; sentAt?: string | null; actorUserId: string
}): Promise<void> {
  const { message } = params
  if (!message.company_id || message.direction !== 'outbound' || !message.raw_payload
    || !['test', 'production'].includes(message.environment)) throw new Error('ediel_post_send_source_scope_required')
  const originalHash = createHash('sha256').update(message.raw_payload, 'utf8').digest('hex')
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as (name: 'ediel_project_accepted_source_state_v1', input: {
    p_company_id: string; p_environment: string; p_actor_user_id: string; p_message_id: string; p_expected_original_hash: string
  }) => PromiseLike<{ data: SourceProjection | null; error: { message: string } | null }>
  const { data, error } = await rpc('ediel_project_accepted_source_state_v1', { p_company_id: message.company_id,
    p_environment: message.environment, p_actor_user_id: params.actorUserId, p_message_id: message.id, p_expected_original_hash: originalHash })
  if (error) throw error
  if (!data || data.status !== 'source_projection' || data.companyId !== message.company_id || data.environment !== message.environment
    || data.messageId !== message.id || data.originalHash !== originalHash || data.authorizesProviderEntry !== false
    || !Number.isFinite(Date.parse(data.observedAt))) throw new Error('ediel_post_send_frozen_source_projection_invalid')
  if (params.sentAt && Date.parse(params.sentAt) !== Date.parse(data.observedAt)) throw new Error('ediel_post_send_frozen_dispatch_anchor_changed')
}
