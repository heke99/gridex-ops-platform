import { supabaseService } from '@/lib/supabase/service'
import {
  extractManualFacilityFields,
  scoreManualFacilityPayload,
  applyManualFacilityResponse,
  type ManualFacilityParseResult,
} from '@/lib/customer-operations/manualFacilityResponseParser'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'
import { resolveManualInboundCorrelation } from '@/lib/inbound-mail/manualInboundCorrelation'

type JsonRecord = Record<string, unknown>

export type ManualInboundEmail = {
  mailbox?: string | null
  mailboxCompanyId?: string | null
  fromEmail?: string | null
  fromName?: string | null
  toEmail?: string | null
  subject?: string | null
  bodyText?: string | null
  bodyHtml?: string | null
  providerMessageId?: string | null
  threadId?: string | null
  inReplyTo?: string | null
  references?: string[] | null
  attachments?: unknown[]
}

export type ManualInboundResult = {
  inboundId: string | null
  resolutionStatus: 'matched' | 'ambiguous' | 'unmatched' | 'ignored'
  requestId: string | null
  caseReference: string | null
  companyId?: string | null
  customerId?: string | null
  customerSiteId?: string | null
  meteringPointId?: string | null
  intent?: string | null
  businessProcess?: string | null
  processingState?: string | null
  parse?: ManualFacilityParseResult | null
}

const CASE_REFERENCE_RE = /GX-FIR-[A-F0-9]{8,32}/i
const FACILITY_REQUEST_TYPES = new Set([
  'facility_identifier_lookup',
  'facility_lookup',
  'metering_point_lookup',
  'grid_area_confirmation',
  'grid_contract_information',
])

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeEmail(value: unknown): string | null {
  return clean(value)?.toLowerCase() ?? null
}

function stripHtml(value: string | null): string {
  if (!value) return ''
  return value
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function attachmentText(attachments: unknown[] | undefined): string {
  if (!Array.isArray(attachments)) return ''
  const parts: string[] = []
  for (const entry of attachments.slice(0, 10)) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as JsonRecord
    const contentType = clean(row.contentType ?? row.content_type ?? row.mime_type)?.toLowerCase() ?? ''
    const filename = clean(row.filename)?.toLowerCase() ?? ''
    const raw = clean(row.text ?? row.content)
    if (!raw || raw.length > 200_000) continue
    if (contentType.startsWith('text/') || /\.(txt|csv|json|xml)$/.test(filename)) {
      try {
        parts.push(row.encoding === 'base64' ? Buffer.from(raw, 'base64').toString('utf8') : raw)
      } catch {
        // Invalid attachment content is retained as raw evidence but never parsed.
      }
    }
  }
  return parts.join('\n')
}

export function buildNormalizedManualInboundText(email: ManualInboundEmail): string {
  return [
    clean(email.subject),
    clean(email.bodyText),
    stripHtml(clean(email.bodyHtml)),
    attachmentText(email.attachments),
  ]
    .filter(Boolean)
    .join('\n')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 500_000)
}

export function extractCaseReference(email: ManualInboundEmail): string | null {
  const candidates = [
    clean(email.subject),
    clean(email.toEmail),
    clean(email.bodyText),
    clean(email.bodyHtml),
    attachmentText(email.attachments),
  ]
  for (const candidate of candidates) {
    const match = candidate?.match(CASE_REFERENCE_RE)
    if (match) return match[0].toUpperCase()
  }
  return null
}

