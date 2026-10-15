import { assertEdielTenantActor } from '@/lib/ediel/services/authorization'
import { processInboundAckMessage } from '@/lib/ediel/flows/inboundAckProcessing'
import { InboundReceptionHeldError, recordInboundReception, requireFirstReception, type InboundReception } from '@/lib/ediel/inbound/receptions'
import type { EdielMessageRow } from '@/lib/ediel/types'
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
      syntax_check_status: negative ? 'rejected' : 'accepted',
      ack_outcome: negative ? 'negative' : 'positive',
      failed_at: negative ? nowIso() : null,
      acknowledged_at: negative ? null : nowIso(),
      failure_reason: negative ? 'Negativ CONTRL (UCI/0083=4) mottagen via canonical inbound engine.' : null,
    }
  }

  return {
    aperak_status: negative ? 'rejected' : 'accepted',
    functional_check_status: negative ? 'rejected' : 'accepted',
    ack_outcome: negative ? 'negative' : 'positive',
    failed_at: negative ? nowIso() : null,
    acknowledged_at: negative ? null : nowIso(),
    failure_reason: negative ? classification.profile === 'PRODAT_16_B'
      ? `Negativ PRODAT-APERAK (BGM ${parsed.messageFunctionCode}) mottagen via canonical inbound engine.`
      : 'Negativ UTILTS-APERAK (BGM 313) mottagen via canonical inbound engine.' : null,
  }
}

type AckSourceIdentity = {
  companyId: string
  environment?: string | null
  inboundEmailMessageId: string
  parsed: ParsedEdifactEnvelope
}

function assertOwnInboundAckIdentity(row: Record<string, unknown>, input: AckSourceIdentity, ownMail: boolean): void {
  // A different canonical mail is still submitted to the reception gate so
  // protocol-duplicate/identity-conflict response obligations remain intact.
  if (row.company_id !== input.companyId || row.environment !== input.environment
    || row.direction !== 'inbound' || row.message_standard !== 'edifact'
    || typeof row.inbound_email_message_id !== 'string' || !row.inbound_email_message_id) {
    throw new Error('ack_current_mail_source_invalid')
  }
  if (ownMail && (row.inbound_email_message_id !== input.inboundEmailMessageId
    || row.message_family !== input.parsed.messageFamily || row.message_code !== input.parsed.messageCode
    || row.raw_payload !== input.parsed.rawPayload
    || (row.receiver_ediel_id ?? null) !== (input.parsed.receiverEdielId ?? null)
    || (row.application_reference ?? null) !== (input.parsed.applicationReference ?? null))) {
    throw new Error('ack_current_mail_source_invalid')
  }
}

