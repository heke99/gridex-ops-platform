// lib/customer-operations/manualGridOwnerFollowUps.ts
//
// SLA watchdog for manual grid-owner information requests waiting for an
// answer (status waiting_manual_response). After 5 Swedish business days
// (Europe/Stockholm calendar, market calendar holidays) a reminder is queued;
// after 10 business days an escalation. Each follow-up gets its own outbox
// idempotency key (request id + kind + count) and is only queued while the
// power of attorney is still valid and a verified grid-owner contact exists.
// The outbox worker re-checks POA and recipient again right before sending.

import { supabaseService } from '@/lib/supabase/service'
import { addBusinessDays } from '@/lib/ediel/calendar/marketCalendar'
import { renderManualEmailTemplate } from '@/lib/email/manualGridOwnerTemplates'
import {
  resolveManualOperationsMailbox,
  resolveManualMailboxEnvironment,
  type ManualMailboxChannelType,
} from '@/lib/email/manualOperationsMailbox'
import {
  MANUAL_CONTACT_CHANNEL_TYPES,
  findGridOwnerManualContact,
  manualPoaIsCurrentlyValid,
  readPowerOfAttorneyForSend,
} from '@/lib/customer-operations/manualGridOwnerSendGuards'
import { resolveManualRecipient } from '@/lib/customer-operations/requestMissingFacilityInformationCore'

type JsonRecord = Record<string, unknown>

export const REMINDER_AFTER_BUSINESS_DAYS = 5
export const ESCALATION_AFTER_BUSINESS_DAYS = 10
const MAX_FOLLOW_UPS = 2
const STOCKHOLM = 'Europe/Stockholm'

export type ManualFollowUpResult = {
  scanned: number
  scheduled: number
  reminders: number
  escalations: number
  needsReview: number
  skipped: number
  errors: string[]
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function jsonObject(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' ? message : String(error)
}

function stockholmParts(instant: Date): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: STOCKHOLM, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant)
  const out: Record<string, number> = {}
  for (const part of parts) if (part.type !== 'literal') out[part.type] = Number(part.value)
  return out
}

export function stockholmDate(instant: Date): string {
  const p = stockholmParts(instant)
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

// 08:00 Stockholm local time on the given calendar date, as a UTC instant.
export function stockholmMorning(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d, 8, 0, 0)
  const p = stockholmParts(new Date(guess))
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return new Date(guess - (asUtc - guess))
}

// The follow-up becomes due on the morning of the N:th Swedish business day
// after the Stockholm calendar date the request was sent.
export async function followUpDueAt(sentAt: Date, businessDays: number): Promise<Date> {
  const start = new Date(`${stockholmDate(sentAt)}T00:00:00Z`)
  const due = await addBusinessDays(start, businessDays)
  return stockholmMorning(due.toISOString().slice(0, 10))
}

function customerName(customer: JsonRecord | null): string | null {
  if (!customer) return null
  for (const key of ['company_name', 'full_name', 'name', 'display_name']) {
    const value = clean(customer[key])
    if (value) return value
  }
  const joined = [clean(customer.first_name), clean(customer.last_name)].filter(Boolean).join(' ').trim()
  return joined || clean(customer.customer_number)
}

async function markNeedsReview(request: JsonRecord, code: string, message: string) {
  const metadata = jsonObject(request.metadata)
  const now = new Date().toISOString()
  const result = await supabaseService
    .from('grid_owner_information_requests')
    .update({
      status: 'needs_review',
      last_error_code: code,
      last_error_message: message.slice(0, 500),
      next_follow_up_at: null,
      metadata: { ...metadata, follow_up_blocked_reason: code, follow_up_blocked_at: now },
      updated_at: now,
    })
    .eq('company_id', String(request.company_id))
    .eq('id', String(request.id))
    .eq('status', 'waiting_manual_response')
    .select('id')
  if (result.error) throw result.error
}

async function readOne(table: string, select: string, companyId: string, id: string | null): Promise<JsonRecord | null> {
  if (!id) return null
  const { data, error } = await supabaseService.from(table).select(select).eq('company_id', companyId).eq('id', id).maybeSingle()
  if (error) throw error
  return (data as JsonRecord | null) ?? null
}

async function tenantCompanyName(companyId: string): Promise<string> {
  const { data, error } = await supabaseService.from('companies').select('*').eq('id', companyId).maybeSingle()
  if (error) throw error
  const row = (data as JsonRecord | null) ?? {}
  for (const key of ['legal_name', 'company_name', 'display_name', 'name']) {
    const value = clean(row[key])
    if (value) return value
  }
  return 'Elhandelsbolaget'
}

