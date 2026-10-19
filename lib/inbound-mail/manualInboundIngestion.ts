import { supabaseService } from '@/lib/supabase/service'
import {
  extractManualFacilityFields,
  scoreManualFacilityPayload,
  applyManualFacilityResponse,
  type ManualFacilityParseResult,
} from '@/lib/customer-operations/manualFacilityResponseParser'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'
import { resolveManualInboundCorrelation } from '@/lib/inbound-mail/manualInboundCorrelation'
import { autoReplyReason } from '@/lib/inbound-mail/autoReply'
import { assessManualReply, authoredManualReply, authoredManualReplyRequiresReview, stripQuotedManualReplyHtml } from '@/lib/inbound-mail/manualReplyAssessment'
import { recordManualCounterpartyReply } from '@/lib/inbound-mail/manualCounterpartyReply'
import { recordManualMailAiReading } from '@/lib/inbound-mail/manualMailAiRecording'
import type { ManualSenderVerification } from '@/lib/inbound-mail/manualSenderVerification'
import { createHash } from 'node:crypto'
import { interpretManualMail } from '@/lib/inbound-mail/manualMailInterpretation'
import { applyManualCommercialReply, continueManualCommercialReply, markManualReplyContinuationFailed, reviewManualReply } from '@/lib/inbound-mail/manualReplyApplication'
import { normalizeManualFacilityFacts } from '@/lib/inbound-mail/manualFacilityFacts'
import { tenantSelect } from '@/lib/supabase/tenantQuery'
import { extractManualCustomerIdentityHints, manualCustomerIdentityMatches } from '@/lib/inbound-mail/manualCustomerIdentity'
import { prepareManualMailDocuments, type ManualDocumentUnit } from '@/lib/inbound-mail/manualMailDocumentParser'
import { recordManualMailDocumentReading } from '@/lib/inbound-mail/manualMailDocumentReading'
import { createManualMailSourceCorpus } from '@/lib/inbound-mail/manualMailEvidenceSources'
import { isVerifiedManualDocumentSender, resolveManualDocumentRouting } from '@/lib/inbound-mail/manualInboundRouting'

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
  // Root headers relevant to RFC 3834 auto-reply detection (lower-case names).
  autoReplyHeaders?: Record<string, string> | null
  // Server-generated from the original RFC bytes, never accepted from a public payload.
  senderVerification?: ManualSenderVerification
  // Server-only MIME traversal result, never accepted from a public webhook.
  mimeRequiresReview?: boolean
}

export type ManualInboundResult = {
  inboundId: string | null
  resolutionStatus: 'matched' | 'ambiguous' | 'unmatched' | 'ignored'
  reason?: 'retired_source'
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

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

/** Merge stage witnesses without replacing a sibling paid reservation/result. */
async function mergeManualEvidence(inboundId: string, fingerprint: string, merge: (payload: JsonRecord) => JsonRecord): Promise<JsonRecord> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const found = await supabaseService.from('manual_inbound_messages').select('extracted_payload').eq('id', inboundId).maybeSingle()
    if (found.error) throw found.error
    if (!found.data) throw new Error('manual_mail_source_missing')
    const previous = record(found.data.extracted_payload)
    // Legacy rows are bound against their persisted originals by persistRawInbound
    // before reaching this helper; add the missing fingerprint once.
    if (previous.source_fingerprint !== undefined && previous.source_fingerprint !== fingerprint) throw new Error('manual_mail_source_changed')
    const next = { ...merge(previous), source_fingerprint: fingerprint }
    const changed = await supabaseService.from('manual_inbound_messages').update({ extracted_payload: next })
      .eq('id', inboundId).eq('extracted_payload', JSON.stringify(previous)).select('id').maybeSingle()
    if (changed.error) throw changed.error
    if (changed.data) return next
  }
  throw new Error('manual_mail_evidence_changed')
}

function normalizeEmail(value: unknown): string | null {
  return clean(value)?.toLowerCase() ?? null
}

function legacySourceFingerprint(email: ManualInboundEmail): string {
  return createHash('sha256').update(JSON.stringify([normalizeEmail(email.fromEmail), clean(email.subject),
    clean(email.bodyText), clean(email.bodyHtml), Array.isArray(email.attachments) ? email.attachments : [],
    ...(email.mimeRequiresReview === true ? ['mime_structure_incomplete'] : [])])).digest('hex')
}

