import { supabaseService } from '@/lib/supabase/service'
import type { ParsedEdifactEnvelope } from '@/lib/inbound-mail/edielEmailParser'
import type { InboundEntityMatch } from '@/lib/inbound-mail/inboundMatcher'
import { createInboundMailTask } from '@/lib/inbound-mail/inboundTaskFactory'

function nowIso(): string {
  return new Date().toISOString()
}

function isNegativeContrL(parsed: ParsedEdifactEnvelope): boolean {
  return parsed.messageFamily === 'CONTRL' && parsed.segments.some((segment) => /(^|\+)UCI\+[^']*\+7(\+|$)/.test(segment))
}

function isNegativeAperak(parsed: ParsedEdifactEnvelope): boolean {
  if (parsed.messageFamily !== 'APERAK') return false
  if (parsed.messageCode === '313') return true
  return parsed.segments.some((segment) => segment.startsWith('ERC+') || segment.includes('+AAO+'))
}

function isPositiveAperak(parsed: ParsedEdifactEnvelope): boolean {
  return parsed.messageFamily === 'APERAK' && !isNegativeAperak(parsed)
}

function eventMessageForParsed(parsed: ParsedEdifactEnvelope): string {
  if (parsed.messageFamily === 'CONTRL') return isNegativeContrL(parsed) ? 'Negativ CONTRL mottagen.' : 'Positiv CONTRL mottagen.'
  if (parsed.messageFamily === 'APERAK') return isNegativeAperak(parsed) ? 'Negativ APERAK mottagen.' : 'Positiv APERAK mottagen.'
  if (parsed.messageFamily === 'UTILTS_ERR') return 'UTILTS_ERR mottagen.'
  if (parsed.messageFamily === 'PRODAT') return `PRODAT ${parsed.messageCode ?? ''} mottagen.`.trim()
  if (parsed.messageFamily === 'UTILTS') return `UTILTS ${parsed.messageCode ?? ''} mottagen.`.trim()
  return 'Inkommande Ediel-meddelande mottaget.'
}

function statusForInboundEdielMessage(parsed: ParsedEdifactEnvelope): string {
  if (isNegativeContrL(parsed) || isNegativeAperak(parsed) || parsed.messageFamily === 'UTILTS_ERR') return 'failed'
  return 'received'
}

function ackColumnsForParsed(parsed: ParsedEdifactEnvelope): Record<string, unknown> {
  if (parsed.messageFamily === 'CONTRL') {
    return {
      contrl_status: isNegativeContrL(parsed) ? 'rejected' : 'accepted',
      syntax_check_status: isNegativeContrL(parsed) ? 'rejected' : 'accepted',
      ack_outcome: isNegativeContrL(parsed) ? 'negative' : 'positive',
      failed_at: isNegativeContrL(parsed) ? nowIso() : null,
      acknowledged_at: isNegativeContrL(parsed) ? null : nowIso(),
      failure_reason: isNegativeContrL(parsed) ? 'Negativ CONTRL mottagen via inbound mail engine.' : null,
    }
  }

  if (parsed.messageFamily === 'APERAK') {
    return {
      aperak_status: isNegativeAperak(parsed) ? 'rejected' : 'accepted',
      functional_check_status: isNegativeAperak(parsed) ? 'rejected' : 'accepted',
      ack_outcome: isNegativeAperak(parsed) ? 'negative' : 'positive',
      failed_at: isNegativeAperak(parsed) ? nowIso() : null,
      acknowledged_at: isNegativeAperak(parsed) ? null : nowIso(),
      failure_reason: isNegativeAperak(parsed) ? 'Negativ APERAK mottagen via inbound mail engine.' : null,
    }
  }

  if (parsed.messageFamily === 'UTILTS_ERR') {
    return {
      utilts_err_status: 'received',
      functional_check_status: 'rejected',
      ack_outcome: 'negative',
      failed_at: nowIso(),
      failure_reason: 'UTILTS_ERR mottagen via inbound mail engine.',
    }
  }

  return {}
}

function payloadForInbound(input: {
  parsed: ParsedEdifactEnvelope
  outboundMatch?: InboundEntityMatch | null
  meteringPointMatch?: InboundEntityMatch | null
  inboundEmailMessageId?: string | null
  parseResultId?: string | null
}): Record<string, unknown> {
  return {
    inboundEmailMessageId: input.inboundEmailMessageId ?? null,
    parseResultId: input.parseResultId ?? null,
    inboundFamily: input.parsed.messageFamily,
    inboundCode: input.parsed.messageCode,
    interchangeReference: input.parsed.interchangeReference,
    transactionReference: input.parsed.transactionReference,
    bgmReference: input.parsed.bgmReference,
    references: input.parsed.references,
    parties: input.parsed.parties,
    outboundMatch: input.outboundMatch ?? null,
    meteringPointMatch: input.meteringPointMatch ?? null,
  }
}

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
      updated_at: nowIso(),
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

export async function createInboundEdielMessage(input: {
  companyId: string
  inboundEmailMessageId: string
  parseResultId?: string | null
  parsed: ParsedEdifactEnvelope
  outboundMatch?: InboundEntityMatch | null
  meteringPointMatch?: InboundEntityMatch | null
}): Promise<string | null> {
  const matchedOutboundId = input.outboundMatch?.status === 'matched' ? input.outboundMatch.entityId : null
  const matchedMeteringPointId = input.meteringPointMatch?.status === 'matched' ? input.meteringPointMatch.entityId : null
  const matchedOutbound = input.outboundMatch?.candidates?.[0] ?? {}

  const payload = payloadForInbound({
    parsed: input.parsed,
    outboundMatch: input.outboundMatch,
    meteringPointMatch: input.meteringPointMatch,
    inboundEmailMessageId: input.inboundEmailMessageId,
    parseResultId: input.parseResultId ?? null,
  })

  const insertPayload = {
    company_id: input.companyId,
    direction: 'inbound',
    message_standard: 'edifact',
    message_family: input.parsed.messageFamily,
    message_code: input.parsed.messageCode,
    status: statusForInboundEdielMessage(input.parsed),
    sender_ediel_id: input.parsed.senderEdielId,
    sender_sub_address: input.parsed.senderSubAddress,
    receiver_ediel_id: input.parsed.receiverEdielId,
    receiver_sub_address: input.parsed.receiverSubAddress,
    interchange_reference: input.parsed.interchangeReference,
    transaction_reference: input.parsed.transactionReference,
    application_reference: input.parsed.applicationReference,
    external_reference: input.parsed.bgmReference,
    original_message_id: input.parsed.bgmReference,
    raw_payload: input.parsed.rawPayload,
    parsed_payload: input.parsed,
    validation_report: { status: 'parsed_by_batch_7a_inbound_mail_engine' },
    inbound_email_message_id: input.inboundEmailMessageId,
    outbound_request_id: matchedOutboundId,
    metering_point_id: matchedMeteringPointId,
    customer_id: typeof matchedOutbound.customer_id === 'string' ? matchedOutbound.customer_id : null,
    site_id: typeof matchedOutbound.site_id === 'string' ? matchedOutbound.site_id : null,
    grid_owner_id: typeof matchedOutbound.grid_owner_id === 'string' ? matchedOutbound.grid_owner_id : null,
    message_received_at: nowIso(),
    parsed_at: nowIso(),
    ...ackColumnsForParsed(input.parsed),
  }

  let existingId: string | null = null

  if (input.parsed.interchangeReference && input.parsed.senderEdielId && input.parsed.receiverEdielId) {
    const existing = await supabaseService
      .from('ediel_messages')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('direction', 'inbound')
      .eq('sender_ediel_id', input.parsed.senderEdielId)
      .eq('receiver_ediel_id', input.parsed.receiverEdielId)
      .eq('interchange_reference', input.parsed.interchangeReference)
      .maybeSingle()

    if (existing.error) console.warn('[inbound-mail] Kunde inte kontrollera befintlig inbound ediel_message', existing.error)
    existingId = (existing.data as { id?: string } | null)?.id ?? null
  }

  const result = existingId
    ? await supabaseService
        .from('ediel_messages')
        .update({ ...insertPayload, updated_at: nowIso() })
        .eq('id', existingId)
        .select('id')
        .maybeSingle()
    : await supabaseService
        .from('ediel_messages')
        .insert(insertPayload)
        .select('id')
        .maybeSingle()

  if (result.error) {
    console.warn('[inbound-mail] Kunde inte skapa/uppdatera inbound ediel_message', result.error)
    return null
  }

  const edielMessageId = (result.data as { id?: string } | null)?.id ?? existingId

  if (edielMessageId) {
    await supabaseService.from('ediel_message_events').insert({
      company_id: input.companyId,
      ediel_message_id: edielMessageId,
      event_type: 'inbound_mail_processed',
      event_status: isNegativeContrL(input.parsed) || isNegativeAperak(input.parsed) || input.parsed.messageFamily === 'UTILTS_ERR' ? 'warning' : 'info',
      message: eventMessageForParsed(input.parsed),
      payload,
    })
  }

  return edielMessageId
}

async function updateOutboundEdielAckState(input: {
  companyId: string
  outboundRequestId: string
  parsed: ParsedEdifactEnvelope
  inboundEdielMessageId?: string | null
  responsePayload: Record<string, unknown>
}): Promise<void> {
  const ackColumns = ackColumnsForParsed(input.parsed)
  if (Object.keys(ackColumns).length === 0) return

  const { data: outboundMessages, error } = await supabaseService
    .from('ediel_messages')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('direction', 'outbound')
    .eq('outbound_request_id', input.outboundRequestId)
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) {
    console.warn('[inbound-mail] Kunde inte läsa outbound ediel_messages för ACK-update', error)
    return
  }

  const messageIds = ((outboundMessages ?? []) as Array<{ id: string }>).map((row) => row.id)
  if (messageIds.length === 0) return

  const { error: updateError } = await supabaseService
    .from('ediel_messages')
    .update({
      ...ackColumns,
      related_message_id: input.inboundEdielMessageId ?? undefined,
      updated_at: nowIso(),
    })
    .in('id', messageIds)

  if (updateError) console.warn('[inbound-mail] Kunde inte uppdatera outbound ediel_messages ACK-status', updateError)

  await supabaseService.from('ediel_message_events').insert(messageIds.map((id) => ({
    company_id: input.companyId,
    ediel_message_id: id,
    event_type: 'ack_received_via_inbound_mail',
    event_status: isNegativeContrL(input.parsed) || isNegativeAperak(input.parsed) || input.parsed.messageFamily === 'UTILTS_ERR' ? 'warning' : 'info',
    message: eventMessageForParsed(input.parsed),
    payload: input.responsePayload,
  })))
}

async function updateBusinessStatusFromInbound(input: {
  companyId: string
  parsed: ParsedEdifactEnvelope
  outboundMatch: InboundEntityMatch
  responsePayload: Record<string, unknown>
}): Promise<void> {
  const outbound = input.outboundMatch.candidates?.[0] ?? {}
  const sourceType = typeof outbound.source_type === 'string' ? outbound.source_type : null
  const sourceId = typeof outbound.source_id === 'string' ? outbound.source_id : null

  if (!sourceId) return

  if (sourceType === 'supplier_switch_request') {
    if (input.parsed.messageFamily === 'PRODAT' && input.parsed.messageCode === 'Z04') {
      await supabaseService
        .from('supplier_switch_requests')
        .update({ status: 'confirmed', completed_at: nowIso(), metadata: input.responsePayload, updated_at: nowIso() })
        .eq('id', sourceId)
        .eq('company_id', input.companyId)
    }

    if (isNegativeAperak(input.parsed) || input.parsed.messageFamily === 'UTILTS_ERR') {
      await supabaseService
        .from('supplier_switch_requests')
        .update({ status: 'rejected', failed_at: nowIso(), failure_reason: eventMessageForParsed(input.parsed), metadata: input.responsePayload, updated_at: nowIso() })
        .eq('id', sourceId)
        .eq('company_id', input.companyId)
    }
  }

  if (sourceType === 'grid_owner_data_request') {
    if (input.parsed.messageFamily === 'PRODAT' && ['Z02', 'Z14'].includes(String(input.parsed.messageCode ?? '').toUpperCase())) {
      await supabaseService
        .from('grid_owner_data_requests')
        .update({ status: 'received', response_payload: input.responsePayload, updated_at: nowIso() })
        .eq('id', sourceId)
        .eq('company_id', input.companyId)
    }

    if (input.parsed.messageFamily === 'UTILTS') {
      await supabaseService
        .from('grid_owner_data_requests')
        .update({ status: 'received', response_payload: input.responsePayload, updated_at: nowIso() })
        .eq('id', sourceId)
        .eq('company_id', input.companyId)
    }

    if (isNegativeAperak(input.parsed) || input.parsed.messageFamily === 'UTILTS_ERR') {
      await supabaseService
        .from('grid_owner_data_requests')
        .update({ status: 'failed', failure_reason: eventMessageForParsed(input.parsed), response_payload: input.responsePayload, failed_at: nowIso(), updated_at: nowIso() })
        .eq('id', sourceId)
        .eq('company_id', input.companyId)
    }
  }
}

export async function applySafeInboundStatusUpdate(input: {
  companyId: string
  parsed: ParsedEdifactEnvelope
  outboundMatch: InboundEntityMatch
  meteringPointMatch: InboundEntityMatch
  inboundEmailMessageId?: string | null
  parseResultId?: string | null
  actorUserId?: string | null
}): Promise<void> {
  if (input.outboundMatch.status !== 'matched' || !input.outboundMatch.entityId) return

  const inboundEdielMessageId = await createInboundEdielMessage({
    companyId: input.companyId,
    inboundEmailMessageId: input.inboundEmailMessageId ?? '',
    parseResultId: input.parseResultId ?? null,
    parsed: input.parsed,
    outboundMatch: input.outboundMatch,
    meteringPointMatch: input.meteringPointMatch,
  })

  const responsePayload = payloadForInbound({
    parsed: input.parsed,
    outboundMatch: input.outboundMatch,
    meteringPointMatch: input.meteringPointMatch,
    inboundEmailMessageId: input.inboundEmailMessageId ?? null,
    parseResultId: input.parseResultId ?? null,
  })

  if (input.parsed.messageFamily === 'CONTRL') {
    const isNegative = isNegativeContrL(input.parsed)
    await supabaseService
      .from('outbound_requests')
      .update({
        status: isNegative ? 'failed' : 'acknowledged',
        response_payload: responsePayload,
        failure_reason: isNegative ? 'Negativ CONTRL mottagen via inbound mail engine.' : null,
        acknowledged_at: isNegative ? null : nowIso(),
        failed_at: isNegative ? nowIso() : null,
      })
      .eq('id', input.outboundMatch.entityId)
      .eq('company_id', input.companyId)

    await updateOutboundEdielAckState({ companyId: input.companyId, outboundRequestId: input.outboundMatch.entityId, parsed: input.parsed, inboundEdielMessageId, responsePayload })

    if (isNegative) {
      await createInboundMailTask({
        companyId: input.companyId,
        title: 'Negativ CONTRL mottagen',
        description: 'Syntaxkvittensen var negativ. Stoppa flödet och kontrollera raw EDIFACT innan omsändning.',
        priority: 'urgent',
        metadata: responsePayload,
        actorUserId: input.actorUserId ?? null,
      })
    }
    return
  }

  if (input.parsed.messageFamily === 'APERAK') {
    const isNegative = isNegativeAperak(input.parsed)
    await supabaseService
      .from('outbound_requests')
      .update({
        status: isNegative ? 'failed' : 'acknowledged',
        response_payload: responsePayload,
        failure_reason: isNegative ? 'Negativ APERAK mottagen via inbound mail engine.' : null,
        acknowledged_at: isNegative ? null : nowIso(),
        failed_at: isNegative ? nowIso() : null,
      })
      .eq('id', input.outboundMatch.entityId)
      .eq('company_id', input.companyId)

    await updateOutboundEdielAckState({ companyId: input.companyId, outboundRequestId: input.outboundMatch.entityId, parsed: input.parsed, inboundEdielMessageId, responsePayload })
    await updateBusinessStatusFromInbound({ companyId: input.companyId, parsed: input.parsed, outboundMatch: input.outboundMatch, responsePayload })

    if (isNegative) {
      await createInboundMailTask({
        companyId: input.companyId,
        title: 'Negativ APERAK mottagen',
        description: 'Applikationskvittensen var negativ. Korrigera felorsak och skapa ny preflight innan eventuell omsändning.',
        priority: 'urgent',
        metadata: responsePayload,
        actorUserId: input.actorUserId ?? null,
      })
    }
    return
  }

  if (input.parsed.messageFamily === 'UTILTS_ERR') {
    await supabaseService
      .from('outbound_requests')
      .update({
        status: 'failed',
        response_payload: responsePayload,
        failure_reason: 'UTILTS_ERR mottagen via inbound mail engine.',
        failed_at: nowIso(),
      })
      .eq('id', input.outboundMatch.entityId)
      .eq('company_id', input.companyId)

    await updateOutboundEdielAckState({ companyId: input.companyId, outboundRequestId: input.outboundMatch.entityId, parsed: input.parsed, inboundEdielMessageId, responsePayload })
    await updateBusinessStatusFromInbound({ companyId: input.companyId, parsed: input.parsed, outboundMatch: input.outboundMatch, responsePayload })
    await createInboundMailTask({
      companyId: input.companyId,
      title: 'UTILTS_ERR mottagen',
      description: 'UTILTS-flödet fick funktionsfel. Kontrollera STS/reason och korrigera innan nytt flöde.',
      priority: 'urgent',
      metadata: responsePayload,
      actorUserId: input.actorUserId ?? null,
    })
    return
  }

  if (input.parsed.messageFamily === 'PRODAT' || input.parsed.messageFamily === 'UTILTS') {
    await supabaseService
      .from('outbound_requests')
      .update({ status: 'acknowledged', response_payload: responsePayload, acknowledged_at: nowIso() })
      .eq('id', input.outboundMatch.entityId)
      .eq('company_id', input.companyId)

    await updateBusinessStatusFromInbound({ companyId: input.companyId, parsed: input.parsed, outboundMatch: input.outboundMatch, responsePayload })
  }
}

export { isNegativeAperak, isNegativeContrL, isPositiveAperak }