async function findExistingInbound(input: {
  mailbox: string
  providerMessageId: string
}): Promise<JsonRecord | null> {
  const { data, error } = await supabaseService
    .from('manual_inbound_messages')
    .select('id,company_id,request_id,resolution_status,customer_id,customer_site_id,metering_point_id,intent,business_process,processing_state')
    .eq('mailbox', input.mailbox)
    .eq('provider_message_id', input.providerMessageId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as JsonRecord | null
}

async function persistRawInbound(input: {
  email: ManualInboundEmail
  mailbox: string
  providerMessageId: string | null
}): Promise<{ inboundId: string; existing: JsonRecord | null }> {
  if (input.providerMessageId) {
    const existing = await findExistingInbound({ mailbox: input.mailbox, providerMessageId: input.providerMessageId })
    if (existing) return { inboundId: String(existing.id), existing }
  }

  const insert = await supabaseService
    .from('manual_inbound_messages')
    .insert({
      company_id: null,
      request_id: null,
      mailbox: input.mailbox,
      mailbox_company_id: clean(input.email.mailboxCompanyId),
      from_email: clean(input.email.fromEmail),
      from_name: clean(input.email.fromName),
      to_email: clean(input.email.toEmail),
      subject: clean(input.email.subject),
      body_text: clean(input.email.bodyText),
      body_html: clean(input.email.bodyHtml),
      provider_message_id: input.providerMessageId,
      thread_id: clean(input.email.threadId),
      in_reply_to: clean(input.email.inReplyTo ?? input.email.threadId),
      reference_message_ids: Array.isArray(input.email.references) ? input.email.references.filter(Boolean).slice(0, 50) : [],
      attachments: Array.isArray(input.email.attachments) ? input.email.attachments : [],
      resolution_status: 'unmatched',
      extracted_payload: {},
      confidence_score: 0,
      correlation_evidence: {},
      processing_state: 'received',
    })
    .select('id')
    .maybeSingle()

  if (insert.error) {
    if (String(insert.error.code) === '23505' && input.providerMessageId) {
      const existing = await findExistingInbound({ mailbox: input.mailbox, providerMessageId: input.providerMessageId })
      if (existing) return { inboundId: String(existing.id), existing }
    }
    throw insert.error
  }
  if (!insert.data?.id) throw new Error('Inkommande e-post kunde inte persisteras före korrelation.')
  return { inboundId: String(insert.data.id), existing: null }
}

async function upsertInboundOperationEvent(input: {
  inboundId: string
  companyId: string | null
  resolutionStatus: ManualInboundResult['resolutionStatus']
  tenantResolutionMethod: string | null
  businessProcess: string
  intent: string
  intentConfidence: number
  gridOwnerId: string | null
  customerId: string | null
  customerSiteId: string | null
  meteringPointId: string | null
  requestId: string | null
  processingState: string
  evidence: JsonRecord
  businessEventFingerprint: string | null
}): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabaseService
    .from('inbound_operation_events')
    .upsert({
      source_transport: 'email',
      source_id: input.inboundId,
      company_id: input.companyId,
      tenant_resolution_status: input.resolutionStatus,
      tenant_resolution_method: input.tenantResolutionMethod,
      business_process: input.businessProcess,
      intent: input.intent,
      intent_confidence: input.intentConfidence,
      grid_owner_id: input.gridOwnerId,
      customer_id: input.customerId,
      customer_site_id: input.customerSiteId,
      metering_point_id: input.meteringPointId,
      business_object_id: input.requestId,
      processing_state: input.processingState,
      evidence: input.evidence,
      business_event_fingerprint: input.businessEventFingerprint,
      idempotency_key: `email:${input.inboundId}`,
      updated_at: now,
    }, { onConflict: 'idempotency_key' })
  if (error) throw error
}

function operationFingerprint(input: {
  companyId: string | null
  businessProcess: string
  requestId: string | null
  customerSiteId: string | null
  facilityId: string | null
  meteringPointValue: string | null
}): string | null {
  if (!input.companyId || input.businessProcess === 'unknown') return null
  const entity = input.requestId ?? input.customerSiteId ?? input.facilityId ?? input.meteringPointValue
  if (!entity) return null
  return [input.companyId, input.businessProcess, entity].join(':')
}