function sourceFingerprint(email: ManualInboundEmail): string {
  return createHash('sha256').update(JSON.stringify({ version: 2, content: legacySourceFingerprint(email),
    rawSha256: email.senderVerification?.status === 'verified' ? email.senderVerification.raw_sha256 : null,
    inReplyTo: clean(email.inReplyTo ?? email.threadId),
    references: (email.references ?? []).map(clean).filter(Boolean).slice(0, 50),
    mailboxCompanyId: clean(email.mailboxCompanyId),
  })).digest('hex')
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
    .select('id,company_id,request_id,resolution_status,customer_id,customer_site_id,metering_point_id,intent,business_process,processing_state,received_at,extracted_payload,from_email,subject,body_text,body_html,attachments,correlation_evidence,in_reply_to,thread_id,reference_message_ids,mailbox_company_id')
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
  collisionWithId?: string
}): Promise<{ inboundId: string; existing: JsonRecord | null; receivedAt: string; quarantined?: boolean }> {
  const fingerprint = sourceFingerprint(input.email)
  let legacyUpgradeAttempts = 0
  const resumeExisting = async (existing: JsonRecord): Promise<{ inboundId: string; existing: JsonRecord | null; receivedAt: string; quarantined?: boolean }> => {
    const stored = existing.extracted_payload as JsonRecord | null
    const original: ManualInboundEmail = { fromEmail: clean(existing.from_email),
      subject: clean(existing.subject), bodyText: clean(existing.body_text), bodyHtml: clean(existing.body_html), attachments: existing.attachments as unknown[] }
    const storedFingerprint = clean(stored?.source_fingerprint) ?? legacySourceFingerprint(original)
    const previousProof = record(stored?.sender_verification)
    const previousRaw = clean(previousProof.raw_sha256)
    const originalReply = clean(existing.in_reply_to ?? existing.thread_id)
    const originalReferences = Array.isArray(existing.reference_message_ids) ? existing.reference_message_ids : []
    const originalMailboxCompany = clean(existing.mailbox_company_id)
    const legacyMatch = stored?.source_fingerprint_version !== 2 && storedFingerprint === legacySourceFingerprint(input.email)
      && (previousProof.status === 'verified'
        ? input.email.senderVerification?.status === 'verified' && previousRaw === input.email.senderVerification.raw_sha256
        : originalReply === clean(input.email.inReplyTo ?? input.email.threadId)
          && JSON.stringify(originalReferences) === JSON.stringify((input.email.references ?? []).filter(Boolean).slice(0, 50)))
      && (!originalReply || originalReply === clean(input.email.inReplyTo ?? input.email.threadId))
      && JSON.stringify(originalReferences) === JSON.stringify((input.email.references ?? []).filter(Boolean).slice(0, 50))
      && originalMailboxCompany === clean(input.email.mailboxCompanyId)
    if (storedFingerprint !== fingerprint && !legacyMatch) {
      // An RFC Message-ID is sender-controlled. Preserve both originals, and
      // quarantine a collision without rewriting the already processed source.
      const collisionKey = createHash('sha256').update(`${input.providerMessageId}:${fingerprint}`).digest('hex')
      return persistRawInbound({ ...input, providerMessageId: `collision:${collisionKey}`, collisionWithId: String(existing.id) })
    }
    if (legacyMatch) {
      if (++legacyUpgradeAttempts > 3) throw new Error('manual_mail_source_changed')
      const payload = { ...record(stored), source_fingerprint: fingerprint, source_fingerprint_version: 2 }
      const upgraded = await supabaseService.from('manual_inbound_messages').update({ extracted_payload: payload })
        .eq('id', String(existing.id)).eq('extracted_payload', JSON.stringify(record(stored))).select('id').maybeSingle()
      if (upgraded.error) throw upgraded.error
      if (!upgraded.data) {
        const current = await findExistingInbound({ mailbox: input.mailbox, providerMessageId: input.providerMessageId! })
        if (!current) throw new Error('manual_mail_source_changed')
        return resumeExisting(current)
      }
      existing = { ...existing, extracted_payload: payload }
    }
    return { inboundId: String(existing.id), existing, receivedAt: clean(existing.received_at) ?? new Date().toISOString(),
      quarantined: Boolean(input.collisionWithId || (existing.correlation_evidence as JsonRecord | null)?.source_collision) }
  }
  if (input.providerMessageId) {
    const existing = await findExistingInbound({ mailbox: input.mailbox, providerMessageId: input.providerMessageId })
    if (existing) return resumeExisting(existing)
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
      extracted_payload: { source_fingerprint: fingerprint, source_fingerprint_version: 2, ...(input.email.mimeRequiresReview === true ? { mime_requires_review: true } : {}) },
      confidence_score: 0,
      correlation_evidence: input.collisionWithId ? { source_collision: true, collision_with_id: input.collisionWithId } : {},
      processing_state: input.collisionWithId ? 'needs_review' : 'received',
      received_at: new Date().toISOString(),
    })
    .select('id,received_at')
    .maybeSingle()

  if (insert.error) {
    if (String(insert.error.code) === '23505' && input.providerMessageId) {
      const existing = await findExistingInbound({ mailbox: input.mailbox, providerMessageId: input.providerMessageId })
      if (existing) return resumeExisting(existing)
    }
    throw insert.error
  }
  if (!insert.data?.id) throw new Error('Inkommande e-post kunde inte persisteras före korrelation.')
  return { inboundId: String(insert.data.id), existing: null, receivedAt: clean(insert.data.received_at) ?? new Date().toISOString(), quarantined: Boolean(input.collisionWithId) }
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

const NON_TERMINAL_PROCESSING_STATES = new Set(['received', 'normalized', 'matched'])

function isReprocessable(existing: JsonRecord): boolean {
  if (clean(existing.resolution_status) === 'unmatched') return true
  const state = clean(existing.processing_state)
  return state === null || NON_TERMINAL_PROCESSING_STATES.has(state)
}

