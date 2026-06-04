import { supabaseService } from '@/lib/supabase/service'
import type { ParsedEdifactEnvelope } from '@/lib/inbound-mail/edielEmailParser'
import type { InboundEntityMatch } from '@/lib/inbound-mail/inboundMatcher'
import { createInboundMailTask } from '@/lib/inbound-mail/inboundTaskFactory'
import { classifyProductionInboundDecision } from '@/lib/ediel/inbound/productionInboundDecisionEngine'
import { tenantResolutionForStorage, type InboundTenantResolution } from '@/lib/ediel/tenant/resolveInboundTenant'

function nowIso(): string {
  return new Date().toISOString()
}

function postgresErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

function postgresErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (!error || typeof error !== 'object') return String(error ?? '')
  const candidate = error as { message?: unknown; details?: unknown; hint?: unknown }
  return [candidate.message, candidate.details, candidate.hint]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
}

function isPostgresUniqueViolation(error: unknown): boolean {
  return postgresErrorCode(error) === '23505'
}

function isUnsafeBatch7aTransactionConflict(error: unknown): boolean {
  return postgresErrorMessage(error).includes('ux_ediel_batch7a_inbound_transaction')
}

async function findExistingInboundEdielMessageByCanonicalIdentity(input: {
  companyId: string
  inboundEmailMessageId?: string | null
  parsed: ParsedEdifactEnvelope
}): Promise<string | null> {
  if (input.inboundEmailMessageId) {
    const { data, error } = await supabaseService
      .from('ediel_messages')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('direction', 'inbound')
      .eq('inbound_email_message_id', input.inboundEmailMessageId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!error) {
      const id = (data as { id?: string } | null)?.id ?? null
      if (id) return id
    }
  }

  if (input.parsed.interchangeReference && input.parsed.senderEdielId && input.parsed.receiverEdielId) {
    const { data, error } = await supabaseService
      .from('ediel_messages')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('direction', 'inbound')
      .eq('sender_ediel_id', input.parsed.senderEdielId)
      .eq('receiver_ediel_id', input.parsed.receiverEdielId)
      .eq('interchange_reference', input.parsed.interchangeReference)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!error) return (data as { id?: string } | null)?.id ?? null
    console.warn('[inbound-mail] Kunde inte kontrollera befintlig inbound ediel_message via interchange', error)
  }

  return null
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

function productionDecisionForParsed(parsed: ParsedEdifactEnvelope) {
  return classifyProductionInboundDecision({
    messageFamily: parsed.messageFamily,
    messageCode: parsed.messageCode,
    rawPayload: parsed.rawPayload,
  })
}

function isRejectedZ14(parsed: ParsedEdifactEnvelope): boolean {
  const decision = productionDecisionForParsed(parsed)
  if (decision.scenario === 'prodat_permission_rejected') return true
  if (parsed.messageFamily !== 'PRODAT' || String(parsed.messageCode ?? '').toUpperCase() !== 'Z14') return false
  const raw = parsed.rawPayload.toUpperCase()
  return raw.includes('Z14N') || raw.includes('S18') || raw.includes('E18') || parsed.segments.some((segment) => segment.startsWith('STS+') && /\+(?:E18|S18|39|41)(?::|\+|$)/.test(segment))
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
      syntax_status: isNegativeContrL(parsed) ? 'rejected' : 'accepted',
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
      application_status: isNegativeAperak(parsed) ? 'rejected' : 'accepted',
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
      application_status: 'rejected',
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
    dates: input.parsed.dates,
    quantities: input.parsed.quantities,
    errorCodes: input.parsed.errorCodes,
    freeText: input.parsed.freeText,
    outboundMatch: input.outboundMatch ?? null,
    meteringPointMatch: input.meteringPointMatch ?? null,
  }
}

function tenantResolutionStatus(status: 'unassigned' | 'ambiguous'): 'tenant_unresolved' | 'tenant_ambiguous' {
  return status === 'ambiguous' ? 'tenant_ambiguous' : 'tenant_unresolved'
}

function tenantResolutionPayload(resolution?: InboundTenantResolution | null): Record<string, unknown> | null {
  return resolution ? tenantResolutionForStorage(resolution) : null
}

function mergeTenantResolutionIntoPayload(
  payload: Record<string, unknown>,
  resolution?: InboundTenantResolution | null,
): Record<string, unknown> {
  const stored = tenantResolutionPayload(resolution)
  return stored ? { ...payload, tenantResolution: stored } : payload
}

