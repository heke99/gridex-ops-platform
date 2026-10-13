import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'

type Request = Record<string, unknown>
export type InboundAckSwitchTransitionInput = {
  companyId: string
  environment: 'test' | 'production'
  actorUserId: string
  ackMessageId: string
  ackPayloadHash: string
  sourceMessageId: string
  sourcePayloadHash: string
  switchRequestId: string
  negativeStatus: 'failed' | 'rejected'
  /** Complete discovered row. This can inhibit an effect; it grants no authority. */
  expectedRequest: Request
}
export type InboundAckSwitchTransition = {
  disposition: 'mutated_failure' | 'preserved_confirmation' | 'already_terminal' | 'stale_preimage' | 'not_applicable'
  changed: boolean
  request: Request | null
}
const record = (value: unknown): value is Request => !!value && typeof value === 'object' && !Array.isArray(value)
const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

/** The database re-reads committed authority and locks/rechecks the recipient.
 * A transport error has an unknown commit outcome. Retry this same operation;
 * never perform a direct patch or a compensating write here. */
export async function applyInboundAckSwitchTransition(input: InboundAckSwitchTransitionInput): Promise<InboundAckSwitchTransition> {
  if (!record(input) || ![input.companyId, input.actorUserId, input.ackMessageId, input.sourceMessageId, input.switchRequestId].every(uuid)
    || !['test', 'production'].includes(input.environment) || !['failed', 'rejected'].includes(input.negativeStatus)
    || ![input.ackPayloadHash, input.sourcePayloadHash].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))
    || !record(input.expectedRequest) || input.expectedRequest.id !== input.switchRequestId || input.expectedRequest.company_id !== input.companyId) {
    throw new Error('ack_switch_transition_scope_required')
  }
  // Serialize nested state before the await; pin primitives independently of
  // mutable caller objects. The exact text hash binds the complete CAS input.
  const expectedRequestText = JSON.stringify(input.expectedRequest)
  const pins = Object.freeze({ companyId: input.companyId, environment: input.environment, actorUserId: input.actorUserId,
    ackMessageId: input.ackMessageId, ackPayloadHash: input.ackPayloadHash, sourceMessageId: input.sourceMessageId,
    sourcePayloadHash: input.sourcePayloadHash, switchRequestId: input.switchRequestId, negativeStatus: input.negativeStatus,
    expectedRequestHash: digest(expectedRequestText) })
  const { data, error } = await supabaseService.rpc('gridex_apply_inbound_ack_switch_transition_v1', {
    p_company_id: pins.companyId, p_environment: pins.environment, p_actor_user_id: pins.actorUserId,
    p_ack_message_id: pins.ackMessageId, p_ack_payload_hash: pins.ackPayloadHash, p_source_message_id: pins.sourceMessageId,
    p_source_payload_hash: pins.sourcePayloadHash, p_switch_request_id: pins.switchRequestId,
    p_negative_status: pins.negativeStatus, p_expected_request: expectedRequestText,
  })
  if (error) throw error
  const invalid = () => { throw new Error('ack_switch_transition_invalid') }
  if (!record(data) || data.version !== 1 || Object.entries(pins).some(([key, value]) => data[key] !== value)
    || typeof data.changed !== 'boolean' || !['mutated_failure', 'preserved_confirmation', 'already_terminal', 'stale_preimage', 'not_applicable'].includes(String(data.disposition))) return invalid()
  const changed = data.disposition === 'mutated_failure', current = data.request
  if (data.changed !== changed || !(current === null || record(current))) return invalid()
  if (current === null) {
    if (data.disposition !== 'not_applicable') return invalid()
  } else {
    if (current.id !== pins.switchRequestId || current.company_id !== pins.companyId || typeof current.status !== 'string') return invalid()
    if (changed && (current.status !== pins.negativeStatus || current.outbound_z03_message_id !== pins.sourceMessageId || current.updated_by !== pins.actorUserId)) return invalid()
    if (data.disposition === 'preserved_confirmation' && (!['accepted', 'completed'].includes(current.status)
      || current.outbound_z03_message_id !== pins.sourceMessageId || !uuid(current.inbound_z04_message_id))) return invalid()
    if (data.disposition === 'already_terminal' && !['failed', 'rejected', 'cancelled', 'cancelled_before_start'].includes(current.status)) return invalid()
  }
  return Object.freeze({ disposition: data.disposition, changed: data.changed, request: current === null ? null : Object.freeze(current) }) as InboundAckSwitchTransition
}