function retiredSourceResult(caseReference: string | null): ManualInboundResult {
  return {
    inboundId: null,
    resolutionStatus: 'ignored',
    reason: 'retired_source',
    requestId: null,
    caseReference,
    companyId: null,
    processingState: 'ignored_retired_source',
    parse: null,
  }
}

function isRetiredSourceInsertError(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && 'code' in error && error.code === '23514'
    && 'message' in error && error.message === 'manual_inbound_source_retired'
}

export async function ingestManualInboundEmail(email: ManualInboundEmail): Promise<ManualInboundResult> {
  await assertPlatformSchemaReady()

  const mailbox = normalizeEmail(email.mailbox ?? email.toEmail) ?? ''
  const providerMessageId = clean(email.providerMessageId)
  const verifiedSender = email.senderVerification?.status === 'verified'
    && email.senderVerification.version === 1 && email.senderVerification.method === 'dkim'
    && normalizeEmail(email.senderVerification.from_email) === normalizeEmail(email.fromEmail)
    && email.senderVerification.signing_domain === normalizeEmail(email.fromEmail)?.split('@')[1]
    && /^[a-f0-9]{64}$/.test(email.senderVerification.raw_sha256)
    && email.senderVerification.signed_headers.includes('from')
  const signed = (header: string) => verifiedSender && email.senderVerification!.signed_headers.includes(header)
  const correlationEmail: ManualInboundEmail = verifiedSender ? { ...email,
    subject: signed('subject') ? email.subject : null, toEmail: null,
    threadId: signed('in-reply-to') ? email.inReplyTo ?? null : null,
    inReplyTo: signed('in-reply-to') ? email.inReplyTo ?? null : null,
    references: signed('references') ? email.references ?? [] : [],
  } : email
  const caseReference = extractCaseReference(correlationEmail)
  if (providerMessageId) {
    const { data: retired, error } = await supabaseService.rpc('gridex_manual_inbound_source_retired_v1', {
      p_mailbox: mailbox,
      p_provider_id: providerMessageId,
    })
    if (error) throw error
    if (typeof retired !== 'boolean') throw new Error('Invalid manual inbound source retirement result')
    if (retired) return retiredSourceResult(caseReference)
  }

  let raw: Awaited<ReturnType<typeof persistRawInbound>>
  try {
    raw = await persistRawInbound({ email, mailbox, providerMessageId })
  } catch (error) {
    // A delete may retire this exact key after the lookup. The insert guard
    // protects that race; only its explicit signal is safe to acknowledge.
    if (isRetiredSourceInsertError(error)) return retiredSourceResult(caseReference)
    throw error
  }

  if (raw.quarantined) return { inboundId: raw.inboundId, resolutionStatus: 'unmatched', requestId: null,
    caseReference, companyId: null, customerId: null, customerSiteId: null, meteringPointId: null, processingState: 'needs_review', parse: null }

  // A terminal correlation is idempotent. Unmatched rows are intentionally
  // re-evaluated because new tenant/customer masterdata may have arrived since
  // the first attempt, and so is a row whose processing never reached a
  // terminal state (e.g. matched, but applying the response threw). Every step
  // below is an idempotent update/upsert keyed by the inbound row.
  if (raw.existing && !isReprocessable(raw.existing)) {
    const automation = record(record(raw.existing.extracted_payload).manual_automation)
    if (automation.multi_site && raw.existing.company_id && raw.existing.customer_id && raw.existing.request_id) {
      const { continueManualMultiSiteReply } = await import('@/lib/inbound-mail/manualMultiSiteReply')
      await continueManualMultiSiteReply({ companyId: String(raw.existing.company_id), customerId: String(raw.existing.customer_id),
        parentRequestId: String(raw.existing.request_id), inboundId: raw.inboundId })
    } else if (raw.existing.processing_state === 'applied' && raw.existing.company_id && raw.existing.customer_id
      && raw.existing.customer_site_id && raw.existing.request_id) {
      await continueManualCommercialReply({ inboundId: raw.inboundId, companyId: String(raw.existing.company_id),
        customerId: String(raw.existing.customer_id), siteId: String(raw.existing.customer_site_id), requestId: String(raw.existing.request_id) })
    }
    return resultFromExisting(raw.existing, caseReference)
  }

  // Auto-replies (out-of-office, bulk, delivery reports) quote the case
  // reference but are no answer: classify before anything is applied so the
  // request keeps waiting for the real response.
  const autoReply = autoReplyReason(email.autoReplyHeaders)
  if (autoReply) {
    const ignoredUpdate = await supabaseService
      .from('manual_inbound_messages')
      .update({
        resolution_status: 'ignored',
        processing_state: 'ignored',
        intent: 'auto_reply',
        correlation_evidence: { classification: 'ignored_auto_reply', auto_reply_reason: autoReply, case_reference: caseReference },
      })
      .eq('id', raw.inboundId)
      .select('id')
      .maybeSingle()
    if (ignoredUpdate.error) throw ignoredUpdate.error
    return {
      inboundId: raw.inboundId,
      resolutionStatus: 'ignored',
      requestId: null,
      caseReference,
      companyId: null,
      intent: 'auto_reply',
      processingState: 'ignored_auto_reply',
      parse: null,
    }
  }

  const normalizedText = buildNormalizedManualInboundText(correlationEmail)
  const htmlReply = stripQuotedManualReplyHtml(clean(email.bodyHtml) ?? '')
  const replyText = clean(email.bodyText) ?? stripHtml(htmlReply.html)
  const authoredBody = authoredManualReply(replyText)
  let authoredText = authoredBody
  const authoredHtml = authoredManualReply(stripHtml(htmlReply.html))
  const comparable = (value: string) => value.normalize('NFKC').replace(/[\s\p{P}\p{Z}]/gu, '').toLowerCase()
  const alternativesDisagree = Boolean(clean(email.bodyText) && clean(email.bodyHtml)
    && comparable(authoredBody) !== comparable(authoredHtml))
  let sourceStructureRequiresReview = email.mimeRequiresReview === true
    || (raw.existing?.extracted_payload as JsonRecord | null)?.mime_requires_review === true
    || (Boolean(clean(email.bodyHtml)) && htmlReply.requiresReview)
    || alternativesDisagree
    || authoredManualReplyRequiresReview(replyText)
  const documentReasons: string[] = []
  const documents = await prepareManualMailDocuments(email.attachments ?? [])
  const documentUnits: ManualDocumentUnit[] = [...documents.units]
  const hasDocuments = (email.attachments?.length ?? 0) > 0
  if (documents.status !== 'completed') documentReasons.push(...documents.reasons)
  if (documents.status === 'completed' && documents.visuals.length) {
    const eligible = verifiedSender && !sourceStructureRequiresReview && await isVerifiedManualDocumentSender({ fromEmail: email.fromEmail, senderVerification: email.senderVerification })
    if (!eligible) documentReasons.push('document_sender_unverified')
    else {
      const fingerprint = sourceFingerprint(email)
      const previous = await mergeManualEvidence(raw.inboundId, fingerprint, (payload) => {
        const automation = record(payload.manual_automation)
        return { ...payload, sender_verification: email.senderVerification, manual_automation: { ...automation,
          version: 1, sourceHash: automation.sourceHash ?? createHash('sha256').update(authoredBody).digest('hex'),
          documentEligibility: { eligible: true, raw_sha256: email.senderVerification!.raw_sha256 } } }
      })
      const savedContext = record(record(record(previous.manual_automation).documentReading).context)
      // A pre-correlation transcription retains its original all-null context
      // after canonical assignment. Restoration cannot reserve another call.
      const hasSavedContext = Object.hasOwn(savedContext, 'company_id')
      const context = hasSavedContext ? savedContext : {
        company_id: raw.existing?.company_id ?? null, customer_id: raw.existing?.customer_id ?? null, request_id: raw.existing?.request_id ?? null,
      }
      const completeContext = [context.company_id, context.customer_id, context.request_id].every(value => typeof value === 'string')
      const reading = await recordManualMailDocumentReading({ inboundId: raw.inboundId,
        companyId: completeContext ? String(context.company_id) : null,
        customerId: completeContext ? String(context.customer_id) : null, requestId: completeContext ? String(context.request_id) : null,
        authoredText: authoredBody, senderCredible: true, rawSourceHash: email.senderVerification!.raw_sha256,
        sourceFingerprint: fingerprint, extractorVersion: documents.extractorVersion, manifest: documents.manifest, visuals: documents.visuals })
      if (reading?.status === 'completed') documentUnits.push(...reading.units.filter(unit => unit.text.trim()))
      else {
        const state = record(record(record(previous.manual_automation).documentReading))
        if (!reading && state.status === 'processing') throw new Error('manual_mail_document_reading_in_progress')
        documentReasons.push(`document_reading_${reading?.status === 'failed' || reading?.status === 'skipped' ? reading.reason : 'unavailable'}`)
      }
    }
  }
  const bodyFacilityCount = new Set(authoredBody.match(/(?<!\d)\d{18}(?!\d)/g) ?? []).size
  const corpus = (hasDocuments || bodyFacilityCount > 0) && documents.status === 'completed' && documentReasons.length === 0
    ? createManualMailSourceCorpus(authoredBody, documentUnits, documents.manifest, documents.extractorVersion) : undefined
  if (corpus?.ok) authoredText = corpus.text
  else if (corpus) documentReasons.push(...corpus.reasons)
  if (documentReasons.length) sourceStructureRequiresReview = true
  const replyAssessment = assessManualReply(authoredBody, clean(correlationEmail.subject))
  let extracted = extractManualFacilityFields(authoredText)
  const identity = extractManualCustomerIdentityHints(authoredText)
  extracted = { ...extracted, ...identity.hints }
  const sourceHash = corpus?.ok ? corpus.sourceHash : createHash('sha256').update(authoredText).digest('hex')
  const confidence = scoreManualFacilityPayload(extracted)
  const correlationInput = {
    email: {
      mailbox, mailboxCompanyId: clean(email.mailboxCompanyId), fromEmail: clean(email.fromEmail), toEmail: clean(correlationEmail.toEmail),
      threadId: clean(correlationEmail.threadId), inReplyTo: clean(correlationEmail.inReplyTo ?? correlationEmail.threadId),
      references: correlationEmail.references ?? [],
    }, caseReference, normalizedText, extracted,
  }
  let correlation = await resolveManualInboundCorrelation(correlationInput)
  const originalCorrelation = correlation
  let multiSiteParent: JsonRecord | null = null
  // Every readable authenticated reply passes the same identity guard before
  // assignment. Unhandled labels and bare identifiers must not bypass it by
  // failing the older field extractor and falling back to stale thread data.
  const documentRouting = verifiedSender && !documentReasons.length
    ? await resolveManualDocumentRouting({ email: correlationInput.email, caseReference, authoredText: authoredBody,
      units: corpus?.ok ? corpus.catalog.filter(entry => entry.origin !== 'body').map(entry => ({
        attachmentId: entry.attachmentId!, sha256: entry.sha256!, origin: entry.origin as ManualDocumentUnit['origin'],
        locator: `${entry.locator}:paragraph:${entry.part}`, text: entry.text,
      })) : [] }) : undefined
  if (documentRouting) {
    if (documentRouting.resolutionStatus === 'matched' && (documentRouting.sites.length > 1
      || Boolean(documentRouting.request && documentRouting.sites[0]?.customerSiteId !== documentRouting.request.customer_site_id))) {
      const original = documentRouting.request ?? originalCorrelation.request
      if ((documentRouting.request ? documentRouting.senderCredible : originalCorrelation.senderCredible) && original?.company_id === documentRouting.companyId && original.customer_id === documentRouting.customerId) multiSiteParent = original
      else {
        const candidate = Array.isArray(documentRouting.evidence.site_requests) ? record(documentRouting.evidence.site_requests[0]) : {}
        if (typeof candidate.requestId === 'string' && documentRouting.companyId) {
          const found = await tenantSelect(documentRouting.companyId, 'grid_owner_information_requests').eq('id', candidate.requestId)
            .eq('customer_id', documentRouting.customerId!).maybeSingle()
          if (found.error) throw found.error
          multiSiteParent = found.data ? record(found.data) : null
        }
      }
    }
    const oneSite = documentRouting.sites.length === 1 ? documentRouting.sites[0] : null
    correlation = { ...correlation, resolutionStatus: documentRouting.resolutionStatus,
      companyId: documentRouting.companyId, customerId: documentRouting.customerId,
      requestId: clean(multiSiteParent?.id) ?? documentRouting.requestId, request: multiSiteParent ?? documentRouting.request,
      customerSiteId: clean(multiSiteParent?.customer_site_id) ?? oneSite?.customerSiteId ?? null, meteringPointId: null,
      gridOwnerId: clean((multiSiteParent ?? documentRouting.request)?.grid_owner_id), senderCredible: documentRouting.senderCredible,
      tenantResolutionMethod: 'canonical_document_identity', entityResolutionMethod: 'canonical_document_site',
      evidence: { ...documentRouting.evidence, document_review_reasons: documentRouting.reasons } }
    documentReasons.push(...documentRouting.reasons)
    if (documentRouting.resolutionStatus === 'matched' && documentRouting.senderCredible
      && Array.isArray(documentRouting.evidence.sender_organization_numbers)
      && documentRouting.evidence.sender_organization_numbers.length) {
      // Routing has classified these only after matching the current sender's
      // verified actor and a signature boundary. Keep the complete text, but
      // do not submit the sender's organisation as the customer's identifier.
      const typed = [
        ...(Array.isArray(documentRouting.evidence.body_identifiers) ? documentRouting.evidence.body_identifiers : []),
        ...(Array.isArray(documentRouting.evidence.document_identifiers)
          ? documentRouting.evidence.document_identifiers.flatMap(value => Array.isArray(record(value).identifiers) ? record(value).identifiers as unknown[] : []) : []),
      ].map(record)
      const organizations = new Set(typed.filter(value => value.kind === 'org_number').map(value => clean(value.value)).filter(Boolean))
      delete identity.hints.org_number
      delete extracted.org_number
      if (organizations.size === 1) {
        identity.hints.org_number = [...organizations][0]!
        extracted.org_number = identity.hints.org_number
      }
      if (['org_number', 'personal_number', 'customer_identity_number'].every(kind => new Set(typed.filter(value => value.kind === kind).map(value => value.value)).size <= 1)) {
        identity.reasons = identity.reasons.filter(reason => reason !== 'multiple_customer_identities')
      }
    }
  }

  if (!verifiedSender || !correlation.senderCredible || sourceStructureRequiresReview || documentReasons.length > 0) {
    // Tenant-readable originals require a complete, authenticated and credible
    // customer correlation. An unread attachment may concern another customer
    // even when the signed subject still names an old request.
    correlation = { ...correlation, resolutionStatus: correlation.resolutionStatus === 'ignored' ? 'ignored'
      : correlation.resolutionStatus === 'ambiguous' || sourceStructureRequiresReview ? 'ambiguous' : 'unmatched',
      evidence: { ...correlation.evidence, unverified_candidate: { companyId: correlation.companyId, customerId: correlation.customerId,
        requestId: correlation.requestId, customerSiteId: correlation.customerSiteId },
      source_review_reasons: [...documentReasons, ...(!verifiedSender ? ['sender_not_authenticated'] : []),
        ...(!correlation.senderCredible ? ['sender_not_credible'] : []), ...(sourceStructureRequiresReview ? ['manual_reply_structure_incomplete'] : [])] },
      companyId: null, customerId: null, requestId: null, request: null, customerSiteId: null,
      meteringPointId: null, gridOwnerId: null, senderCredible: false }
  }
  let baseProcessingState = correlation.resolutionStatus === 'matched'
    ? 'matched'
    : correlation.resolutionStatus === 'ignored'
      ? 'ignored'
      : correlation.resolutionStatus

  // Unverified entity hints stay in correlation_evidence, not tenant-readable
  // foreign keys or operational event attribution.
  let matched = correlation.resolutionStatus === 'matched'
  let companyId = matched ? correlation.companyId : null
  let requestId = matched ? correlation.requestId : null
  let customerId = matched ? correlation.customerId : null
  let customerSiteId = matched ? correlation.customerSiteId : null
  let meteringPointId = matched ? correlation.meteringPointId : null
  let gridOwnerId = matched ? correlation.gridOwnerId : null
  const identityReasons = [...identity.reasons]
  if (matched && companyId && customerId && Object.keys(identity.hints).length > 0) {
    const customer = await tenantSelect(companyId, 'customers', 'id,company_id,personal_number,org_number')
      .eq('id', customerId).maybeSingle()
    if (customer.error) throw customer.error
    const row = customer.data as JsonRecord | null
    if (!row || row.id !== customerId || row.company_id !== companyId || !manualCustomerIdentityMatches(identity.hints, row)) identityReasons.push('customer_identity_mismatch')
  }
  if (identityReasons.length) {
    // Conflicting identity is never persisted under the subject's tenant.
    matched = false
    companyId = requestId = customerId = customerSiteId = meteringPointId = gridOwnerId = null
    correlation = { ...correlation, resolutionStatus: 'ambiguous', companyId: null, customerId: null,
      requestId: null, request: null, customerSiteId: null, meteringPointId: null, gridOwnerId: null,
      senderCredible: false, evidence: { ...correlation.evidence, customer_identity_review_reasons: identityReasons } }
    baseProcessingState = 'ambiguous'
  }
  const multiSite = Boolean(multiSiteParent && documentRouting?.resolutionStatus === 'matched')
  const sourceRequiresReview = sourceStructureRequiresReview || identityReasons.length > 0
  const counterpartyReply = matched && verifiedSender && !sourceRequiresReview && correlation.senderCredible && correlation.request && companyId ? replyAssessment : null
  if (counterpartyReply) {
    correlation.intent = counterpartyReply.intent
    correlation.evidence = { ...correlation.evidence, counterparty_reply: counterpartyReply }
  }

  const correlationUpdate = await supabaseService
    .from('manual_inbound_messages')
    .update({
      company_id: companyId,
      request_id: requestId,
      mailbox_company_id: clean(email.mailboxCompanyId),
      in_reply_to: clean(email.inReplyTo ?? email.threadId),
      reference_message_ids: Array.isArray(email.references) ? email.references.filter(Boolean).slice(0, 50) : [],
      grid_owner_id: gridOwnerId,
      customer_id: customerId,
      customer_site_id: customerSiteId,
      metering_point_id: meteringPointId,
      tenant_resolution_method: correlation.tenantResolutionMethod,
      entity_resolution_method: correlation.entityResolutionMethod,
      correlation_evidence: correlation.evidence,
      normalized_text: normalizedText,
      business_process: correlation.businessProcess,
      intent: correlation.intent,
      processing_state: baseProcessingState,
      resolution_status: correlation.resolutionStatus,
      confidence_score: confidence,
    })
    .eq('id', raw.inboundId)
    .in('processing_state', ['received', 'normalized', 'matched', 'unmatched', 'ambiguous'])
    .select('id')
    .maybeSingle()
  if (correlationUpdate.error) throw correlationUpdate.error
  if (!correlationUpdate.data) {
    const latest = await supabaseService.from('manual_inbound_messages').select('*').eq('id', raw.inboundId).maybeSingle()
    if (latest.error) throw latest.error
    if (!latest.data) throw new Error('manual_inbound_concurrent_change')
    return resultFromExisting(latest.data as JsonRecord, caseReference)
  }

  // Derived stages are merged with compare-and-swap, preserving immutable
  // originals and the append-only transcription/semantic reading namespaces.
  await mergeManualEvidence(raw.inboundId, sourceFingerprint(email), (payload) => ({
    ...payload, ...extracted, sender_credible: correlation.senderCredible, reply_assessment: replyAssessment,
    mime_requires_review: email.mimeRequiresReview === true,
    manual_reply_structure_requires_review: sourceStructureRequiresReview,
    customer_identity_review_reasons: identityReasons,
    sender_verification: verifiedSender ? email.senderVerification : { status: 'unverified', reason: 'sender_not_authenticated' },
    manual_automation: { ...record(payload.manual_automation), version: 1, sourceHash,
      ...(corpus?.ok || hasDocuments ? { documentSources: { status: documentReasons.length ? 'needs_review' : 'completed',
        sourceVersion: 2, manifest: documents.manifest, extractorVersion: documents.extractorVersion,
        ...(corpus?.ok ? { manifestHash: corpus.manifestHash, catalog: corpus.catalog } : {}), reasons: documentReasons } } : {}),
    },
  }))

  // A trusted deterministic rejection/completion already selects the hold
  // branch below. Its result never depends on a paid reading or its recovery.
  let reading = !counterpartyReply && matched && companyId && customerId && requestId
    ? await recordManualMailAiReading({ inboundId: raw.inboundId, companyId, customerId, requestId,
      senderCredible: verifiedSender && !sourceRequiresReview && correlation.senderCredible, authoredText, multiSite, ...(corpus?.ok ? { sourceCorpus: corpus } : {}) }) : undefined
  const aiRequired = !counterpartyReply && matched && verifiedSender && !sourceRequiresReview && correlation.senderCredible && process.env.MANUAL_MAIL_AI_ENABLED === '1'
  if (aiRequired && !reading && companyId && customerId && requestId) {
    const pending = await supabaseService.from('manual_inbound_messages').select('extracted_payload')
      .eq('id', raw.inboundId).eq('company_id', companyId).eq('customer_id', customerId).eq('request_id', requestId).maybeSingle()
    if (pending.error) throw pending.error
    const saved = (pending.data?.extracted_payload as JsonRecord | null)?.ai_read_only as JsonRecord | undefined
    if (saved?.status === 'processing') throw new Error('manual_mail_reading_in_progress')
    if (saved?.status === 'completed') reading = await recordManualMailAiReading({ inboundId: raw.inboundId,
      companyId, customerId, requestId, senderCredible: true, authoredText, multiSite, ...(corpus?.ok ? { sourceCorpus: corpus } : {}) })
  }
  const interpretation = interpretManualMail({ authoredText, extracted, reading, documentSources: corpus?.ok === true,
    canonicalCustomerIdentity: documentRouting?.resolutionStatus === 'matched' && identityReasons.length === 0 })
  if (sourceStructureRequiresReview) interpretation.reasons.push('manual_reply_structure_incomplete')
  interpretation.reasons.push(...identityReasons, ...documentReasons)
  if (aiRequired && reading?.status !== 'completed') interpretation.reasons.push('ai_reading_unavailable')
  extracted = interpretation.extracted
  const facilityFacts = normalizeManualFacilityFacts({ extracted, authoredText })

  const fingerprint = operationFingerprint({
    companyId,
    businessProcess: correlation.businessProcess,
    requestId,
    customerSiteId,
    facilityId: clean(extracted.facility_id),
    meteringPointValue: clean(extracted.metering_point_id),
  })

  await upsertInboundOperationEvent({
    inboundId: raw.inboundId,
    companyId,
    resolutionStatus: correlation.resolutionStatus,
    tenantResolutionMethod: correlation.tenantResolutionMethod,
    businessProcess: correlation.businessProcess,
    intent: correlation.intent,
    intentConfidence: correlation.intentConfidence,
    gridOwnerId,
    customerId,
    customerSiteId,
    meteringPointId,
    requestId,
    processingState: baseProcessingState,
    evidence: correlation.evidence,
    businessEventFingerprint: fingerprint,
  })

  let parse: ManualFacilityParseResult | null = null
  let processingState = documentReasons.length || identityReasons.length || sourceStructureRequiresReview || !verifiedSender || !correlation.senderCredible ? 'needs_review' : baseProcessingState
  const requestType = clean(correlation.request?.request_type)
  const canApplyFacilityResponse = correlation.resolutionStatus === 'matched'
    && correlation.request
    && correlation.companyId
    && correlation.senderCredible
    && requestType !== null
    && FACILITY_REQUEST_TYPES.has(requestType)

  if (counterpartyReply && correlation.request && correlation.companyId) {
    await recordManualCounterpartyReply({ companyId: correlation.companyId, request: correlation.request, inboundId: raw.inboundId, assessment: counterpartyReply })
    processingState = 'needs_review'
  } else if (matched && !verifiedSender) {
    // An unauthenticated message is visible for review but has no authority to
    // stop an existing conversation, spend an inference or mutate customer data.
    processingState = 'needs_review'
  } else if (multiSite && matched && correlation.request && companyId && customerId && documentRouting && corpus?.ok) {
    // One reading covers the complete source. Only server-partitioned source
    // paragraphs may contribute fields to each canonical facility.
    const groups = documentRouting.sites.map((site) => {
      const siteBody = site.bodyText ?? ''
      const bodyParagraphs = new Set(siteBody.split(/\n\s*\n/).map(value => value.trim()).filter(Boolean))
      const sources = new Set(corpus.catalog.filter(entry => entry.origin === 'body' ? bodyParagraphs.has(entry.text)
        : site.units.some(unit => unit.attachmentId === entry.attachmentId && unit.sha256 === entry.sha256
          && unit.locator === `${entry.locator}:paragraph:${entry.part}` && unit.text === entry.text)).map(entry => entry.source))
      const siteText = [siteBody, ...site.units.map(unit => unit.text)].filter(Boolean).join('\n\n')
      const siteReading = reading?.status === 'completed' ? { ...reading,
        fields: reading.fields.filter(field => field.source !== undefined && sources.has(field.source)),
        // This qualifier describes the already verified partition, rather
        // than a condition on any facility. Other qualifiers remain holds.
        review_reasons: reading.review_reasons.filter(reason => reason !== 'multiple_facilities'),
      } : undefined
      const interpreted = interpretManualMail({ authoredText: siteText, extracted: extractManualFacilityFields(siteText),
        reading: siteReading, documentSources: true, canonicalCustomerIdentity: true })
      const requestEvidence = Array.isArray(documentRouting.evidence.site_requests)
        ? documentRouting.evidence.site_requests.map(record).find(row => row.customerSiteId === site.customerSiteId) : undefined
      return { facilityId: site.facilityId ?? '', requestId: clean(requestEvidence?.requestId) ?? undefined,
        meteringPointId: clean(interpreted.extracted.metering_point_id) ?? undefined,
        extracted: interpreted.extracted, authoredText: siteText,
        evidence: { sources: [...sources], originalSourceHash: sourceHash },
        reasons: [...interpreted.reasons, ...documentReasons, ...identityReasons,
          ...(sourceStructureRequiresReview ? ['manual_reply_structure_incomplete'] : []),
          ...(aiRequired && reading?.status !== 'completed' ? ['ai_reading_unavailable'] : []),
          ...(!correlation.senderCredible ? ['sender_not_credible'] : [])],
      }
    })
    const { applyManualMultiSiteReply } = await import('@/lib/inbound-mail/manualMultiSiteReply')
    const result = await applyManualMultiSiteReply({ companyId, customerId, parentRequest: correlation.request,
      inboundId: raw.inboundId, sourceHash, receivedAt: raw.receivedAt, groups })
    processingState = result.outcome
    parse = { outcome: result.outcome, confidence: result.reviewCount ? 0 : 1, extracted: {},
      reasons: result.reviewCount ? ['multi_site_items_require_review'] : [] }
  } else if (matched && correlation.request && companyId && (!correlation.senderCredible || interpretation.reasons.length > 0
    || (canApplyFacilityResponse && !facilityFacts.ok))) {
    const reasons = [...(!verifiedSender ? ['sender_not_authenticated'] : []), ...(!correlation.senderCredible ? ['sender_not_credible'] : []),
      ...interpretation.reasons, ...(canApplyFacilityResponse ? facilityFacts.reasons : [])]
    await reviewManualReply({ companyId, request: correlation.request, inboundId: raw.inboundId, extracted, reasons })
    processingState = 'needs_review'
  } else if (matched && correlation.request && companyId && customerId && customerSiteId
    && requestType === 'current_supplier_contract_information_request') {
    parse = await applyManualCommercialReply({ companyId, customerId, siteId: customerSiteId, request: correlation.request,
      inboundId: raw.inboundId, extracted, authoredText, receivedAt: raw.receivedAt, sourceHash })
    processingState = parse.outcome
  } else if (canApplyFacilityResponse && correlation.request && correlation.companyId) {
    try {
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
        automaticInbound: { inboundId: raw.inboundId, sourceHash, facts: facilityFacts.facts },
      })
    } catch (error) {
      if (customerId && customerSiteId && requestId) {
        try {
          await markManualReplyContinuationFailed({ companyId: correlation.companyId, customerId,
            siteId: customerSiteId, requestId, inboundId: raw.inboundId })
        } catch { /* Keep the original error and canonical retry if storage is unavailable. */ }
      }
      throw error
    }

    processingState = parse.outcome === 'applied' ? 'applied' : 'needs_review'
    // The canonical completion command owns completed/needs_review request
    // state. Only the inbound processing projection is finalized here.
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
      .in('processing_state', processingState === 'applied'
        ? ['received', 'normalized', 'matched', 'applied'] : ['received', 'normalized', 'matched', 'unmatched', 'ambiguous'])
      .select('id')
      .maybeSingle()
    if (stateUpdate.error) throw stateUpdate.error
    if (!stateUpdate.data) {
      const latest = await supabaseService.from('manual_inbound_messages').select('*').eq('id', raw.inboundId).maybeSingle()
      if (latest.error) throw latest.error
      if (!latest.data) throw new Error('manual_inbound_concurrent_change')
      return resultFromExisting(latest.data as JsonRecord, caseReference)
    }

    await upsertInboundOperationEvent({
      inboundId: raw.inboundId,
      companyId,
      resolutionStatus: correlation.resolutionStatus,
      tenantResolutionMethod: correlation.tenantResolutionMethod,
      businessProcess: correlation.businessProcess,
      intent: correlation.intent,
      intentConfidence: correlation.intentConfidence,
      gridOwnerId,
      customerId,
      customerSiteId,
      meteringPointId,
      requestId,
      processingState,
      evidence: { ...correlation.evidence, parse_outcome: parse?.outcome ?? null },
      businessEventFingerprint: fingerprint,
    })
  }

  return {
    inboundId: raw.inboundId,
    resolutionStatus: correlation.resolutionStatus,
    requestId,
    caseReference,
    companyId,
    customerId,
    customerSiteId,
    meteringPointId,
    intent: correlation.intent,
    businessProcess: correlation.businessProcess,
    processingState,
    parse,
  }
}