function resultFromExisting(existing: JsonRecord, caseReference: string | null): ManualInboundResult {
  return {
    inboundId: clean(existing.id),
    resolutionStatus: String(existing.resolution_status ?? 'unmatched') as ManualInboundResult['resolutionStatus'],
    requestId: clean(existing.request_id),
    caseReference,
    companyId: clean(existing.company_id),
    customerId: clean(existing.customer_id),
    customerSiteId: clean(existing.customer_site_id),
    meteringPointId: clean(existing.metering_point_id),
    intent: clean(existing.intent),
    businessProcess: clean(existing.business_process),
    processingState: clean(existing.processing_state),
    parse: null,
  }
}

export async function ingestManualInboundEmail(email: ManualInboundEmail): Promise<ManualInboundResult> {
  await assertPlatformSchemaReady()

  const mailbox = normalizeEmail(email.mailbox ?? email.toEmail) ?? ''
  const providerMessageId = clean(email.providerMessageId)
  const caseReference = extractCaseReference(email)
  const raw = await persistRawInbound({ email, mailbox, providerMessageId })

  // A terminal correlation is idempotent. Unmatched rows are intentionally
  // re-evaluated because new tenant/customer masterdata may have arrived since
  // the first attempt.
  if (raw.existing && clean(raw.existing.resolution_status) !== 'unmatched') {
    return resultFromExisting(raw.existing, caseReference)
  }

  const normalizedText = buildNormalizedManualInboundText(email)
  const extracted = extractManualFacilityFields(normalizedText)
  const confidence = scoreManualFacilityPayload(extracted)
  const correlation = await resolveManualInboundCorrelation({
    email: {
      mailbox,
      mailboxCompanyId: clean(email.mailboxCompanyId),
      fromEmail: clean(email.fromEmail),
      toEmail: clean(email.toEmail),
      threadId: clean(email.threadId),
      inReplyTo: clean(email.inReplyTo ?? email.threadId),
      references: email.references ?? [],
    },
    caseReference,
    normalizedText,
    extracted,
  })

  const baseProcessingState = correlation.resolutionStatus === 'matched'
    ? 'matched'
    : correlation.resolutionStatus === 'ignored'
      ? 'ignored'
      : correlation.resolutionStatus

  const correlationUpdate = await supabaseService
    .from('manual_inbound_messages')
    .update({
      company_id: correlation.companyId,
      request_id: correlation.requestId,
      mailbox_company_id: clean(email.mailboxCompanyId),
      in_reply_to: clean(email.inReplyTo ?? email.threadId),
      reference_message_ids: Array.isArray(email.references) ? email.references.filter(Boolean).slice(0, 50) : [],
      grid_owner_id: correlation.gridOwnerId,
      customer_id: correlation.customerId,
      customer_site_id: correlation.customerSiteId,
      metering_point_id: correlation.meteringPointId,
      tenant_resolution_method: correlation.tenantResolutionMethod,
      entity_resolution_method: correlation.entityResolutionMethod,
      correlation_evidence: correlation.evidence,
      normalized_text: normalizedText,
      business_process: correlation.businessProcess,
      intent: correlation.intent,
      processing_state: baseProcessingState,
      resolution_status: correlation.resolutionStatus,
      extracted_payload: { ...extracted, sender_credible: correlation.senderCredible },
      confidence_score: confidence,
    })
    .eq('id', raw.inboundId)
    .select('id')
    .maybeSingle()
  if (correlationUpdate.error) throw correlationUpdate.error
  if (!correlationUpdate.data) throw new Error('Inkommande e-post kunde inte uppdateras med korrelationsresultat.')

  const fingerprint = operationFingerprint({
    companyId: correlation.companyId,
    businessProcess: correlation.businessProcess,
    requestId: correlation.requestId,
    customerSiteId: correlation.customerSiteId,
    facilityId: clean(extracted.facility_id),
    meteringPointValue: clean(extracted.metering_point_id),
  })

  await upsertInboundOperationEvent({
    inboundId: raw.inboundId,
    companyId: correlation.companyId,
    resolutionStatus: correlation.resolutionStatus,
    tenantResolutionMethod: correlation.tenantResolutionMethod,
    businessProcess: correlation.businessProcess,
    intent: correlation.intent,
    intentConfidence: correlation.intentConfidence,
    gridOwnerId: correlation.gridOwnerId,
    customerId: correlation.customerId,
    customerSiteId: correlation.customerSiteId,
    meteringPointId: correlation.meteringPointId,
    requestId: correlation.requestId,
    processingState: baseProcessingState,
    evidence: correlation.evidence,
    businessEventFingerprint: fingerprint,
  })

  let parse: ManualFacilityParseResult | null = null
  let processingState = baseProcessingState
  const requestType = clean(correlation.request?.request_type)
  const canApplyFacilityResponse = correlation.resolutionStatus === 'matched'
    && correlation.request
    && correlation.companyId
    && correlation.senderCredible
    && requestType !== null
    && FACILITY_REQUEST_TYPES.has(requestType)

  if (canApplyFacilityResponse && correlation.request && correlation.companyId) {
    parse = await applyManualFacilityResponse({
      companyId: correlation.companyId,
      request: correlation.request,
      extracted,
      rawPayload: {
        subject: clean(email.subject),
        body_text: clean(email.bodyText),
        from_email: clean(email.fromEmail),
        provider_message_id: providerMessageId,
        in_reply_to: clean(email.inReplyTo ?? email.threadId),
        mailbox,
        inbound_id: raw.inboundId,
      },
      senderCredible: correlation.senderCredible,
      source: 'manual_inbound_ingestion',
    })

    processingState = parse.outcome === 'applied' ? 'applied' : 'needs_review'
    if (parse.outcome === 'applied') {
      const requestUpdate = await supabaseService
        .from('grid_owner_information_requests')
        .update({ status: 'manual_response_received', received_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('company_id', correlation.companyId)
        .eq('id', String(correlation.request.id))
        .in('status', ['manual_email_queued', 'manual_email_sent', 'waiting_manual_response', 'manual_response_received'])
        .select('id')
      if (requestUpdate.error) throw requestUpdate.error
      if (!requestUpdate.data?.length) throw new Error('Nätägarärendet kunde inte markeras mottaget i rätt tenant.')
    }
  } else if (correlation.resolutionStatus === 'matched') {
    // We understood who/what the mail belongs to, but this batch only auto-
    // applies the existing canonical facility-response path. Other intents are
    // persisted for the next process adapters and surfaced for review meanwhile.
    processingState = 'needs_review'
  }

  if (processingState !== baseProcessingState) {
    const stateUpdate = await supabaseService
      .from('manual_inbound_messages')
      .update({ processing_state: processingState })
      .eq('id', raw.inboundId)
      .select('id')
      .maybeSingle()
    if (stateUpdate.error) throw stateUpdate.error

    await upsertInboundOperationEvent({
      inboundId: raw.inboundId,
      companyId: correlation.companyId,
      resolutionStatus: correlation.resolutionStatus,
      tenantResolutionMethod: correlation.tenantResolutionMethod,
      businessProcess: correlation.businessProcess,
      intent: correlation.intent,
      intentConfidence: correlation.intentConfidence,
      gridOwnerId: correlation.gridOwnerId,
      customerId: correlation.customerId,
      customerSiteId: correlation.customerSiteId,
      meteringPointId: correlation.meteringPointId,
      requestId: correlation.requestId,
      processingState,
      evidence: { ...correlation.evidence, parse_outcome: parse?.outcome ?? null },
      businessEventFingerprint: fingerprint,
    })
  }

  return {
    inboundId: raw.inboundId,
    resolutionStatus: correlation.resolutionStatus,
    requestId: correlation.requestId,
    caseReference,
    companyId: correlation.companyId,
    customerId: correlation.customerId,
    customerSiteId: correlation.customerSiteId,
    meteringPointId: correlation.meteringPointId,
    intent: correlation.intent,
    businessProcess: correlation.businessProcess,
    processingState,
    parse,
  }
}
