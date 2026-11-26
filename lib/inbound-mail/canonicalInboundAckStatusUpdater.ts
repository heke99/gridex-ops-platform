import { classifyCanonicalInboundAck } from '@/lib/ediel/ack/inboundAckOutcome'
import { validateEdifactEnvelope } from '@/lib/ediel/core/edifactValidation'
import type { ParsedEdifactEnvelope } from '@/lib/inbound-mail/edielEmailParser'
import type { InboundEntityMatch } from '@/lib/inbound-mail/inboundMatcher'
import { createInboundMailTask } from '@/lib/inbound-mail/inboundTaskFactory'
import type { InboundTenantResolution } from '@/lib/ediel/tenant/resolveInboundTenant'
import { tenantResolutionForStorage } from '@/lib/ediel/tenant/resolveInboundTenant'
import { supabaseService } from '@/lib/supabase/service'
import { commitRetainedSmimeAck, type RetainedSmimeAck } from './retainedSmimeRecovery'

function nowIso(): string {
  return new Date().toISOString()
}

function candidate(match: InboundEntityMatch): Record<string, unknown> {
  return match.candidates?.[0] ?? {}
}

function ackLabel(parsed: ParsedEdifactEnvelope): string {
  return parsed.messageFamily === 'CONTRL' ? 'CONTRL' : 'APERAK'
}

function classifyAckForPersistence(parsed: ParsedEdifactEnvelope) {
  const classification = classifyCanonicalInboundAck(parsed)
  if (classification.outcome !== 'positive' && classification.outcome !== 'negative') return classification
  if (validateEdifactEnvelope(parsed.rawPayload).issues.some((issue) => issue.code === 'unt_count_mismatch')) {
    return { ...classification, outcome: 'invalid' as const, reason: 'unt_count_mismatch' }
  }
  return classification
}

function ackColumns(parsed: ParsedEdifactEnvelope, receivedAt: string): Record<string, unknown> {
  const classification = classifyAckForPersistence(parsed)
  if (classification.outcome !== 'positive' && classification.outcome !== 'negative') return {}
  const negative = classification.outcome === 'negative'

  if (classification.family === 'CONTRL') {
    return {
      contrl_status: negative ? 'rejected' : 'accepted',
      syntax_check_status: negative ? 'rejected' : 'accepted',
      ack_outcome: negative ? 'negative' : 'positive',
      failed_at: negative ? receivedAt : null,
      acknowledged_at: negative ? null : receivedAt,
      failure_reason: negative ? 'Negativ CONTRL (UCI/0083=4) mottagen via canonical inbound engine.' : null,
    }
  }

  return {
    aperak_status: negative ? 'rejected' : 'accepted',
    functional_check_status: negative ? 'rejected' : 'accepted',
    ack_outcome: negative ? 'negative' : 'positive',
    failed_at: negative ? receivedAt : null,
    acknowledged_at: negative ? null : receivedAt,
    failure_reason: negative ? classification.profile === 'PRODAT_16_B'
      ? `Negativ PRODAT-APERAK (BGM ${parsed.messageFunctionCode}) mottagen via canonical inbound engine.`
      : 'Negativ UTILTS-APERAK (BGM 313) mottagen via canonical inbound engine.' : null,
  }
}

type ExistingInboundAck = {
  id: string
  environment: string | null
  message_family: string
  message_code: string | null
  inbound_email_message_id: string | null
  raw_payload: string | null
}

type ExistingAckDisposition =
  | { status: 'exact_replay'; id: string }
  | { status: 'identity_conflict'; id: null }

type InboundAckPersistence = { status: 'persisted'; id: string } | ExistingAckDisposition

function priorAckDisposition(
  prior: ExistingInboundAck,
  parsed: ParsedEdifactEnvelope,
  environment: string | null,
  inboundEmailMessageId: string,
): ExistingAckDisposition | null {
  if (prior.environment !== environment || prior.message_family !== parsed.messageFamily
    || prior.message_code !== parsed.messageCode || prior.raw_payload !== parsed.rawPayload) {
    return { status: 'identity_conflict', id: null }
  }
  return prior.inbound_email_message_id === inboundEmailMessageId
    ? null
    : { status: 'exact_replay', id: prior.id }
}