type FollowUpOutcome = 'scheduled' | 'reminder' | 'escalation' | 'needs_review' | 'skipped'

async function processRequest(request: JsonRecord, now: Date): Promise<FollowUpOutcome> {
  const companyId = String(request.company_id)
  const requestId = String(request.id)
  const count = Number(request.follow_up_count ?? 0)
  if (!Number.isFinite(count) || count >= MAX_FOLLOW_UPS) return 'skipped'
  const sentAtRaw = clean(request.sent_at) ?? clean(jsonObject(request.metadata).manual_email_sent_at)
  const sentAt = sentAtRaw ? new Date(sentAtRaw) : null
  if (!sentAt || Number.isNaN(sentAt.getTime())) return 'skipped'

  const nextFollowUpAt = clean(request.next_follow_up_at)
  if (!nextFollowUpAt) {
    const dueAt = await followUpDueAt(sentAt, count === 0 ? REMINDER_AFTER_BUSINESS_DAYS : ESCALATION_AFTER_BUSINESS_DAYS)
    const scheduled = await supabaseService
      .from('grid_owner_information_requests')
      .update({ next_follow_up_at: dueAt.toISOString(), updated_at: now.toISOString() })
      .eq('company_id', companyId)
      .eq('id', requestId)
      .eq('status', 'waiting_manual_response')
      .eq('follow_up_count', count)
      .select('id')
    if (scheduled.error) throw scheduled.error
    if (dueAt.getTime() > now.getTime()) return 'scheduled'
  } else if (Date.parse(nextFollowUpAt) > now.getTime()) {
    return 'skipped'
  }

  const kind: 'reminder' | 'escalation' = count === 0 ? 'reminder' : 'escalation'
  const metadata = jsonObject(request.metadata)
  const requestChannel = clean(metadata.channel_type)
  const channelType = requestChannel && MANUAL_CONTACT_CHANNEL_TYPES.has(requestChannel) ? requestChannel : 'facility_information_request'

  const poaId = clean(request.poa_id)
  const poa = poaId ? await readPowerOfAttorneyForSend({ companyId, poaId }) : null
  if (!poa || !manualPoaIsCurrentlyValid(poa, now)) {
    await markNeedsReview(request, 'poa_not_valid', 'Fullmakten är inte längre giltig. Påminnelse till nätägaren skickades inte.')
    return 'needs_review'
  }

  const gridOwnerId = clean(request.grid_owner_id)
  // An escalation goes to the grid owner's escalation contact when one exists.
  let contactChannelType = channelType
  let contact = null as Awaited<ReturnType<typeof findGridOwnerManualContact>>
  if (gridOwnerId && kind === 'escalation') {
    contact = await findGridOwnerManualContact({ companyId, gridOwnerId, channelType: 'escalation' })
    if (contact) contactChannelType = 'escalation'
  }
  if (gridOwnerId && !contact) contact = await findGridOwnerManualContact({ companyId, gridOwnerId, channelType })
  if (!contact) {
    await markNeedsReview(request, 'grid_owner_contact_missing', 'Verifierad kontaktväg till nätägaren saknas. Påminnelse skickades inte.')
    return 'needs_review'
  }
  const recipient = resolveManualRecipient(contact)
  if (!recipient.selected_to_email || (recipient.environment === 'production' && !recipient.externally_sendable)) return 'skipped'

  const mailbox = await resolveManualOperationsMailbox({ companyId, channelType: channelType as ManualMailboxChannelType })
  if (!mailbox) {
    await markNeedsReview(request, 'manual_mailbox_required', 'Manuell avsändarbrevlåda saknas. Påminnelse skickades inte.')
    return 'needs_review'
  }

  const [customer, site, companyName] = await Promise.all([
    readOne('customers', '*', companyId, clean(request.customer_id)),
    readOne('customer_sites', 'id,street,postal_code,city', companyId, clean(request.customer_site_id)),
    tenantCompanyName(companyId),
  ])
  const rendered = renderManualEmailTemplate(kind, {
    case_reference: clean(request.case_reference),
    customer_name: customerName(customer),
    site_address: clean(site?.street),
    postal_code: clean(site?.postal_code),
    city: clean(site?.city),
    ops_sender_name: clean(process.env.MANUAL_GRID_OWNER_SENDER_NAME) ?? 'Gridex Operations',
    tenant_company_name: companyName,
  })

  const followUpNumber = count + 1
  const idempotencyKey = `manual-facility-follow-up:${requestId}:${kind}:${followUpNumber}`
  const nowIso = now.toISOString()
  const inserted = await supabaseService
    .from('manual_email_outbox')
    .insert({
      company_id: companyId,
      request_id: requestId,
      to_email: recipient.selected_to_email,
      from_email: mailbox.fromEmail,
      reply_to: mailbox.replyToEmail ?? mailbox.fromEmail,
      subject: rendered.subject,
      body_html: rendered.bodyHtml,
      body_text: rendered.bodyText,
      attachments: [],
      status: 'queued',
      provider: 'resend',
      idempotency_key: idempotencyKey,
      provider_idempotency_key: idempotencyKey,
      actual_recipient_email: recipient.selected_to_email,
      external_delivery: true,
      next_attempt_at: nowIso,
      queued_at: nowIso,
      recipient_resolution: {
        ...recipient,
        recipient_contact_channel_id: contact.contactChannelId,
        contact_channel_type: contactChannelType,
        follow_up_kind: kind,
        follow_up_number: followUpNumber,
        template_key: rendered.templateKey,
        template_version: rendered.templateVersion,
      },
    })
    .select('id')
    .maybeSingle()
  if (inserted.error) {
    const code = String((inserted.error as { code?: unknown }).code ?? '')
    if (code === '23514') {
      await markNeedsReview(request, 'outbox_guard_rejected', 'Nätägarens kontaktväg eller anläggningens nätägare är inte längre verifierad. Påminnelse skickades inte.')
      return 'needs_review'
    }
    // 23505: this exact follow-up was already queued by an earlier run.
    if (code !== '23505') throw inserted.error
  }

  const escalationAt = kind === 'reminder' ? await followUpDueAt(sentAt, ESCALATION_AFTER_BUSINESS_DAYS) : null
  const advanced = await supabaseService
    .from('grid_owner_information_requests')
    .update({
      follow_up_count: followUpNumber,
      next_follow_up_at: escalationAt ? escalationAt.toISOString() : null,
      metadata: {
        ...metadata,
        last_follow_up: { kind, number: followUpNumber, queued_at: nowIso, outbox_id: clean(inserted.data?.id), idempotency_key: idempotencyKey },
      },
      updated_at: nowIso,
    })
    .eq('company_id', companyId)
    .eq('id', requestId)
    .eq('status', 'waiting_manual_response')
    .eq('follow_up_count', count)
    .select('id')
  if (advanced.error) throw advanced.error
  return kind
}

