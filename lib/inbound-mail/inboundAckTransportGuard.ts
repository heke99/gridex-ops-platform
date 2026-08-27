import type { ParsedEdifactEnvelope } from '@/lib/inbound-mail/edielEmailParser'
import type { InboundEntityMatch } from '@/lib/inbound-mail/inboundMatcher'
import { supabaseService } from '@/lib/supabase/service'

export type AckTransportPartyIdentity = {
  id?: string | null
  outboundRequestId?: string | null
  environment?: string | null
  senderEdielId?: string | null
  senderSubAddress?: string | null
  receiverEdielId?: string | null
  receiverSubAddress?: string | null
}

export type InboundAckTransportGuardResult = {
  ok: boolean
  reason: string | null
  outboundMessageId: string | null
  outboundRequestId: string | null
  expectedInboundSenderEdielId: string | null
  expectedInboundReceiverEdielId: string | null
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function normalizeEnvironment(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized === 'test' || normalized === 'production' ? normalized : null
}

function identityFromRow(row: Record<string, unknown>): AckTransportPartyIdentity {
  return {
    id: clean(row.id),
    outboundRequestId: clean(row.outbound_request_id),
    environment: normalizeEnvironment(row.environment),
    senderEdielId: clean(row.sender_ediel_id),
    senderSubAddress: clean(row.sender_sub_address ?? row.sender_subaddress),
    receiverEdielId: clean(row.receiver_ediel_id),
    receiverSubAddress: clean(row.receiver_sub_address ?? row.receiver_subaddress),
  }
}

export function evaluateInboundAckTransportMirror(input: {
  parsed: Pick<ParsedEdifactEnvelope, 'senderEdielId' | 'senderSubAddress' | 'receiverEdielId' | 'receiverSubAddress'>
  outbound: AckTransportPartyIdentity
  environment?: string | null
}): Omit<InboundAckTransportGuardResult, 'outboundMessageId' | 'outboundRequestId'> {
  const inboundSender = upper(input.parsed.senderEdielId)
  const inboundReceiver = upper(input.parsed.receiverEdielId)
  const outboundSender = upper(input.outbound.senderEdielId)
  const outboundReceiver = upper(input.outbound.receiverEdielId)

  if (!inboundSender || !inboundReceiver) {
    return {
      ok: false,
      reason: 'ack_transport_inbound_party_missing',
      expectedInboundSenderEdielId: clean(input.outbound.receiverEdielId),
      expectedInboundReceiverEdielId: clean(input.outbound.senderEdielId),
    }
  }
  if (!outboundSender || !outboundReceiver) {
    return {
      ok: false,
      reason: 'ack_transport_outbound_party_missing',
      expectedInboundSenderEdielId: clean(input.outbound.receiverEdielId),
      expectedInboundReceiverEdielId: clean(input.outbound.senderEdielId),
    }
  }

  const inboundEnvironment = normalizeEnvironment(input.environment)
  const outboundEnvironment = normalizeEnvironment(input.outbound.environment)
  if (inboundEnvironment && outboundEnvironment && inboundEnvironment !== outboundEnvironment) {
    return {
      ok: false,
      reason: `ack_transport_environment_mismatch:${inboundEnvironment}:${outboundEnvironment}`,
      expectedInboundSenderEdielId: clean(input.outbound.receiverEdielId),
      expectedInboundReceiverEdielId: clean(input.outbound.senderEdielId),
    }
  }

  if (inboundSender !== outboundReceiver || inboundReceiver !== outboundSender) {
    return {
      ok: false,
      reason: `ack_transport_party_mismatch:${inboundSender}:${inboundReceiver}:${outboundReceiver}:${outboundSender}`,
      expectedInboundSenderEdielId: clean(input.outbound.receiverEdielId),
      expectedInboundReceiverEdielId: clean(input.outbound.senderEdielId),
    }
  }

  const expectedInboundSenderSub = upper(input.outbound.receiverSubAddress)
  const expectedInboundReceiverSub = upper(input.outbound.senderSubAddress)
  const inboundSenderSub = upper(input.parsed.senderSubAddress)
  const inboundReceiverSub = upper(input.parsed.receiverSubAddress)

  if (expectedInboundSenderSub && inboundSenderSub !== expectedInboundSenderSub) {
    return {
      ok: false,
      reason: `ack_transport_sender_subaddress_mismatch:${inboundSenderSub || 'missing'}:${expectedInboundSenderSub}`,
      expectedInboundSenderEdielId: clean(input.outbound.receiverEdielId),
      expectedInboundReceiverEdielId: clean(input.outbound.senderEdielId),
    }
  }
  if (expectedInboundReceiverSub && inboundReceiverSub !== expectedInboundReceiverSub) {
    return {
      ok: false,
      reason: `ack_transport_receiver_subaddress_mismatch:${inboundReceiverSub || 'missing'}:${expectedInboundReceiverSub}`,
      expectedInboundSenderEdielId: clean(input.outbound.receiverEdielId),
      expectedInboundReceiverEdielId: clean(input.outbound.senderEdielId),
    }
  }

  return {
    ok: true,
    reason: null,
    expectedInboundSenderEdielId: clean(input.outbound.receiverEdielId),
    expectedInboundReceiverEdielId: clean(input.outbound.senderEdielId),
  }
}

function identityKey(identity: AckTransportPartyIdentity): string {
  return [
    normalizeEnvironment(identity.environment) ?? '',
    upper(identity.senderEdielId),
    upper(identity.senderSubAddress),
    upper(identity.receiverEdielId),
    upper(identity.receiverSubAddress),
  ].join('|')
}

async function outboundMessageIdentities(input: {
  companyId: string
  outboundMatch: InboundEntityMatch
}): Promise<AckTransportPartyIdentity[]> {
  if (input.outboundMatch.status !== 'matched' || !input.outboundMatch.entityId) return []

  if (input.outboundMatch.entityType === 'ediel_message') {
    const { data, error } = await supabaseService
      .from('ediel_messages')
      .select('id,outbound_request_id,environment,sender_ediel_id,sender_sub_address,receiver_ediel_id,receiver_sub_address')
      .eq('company_id', input.companyId)
      .eq('direction', 'outbound')
      .eq('id', input.outboundMatch.entityId)
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data ? [identityFromRow(data as Record<string, unknown>)] : []
  }

  if (input.outboundMatch.entityType === 'outbound_request') {
    const { data, error } = await supabaseService
      .from('ediel_messages')
      .select('id,outbound_request_id,environment,sender_ediel_id,sender_sub_address,receiver_ediel_id,receiver_sub_address,message_sent_at,created_at')
      .eq('company_id', input.companyId)
      .eq('direction', 'outbound')
      .eq('outbound_request_id', input.outboundMatch.entityId)
      .order('message_sent_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(10)
    if (error) throw error
    return ((data ?? []) as Array<Record<string, unknown>>).map(identityFromRow)
  }

  return []
}

/**
 * A reference match alone is never sufficient for an ACK to mutate state.
 * The inbound UNB parties must be the exact reverse of the original outbound
 * UNB parties, with environment and configured subaddresses preserved.
 */
export async function verifyInboundAckTransportCorrelation(input: {
  companyId: string
  environment?: string | null
  parsed: ParsedEdifactEnvelope
  outboundMatch: InboundEntityMatch
}): Promise<InboundAckTransportGuardResult> {
  if (input.outboundMatch.status !== 'matched' || !input.outboundMatch.entityId) {
    return {
      ok: false,
      reason: 'ack_transport_reference_not_matched',
      outboundMessageId: null,
      outboundRequestId: input.outboundMatch.entityType === 'outbound_request' ? input.outboundMatch.entityId : null,
      expectedInboundSenderEdielId: null,
      expectedInboundReceiverEdielId: null,
    }
  }

  const identities = await outboundMessageIdentities({
    companyId: input.companyId,
    outboundMatch: input.outboundMatch,
  })
  if (identities.length === 0) {
    return {
      ok: false,
      reason: 'ack_transport_original_outbound_message_missing',
      outboundMessageId: null,
      outboundRequestId: input.outboundMatch.entityType === 'outbound_request' ? input.outboundMatch.entityId : null,
      expectedInboundSenderEdielId: null,
      expectedInboundReceiverEdielId: null,
    }
  }

  const distinct = new Map<string, AckTransportPartyIdentity>()
  for (const identity of identities) distinct.set(identityKey(identity), identity)
  if (distinct.size !== 1) {
    return {
      ok: false,
      reason: `ack_transport_original_party_ambiguous:${distinct.size}`,
      outboundMessageId: null,
      outboundRequestId: input.outboundMatch.entityType === 'outbound_request' ? input.outboundMatch.entityId : null,
      expectedInboundSenderEdielId: null,
      expectedInboundReceiverEdielId: null,
    }
  }

  const outbound = [...distinct.values()][0]
  const evaluated = evaluateInboundAckTransportMirror({
    parsed: input.parsed,
    outbound,
    environment: input.environment,
  })

  return {
    ...evaluated,
    outboundMessageId: clean(outbound.id),
    outboundRequestId: clean(outbound.outboundRequestId) ?? (input.outboundMatch.entityType === 'outbound_request' ? input.outboundMatch.entityId : null),
  }
}

export function failClosedOutboundMatchForAck(input: {
  outboundMatch: InboundEntityMatch
  guard: InboundAckTransportGuardResult
}): InboundEntityMatch {
  if (input.guard.ok) return input.outboundMatch
  return {
    status: 'ambiguous',
    entityType: null,
    entityId: null,
    confidence: 0,
    reasons: [...input.outboundMatch.reasons, input.guard.reason ?? 'ack_transport_guard_failed'],
    candidates: input.outboundMatch.candidates,
  }
}
