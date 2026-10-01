import { supabaseService } from '@/lib/supabase/service'

export type InboundReception = {
  companyId: string
  sourceMessageId: string
  inboundEmailMessageId: string
  parseResultId: string
  receptionId: string
  classification: 'first_reception' | 'protocol_duplicate' | 'identity_conflict'
  isReplay: boolean
  receivedAt: string
  canonicalPayloadHash: string
  receivedPayloadHash: string
  responseRequestId: string | null
  status: 'observed' | 'held'
  reason: string | null
  businessEffectAuthorized: false
}

type ReceptionScope = { companyId: string; messageId: string; inboundEmailMessageId: string }

function reception(value: unknown, input: ReceptionScope): InboundReception {
  if (!value || typeof value !== 'object') throw new Error('ediel_reception_result_invalid')
  const r = value as InboundReception
  const first = r.classification === 'first_reception'
  if (
    r.companyId !== input.companyId || r.sourceMessageId !== input.messageId || r.inboundEmailMessageId !== input.inboundEmailMessageId ||
    !['first_reception', 'protocol_duplicate', 'identity_conflict'].includes(r.classification) ||
    typeof r.receptionId !== 'string' || typeof r.parseResultId !== 'string' || typeof r.isReplay !== 'boolean' ||
    typeof r.receivedAt !== 'string' || !Number.isFinite(Date.parse(r.receivedAt)) ||
    !/^[a-f0-9]{64}$/.test(r.canonicalPayloadHash) || !/^[a-f0-9]{64}$/.test(r.receivedPayloadHash) ||
    r.businessEffectAuthorized !== false ||
    (first ? r.status !== 'observed' || r.responseRequestId !== null || r.reason !== null :
      r.status !== 'held' || typeof r.responseRequestId !== 'string' || !r.responseRequestId || typeof r.reason !== 'string' || !r.reason) ||
    (r.classification === 'identity_conflict' ? r.receivedPayloadHash === r.canonicalPayloadHash : r.receivedPayloadHash !== r.canonicalPayloadHash)
  ) throw new Error('ediel_reception_result_invalid')
  return r
}

export async function recordInboundReception(input: ReceptionScope & { actorUserId: string; parseResultId: string }): Promise<InboundReception> {
  const { data, error } = await supabaseService.rpc('ediel_record_inbound_reception_v1', {
    p_company_id: input.companyId,
    p_message_id: input.messageId,
    p_actor_user_id: input.actorUserId,
    p_inbound_email_message_id: input.inboundEmailMessageId,
    p_parse_result_id: input.parseResultId,
  })
  if (error) throw error
  return reception(data, input)
}

export async function readInboundReceptionRequest(input: ReceptionScope & { actorUserId: string }): Promise<InboundReception | null> {
  const { data, error } = await supabaseService.rpc('ediel_inbound_reception_request_v1', {
    p_company_id: input.companyId,
    p_message_id: input.messageId,
    p_actor_user_id: input.actorUserId,
    p_inbound_email_message_id: input.inboundEmailMessageId,
  })
  if (error) throw error
  return data === null ? null : reception(data, input)
}

/** A newly received duplicate never inherits permission to reset an old ACK. */
export class InboundReceptionHeldError extends Error {
  constructor(readonly reception: InboundReception) {
    super(reception.reason ?? 'ediel_duplicate_response_source_required')
    this.name = 'InboundReceptionHeldError'
  }
}

export function requireFirstReception(r: InboundReception): void {
  if (r.status === 'held' || r.classification !== 'first_reception') throw new InboundReceptionHeldError(r)
}
