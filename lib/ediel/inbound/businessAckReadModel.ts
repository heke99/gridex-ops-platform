import { supabaseService } from '@/lib/supabase/service'
import type { AckFamily } from '@/lib/ediel/core/ackPolicy'
import type { EdielMessageRow } from '@/lib/ediel/types'

export type BusinessAckStatus = {
  messages: EdielMessageRow[]
  heldOriginalIds: string[]
  sourceDirection: 'inbound' | 'outbound'
  sourceSnapshot: EdielMessageRow | null
  sourceReceipt: { sourceAccepted: boolean; finalAckReached: boolean; wholeSourceRejected: boolean } | null
}
export type BusinessAckDisplayStatus = BusinessAckStatus | { messages: []; heldOriginalIds: []; holdReason: 'unavailable' }

/** Historical status only. Native source/ACK owners qualify the originals;
 * current communication.read authorizes disclosure, without preparing effects. */
export async function readBusinessAckStatus(input: {
  sourceMessageId: string
  actorUserId: string
  companyId?: string | null
  environment?: string | null
  ackFamily?: AckFamily | null
}): Promise<BusinessAckStatus> {
  if (!input.sourceMessageId || !input.actorUserId) throw Error('ediel_business_ack_status_scope_required')
  const { data, error } = await supabaseService.rpc('ediel_read_business_ack_status_v1', {
    p_source_message_id: input.sourceMessageId, p_actor_user_id: input.actorUserId,
    p_company_id: input.companyId ?? null, p_environment: input.environment ?? null, p_ack_family: input.ackFamily ?? null,
  })
  if (error) throw error
  const result = data as { version?: number; companyId?: string; sourceMessageId?: string; environment?: string;
    ackFamily?: string | null; sourceDirection?: string; sourceSnapshot?: EdielMessageRow | null;
    sourceReceipt?: BusinessAckStatus['sourceReceipt']; messages?: EdielMessageRow[]; heldOriginalIds?: string[] } | null
  if (!result || result.version !== 1 || !result.companyId || result.sourceMessageId !== input.sourceMessageId ||
    !['test', 'production'].includes(result.environment ?? '') || (input.companyId && result.companyId !== input.companyId) ||
    (input.environment && result.environment !== input.environment) || result.ackFamily !== (input.ackFamily ?? null) ||
    !['inbound', 'outbound'].includes(result.sourceDirection ?? '') ||
    (result.sourceSnapshot != null && (result.sourceDirection !== 'outbound' || result.sourceSnapshot.id !== input.sourceMessageId ||
      result.sourceSnapshot.company_id !== result.companyId || result.sourceSnapshot.environment !== result.environment || result.sourceSnapshot.direction !== 'outbound')) ||
    (result.sourceSnapshot != null && (!result.sourceReceipt || ['sourceAccepted', 'finalAckReached', 'wholeSourceRejected'].some(k =>
      typeof result.sourceReceipt?.[k as keyof NonNullable<BusinessAckStatus['sourceReceipt']>] !== 'boolean'))) ||
    (result.sourceSnapshot == null && result.sourceReceipt != null) ||
    !Array.isArray(result.messages) || !Array.isArray(result.heldOriginalIds) || result.heldOriginalIds.some(id => typeof id !== 'string') ||
    result.messages.some(m => m.company_id !== result.companyId || m.environment !== result.environment || m.related_message_id !== input.sourceMessageId ||
      m.direction !== (result.sourceDirection === 'inbound' ? 'outbound' : 'inbound') ||
      !['CONTRL', 'APERAK', 'UTILTS_ERR'].includes(m.message_family) || (input.ackFamily && m.message_family !== input.ackFamily))) {
    throw Error('ediel_business_ack_status_native_scope_mismatch')
  }
  return { messages: result.messages, heldOriginalIds: result.heldOriginalIds,
    sourceDirection: result.sourceDirection as BusinessAckStatus['sourceDirection'], sourceSnapshot: result.sourceSnapshot ?? null,
    sourceReceipt: result.sourceReceipt ?? null }
}

/** Display failure is an explicit hold for this row. Command/replay callers use
 * the strict reader above and propagate denial; no public status fallback. */
export async function readBusinessAckStatusForDisplay(input: Parameters<typeof readBusinessAckStatus>[0]): Promise<BusinessAckDisplayStatus> {
  try { return await readBusinessAckStatus(input) }
  catch { return { messages: [], heldOriginalIds: [], holdReason: 'unavailable' } }
}

export function businessAckStatusPresentation(status: BusinessAckDisplayStatus) {
  const held = 'holdReason' in status || status.heldOriginalIds.length > 0
  const snapshot = 'sourceSnapshot' in status ? status.sourceSnapshot : null
  const receipt = 'sourceReceipt' in status ? status.sourceReceipt : null
  const state = held ? 'ack_status_held' : receipt ? receipt.wholeSourceRejected ? 'ack_source_rejected' :
    receipt.sourceAccepted ? 'ack_source_accepted' : receipt.finalAckReached ? 'ack_completed_with_rejections' : 'ack_partially_received' :
    status.messages.length > 0 ? 'ack_originals_qualified' : 'ack_status_unproven'
  const family = (name: AckFamily) => held ? 'ack_status_held' : snapshot ?
    (name === 'CONTRL' ? snapshot.contrl_status : name === 'APERAK' ? snapshot.aperak_status : snapshot.utilts_err_status) ?? '—' :
    status.messages.some(m => m.message_family === name) ? 'ack_originals_qualified' : 'ack_status_unproven'
  return { state, contrl: family('CONTRL'), aperak: family('APERAK'), utiltsErr: family('UTILTS_ERR') }
}
