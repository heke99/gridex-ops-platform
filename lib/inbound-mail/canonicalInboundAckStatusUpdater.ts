import { classifyCanonicalInboundAck } from '@/lib/ediel/ack/inboundAckOutcome'
import type { ParsedEdifactEnvelope } from '@/lib/inbound-mail/edielEmailParser'
import type { InboundEntityMatch } from '@/lib/inbound-mail/inboundMatcher'
import { createInboundMailTask } from '@/lib/inbound-mail/inboundTaskFactory'
import type { InboundTenantResolution } from '@/lib/ediel/tenant/resolveInboundTenant'
import { tenantResolutionForStorage } from '@/lib/ediel/tenant/resolveInboundTenant'
import { supabaseService } from '@/lib/supabase/service'

function nowIso(): string {
  return new Date().toISOString()
}

function candidate(match: InboundEntityMatch): Record<string, unknown> {
  return match.candidates?.[0] ?? {}
}

function ackLabel(parsed: ParsedEdifactEnvelope): string {
  return parsed.messageFamily === 'CONTRL' ? 'CONTRL' : 'APERAK'
}

function ackColumns(parsed: ParsedEdifactEnvelope): Record<string, unknown> {
  const classification = classifyCanonicalInboundAck(parsed)
  if (classification.outcome !== 'positive' && classification.outcome !== 'negative') return {}
  const negative = classification.outcome === 'negative'

  if (classification.family === 'CONTRL') {
    return {
      contrl_status: negative ? 'rejected' : 'accepted',
      syntax_status: negative ? 'rejected' : 'accepted',
      syntax_check_status: negative ? 'rejected' : 'accepted',
      ack_outcome: negative ? 'negative' : 'positive',
      failed_at: negative ? nowIso() : null,
      acknowledged_at: negative ? null : nowIso(),
      failure_reason: negative ? 'Negativ CONTRL (UCI/0083=4) mottagen via canonical inbound engine.' : null,
    }
  }

  return {
    aperak_status: negative ? 'rejected' : 'accepted',
    application_status: negative ? 'rejected' : 'accepted',
    functional_check_status: negative ? 'rejected' : 'accepted',
    ack_outcome: negative ? 'negative' : 'positive',
    failed_at: negative ? nowIso() : null,
    acknowledged_at: negative ? null : nowIso(),
    failure_reason: negative ? 'Negativ APERAK (BGM 313) mottagen via canonical inbound engine.' : null,
  }
}

async function findExistingInboundAck(input: {
  companyId: string
  inboundEmailMessageId: string
  parsed: ParsedEdifactEnvelope
}): Promise<string | null> {
  const byEmail = await supabaseService
    .from('ediel_messages')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('direction', 'inbound')
    .eq('inbound_email_message_id', input.inboundEmailMessageId)
    .limit(1)
    .maybeSingle()
  if (!byEmail.error && (byEmail.data as { id?: string } | null)?.id) {
    return (byEmail.data as { id: string }).id
  }

  if (!input.parsed.interchangeReference || !input.parsed.senderEdielId || !input.parsed.receiverEdielId) return null
  const byInterchange = await supabaseService
    .from('ediel_messages')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('direction', 'inbound')
    .eq('sender_ediel_id', input.parsed.senderEdielId)
    .eq('receiver_ediel_id', input.parsed.receiverEdielId)
    .eq('interchange_reference', input.parsed.interchangeReference)
    .limit(1)
    .maybeSingle()
  if (byInterchange.error) return null
  return (byInterchange.data as { id?: string } | null)?.id ?? null
}

