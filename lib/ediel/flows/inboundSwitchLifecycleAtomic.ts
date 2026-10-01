import { supabaseService } from '@/lib/supabase/service'
import type { InboundBusinessStateResult } from './inboundBusinessStateMachineLegacy'
import type { EdielMessageRow } from '@/lib/ediel/types'

export type InboundSwitchLifecycleReceipt = InboundBusinessStateResult & {
  switchRequestId: string
  supplyPeriodId: string | null
  caseId: string | null
  replayed: boolean
  ackOutcome?: 'positive' | 'negative'
  finalAckReached?: boolean
  sourceMessageId?: string
  outboundRequestId?: string | null
}

/** Only the persisted source ID crosses this boundary. The database derives
 * outcome, graph and required intent from sealed original wire/current rows. */
export async function applyInboundSwitchLifecycleAtomically(input: {
  sourceMessageId: string
  actorUserId: string
}): Promise<InboundSwitchLifecycleReceipt> {
  const { data, error } = await supabaseService.rpc('gridex_apply_inbound_switch_lifecycle_v1', {
    p_source_message_id: input.sourceMessageId,
    p_actor_user_id: input.actorUserId,
  })
  if (error) throw error
  const result = Array.isArray(data) ? data[0] : data
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('inbound_switch_atomic_receipt_missing')
  const row = result as Record<string, unknown>
  if (!['supplier_switch_accepted', 'business_rejection', 'technical_rejection', 'ignored'].includes(String(row.outcome))
    || typeof row.switchRequestId !== 'string' || typeof row.tenantMessage !== 'string'
    || typeof row.reviewRequired !== 'boolean' || !Array.isArray(row.updated)
    || !row.metadata || typeof row.metadata !== 'object' || typeof row.replayed !== 'boolean') {
    throw new Error('inbound_switch_atomic_receipt_invalid')
  }
  return row as InboundSwitchLifecycleReceipt
}

/** Inspect the stored receive/source pair, never a caller's correlation hints.
 * Unmatched and customer-information ACKs keep their existing review owner. */
export async function getStoredInboundSwitchAckSource(sourceMessageId: string): Promise<{
  ack: EdielMessageRow; origin: EdielMessageRow
} | null> {
  const receive = await supabaseService.from('ediel_messages').select('*').eq('id', sourceMessageId).maybeSingle()
  if (receive.error) throw receive.error
  const ack = receive.data as EdielMessageRow | null
  if (!ack || ack.direction !== 'inbound' || !['CONTRL', 'APERAK'].includes(ack.message_family)
    || !ack.company_id || !ack.related_message_id) return null
  const source = await supabaseService.from('ediel_messages').select('*')
    .eq('id', ack.related_message_id).eq('company_id', ack.company_id).maybeSingle()
  if (source.error) throw source.error
  const origin = source.data as EdielMessageRow | null
  if (!origin || origin.direction !== 'outbound' || origin.message_family !== 'PRODAT'
    || origin.message_code !== 'Z03' || !origin.switch_request_id) return null
  return { ack, origin }
}

/** Rejecting a customer-information ACK is a separate review corridor. Read
 * the persisted correlation because the in-memory receive object can precede
 * the actual link writer. The atomic owner rechecks this row under its lock. */
export async function hasStoredInboundSupplierSwitchSource(sourceMessageId: string): Promise<boolean> {
  const { data, error } = await supabaseService.from('ediel_messages')
    .select('id,switch_request_id').eq('id', sourceMessageId).single()
  if (error) throw error
  return typeof data?.switch_request_id === 'string' && Boolean(data.switch_request_id.trim())
}
