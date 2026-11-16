import { createHash } from 'crypto'
import { supabaseService } from '@/lib/supabase/service'

function sha256(value: string | null | undefined): string | null {
  if (!value) return null
  return createHash('sha256').update(value).digest('hex')
}

function bytes(value: string | null | undefined): number | null {
  if (!value) return null
  return Buffer.byteLength(value, 'utf8')
}

function isSchemaCompatibilityError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return (
    maybe?.code === '42P01' ||
    maybe?.code === '42703' ||
    maybe?.code === 'PGRST204' ||
    maybe?.code === 'PGRST205' ||
    /does not exist|schema cache|column/i.test(maybe?.message ?? '')
  )
}

export async function recordEdielExchangeLog(input: {
  companyId?: string | null
  environmentType?: string | null
  edielMessageId?: string | null
  outboundQueueId?: string | null
  routeProfileId?: string | null
  direction: 'inbound' | 'outbound'
  exchangeKind?: string | null
  rawPayload?: string | null
  rawPayloadRef?: string | null
  parsedPayloadRef?: string | null
  senderEdielId?: string | null
  receiverEdielId?: string | null
  interchangeReference?: string | null
  messageReference?: string | null
  messageType?: string | null
  businessCode?: string | null
  ackStatus?: string | null
  certificateFingerprint?: string | null
  routeSnapshot?: Record<string, unknown> | null
  certificateSnapshot?: Record<string, unknown> | null
  senderReceiverSnapshot?: Record<string, unknown> | null
  applicationReferenceSnapshot?: Record<string, unknown> | null
  brpSnapshot?: Record<string, unknown> | null
  metadata?: Record<string, unknown>
  actorUserId?: string | null
}) {
  const now = new Date().toISOString()
  const { error } = await supabaseService
    .from('ediel_exchange_logs')
    .insert({
      company_id: input.companyId ?? null,
      environment_type: input.environmentType ?? null,
      ediel_message_id: input.edielMessageId ?? null,
      outbound_queue_id: input.outboundQueueId ?? null,
      route_profile_id: input.routeProfileId ?? null,
      direction: input.direction,
      exchange_kind: input.exchangeKind ?? 'message',
      sent_at: input.direction === 'outbound' ? now : null,
      received_at: input.direction === 'inbound' ? now : null,
      sender_ediel_id: input.senderEdielId ?? null,
      receiver_ediel_id: input.receiverEdielId ?? null,
      interchange_reference: input.interchangeReference ?? null,
      message_reference: input.messageReference ?? null,
      message_type: input.messageType ?? null,
      business_code: input.businessCode ?? null,
      ack_status: input.ackStatus ?? null,
      certificate_fingerprint: input.certificateFingerprint ?? null,
      raw_payload_ref: input.rawPayloadRef ?? null,
      parsed_payload_ref: input.parsedPayloadRef ?? null,
      payload_ref: input.rawPayloadRef ?? input.parsedPayloadRef ?? null,
      payload_hash: sha256(input.rawPayload),
      payload_size_bytes: bytes(input.rawPayload),
      correlation_keys: {
        interchangeReference: input.interchangeReference ?? null,
        messageReference: input.messageReference ?? null,
        messageType: input.messageType ?? null,
        businessCode: input.businessCode ?? null,
      },
      route_snapshot: input.routeSnapshot ?? {},
      certificate_snapshot: input.certificateSnapshot ?? {},
      sender_receiver_snapshot: input.senderReceiverSnapshot ?? {},
      application_reference_snapshot: input.applicationReferenceSnapshot ?? {},
      brp_snapshot: input.brpSnapshot ?? {},
      metadata: input.metadata ?? {},
      created_by: input.actorUserId ?? null,
    })

  if (error && !isSchemaCompatibilityError(error)) throw error
}