async function persistInboundAck(input: {
  companyId: string
  environment?: string | null
  inboundEmailMessageId: string
  parseResultId?: string | null
  parsed: ParsedEdifactEnvelope
  outboundMatch: InboundEntityMatch
  meteringPointMatch: InboundEntityMatch
  tenantResolution?: InboundTenantResolution | null
}): Promise<string | null> {
  const classification = classifyCanonicalInboundAck(input.parsed)
  const matched = input.outboundMatch.status === 'matched'
  const invalid = classification.outcome === 'invalid'
  const negative = classification.outcome === 'negative'
  const outbound = candidate(input.outboundMatch)
  const tenantResolution = input.tenantResolution ? tenantResolutionForStorage(input.tenantResolution) : null
  const payload = {
    inboundFamily: input.parsed.messageFamily,
    inboundCode: input.parsed.messageCode,
    canonicalAck: classification,
    references: input.parsed.references,
    applicationReference: input.parsed.applicationReference,
    errorCodes: input.parsed.errorCodes,
    freeText: input.parsed.freeText,
    outboundMatch: input.outboundMatch,
    meteringPointMatch: input.meteringPointMatch,
    tenantResolution,
  }

  const insertPayload = {
    company_id: input.companyId,
    environment: input.environment === 'test' || input.environment === 'production' ? input.environment : null,
    direction: 'inbound',
    message_standard: 'edifact',
    message_family: input.parsed.messageFamily,
    message_code: input.parsed.messageCode,
    status: negative ? 'failed' : 'received',
    processing_status: invalid || !matched || negative ? 'manual_review' : 'received',
    sender_ediel_id: input.parsed.senderEdielId,
    sender_sub_address: input.parsed.senderSubAddress,
    receiver_ediel_id: input.parsed.receiverEdielId,
    receiver_sub_address: input.parsed.receiverSubAddress,
    parsed_unb_sender_ediel_id: input.parsed.senderEdielId,
    parsed_unb_receiver_ediel_id: input.parsed.receiverEdielId,
    resolved_company_id: input.companyId,
    interchange_reference: input.parsed.interchangeReference,
    transaction_reference: input.parsed.transactionReference,
    application_reference: input.parsed.applicationReference,
    external_reference: input.parsed.bgmReference,
    original_message_id: input.parsed.bgmReference,
    raw_payload: input.parsed.rawPayload,
    parsed_payload: { ...input.parsed, canonicalAck: classification, tenantResolution },
    validation_report: {
      status: invalid ? 'invalid_ack_manual_review' : 'canonical_ack_classified',
      canonicalAck: classification,
      tenantResolution,
    },
    tenant_resolution_status: 'tenant_resolved',
    business_match_status: matched ? 'matched' : 'business_unresolved',
    inbound_email_message_id: input.inboundEmailMessageId,
    related_message_id: input.outboundMatch.entityType === 'ediel_message' ? input.outboundMatch.entityId : null,
    outbound_request_id: input.outboundMatch.entityType === 'outbound_request' ? input.outboundMatch.entityId : typeof outbound.outbound_request_id === 'string' ? outbound.outbound_request_id : null,
    metering_point_id: input.meteringPointMatch.status === 'matched' ? input.meteringPointMatch.entityId : null,
    customer_id: typeof outbound.customer_id === 'string' ? outbound.customer_id : null,
    site_id: typeof outbound.site_id === 'string' ? outbound.site_id : null,
    grid_owner_id: typeof outbound.grid_owner_id === 'string' ? outbound.grid_owner_id : null,
    message_received_at: nowIso(),
    parsed_at: nowIso(),
    failure_reason: invalid ? classification.reason : undefined,
    ...ackColumns(input.parsed),
  }

  const existingId = await findExistingInboundAck({
    companyId: input.companyId,
    inboundEmailMessageId: input.inboundEmailMessageId,
    parsed: input.parsed,
  })
  const result = existingId
    ? await supabaseService.from('ediel_messages').update({ ...insertPayload, updated_at: nowIso() }).eq('id', existingId).select('id').maybeSingle()
    : await supabaseService.from('ediel_messages').insert(insertPayload).select('id').maybeSingle()

  if (result.error) {
    console.warn('[inbound-mail] Kunde inte persist canonical inbound ACK', result.error)
    return existingId
  }

  const id = (result.data as { id?: string } | null)?.id ?? existingId
  if (id) {
    await supabaseService.from('ediel_message_events').insert({
      company_id: input.companyId,
      ediel_message_id: id,
      event_type: invalid ? 'manual_note' : 'inbound_mail_processed',
      event_status: invalid || negative ? 'warning' : 'info',
      message: invalid
        ? `Ogiltig ${ackLabel(input.parsed)} mottagen: ${classification.reason ?? 'okänd orsak'}.`
        : `${negative ? 'Negativ' : 'Positiv'} ${ackLabel(input.parsed)} mottagen.`,
      payload,
    })
  }
  return id
}

async function updateOutboundAck(input: {
  companyId: string
  inboundEdielMessageId: string | null
  parsed: ParsedEdifactEnvelope
  outboundMatch: InboundEntityMatch
}): Promise<void> {
  const classification = classifyCanonicalInboundAck(input.parsed)
  if (classification.outcome !== 'positive' && classification.outcome !== 'negative') return
  if (input.outboundMatch.status !== 'matched' || !input.outboundMatch.entityId) return

  const negative = classification.outcome === 'negative'
  const columns = ackColumns(input.parsed)
  let outboundRequestId: string | null = null
  const outbound = candidate(input.outboundMatch)

  if (input.outboundMatch.entityType === 'outbound_request') {
    outboundRequestId = input.outboundMatch.entityId
    await supabaseService.from('outbound_requests').update({
      status: classification.family === 'CONTRL'
        ? negative ? 'syntax_rejected' : 'syntax_accepted'
        : negative ? 'application_rejected' : 'application_accepted',
      response_payload: { canonicalAck: classification, rawPayload: input.parsed.rawPayload },
      failure_reason: negative ? `${ackLabel(input.parsed)} avvisade meddelandet.` : null,
      acknowledged_at: negative ? null : nowIso(),
      failed_at: negative ? nowIso() : null,
      updated_at: nowIso(),
    }).eq('company_id', input.companyId).eq('id', outboundRequestId)
  } else if (input.outboundMatch.entityType === 'ediel_message') {
    outboundRequestId = typeof outbound.outbound_request_id === 'string' ? outbound.outbound_request_id : null
  }

  if (outboundRequestId) {
    await supabaseService.from('ediel_messages').update({
      ...columns,
      related_message_id: input.inboundEdielMessageId ?? undefined,
      updated_at: nowIso(),
    }).eq('company_id', input.companyId).eq('direction', 'outbound').eq('outbound_request_id', outboundRequestId)
  } else if (input.outboundMatch.entityType === 'ediel_message') {
    await supabaseService.from('ediel_messages').update({
      ...columns,
      related_message_id: input.inboundEdielMessageId ?? undefined,
      updated_at: nowIso(),
    }).eq('company_id', input.companyId).eq('direction', 'outbound').eq('id', input.outboundMatch.entityId)
  }

  if (!negative || input.outboundMatch.entityType !== 'outbound_request') return
  const sourceType = typeof outbound.source_type === 'string' ? outbound.source_type : null
  const sourceId = typeof outbound.source_id === 'string' ? outbound.source_id : null
  if (!sourceId) return

  if (sourceType === 'supplier_switch_request') {
    await supabaseService.from('supplier_switch_requests').update({
      status: 'rejected', failed_at: nowIso(), failure_reason: `${ackLabel(input.parsed)} avvisade Ediel-meddelandet.`, updated_at: nowIso(),
    }).eq('company_id', input.companyId).eq('id', sourceId)
  }
  if (sourceType === 'grid_owner_data_request') {
    await supabaseService.from('grid_owner_data_requests').update({
      status: 'failed', failed_at: nowIso(), failure_reason: `${ackLabel(input.parsed)} avvisade Ediel-meddelandet.`, updated_at: nowIso(),
    }).eq('company_id', input.companyId).eq('id', sourceId)
  }
}