function matchedOutboundRow(match: InboundEntityMatch): Record<string, unknown> {
  return match.candidates?.[0] ?? {}
}

function matchedContext(input: { outboundMatch: InboundEntityMatch; meteringPointMatch: InboundEntityMatch }) {
  const outbound = matchedOutboundRow(input.outboundMatch)
  const metering = input.meteringPointMatch.status === 'matched' ? input.meteringPointMatch.candidates?.[0] ?? {} : {}
  return {
    customerId: typeof outbound.customer_id === 'string' ? outbound.customer_id : typeof metering.customer_id === 'string' ? metering.customer_id : null,
    siteId: typeof outbound.site_id === 'string' ? outbound.site_id : typeof metering.site_id === 'string' ? metering.site_id : null,
    meteringPointId: typeof outbound.metering_point_id === 'string' ? outbound.metering_point_id : input.meteringPointMatch.status === 'matched' ? input.meteringPointMatch.entityId : null,
    gridOwnerId: typeof outbound.grid_owner_id === 'string' ? outbound.grid_owner_id : typeof metering.grid_owner_id === 'string' ? metering.grid_owner_id : null,
  }
}

function parseEdielDate(value: string | null | undefined): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  if (digits.length < 8) return null
  const year = digits.slice(0, 4)
  const month = digits.slice(4, 6)
  const day = digits.slice(6, 8)
  const hour = digits.slice(8, 10) || '00'
  const minute = digits.slice(10, 12) || '00'
  const second = digits.slice(12, 14) || '00'
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function firstDate(parsed: ParsedEdifactEnvelope, keys: string[]): string | null {
  for (const key of keys) {
    const date = parseEdielDate(parsed.dates[key]?.[0])
    if (date) return date
  }
  return null
}