async function findExistingInboundAck(input: {
  companyId: string
  inboundEmailMessageId: string
  parsed: ParsedEdifactEnvelope
  environment?: string | null
  protectedNegative?: boolean
}): Promise<string | null> {
  const byEmail = await supabaseService
    .from('ediel_messages')
    .select(input.protectedNegative ? '*' : 'id')
    .eq('company_id', input.companyId)
    .eq('direction', 'inbound')
    .eq('inbound_email_message_id', input.inboundEmailMessageId)
    .limit(1)
    .maybeSingle()
  if (byEmail.error && input.protectedNegative) throw byEmail.error
  if (!byEmail.error && (byEmail.data as { id?: string } | null)?.id) {
    if (input.protectedNegative) assertOwnInboundAckIdentity(byEmail.data as Record<string,unknown>, input, true)
    return (byEmail.data as { id: string }).id
  }

  if (!input.parsed.interchangeReference || !input.parsed.senderEdielId || !input.parsed.receiverEdielId) return null
  const byInterchange = await supabaseService
    .from('ediel_messages')
    .select(input.protectedNegative ? '*' : 'id')
    .eq('company_id', input.companyId)
    .eq('direction', 'inbound')
    .eq('sender_ediel_id', input.parsed.senderEdielId)
    .eq('receiver_ediel_id', input.parsed.receiverEdielId)
    .eq('interchange_reference', input.parsed.interchangeReference)
    .limit(1)
    .maybeSingle()
  if (byInterchange.error) { if (input.protectedNegative) throw byInterchange.error; return null }
  if (input.protectedNegative && byInterchange.data) {
    const row = byInterchange.data as Record<string,unknown>
    assertOwnInboundAckIdentity(row, input, row.inbound_email_message_id === input.inboundEmailMessageId)
  }
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
  protectedNegative?: boolean
  originalReceivedAt?: string
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
    message_received_at: input.protectedNegative ? input.originalReceivedAt : nowIso(),
    parsed_at: nowIso(),
    failure_reason: invalid ? classification.reason : undefined,
    ...ackColumns(input.parsed),
  }

  const existingId = await findExistingInboundAck({
    companyId: input.companyId,
    inboundEmailMessageId: input.inboundEmailMessageId,
    parsed: input.parsed,
    environment: input.environment,
    protectedNegative: input.protectedNegative,
  })
  // Same genuine mail retry must not overwrite the admitted ACK/original
  // context or duplicate diagnostic events before protected reconciliation.
  if (existingId && input.protectedNegative) return existingId
  const result = existingId
    ? await supabaseService.from('ediel_messages').update({ ...insertPayload, updated_at: nowIso() }).eq('id', existingId).select('id').maybeSingle()
    : await supabaseService.from('ediel_messages').insert(insertPayload).select('id').maybeSingle()

  if (result.error) {
    console.warn('[inbound-mail] Kunde inte persist canonical inbound ACK', result.error)
    return existingId
  }

  const id = (result.data as { id?: string } | null)?.id ?? existingId
  if (id && !input.protectedNegative) {
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

export const OUTBOUND_BUSINESS_RESPONSE_STATUSES = '("confirmed","business_response_received")'

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
    const request = supabaseService.from('outbound_requests').update({
      status: classification.family === 'CONTRL'
        ? negative ? 'syntax_rejected' : 'syntax_accepted'
        : negative ? 'application_rejected' : 'application_accepted',
      response_payload: { canonicalAck: classification, rawPayload: input.parsed.rawPayload },
      failure_reason: negative ? `${ackLabel(input.parsed)} avvisade meddelandet.` : null,
      acknowledged_at: negative ? null : nowIso(),
      failed_at: negative ? nowIso() : null,
      updated_at: nowIso(),
    }).eq('company_id', input.companyId).eq('id', outboundRequestId)
    // A positive ACK arriving after the business response (e.g. Z04 before
    // APERAK) completes only the ACK columns; it never rolls back the request.
    await (negative ? request : request.not('status', 'in', OUTBOUND_BUSINESS_RESPONSE_STATUSES))
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
}): Promise<{ status: 'processed' | 'manual_review'; matchStatus: string; inboundEdielMessageId: string | null; reception?: InboundReception }> {
  const classification = classifyCanonicalInboundAck(input.parsed)
  if (classification.outcome === 'not_ack') throw new Error('canonical_inbound_ack_handler_received_non_ack')

  const outbound = candidate(input.outboundMatch)
  const protectedNegative = classification.outcome === 'negative'
    && input.outboundMatch.status === 'matched'
    && ((input.outboundMatch.entityType === 'outbound_request' && outbound.source_type === 'supplier_switch_request')
      || (input.outboundMatch.entityType === 'ediel_message' && typeof outbound.switch_request_id === 'string'))
  if (protectedNegative && (!input.actorUserId || !input.parseResultId
    || !['test', 'production'].includes(input.environment ?? ''))) throw new Error('ack_current_mail_scope_required')
  let originalReceivedAt: string | undefined
  if (protectedNegative) {
    await assertEdielTenantActor({companyId: input.companyId, actorUserId: input.actorUserId!, permission: 'communication.write'})
    const {data: mail, error} = await supabaseService.from('inbound_email_messages')
      .select('id,company_id,environment,received_at').eq('id', input.inboundEmailMessageId)
      .eq('company_id', input.companyId).eq('environment', input.environment!).maybeSingle()
    if (error) throw error
    if (!mail || mail.id !== input.inboundEmailMessageId || mail.company_id !== input.companyId
      || mail.environment !== input.environment || typeof mail.received_at !== 'string'
      || !Number.isFinite(Date.parse(mail.received_at))) throw new Error('ack_current_mail_original_required')
    originalReceivedAt = mail.received_at
  }
  const inboundEdielMessageId = await persistInboundAck({...input, protectedNegative, originalReceivedAt})
  if (protectedNegative) {
    if (!inboundEdielMessageId) throw new Error('ack_current_mail_source_required')
    const reception = await recordInboundReception({companyId: input.companyId,
      messageId: inboundEdielMessageId, inboundEmailMessageId: input.inboundEmailMessageId,
      parseResultId: input.parseResultId!, actorUserId: input.actorUserId!})
    try { requireFirstReception(reception) }
    catch (error) {
      if (!(error instanceof InboundReceptionHeldError)) throw error
      return {status: 'manual_review', matchStatus: error.reception.reason ?? 'ack_duplicate_held',
        inboundEdielMessageId, reception: error.reception}
    }
    const {data, error} = await supabaseService.from('ediel_messages').select('*')
      .eq('company_id', input.companyId).eq('environment', input.environment!)
      .eq('direction', 'inbound').eq('id', inboundEdielMessageId).maybeSingle()
    if (error) throw error
    const message = data as EdielMessageRow | null
    if (!message || message.id !== inboundEdielMessageId || message.company_id !== input.companyId
      || message.environment !== input.environment || message.direction !== 'inbound'
      || message.raw_payload !== input.parsed.rawPayload) throw new Error('ack_current_mail_source_invalid')
    assertOwnInboundAckIdentity(message as unknown as Record<string, unknown>, input, true)
    // Existing protected LOCAL source-apply/readback lives in the flow. This
    // narrow option skips ordinary business/event/diagnostic/send work.
    const result = await processInboundAckMessage({actorUserId: input.actorUserId!, message,
      projectionOnly: true, negativeStatus: 'rejected'})
    return {status: 'manual_review', matchStatus: result.summaryUnavailable ? 'ack_legacy_diagnostic'
      : classification.family === 'CONTRL' ? 'negative_contrl' : 'negative_aperak', inboundEdielMessageId}
  }
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
        : classification.profile === 'PRODAT_16_B'
          ? `BGM ${input.parsed.messageFunctionCode}. Korrigera PRODAT-felet innan eventuell omsändning.`
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