export async function applyCanonicalInboundAckStatusUpdate(input: {
  companyId: string
  environment?: string | null
  parsed: ParsedEdifactEnvelope
  outboundMatch: InboundEntityMatch
  meteringPointMatch: InboundEntityMatch
  inboundEmailMessageId: string
  parseResultId?: string | null
  actorUserId?: string | null
  tenantResolution?: InboundTenantResolution | null
}): Promise<{ status: 'processed' | 'manual_review'; matchStatus: string; inboundEdielMessageId: string | null }> {
  const classification = classifyCanonicalInboundAck(input.parsed)
  if (classification.outcome === 'not_ack') throw new Error('canonical_inbound_ack_handler_received_non_ack')

  const inboundEdielMessageId = await persistInboundAck(input)
  const safelyCorrelated = input.outboundMatch.status === 'matched' && Boolean(input.outboundMatch.entityId)

  if (classification.outcome === 'invalid') {
    await createInboundMailTask({
      companyId: input.companyId,
      title: `Ogiltig ${ackLabel(input.parsed)} kräver manuell granskning`,
      description: classification.reason ?? 'ACK saknar verifierbar canonical outcome.',
      priority: 'urgent',
      taskType: 'ediel_invalid_ack',
      metadata: { inboundEmailMessageId: input.inboundEmailMessageId, parseResultId: input.parseResultId ?? null, canonicalAck: classification },
      actorUserId: input.actorUserId ?? null,
    })
    return { status: 'manual_review', matchStatus: 'invalid_ack', inboundEdielMessageId }
  }

  if (!safelyCorrelated) {
    await createInboundMailTask({
      companyId: input.companyId,
      title: `${ackLabel(input.parsed)} saknar säker korrelation`,
      description: 'ACK är syntaktiskt klassificerad men får inte påverka ett affärsflöde utan exakt tenant- och outbound-match.',
      priority: 'high',
      taskType: 'ediel_unmatched_ack',
      metadata: { inboundEmailMessageId: input.inboundEmailMessageId, parseResultId: input.parseResultId ?? null, canonicalAck: classification, outboundMatch: input.outboundMatch },
      actorUserId: input.actorUserId ?? null,
    })
    return { status: 'manual_review', matchStatus: 'ack_unmatched', inboundEdielMessageId }
  }

  await updateOutboundAck({
    companyId: input.companyId,
    inboundEdielMessageId,
    parsed: input.parsed,
    outboundMatch: input.outboundMatch,
  })

  if (classification.outcome === 'negative') {
    await createInboundMailTask({
      companyId: input.companyId,
      title: `Negativ ${ackLabel(input.parsed)} mottagen`,
      description: classification.family === 'CONTRL'
        ? 'UCI/0083=4. Stoppa flödet och korrigera syntax/tekniskt fel innan omsändning.'
        : 'BGM 313. Korrigera applikationsfelet innan eventuell omsändning.',
      priority: 'urgent',
      taskType: classification.family === 'CONTRL' ? 'ediel_negative_contrl' : 'ediel_negative_aperak',
      metadata: { inboundEmailMessageId: input.inboundEmailMessageId, parseResultId: input.parseResultId ?? null, canonicalAck: classification },
      actorUserId: input.actorUserId ?? null,
    })
    return { status: 'manual_review', matchStatus: classification.family === 'CONTRL' ? 'negative_contrl' : 'negative_aperak', inboundEdielMessageId }
  }

  return { status: 'processed', matchStatus: 'matched', inboundEdielMessageId }
}
