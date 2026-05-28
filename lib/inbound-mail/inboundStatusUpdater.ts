import { supabaseService } from '@/lib/supabase/service'
import type { ParsedEdifactEnvelope } from '@/lib/inbound-mail/edielEmailParser'
import type { InboundEntityMatch } from '@/lib/inbound-mail/inboundMatcher'

export async function updateInboundEmailProcessingStatus(input: {
  inboundEmailMessageId: string
  companyId?: string | null
  status: string
  matchStatus?: string | null
  errorMessage?: string | null
  matchPayload?: Record<string, unknown>
}): Promise<void> {
  const { error } = await supabaseService
    .from('inbound_email_messages')
    .update({
      company_id: input.companyId ?? null,
      processing_status: input.status,
      match_status: input.matchStatus ?? undefined,
      error_message: input.errorMessage ?? null,
      match_payload: input.matchPayload ?? {},
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.inboundEmailMessageId)

  if (error) throw error
}

export async function createParseResult(input: {
  inboundEmailMessageId: string
  companyId?: string | null
  parsed: ParsedEdifactEnvelope
}): Promise<string> {
  const { data, error } = await supabaseService
    .from('inbound_ediel_parse_results')
    .insert({
      company_id: input.companyId ?? null,
      inbound_email_message_id: input.inboundEmailMessageId,
      message_family: input.parsed.messageFamily,
      message_code: input.parsed.messageCode,
      interchange_reference: input.parsed.interchangeReference,
      transaction_reference: input.parsed.transactionReference,
      sender_ediel_id: input.parsed.senderEdielId,
      sender_sub_address: input.parsed.senderSubAddress,
      receiver_ediel_id: input.parsed.receiverEdielId,
      receiver_sub_address: input.parsed.receiverSubAddress,
      application_reference: input.parsed.applicationReference,
      parse_status: 'parsed',
      parsed_payload: input.parsed,
      validation_report: { status: 'parsed_by_batch_7a_engine' },
      raw_payload: input.parsed.rawPayload,
    })
    .select('id')
    .single()

  if (error) throw error
  return (data as { id: string }).id
}

export async function applySafeInboundStatusUpdate(input: {
  companyId: string
  parsed: ParsedEdifactEnvelope
  outboundMatch: InboundEntityMatch
  meteringPointMatch: InboundEntityMatch
}): Promise<void> {
  if (input.outboundMatch.status !== 'matched' || !input.outboundMatch.entityId) return

  const responsePayload = {
    inboundFamily: input.parsed.messageFamily,
    inboundCode: input.parsed.messageCode,
    interchangeReference: input.parsed.interchangeReference,
    transactionReference: input.parsed.transactionReference,
    meteringPointMatch: input.meteringPointMatch,
  }

  if (input.parsed.messageFamily === 'CONTRL') {
    await supabaseService
      .from('outbound_requests')
      .update({ status: 'acknowledged', response_payload: responsePayload, acknowledged_at: new Date().toISOString() })
      .eq('id', input.outboundMatch.entityId)
      .eq('company_id', input.companyId)
    return
  }

  if (input.parsed.messageFamily === 'APERAK') {
    const isNegative = input.parsed.messageCode === '313'
    await supabaseService
      .from('outbound_requests')
      .update({
        status: isNegative ? 'failed' : 'acknowledged',
        response_payload: responsePayload,
        failure_reason: isNegative ? 'Negativ APERAK mottagen via inbound mail engine.' : null,
        acknowledged_at: isNegative ? null : new Date().toISOString(),
        failed_at: isNegative ? new Date().toISOString() : null,
      })
      .eq('id', input.outboundMatch.entityId)
      .eq('company_id', input.companyId)
    return
  }

  if (input.parsed.messageFamily === 'UTILTS_ERR') {
    await supabaseService
      .from('outbound_requests')
      .update({
        status: 'failed',
        response_payload: responsePayload,
        failure_reason: 'UTILTS_ERR mottagen via inbound mail engine.',
        failed_at: new Date().toISOString(),
      })
      .eq('id', input.outboundMatch.entityId)
      .eq('company_id', input.companyId)
  }
}