async function updateInboundEmailStatusOnly(input: {
  inboundEmailMessageId?: string | null
  status: string
  matchStatus?: string | null
  errorMessage?: string | null
}) {
  if (!input.inboundEmailMessageId) return
  await supabaseService.from('inbound_email_messages').update({
    processing_status: input.status,
    match_status: input.matchStatus ?? undefined,
    error_message: input.errorMessage ?? null,
    updated_at: nowIso(),
  }).eq('id', input.inboundEmailMessageId)
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
  tenantResolution?: InboundTenantResolution | null
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
      parsed_payload: mergeTenantResolutionIntoPayload(input.parsed as unknown as Record<string, unknown>, input.tenantResolution),
      validation_report: mergeTenantResolutionIntoPayload({ status: 'parsed_by_batch_7a1_engine' }, input.tenantResolution),
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
  tenantResolution?: InboundTenantResolution | null
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
    parsed_unb_sender_ediel_id: input.parsed.senderEdielId,
    parsed_unb_receiver_ediel_id: input.parsed.receiverEdielId,
    resolved_company_id: input.companyId,
    interchange_reference: input.parsed.interchangeReference,
    transaction_reference: input.parsed.transactionReference,
    application_reference: input.parsed.applicationReference,
    external_reference: input.parsed.bgmReference,
    original_message_id: input.parsed.bgmReference,
    raw_payload: input.parsed.rawPayload,
    parsed_payload: mergeTenantResolutionIntoPayload(input.parsed as unknown as Record<string, unknown>, input.tenantResolution),
    validation_report: mergeTenantResolutionIntoPayload({ status: 'parsed_by_batch_7a1_inbound_mail_engine' }, input.tenantResolution),
    tenant_resolution_status: 'tenant_resolved',
    business_match_status:
      input.outboundMatch?.status === 'matched'
        ? 'matched'
        : input.meteringPointMatch?.status === 'matched'
          ? 'partially_matched'
          : 'business_unresolved',
    processing_status: input.outboundMatch?.status === 'matched' ? statusForInboundEdielMessage(input.parsed) : 'manual_review',
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

  const existingId = await findExistingInboundEdielMessageByCanonicalIdentity({
    companyId: input.companyId,
    inboundEmailMessageId: input.inboundEmailMessageId,
    parsed: input.parsed,
  })

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
    if (isPostgresUniqueViolation(result.error)) {
      const existingAfterConflict = await findExistingInboundEdielMessageByCanonicalIdentity({
        companyId: input.companyId,
        inboundEmailMessageId: input.inboundEmailMessageId,
        parsed: input.parsed,
      })

      if (existingAfterConflict) {
        console.info('[inbound-mail] Inbound ediel_message fanns redan, återanvänder befintlig rad efter unique conflict.', {
          existingAfterConflict,
          inboundEmailMessageId: input.inboundEmailMessageId,
          interchangeReference: input.parsed.interchangeReference,
        })
        return existingAfterConflict
      }

      if (isUnsafeBatch7aTransactionConflict(result.error)) {
        console.warn(
          '[inbound-mail] Inbound ediel_message blockerades av gammalt för grovt Batch 7A transaction-unique-index. Kör migration 20260604113000_fix_ediel_inbound_transaction_dedupe.sql och synka igen.',
          result.error,
        )
        return null
      }
    }

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

export async function createUnresolvedInboundEdielMessage(input: {
  companyId?: string | null
  inboundEmailMessageId: string
  parseResultId?: string | null
  parsed: ParsedEdifactEnvelope
  tenantStatus: 'unassigned' | 'ambiguous'
  reasons: string[]
  candidates: string[]
  environment?: string | null
  tenantResolution?: InboundTenantResolution | null
}): Promise<string | null> {
  const payload = payloadForInbound({
    parsed: input.parsed,
    inboundEmailMessageId: input.inboundEmailMessageId,
    parseResultId: input.parseResultId ?? null,
  })
  const resolutionStatus = tenantResolutionStatus(input.tenantStatus)
  const insertPayload = {
    company_id: input.companyId ?? null,
    direction: 'inbound',
    message_standard: 'edifact',
    message_family: input.parsed.messageFamily,
    message_code: input.parsed.messageCode,
    status: 'received',
    sender_ediel_id: input.parsed.senderEdielId,
    sender_sub_address: input.parsed.senderSubAddress,
    receiver_ediel_id: input.parsed.receiverEdielId,
    receiver_sub_address: input.parsed.receiverSubAddress,
    parsed_unb_sender_ediel_id: input.parsed.senderEdielId,
    parsed_unb_receiver_ediel_id: input.parsed.receiverEdielId,
    resolved_company_id: input.companyId ?? null,
    interchange_reference: input.parsed.interchangeReference,
    transaction_reference: input.parsed.transactionReference,
    application_reference: input.parsed.applicationReference,
    external_reference: input.parsed.bgmReference,
    original_message_id: input.parsed.bgmReference,
    raw_payload: input.parsed.rawPayload,
    parsed_payload: mergeTenantResolutionIntoPayload(input.parsed as unknown as Record<string, unknown>, input.tenantResolution),
    validation_report: mergeTenantResolutionIntoPayload({
      status: 'routing_unresolved_manual_review',
      reasons: input.reasons,
      candidates: input.candidates,
      syntaxDecision: 'not_checked',
      routingDecision: resolutionStatus,
      note: 'Tenant-routing stoppade affärsuppdatering. Detta är inte ett EDIFACT-syntaxfel och ska inte automatiskt skapa negativ CONTRL.',
    }, input.tenantResolution),
    tenant_resolution_status: resolutionStatus,
    business_match_status: 'blocked',
    processing_status: resolutionStatus,
    inbound_email_message_id: input.inboundEmailMessageId,
    message_received_at: nowIso(),
    parsed_at: nowIso(),
    failure_reason: null,
  }

  const { data, error } = await supabaseService
    .from('ediel_messages')
    .insert(insertPayload)
    .select('id')
    .maybeSingle()

  if (error) {
    console.warn('[inbound-mail] Kunde inte skapa unresolved inbound ediel_message', error)
    return null
  }

  const edielMessageId = (data as { id?: string } | null)?.id ?? null
  if (!edielMessageId) return null

  await supabaseService.from('ediel_unresolved_items').insert({
    company_id: input.companyId ?? null,
    source_message_id: edielMessageId,
    environment: input.environment ?? null,
    raw_sender: input.parsed.senderEdielId,
    raw_receiver: input.parsed.receiverEdielId,
    raw_interchange_reference: input.parsed.interchangeReference,
    raw_message_type: input.parsed.messageFamily,
    parsed_sender_ediel_id: input.parsed.senderEdielId,
    parsed_receiver_ediel_id: input.parsed.receiverEdielId,
    parsed_subaddress: input.parsed.receiverSubAddress,
    message_family: input.parsed.messageFamily,
    message_code: input.parsed.messageCode,
    reason: input.reasons.join(' ') || 'Tenant kunde inte lösas säkert från UNB receiver.',
    issue_type: resolutionStatus,
    severity: input.tenantStatus === 'ambiguous' ? 'critical' : 'warning',
    extracted_identifiers: {
      senderEdielId: input.parsed.senderEdielId,
      receiverEdielId: input.parsed.receiverEdielId,
      receiverSubAddress: input.parsed.receiverSubAddress,
      applicationReference: input.parsed.applicationReference,
      interchangeReference: input.parsed.interchangeReference,
      bgmReference: input.parsed.bgmReference,
      inboundEmailMessageId: input.inboundEmailMessageId,
      parseResultId: input.parseResultId ?? null,
    },
    suggested_matches: input.candidates.map((companyId) => ({ companyId })),
    status: 'open',
  })

  await supabaseService.from('ediel_message_events').insert({
    company_id: input.companyId ?? null,
    ediel_message_id: edielMessageId,
    event_type: 'manual_note',
    event_status: input.tenantStatus === 'ambiguous' ? 'error' : 'warning',
    message: 'Inbound Ediel-mail blockerades innan affärsuppdatering eftersom tenant inte kunde lösas säkert.',
    payload: {
      ...payload,
      tenantStatus: input.tenantStatus,
      reasons: input.reasons,
      candidates: input.candidates,
    },
  })

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

async function createAckProblemTask(input: {
  companyId: string
  parsed: ParsedEdifactEnvelope
  outboundMatch: InboundEntityMatch
  meteringPointMatch: InboundEntityMatch
  responsePayload: Record<string, unknown>
  title: string
  description: string
  taskType: string
  actorUserId?: string | null
}) {
  const context = matchedContext({ outboundMatch: input.outboundMatch, meteringPointMatch: input.meteringPointMatch })
  await createInboundMailTask({
    companyId: input.companyId,
    customerId: context.customerId,
    siteId: context.siteId,
    meteringPointId: context.meteringPointId,
    title: input.title,
    description: input.description,
    priority: 'urgent',
    taskType: input.taskType,
    metadata: {
      ...input.responsePayload,
      sourceId: input.outboundMatch.entityId ?? input.responsePayload.inboundEmailMessageId ?? input.parsed.interchangeReference ?? input.parsed.transactionReference ?? input.taskType,
      messageFamily: input.parsed.messageFamily,
      messageCode: input.parsed.messageCode,
      errorCodes: input.parsed.errorCodes,
      errorText: input.parsed.freeText,
      gridOwnerId: context.gridOwnerId,
    },
    actorUserId: input.actorUserId ?? null,
  })
}

async function updateMeteringPermissionFromZ14(input: {
  companyId: string
  parsed: ParsedEdifactEnvelope
  outbound: Record<string, unknown>
  responsePayload: Record<string, unknown>
  actorUserId?: string | null
}) {
  const sourceType = typeof input.outbound.source_type === 'string' ? input.outbound.source_type : null
  const sourceId = typeof input.outbound.source_id === 'string' ? input.outbound.source_id : null
  const status = isRejectedZ14(input.parsed) ? 'rejected_active' : 'z14_received'
  const permissionReference = input.parsed.references.Z12?.[0] ?? input.parsed.references.Z13?.[0] ?? input.parsed.references.ACW?.[0] ?? input.parsed.bgmReference
  const approvedStart = parseEdielDate(input.parsed.dates['157']?.[0]) ?? parseEdielDate(input.parsed.dates['194']?.[0])
  const approvedEnd = parseEdielDate(input.parsed.dates['36']?.[0]) ?? parseEdielDate(input.parsed.dates['206']?.[0])

  if (sourceType === 'metering_permission' && sourceId) {
    const { error } = await supabaseService
      .from('metering_permissions')
      .update({
        status,
        permission_reference: permissionReference ?? undefined,
        approved_start_date: approvedStart ? approvedStart.slice(0, 10) : undefined,
        approved_end_date: approvedEnd ? approvedEnd.slice(0, 10) : undefined,
        last_blocker: status === 'rejected_active' ? 'Z14 markerade begäran som nekad.' : null,
        metadata: input.responsePayload,
        updated_by: input.actorUserId ?? null,
        updated_at: nowIso(),
      })
      .eq('company_id', input.companyId)
      .eq('id', sourceId)
    if (error) console.warn('[inbound-mail] Kunde inte uppdatera metering_permission från Z14', error)
    return
  }

  if (sourceType === 'grid_owner_data_request' && sourceId) {
    const { data, error } = await supabaseService
      .from('metering_permissions')
      .select('id')
      .eq('company_id', input.companyId)
      .contains('metadata', { z13: { gridOwnerDataRequestId: sourceId } })
      .limit(5)

    if (error) {
      console.warn('[inbound-mail] Kunde inte leta metering_permission via grid_owner_data_request', error)
      return
    }

    const rows = (data ?? []) as Array<{ id: string }>
    if (rows.length !== 1) return

    const { error: updateError } = await supabaseService
      .from('metering_permissions')
      .update({
        status,
        permission_reference: permissionReference ?? undefined,
        approved_start_date: approvedStart ? approvedStart.slice(0, 10) : undefined,
        approved_end_date: approvedEnd ? approvedEnd.slice(0, 10) : undefined,
        last_blocker: status === 'rejected_active' ? 'Z14 markerade begäran som nekad.' : null,
        metadata: input.responsePayload,
        updated_by: input.actorUserId ?? null,
        updated_at: nowIso(),
      })
      .eq('company_id', input.companyId)
      .eq('id', rows[0].id)
    if (updateError) console.warn('[inbound-mail] Kunde inte uppdatera metering_permission via grid_owner_data_request', updateError)
  }
}

async function importUtiltsMeteringValue(input: {
  companyId: string
  parsed: ParsedEdifactEnvelope
  outboundMatch: InboundEntityMatch
  meteringPointMatch: InboundEntityMatch
  inboundEdielMessageId?: string | null
  responsePayload: Record<string, unknown>
  actorUserId?: string | null
}) {
  if (input.parsed.messageFamily !== 'UTILTS') return

  const context = matchedContext({ outboundMatch: input.outboundMatch, meteringPointMatch: input.meteringPointMatch })
  if (input.meteringPointMatch.status !== 'matched' || !context.meteringPointId) {
    await createInboundMailTask({
      companyId: input.companyId,
      title: 'UTILTS mottagen men mätpunkt kunde inte matchas säkert',
      description: 'Mätvärden importeras inte automatiskt utan säker mätpunkt. Matcha manuellt i Inbound Mail Engine.',
      priority: 'high',
      taskType: 'ediel_utilts_meter_value_review',
      metadata: { ...input.responsePayload, sourceId: input.outboundMatch.entityId ?? input.parsed.interchangeReference ?? input.parsed.transactionReference ?? 'utilts_missing_metering_point' },
      actorUserId: input.actorUserId ?? null,
    })
    return
  }

  const quantity = input.parsed.quantities.find((item) => item.value !== null)
  if (!quantity) {
    await createInboundMailTask({
      companyId: input.companyId,
      customerId: context.customerId,
      siteId: context.siteId,
      meteringPointId: context.meteringPointId,
      title: 'UTILTS mottagen utan läsbart mätvärde',
      description: 'Parsern hittade ingen QTY-rad med numeriskt värde. Kontrollera raw UTILTS innan import.',
      priority: 'high',
      taskType: 'ediel_utilts_meter_value_review',
      metadata: { ...input.responsePayload, sourceId: input.outboundMatch.entityId ?? input.parsed.interchangeReference ?? input.parsed.transactionReference ?? 'utilts_missing_qty' },
      actorUserId: input.actorUserId ?? null,
    })
    return
  }

  const periodStart = firstDate(input.parsed, ['163', '194', '356', '324', '238']) ?? nowIso()
  const periodEnd = firstDate(input.parsed, ['164', '206', '357', '265']) ?? periodStart
  const readAt = firstDate(input.parsed, ['354', '597', '137', '238']) ?? periodEnd
  const canonicalDedupeKey = [
    input.parsed.interchangeReference,
    input.parsed.transactionReference,
    input.parsed.messageCode,
    context.meteringPointId,
    quantity.qualifier,
    quantity.rawValue,
    periodStart,
    periodEnd,
  ].filter(Boolean).join('|')

  const existing = await supabaseService
    .from('metering_values')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('canonical_dedupe_key', canonicalDedupeKey)
    .maybeSingle()
  if (existing.error) console.warn('[inbound-mail] Kunde inte kontrollera UTILTS dedupe', existing.error)
  if ((existing.data as { id?: string } | null)?.id) return

  const outbound = matchedOutboundRow(input.outboundMatch)
  const { error } = await supabaseService.from('metering_values').insert({
    company_id: input.companyId,
    customer_id: context.customerId,
    site_id: context.siteId,
    metering_point_id: context.meteringPointId,
    source_request_id: input.outboundMatch.entityId ?? null,
    grid_owner_id: context.gridOwnerId,
    reading_type: quantity.qualifier ?? 'consumption',
    value_kwh: quantity.value,
    quality_code: input.parsed.references.Z30?.[0] ?? input.parsed.references.Z31?.[0] ?? null,
    read_at: readAt,
    period_start: periodStart,
    period_end: periodEnd,
    source_system: 'ediel_utilts_inbound_mail',
    raw_payload: input.responsePayload,
    source_ediel_message_id: input.inboundEdielMessageId ?? null,
    canonical_dedupe_key: canonicalDedupeKey,
    is_current: true,
    value_status: 'current',
    created_by: input.actorUserId ?? null,
  })

  if (error) {
    await createInboundMailTask({
      companyId: input.companyId,
      customerId: context.customerId,
      siteId: context.siteId,
      meteringPointId: context.meteringPointId,
      title: 'UTILTS kunde inte importeras till mätvärden',
      description: error.message,
      priority: 'high',
      taskType: 'ediel_utilts_meter_value_review',
      metadata: { ...input.responsePayload, sourceId: input.outboundMatch.entityId ?? canonicalDedupeKey, outbound },
      actorUserId: input.actorUserId ?? null,
    })
  }
}

async function updateBusinessStatusFromInbound(input: {
  companyId: string
  parsed: ParsedEdifactEnvelope
  outboundMatch: InboundEntityMatch
  meteringPointMatch: InboundEntityMatch
  inboundEdielMessageId?: string | null
  responsePayload: Record<string, unknown>
  actorUserId?: string | null
}): Promise<void> {
  const outbound = matchedOutboundRow(input.outboundMatch)
  const sourceType = typeof outbound.source_type === 'string' ? outbound.source_type : null
  const sourceId = typeof outbound.source_id === 'string' ? outbound.source_id : null
  const decision = productionDecisionForParsed(input.parsed)
  const responsePayload = {
    ...input.responsePayload,
    productionInboundDecision: decision,
  }

  if (!sourceId) {
    await importUtiltsMeteringValue({
      companyId: input.companyId,
      parsed: input.parsed,
      outboundMatch: input.outboundMatch,
      meteringPointMatch: input.meteringPointMatch,
      inboundEdielMessageId: input.inboundEdielMessageId,
      responsePayload,
      actorUserId: input.actorUserId ?? null,
    })
    return
  }

  if (sourceType === 'supplier_switch_request') {
    if (input.parsed.messageFamily === 'PRODAT' && input.parsed.messageCode === 'Z04') {
      await supabaseService
        .from('supplier_switch_requests')
        .update({ status: 'confirmed', completed_at: nowIso(), metadata: responsePayload, updated_at: nowIso() })
        .eq('id', sourceId)
        .eq('company_id', input.companyId)
    }

    if (isNegativeAperak(input.parsed) || input.parsed.messageFamily === 'UTILTS_ERR' || isNegativeContrL(input.parsed)) {
      await supabaseService
        .from('supplier_switch_requests')
        .update({ status: 'rejected', failed_at: nowIso(), failure_reason: eventMessageForParsed(input.parsed), metadata: responsePayload, updated_at: nowIso() })
        .eq('id', sourceId)
        .eq('company_id', input.companyId)
    }
  }

  if (sourceType === 'grid_owner_data_request') {
    if (input.parsed.messageFamily === 'PRODAT' && ['Z02', 'Z14'].includes(String(input.parsed.messageCode ?? '').toUpperCase())) {
      await supabaseService
        .from('grid_owner_data_requests')
        .update({ status: 'received', response_payload: responsePayload, received_at: nowIso(), updated_at: nowIso() })
        .eq('id', sourceId)
        .eq('company_id', input.companyId)
    }

    if (input.parsed.messageFamily === 'UTILTS') {
      await supabaseService
        .from('grid_owner_data_requests')
        .update({ status: 'received', response_payload: responsePayload, received_at: nowIso(), updated_at: nowIso() })
        .eq('id', sourceId)
        .eq('company_id', input.companyId)
    }

    if (isNegativeAperak(input.parsed) || input.parsed.messageFamily === 'UTILTS_ERR' || isNegativeContrL(input.parsed)) {
      await supabaseService
        .from('grid_owner_data_requests')
        .update({ status: 'failed', failure_reason: eventMessageForParsed(input.parsed), response_payload: responsePayload, failed_at: nowIso(), updated_at: nowIso() })
        .eq('id', sourceId)
        .eq('company_id', input.companyId)
    }
  }

  if (input.parsed.messageFamily === 'PRODAT' && String(input.parsed.messageCode ?? '').toUpperCase() === 'Z14') {
    await updateMeteringPermissionFromZ14({
      companyId: input.companyId,
      parsed: input.parsed,
      outbound,
      responsePayload,
      actorUserId: input.actorUserId ?? null,
    })
  }
  if (decision.scenario === 'prodat_permission_terminated' && sourceType === 'metering_permission' && sourceId) {
    const { error } = await supabaseService
      .from('metering_permissions')
      .update({
        status: 'terminated',
        terminated_at: nowIso(),
        metadata: input.responsePayload,
        updated_by: input.actorUserId ?? null,
        updated_at: nowIso(),
      })
      .eq('company_id', input.companyId)
      .eq('id', sourceId)
    if (error) console.warn('[inbound-mail] Kunde inte markera metering_permission som terminated från Z15V', error)
  }


  await importUtiltsMeteringValue({
    companyId: input.companyId,
    parsed: input.parsed,
    outboundMatch: input.outboundMatch,
    meteringPointMatch: input.meteringPointMatch,
    inboundEdielMessageId: input.inboundEdielMessageId,
    responsePayload,
    actorUserId: input.actorUserId ?? null,
  })
}

export async function applySafeInboundStatusUpdate(input: {
  companyId: string
  parsed: ParsedEdifactEnvelope
  outboundMatch: InboundEntityMatch
  meteringPointMatch: InboundEntityMatch
  inboundEmailMessageId?: string | null
  parseResultId?: string | null
  actorUserId?: string | null
  tenantResolution?: InboundTenantResolution | null
}): Promise<void> {
  if (input.outboundMatch.status !== 'matched' || !input.outboundMatch.entityId) return

  const inboundEdielMessageId = await createInboundEdielMessage({
    companyId: input.companyId,
    inboundEmailMessageId: input.inboundEmailMessageId ?? '',
    parseResultId: input.parseResultId ?? null,
    parsed: input.parsed,
    outboundMatch: input.outboundMatch,
    meteringPointMatch: input.meteringPointMatch,
    tenantResolution: input.tenantResolution ?? null,
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
        status: isNegative ? 'syntax_rejected' : 'syntax_accepted',
        response_payload: responsePayload,
        failure_reason: isNegative ? 'Negativ CONTRL mottagen via inbound mail engine.' : null,
        acknowledged_at: isNegative ? null : nowIso(),
        failed_at: isNegative ? nowIso() : null,
        updated_at: nowIso(),
      })
      .eq('id', input.outboundMatch.entityId)
      .eq('company_id', input.companyId)

    await updateOutboundEdielAckState({ companyId: input.companyId, outboundRequestId: input.outboundMatch.entityId, parsed: input.parsed, inboundEdielMessageId, responsePayload })
    await updateBusinessStatusFromInbound({ companyId: input.companyId, parsed: input.parsed, outboundMatch: input.outboundMatch, meteringPointMatch: input.meteringPointMatch, inboundEdielMessageId, responsePayload, actorUserId: input.actorUserId ?? null })

    if (isNegative) {
      await createAckProblemTask({
        companyId: input.companyId,
        parsed: input.parsed,
        outboundMatch: input.outboundMatch,
        meteringPointMatch: input.meteringPointMatch,
        responsePayload,
        title: 'Negativ CONTRL mottagen',
        description: 'Syntaxkvittensen var negativ. Stoppa flödet och kontrollera raw EDIFACT innan omsändning.',
        taskType: 'ediel_negative_contrl',
        actorUserId: input.actorUserId ?? null,
      })
      await updateInboundEmailStatusOnly({ inboundEmailMessageId: input.inboundEmailMessageId, status: 'manual_review', matchStatus: 'negative_contrl' })
    }
    return
  }

  if (input.parsed.messageFamily === 'APERAK') {
    const isNegative = isNegativeAperak(input.parsed)
    await supabaseService
      .from('outbound_requests')
      .update({
        status: isNegative ? 'application_rejected' : 'application_accepted',
        response_payload: responsePayload,
        failure_reason: isNegative ? 'Negativ APERAK mottagen via inbound mail engine.' : null,
        acknowledged_at: isNegative ? null : nowIso(),
        failed_at: isNegative ? nowIso() : null,
        updated_at: nowIso(),
      })
      .eq('id', input.outboundMatch.entityId)
      .eq('company_id', input.companyId)

    await updateOutboundEdielAckState({ companyId: input.companyId, outboundRequestId: input.outboundMatch.entityId, parsed: input.parsed, inboundEdielMessageId, responsePayload })
    await updateBusinessStatusFromInbound({ companyId: input.companyId, parsed: input.parsed, outboundMatch: input.outboundMatch, meteringPointMatch: input.meteringPointMatch, inboundEdielMessageId, responsePayload, actorUserId: input.actorUserId ?? null })

    if (isNegative) {
      await createAckProblemTask({
        companyId: input.companyId,
        parsed: input.parsed,
        outboundMatch: input.outboundMatch,
        meteringPointMatch: input.meteringPointMatch,
        responsePayload,
        title: 'Negativ APERAK mottagen',
        description: 'Applikationskvittensen var negativ. Korrigera felorsak och skapa ny preflight innan eventuell omsändning.',
        taskType: 'ediel_negative_aperak',
        actorUserId: input.actorUserId ?? null,
      })
      await updateInboundEmailStatusOnly({ inboundEmailMessageId: input.inboundEmailMessageId, status: 'manual_review', matchStatus: 'negative_aperak' })
    }
    return
  }

  if (input.parsed.messageFamily === 'UTILTS_ERR') {
    await supabaseService
      .from('outbound_requests')
      .update({
        status: 'functional_rejected',
        response_payload: responsePayload,
        failure_reason: 'UTILTS_ERR mottagen via inbound mail engine.',
        failed_at: nowIso(),
        updated_at: nowIso(),
      })
      .eq('id', input.outboundMatch.entityId)
      .eq('company_id', input.companyId)

    await updateOutboundEdielAckState({ companyId: input.companyId, outboundRequestId: input.outboundMatch.entityId, parsed: input.parsed, inboundEdielMessageId, responsePayload })
    await updateBusinessStatusFromInbound({ companyId: input.companyId, parsed: input.parsed, outboundMatch: input.outboundMatch, meteringPointMatch: input.meteringPointMatch, inboundEdielMessageId, responsePayload, actorUserId: input.actorUserId ?? null })
    await createAckProblemTask({
      companyId: input.companyId,
      parsed: input.parsed,
      outboundMatch: input.outboundMatch,
      meteringPointMatch: input.meteringPointMatch,
      responsePayload,
      title: 'UTILTS_ERR mottagen',
      description: 'UTILTS-flödet fick funktionsfel. Kontrollera STS/reason och korrigera innan nytt flöde.',
      taskType: 'ediel_utilts_err',
      actorUserId: input.actorUserId ?? null,
    })
    await updateInboundEmailStatusOnly({ inboundEmailMessageId: input.inboundEmailMessageId, status: 'manual_review', matchStatus: 'utilts_err' })
    return
  }

  if (input.parsed.messageFamily === 'PRODAT' || input.parsed.messageFamily === 'UTILTS') {
    const nextStatus = input.parsed.messageFamily === 'UTILTS' ? 'business_response_received' : String(input.parsed.messageCode ?? '').toUpperCase() === 'Z04' ? 'confirmed' : 'business_response_received'
    await supabaseService
      .from('outbound_requests')
      .update({ status: nextStatus, response_payload: responsePayload, acknowledged_at: nowIso(), updated_at: nowIso() })
      .eq('id', input.outboundMatch.entityId)
      .eq('company_id', input.companyId)

    await updateBusinessStatusFromInbound({ companyId: input.companyId, parsed: input.parsed, outboundMatch: input.outboundMatch, meteringPointMatch: input.meteringPointMatch, inboundEdielMessageId, responsePayload, actorUserId: input.actorUserId ?? null })
  }
}

export { isNegativeAperak, isNegativeContrL, isPositiveAperak }
