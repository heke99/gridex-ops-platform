import { supabaseService } from '@/lib/supabase/service'
import {
  extractManualFacilityFields,
  scoreManualFacilityPayload,
  applyManualFacilityResponse,
  type ManualFacilityParseResult,
} from '@/lib/customer-operations/manualFacilityResponseParser'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'

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

const CASE_REFERENCE_RE = /GX-FIR-[A-F0-9]{8,32}/i

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeEmail(value: unknown): string | null {
  return clean(value)?.toLowerCase() ?? null
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
        // Invalid attachment content is stored but never used for auto-apply.
      }
    }
  }
  return parts.join('\n')
}

export function extractCaseReference(email: ManualInboundEmail): string | null {
  const candidates = [clean(email.subject), clean(email.toEmail), clean(email.bodyText), clean(email.bodyHtml), attachmentText(email.attachments)]
  for (const candidate of candidates) {
    const match = candidate?.match(CASE_REFERENCE_RE)
    if (match) return match[0].toUpperCase()
  }
  return null
}

async function findRequestByCaseReference(caseReference: string): Promise<JsonRecord | null> {
  const { data, error } = await supabaseService
    .from('grid_owner_information_requests')
    .select('*')
    .eq('case_reference', caseReference)
    .in('status', ['manual_email_queued', 'manual_email_sent', 'waiting_manual_response', 'manual_response_received', 'needs_review'])
    .limit(2)
  if (error) throw error
  const rows = (data ?? []) as JsonRecord[]
  if (rows.length > 1) throw new Error('Case reference matchar flera nätägarärenden.')
  return rows[0] ?? null
}

async function isSenderCredible(input: {
  companyId: string
  gridOwnerId: string
  recipientEmail: string | null
  fromEmail: string | null
}): Promise<boolean> {
  const from = normalizeEmail(input.fromEmail)
  if (!from) return false
  if (normalizeEmail(input.recipientEmail) === from) return true
  const { data, error } = await supabaseService
    .from('grid_owner_contact_channels')
    .select('email,company_id,is_enabled,is_verified')
    .eq('grid_owner_id', input.gridOwnerId)
    .eq('is_enabled', true)
    .eq('is_verified', true)
    .or(`company_id.is.null,company_id.eq.${input.companyId}`)
  if (error) throw error
  return ((data ?? []) as JsonRecord[]).some((row) => normalizeEmail(row.email) === from)
}

async function findExistingInbound(input: {
  companyId: string
  mailbox: string
  providerMessageId: string
}): Promise<JsonRecord | null> {
  const { data, error } = await supabaseService
    .from('manual_inbound_messages')
    .select('id,request_id,resolution_status')
    .eq('company_id', input.companyId)
    .eq('mailbox', input.mailbox)
    .eq('provider_message_id', input.providerMessageId)
    .maybeSingle()
  if (error) throw error
  return data as JsonRecord | null
}

export async function ingestManualInboundEmail(email: ManualInboundEmail): Promise<ManualInboundResult> {
  await assertPlatformSchemaReady()
  const caseReference = extractCaseReference(email)
  const request = caseReference ? await findRequestByCaseReference(caseReference) : null
  const companyId = request ? clean(request.company_id) : null
  const requestId = request ? clean(request.id) : null
  const mailbox = normalizeEmail(email.mailbox ?? email.toEmail) ?? ''
  const providerMessageId = clean(email.providerMessageId)

  if (companyId && providerMessageId) {
    const existing = await findExistingInbound({ companyId, mailbox, providerMessageId })
    if (existing) {
      return {
        inboundId: clean(existing.id),
        resolutionStatus: String(existing.resolution_status) as ManualInboundResult['resolutionStatus'],
        requestId: clean(existing.request_id),
        caseReference,
        parse: null,
      }
    }
  }

  const bodyText = [clean(email.bodyText), clean(email.bodyHtml), attachmentText(email.attachments)].filter(Boolean).join('\n')
  const extracted = extractManualFacilityFields(bodyText)
  const confidence = scoreManualFacilityPayload(extracted)
  const gridOwnerId = request ? clean(request.grid_owner_id) : null
  const senderCredible = Boolean(companyId && gridOwnerId && await isSenderCredible({
    companyId,
    gridOwnerId,
    recipientEmail: clean(request?.recipient_email),
    fromEmail: clean(email.fromEmail),
  }))

  const resolutionStatus: ManualInboundResult['resolutionStatus'] = !caseReference
    ? 'unmatched'
    : !request
      ? 'ambiguous'
      : senderCredible
        ? 'matched'
        : 'ignored'

  const insert = await supabaseService
    .from('manual_inbound_messages')
    .insert({
      company_id: companyId,
      request_id: requestId,
      mailbox,
      from_email: clean(email.fromEmail),
      from_name: clean(email.fromName),
      to_email: clean(email.toEmail),
      subject: clean(email.subject),
      body_text: clean(email.bodyText),
      body_html: clean(email.bodyHtml),
      provider_message_id: providerMessageId,
      thread_id: clean(email.threadId),
      attachments: Array.isArray(email.attachments) ? email.attachments : [],
      resolution_status: resolutionStatus,
      extracted_payload: { ...extracted, sender_credible: senderCredible },
      confidence_score: confidence,
    })
    .select('id')
    .maybeSingle()
  if (insert.error) {
    if (String(insert.error.code) === '23505' && companyId && providerMessageId) {
      const existing = await findExistingInbound({ companyId, mailbox, providerMessageId })
      return {
        inboundId: clean(existing?.id),
        resolutionStatus: String(existing?.resolution_status ?? 'matched') as ManualInboundResult['resolutionStatus'],
        requestId: clean(existing?.request_id),
        caseReference,
        parse: null,
      }
    }
    throw insert.error
  }

  let parse: ManualFacilityParseResult | null = null
  if (resolutionStatus === 'matched' && request && companyId) {
    parse = await applyManualFacilityResponse({
      companyId,
      request,
      extracted,
      rawPayload: {
        subject: clean(email.subject),
        body_text: clean(email.bodyText),
        from_email: clean(email.fromEmail),
        provider_message_id: providerMessageId,
        mailbox,
      },
      senderCredible,
      source: 'manual_inbound_ingestion',
    })
    if (parse.outcome === 'applied') {
      const requestUpdate = await supabaseService
        .from('grid_owner_information_requests')
        .update({ status: 'manual_response_received', received_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('company_id', companyId)
        .eq('id', String(request.id))
        .in('status', ['manual_email_queued', 'manual_email_sent', 'waiting_manual_response', 'manual_response_received'])
        .select('id')
      if (requestUpdate.error) throw requestUpdate.error
      if (!requestUpdate.data?.length) throw new Error('Nätägarärendet kunde inte markeras mottaget i rätt tenant.')
    }
  }

  return {
    inboundId: clean(insert.data?.id),
    resolutionStatus,
    requestId,
    caseReference,
    parse,
  }
}