async function findExistingInboundAck(input: {
  companyId: string
  inboundEmailMessageId: string
  parsed: ParsedEdifactEnvelope
}): Promise<ExistingInboundAck | null> {
  const fields = 'id,environment,message_family,message_code,inbound_email_message_id,raw_payload'
  const byEmail = await supabaseService
    .from('ediel_messages')
    .select(fields)
    .eq('company_id', input.companyId)
    .eq('direction', 'inbound')
    .eq('inbound_email_message_id', input.inboundEmailMessageId)
    .eq('message_family', input.parsed.messageFamily)
    .limit(2)
    .maybeSingle()
  if (byEmail.error) throw byEmail.error
  if (byEmail.data) return byEmail.data as ExistingInboundAck

  if (!input.parsed.interchangeReference || !input.parsed.senderEdielId || !input.parsed.receiverEdielId) return null
  const byInterchange = await supabaseService
    .from('ediel_messages')
    .select(fields)
    .eq('company_id', input.companyId)
    .eq('direction', 'inbound')
    .eq('sender_ediel_id', input.parsed.senderEdielId)
    .eq('receiver_ediel_id', input.parsed.receiverEdielId)
    .eq('interchange_reference', input.parsed.interchangeReference)
    .maybeSingle()
  if (byInterchange.error) throw byInterchange.error
  return byInterchange.data as ExistingInboundAck | null
}

async function persistInboundAck(input: {
  companyId: string
  environment?: string | null
  inboundEmailMessageId: string
  parseResultId?: string | null
  receivedAt: string
  parsed: ParsedEdifactEnvelope
  outboundMatch: InboundEntityMatch
  meteringPointMatch: InboundEntityMatch
  tenantResolution?: InboundTenantResolution | null
  recovery?: RetainedSmimeAck | null
}): Promise<InboundAckPersistence> {
  const classification = classifyAckForPersistence(input.parsed)
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
    message_received_at: input.receivedAt,
    parsed_at: nowIso(),
    failure_reason: invalid ? classification.reason : undefined,
    ...ackColumns(input.parsed, input.receivedAt),
  }

  const identity = {
    companyId: input.companyId,
    inboundEmailMessageId: input.inboundEmailMessageId,
    parsed: input.parsed,
  }
  const existing = await findExistingInboundAck(identity)
  if (existing) {
    const disposition = priorAckDisposition(existing, input.parsed, insertPayload.environment, input.inboundEmailMessageId)
    if (disposition) return disposition
  }
  const result = input.recovery
    ? await commitRetainedSmimeAck(input.recovery, existing?.id ?? null, insertPayload)
    : existing
      ? await supabaseService.from('ediel_messages').update({ ...insertPayload, updated_at: nowIso() }).eq('company_id', input.companyId).eq('direction', 'inbound').eq('id', existing.id).select('id').maybeSingle()
      : await supabaseService.from('ediel_messages').insert(insertPayload).select('id').maybeSingle()

  if (!existing && result.error?.code === '23505') {
    // The native unique index may choose an owner after our initial lookup.
    // Re-read only the same physical or interchange identity and never rewrite it.
    const winner = await findExistingInboundAck(identity)
    if (winner) {
      return priorAckDisposition(winner, input.parsed, insertPayload.environment, input.inboundEmailMessageId)
        ?? { status: 'exact_replay', id: winner.id }
    }
  }

  const id = (result.data as { id?: string } | null)?.id
  if (result.error || !id || (existing && id !== existing.id)) {
    throw new Error('canonical_inbound_ack_original_persistence_required', { cause: result.error })
  }

  await supabaseService.from('ediel_message_events').insert({
    company_id: input.companyId,
    ediel_message_id: id,
    event_type: invalid ? 'manual_note' : 'inbound_mail_processed',
    event_status: invalid || negative ? 'warning' : 'info',
    message: invalid
      ? `Ogiltig ${ackLabel(input.parsed)} mottagen: ${classification.reason ?? 'okänd orsak'}.`
      : `${negative ? 'Negativ' : 'Positiv'} ${ackLabel(input.parsed)} mottagen.`,
    payload: input.recovery ? { retainedSmimeRecovery: true, outcome: classification.outcome } : payload,
  })
  return { status: 'persisted', id }
}

