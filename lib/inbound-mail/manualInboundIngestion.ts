// lib/inbound-mail/manualInboundIngestion.ts
//
// Ingests inbound replies for the manual (non-Ediel) grid-owner pipeline. Can be
// driven by a provider webhook or an IMAP poll. It stores every reply in
// manual_inbound_messages, matches it to a request by case_reference (subject /
// body / plus-address), resolves the tenant FROM THE REQUEST (never the mailbox),
// verifies the sender, and — only when safe — applies the parsed facility data.

import { supabaseService } from '@/lib/supabase/service'
import {
  extractManualFacilityFields,
  scoreManualFacilityPayload,
  applyManualFacilityResponse,
  type ManualFacilityParseResult,
} from '@/lib/customer-operations/manualFacilityResponseParser'

type JsonRecord = Record<string, unknown>

export type ManualInboundEmail = {
  mailbox?: string | null
  fromEmail?: string | null
  fromName?: string | null
  toEmail?: string | null
  subject?: string | null
  bodyText?: string | null
  bodyHtml?: string | null
  providerMessageId?: string | null
  threadId?: string | null
  attachments?: unknown[]
}

export type ManualInboundResult = {
  inboundId: string | null
  resolutionStatus: 'matched' | 'ambiguous' | 'unmatched' | 'ignored'
  requestId: string | null
  caseReference: string | null
  parse?: ManualFacilityParseResult | null
}

const CASE_REFERENCE_RE = /GX-FIR-[A-Z0-9]{6,12}/i

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function missingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist/i.test(message)
}

export function extractCaseReference(email: ManualInboundEmail): string | null {
  // Prefer the subject (templates keep the case reference there), then plus-
  // address (reply+GX-FIR-XXXX@...), then the body.
  const candidates = [clean(email.subject), clean(email.toEmail), clean(email.bodyText), clean(email.bodyHtml)]
  for (const candidate of candidates) {
    if (!candidate) continue
    const match = candidate.match(CASE_REFERENCE_RE)
    if (match) return match[0].toUpperCase()
  }
  return null
}

function domainOf(email: string | null): string | null {
  if (!email) return null
  const at = email.lastIndexOf('@')
  return at >= 0 ? email.slice(at + 1).toLowerCase() : null
}

async function isSenderCredible(input: {
  companyId: string
  gridOwnerId: string | null
  recipientEmail: string | null
  fromEmail: string | null
}): Promise<boolean> {
  const from = clean(input.fromEmail)?.toLowerCase() ?? null
  if (!from) return false
  // Direct match to the address we wrote to.
  if (clean(input.recipientEmail)?.toLowerCase() === from) return true

  if (!input.gridOwnerId) return false
  const { data, error } = await supabaseService
    .from('grid_owner_contact_channels')
    .select('email,company_id,is_enabled')
    .eq('grid_owner_id', input.gridOwnerId)
    .eq('is_enabled', true)
    .or(`company_id.is.null,company_id.eq.${input.companyId}`)
  if (error) {
    if (missingSchema(error)) return false
    throw error
  }
  const rows = (data ?? []) as JsonRecord[]
  const fromDomain = domainOf(from)
  return rows.some((row) => {
    const channelEmail = clean(row.email)?.toLowerCase() ?? null
    if (!channelEmail) return false
    if (channelEmail === from) return true
    return Boolean(fromDomain) && domainOf(channelEmail) === fromDomain
  })
}

async function findRequestByCaseReference(caseReference: string): Promise<JsonRecord | null> {
  const { data, error } = await supabaseService
    .from('grid_owner_information_requests')
    .select('*')
    .eq('case_reference', caseReference)
    .limit(2)
  if (error) {
    if (missingSchema(error)) return null
    throw error
  }
  const rows = (data ?? []) as JsonRecord[]
  // case_reference is uniquely indexed; >1 means genuine ambiguity.
  if (rows.length !== 1) return null
  return rows[0]
}

export async function ingestManualInboundEmail(email: ManualInboundEmail): Promise<ManualInboundResult> {
  const subject = clean(email.subject)
  const bodyText = clean(email.bodyText) ?? clean(email.bodyHtml) ?? ''
  const providerMessageId = clean(email.providerMessageId)

  // Idempotency: do not double-ingest the same provider message.
  if (providerMessageId) {
    const existing = await supabaseService
      .from('manual_inbound_messages')
      .select('id,request_id,resolution_status')
      .eq('provider_message_id', providerMessageId)
      .maybeSingle()
    if (existing.data?.id) {
      return {
        inboundId: String(existing.data.id),
        resolutionStatus: (existing.data.resolution_status as ManualInboundResult['resolutionStatus']) ?? 'unmatched',
        requestId: clean(existing.data.request_id),
        caseReference: null,
        parse: null,
      }
    }
  }

  const caseReference = extractCaseReference(email)
  const request = caseReference ? await findRequestByCaseReference(caseReference) : null

  const extracted = extractManualFacilityFields(bodyText)
  const confidence = scoreManualFacilityPayload(extracted)

  // Tenant ALWAYS comes from the matched request, never from the mailbox.
  const companyId = request ? clean(request.company_id) : null
  const gridOwnerId = request ? clean(request.grid_owner_id) : null
  const recipientEmail = request ? clean(request.recipient_email) : null

  let resolutionStatus: ManualInboundResult['resolutionStatus']
  let senderCredible = false
  if (!caseReference || !request) {
    // No case reference / no unambiguous request -> never auto-apply.
    resolutionStatus = caseReference && !request ? 'ambiguous' : 'unmatched'
  } else {
    senderCredible = await isSenderCredible({
      companyId: companyId as string,
      gridOwnerId,
      recipientEmail,
      fromEmail: clean(email.fromEmail),
    })
    resolutionStatus = 'matched'
  }

  const insert = {
    company_id: companyId,
    request_id: request ? clean(request.id) : null,
    mailbox: clean(email.mailbox),
    from_email: clean(email.fromEmail),
    from_name: clean(email.fromName),
    to_email: clean(email.toEmail),
    subject,
    body_text: clean(email.bodyText),
    body_html: clean(email.bodyHtml),
    provider_message_id: providerMessageId,
    thread_id: clean(email.threadId),
    attachments: Array.isArray(email.attachments) ? email.attachments : [],
    resolution_status: resolutionStatus,
    extracted_payload: { ...extracted, sender_credible: senderCredible },
    confidence_score: confidence,
  }

  const inserted = await supabaseService
    .from('manual_inbound_messages')
    .insert(insert)
    .select('id')
    .maybeSingle()
  if (inserted.error && !missingSchema(inserted.error)) throw inserted.error
  const inboundId = clean(inserted.data?.id)

  // Mark response received on the request even before parsing/applying.
  if (request) {
    await supabaseService
      .from('grid_owner_information_requests')
      .update({ status: 'manual_response_received', received_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', request.id)
      .in('status', ['manual_email_queued', 'manual_email_sent', 'waiting_manual_response'])
      .then(() => undefined, () => undefined)
  }

  let parse: ManualFacilityParseResult | null = null
  if (resolutionStatus === 'matched' && request && companyId) {
    parse = await applyManualFacilityResponse({
      companyId,
      request,
      extracted,
      rawPayload: { subject, body_text: clean(email.bodyText), from_email: clean(email.fromEmail), provider_message_id: providerMessageId },
      senderCredible,
      source: 'manual_inbound_ingestion',
    })
  }

  return {
    inboundId,
    resolutionStatus,
    requestId: request ? clean(request.id) : null,
    caseReference,
    parse,
  }
}