export async function runManualGridOwnerFollowUpWatchdog(input: { limit?: number; now?: Date } = {}): Promise<ManualFollowUpResult> {
  const result: ManualFollowUpResult = { scanned: 0, scheduled: 0, reminders: 0, escalations: 0, needsReview: 0, skipped: 0, errors: [] }
  // Fail closed outside production unless a safe recipient is configured: a
  // preview deployment sharing the database must not touch live requests.
  if (resolveManualMailboxEnvironment() !== 'production' && !clean(process.env.MANUAL_GRID_OWNER_SAFE_RECIPIENT)) {
    result.errors.push('manual_ops_environment_not_production')
    return result
  }
  const now = input.now ?? new Date()
  const limit = Math.min(Math.max(Number(input.limit ?? 25) || 25, 1), 100)
  const { data, error } = await supabaseService
    .from('grid_owner_information_requests')
    .select('id,company_id,customer_id,customer_site_id,grid_owner_id,poa_id,status,channel,case_reference,sent_at,follow_up_count,next_follow_up_at,metadata')
    .eq('status', 'waiting_manual_response')
    .eq('channel', 'manual_email')
    .lt('follow_up_count', MAX_FOLLOW_UPS)
    .or(`next_follow_up_at.is.null,next_follow_up_at.lte.${now.toISOString()}`)
    .order('next_follow_up_at', { ascending: true, nullsFirst: true })
    .limit(limit)
  if (error) throw error
  const rows = (data ?? []) as JsonRecord[]
  result.scanned = rows.length
  for (const request of rows) {
    try {
      const outcome = await processRequest(request, now)
      if (outcome === 'scheduled') result.scheduled += 1
      else if (outcome === 'reminder') result.reminders += 1
      else if (outcome === 'escalation') result.escalations += 1
      else if (outcome === 'needs_review') result.needsReview += 1
      else result.skipped += 1
    } catch (requestError) {
      result.errors.push(`follow-up ${String(request.id)}: ${errorMessage(requestError)}`)
    }
  }
  return result
}