const outboundBusinessResponseStatuses: readonly string[] = ['confirmed', 'business_response_received']
export const OUTBOUND_BUSINESS_RESPONSE_STATUSES = `(${outboundBusinessResponseStatuses.map((status) => JSON.stringify(status)).join(',')})`

async function updateOutboundAck(input: {
  companyId: string
  inboundEdielMessageId: string
  receivedAt: string
  outboundMessageId?: string | null
  parsed: ParsedEdifactEnvelope
  outboundMatch: InboundEntityMatch
  recoveredSmime?: boolean
}): Promise<void> {
  const classification = classifyAckForPersistence(input.parsed)
  if (classification.outcome !== 'positive' && classification.outcome !== 'negative') return
  if (input.outboundMatch.status !== 'matched' || !input.outboundMatch.entityId) return

  const negative = classification.outcome === 'negative'
  const columns = ackColumns(input.parsed, input.receivedAt)
  let outboundRequestId: string | null = null
  const outbound = candidate(input.outboundMatch)

  if (input.outboundMatch.entityType === 'outbound_request') {
    outboundRequestId = input.outboundMatch.entityId
    const request = supabaseService.from('outbound_requests').update({
      status: classification.family === 'CONTRL'
        ? negative ? 'syntax_rejected' : 'syntax_accepted'
        : negative ? 'application_rejected' : 'application_accepted',
      response_payload: {
        canonicalAck: classification,
        ...(input.recoveredSmime ? { inboundEdielMessageId: input.inboundEdielMessageId } : { rawPayload: input.parsed.rawPayload }),
        ...(classification.family === 'CONTRL' && !negative && input.outboundMessageId
            && outbound.message_family === 'PRODAT' && outbound.message_code === 'Z03'
          ? { ackSource: { inboundMessageId: input.inboundEdielMessageId, outboundMessageId: input.outboundMessageId } }
          : {}),
      },
      failure_reason: negative ? `${ackLabel(input.parsed)} avvisade meddelandet.` : null,
      acknowledged_at: negative ? null : input.receivedAt,
      failed_at: negative ? input.receivedAt : null,
      updated_at: nowIso(),
    }).eq('company_id', input.companyId).eq('id', outboundRequestId)
    // A positive ACK arriving after the business response (e.g. Z04 before
    // APERAK) completes only the ACK columns; it never rolls back the request.
    const written = await (negative ? request : request.not('status', 'in', OUTBOUND_BUSINESS_RESPONSE_STATUSES))
      .select('id').maybeSingle()
    if (written.error) {
      throw new Error('canonical_inbound_ack_request_update_required', { cause: written.error })
    }
    if (written.data?.id !== outboundRequestId) {
      const current = await supabaseService.from('outbound_requests').select('status')
        .eq('company_id', input.companyId).eq('id', outboundRequestId).maybeSingle()
      if (negative || written.data || current.error || !current.data?.status ||
          !outboundBusinessResponseStatuses.includes(current.data.status)) {
        throw new Error('canonical_inbound_ack_request_update_required', { cause: current.error })
      }
    }
  } else if (input.outboundMatch.entityType === 'ediel_message') {
    outboundRequestId = typeof outbound.outbound_request_id === 'string' ? outbound.outbound_request_id : null
  }

  if (outboundRequestId) {
    const { error } = await supabaseService.from('ediel_messages').update({
      ...columns,
      related_message_id: input.inboundEdielMessageId,
      updated_at: nowIso(),
    }).eq('company_id', input.companyId).eq('direction', 'outbound').eq('outbound_request_id', outboundRequestId)
    if (error) throw error
  } else if (input.outboundMatch.entityType === 'ediel_message') {
    const { error } = await supabaseService.from('ediel_messages').update({
      ...columns,
      related_message_id: input.inboundEdielMessageId,
      updated_at: nowIso(),
    }).eq('company_id', input.companyId).eq('direction', 'outbound').eq('id', input.outboundMatch.entityId)
    if (error) throw error
  }

  if (!negative || input.outboundMatch.entityType !== 'outbound_request') return
  const sourceType = typeof outbound.source_type === 'string' ? outbound.source_type : null
  const sourceId = typeof outbound.source_id === 'string' ? outbound.source_id : null
  if (!sourceId) return

  if (sourceType === 'supplier_switch_request') {
    const { error } = await supabaseService.from('supplier_switch_requests').update({
      status: 'rejected', failed_at: nowIso(), failure_reason: `${ackLabel(input.parsed)} avvisade Ediel-meddelandet.`, updated_at: nowIso(),
    }).eq('company_id', input.companyId).eq('id', sourceId)
    if (error) throw error
  }
  if (sourceType === 'grid_owner_data_request') {
    const { error } = await supabaseService.from('grid_owner_data_requests').update({
      status: 'failed', failed_at: nowIso(), failure_reason: `${ackLabel(input.parsed)} avvisade Ediel-meddelandet.`, updated_at: nowIso(),
    }).eq('company_id', input.companyId).eq('id', sourceId)
    if (error) throw error
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
  receivedAt?: string | null
  outboundMessageId?: string | null
  actorUserId?: string | null
  tenantResolution?: InboundTenantResolution | null
  recovery?: RetainedSmimeAck | null
}): Promise<{ status: 'processed' | 'manual_review'; matchStatus: string; inboundEdielMessageId: string | null }> {
  const classification = classifyAckForPersistence(input.parsed)
  if (classification.outcome === 'not_ack') throw new Error('canonical_inbound_ack_handler_received_non_ack')

  const receivedAt = input.receivedAt && Number.isFinite(Date.parse(input.receivedAt)) ? input.receivedAt : nowIso()
  const countMismatch = classification.reason === 'unt_count_mismatch'
  const persistence = countMismatch ? null : await persistInboundAck({ ...input, receivedAt })
  const inboundEdielMessageId = persistence?.id ?? null
  const safelyCorrelated = input.outboundMatch.status === 'matched' && Boolean(input.outboundMatch.entityId)

  if (persistence?.status === 'identity_conflict') {
    await createInboundMailTask({
      companyId: input.companyId,
      title: `Motstridigt ${ackLabel(input.parsed)} kräver manuell granskning`,
      description: 'Samma Ediel-identitet har ett tidigare original med annat innehåll eller annan mottagningsmiljö.',
      priority: 'urgent',
      taskType: 'ediel_inbound_ack_conflict',
      customerId: safelyCorrelated ? (candidate(input.outboundMatch).customer_id as string | undefined) : undefined,
      metadata: {
        sourceId: input.inboundEmailMessageId,
        inboundEmailMessageId: input.inboundEmailMessageId,
        parseResultId: input.parseResultId ?? null,
      },
      actorUserId: input.actorUserId ?? null,
    })
    return { status: 'manual_review', matchStatus: 'ack_identity_conflict', inboundEdielMessageId: null }
  }

  if (persistence?.status === 'exact_replay') {
    return {
      status: classification.outcome === 'positive' && safelyCorrelated ? 'processed' : 'manual_review',
      matchStatus: 'ack_exact_replay',
      inboundEdielMessageId,
    }
  }

  if (classification.outcome === 'invalid') {
    await createInboundMailTask({
      companyId: input.companyId,
      title: `Ogiltig ${ackLabel(input.parsed)} kräver manuell granskning`,
      description: classification.reason ?? 'ACK saknar verifierbar canonical outcome.',
      priority: 'urgent',
      taskType: 'ediel_invalid_ack',
      customerId: countMismatch && safelyCorrelated ? (candidate(input.outboundMatch).customer_id as string | undefined) : undefined,
      metadata: { inboundEmailMessageId: input.inboundEmailMessageId, parseResultId: input.parseResultId ?? null, canonicalAck: classification, ...(countMismatch ? { sourceId: input.inboundEmailMessageId } : {}) },
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

  if (!inboundEdielMessageId) throw new Error('canonical_inbound_ack_original_persistence_required')
  await updateOutboundAck({
    companyId: input.companyId,
    inboundEdielMessageId,
    receivedAt,
    outboundMessageId: input.outboundMessageId,
    parsed: input.parsed,
    outboundMatch: input.outboundMatch,
    recoveredSmime: Boolean(input.recovery),
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
