// lib/email/manualEmailOutbox.ts
//
// Worker for the manual (non-Ediel) grid-owner e-mail outbox. The UI never sends
// e-mail directly: orchestrators enqueue a `manual_email_outbox` row and this
// worker (driven by cron) sends it via the Resend provider abstraction.
//
// Idempotency: each row carries a unique idempotency_key so repeated enqueues do
// not produce duplicate rows; the worker additionally locks a row before sending
// and forwards the idempotency key to the transport provider.

import { randomUUID } from 'node:crypto'
import { getEmailProvider } from '@/lib/email/providers'
import type { EmailAttachment } from '@/lib/email/providers/types'
import { isEdielReservedSender } from '@/lib/email/manualOperationsMailbox'
import { supabaseService } from '@/lib/supabase/service'

type JsonRecord = Record<string, unknown>

const MAX_ATTEMPTS = 5

export type ProcessManualEmailOutboxResult = {
  scanned: number
  claimed: number
  sent: number
  failed: number
  skipped: number
  errors: string[]
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function missingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist/i.test(message)
}

function toAttachments(value: unknown): EmailAttachment[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      const record = entry as JsonRecord
      const filename = clean(record.filename)
      const content = clean(record.content)
      if (!filename || !content) return null
      return {
        filename,
        content,
        contentType: clean(record.contentType) ?? clean(record.content_type) ?? null,
      } as EmailAttachment
    })
    .filter((entry): entry is EmailAttachment => Boolean(entry))
}

async function advanceLinkedRequest(
  requestId: string | null,
  info?: { outboxId?: string | null; providerMessageId?: string | null },
) {
  if (!requestId) return
  const now = new Date().toISOString()

  // Primary transition: move the request into the manual waiting state when it
  // is in one of the expected pre-send statuses.
  await supabaseService
    .from('grid_owner_information_requests')
    .update({
      status: 'waiting_manual_response',
      dispatch_status: 'waiting_response',
      sent_at: now,
      updated_at: now,
    })
    .eq('id', requestId)
    .in('status', ['manual_email_queued', 'ready_to_send_manual_email', 'manual_email_sent'])
    .then(() => undefined, () => undefined)

  // The site/customer "waiting for grid owner" state is only truthful once the
  // e-mail is actually sent, so it is advanced here (send confirmation), not at
  // queue time.
  const { data: requestRow } = await supabaseService
    .from('grid_owner_information_requests')
    .select('company_id,customer_id,customer_site_id')
    .eq('id', requestId)
    .maybeSingle()
  const linked = requestRow as { company_id?: string | null; customer_id?: string | null; customer_site_id?: string | null } | null
  if (linked?.company_id && linked.customer_site_id) {
    await supabaseService
      .from('customer_sites')
      .update({ facility_data_status: 'waiting_manual_response', next_action: 'Väntar på svar från nätägaren.', updated_at: now })
      .eq('company_id', linked.company_id)
      .eq('id', linked.customer_site_id)
      .then(() => undefined, () => undefined)
    if (linked.customer_id) {
      await supabaseService
        .from('customers')
        .update({ next_action: 'Väntar på svar från nätägaren.', updated_at: now })
        .eq('company_id', linked.company_id)
        .eq('id', linked.customer_id)
        .then(() => undefined, () => undefined)
    }
  }

  // Safety net: a sent outbox row must NEVER leave the linked request with
  // dispatch_status = 'not_started', regardless of the request status value.
  await supabaseService
    .from('grid_owner_information_requests')
    .update({
      dispatch_status: 'waiting_response',
      sent_at: now,
      updated_at: now,
    })
    .eq('id', requestId)
    .eq('dispatch_status', 'not_started')
    .then(() => undefined, () => undefined)

  // Record the outbox linkage / send info in request metadata (best-effort).
  if (info?.outboxId || info?.providerMessageId) {
    const { data: current } = await supabaseService
      .from('grid_owner_information_requests')
      .select('metadata')
      .eq('id', requestId)
      .maybeSingle()
    const baseMetadata =
      current && typeof current.metadata === 'object' && current.metadata !== null
        ? (current.metadata as Record<string, unknown>)
        : {}
    await supabaseService
      .from('grid_owner_information_requests')
      .update({
        metadata: {
          ...baseMetadata,
          manual_email_outbox_id: info.outboxId ?? baseMetadata.manual_email_outbox_id ?? null,
          manual_email_provider_message_id:
            info.providerMessageId ?? baseMetadata.manual_email_provider_message_id ?? null,
          manual_email_sent_at: now,
        },
        updated_at: now,
      })
      .eq('id', requestId)
      .then(() => undefined, () => undefined)
  }
}

// When a manual outbox item fails permanently, the linked grid-owner request
// must not stay stuck in a "queued/ready to send" state. Move it to needs_review
// with dispatch_status=failed so it surfaces as an actionable item, keeping the
// request status and the outbox status in sync.
async function markLinkedRequestFailed(
  requestId: string | null,
  errorCode: string,
  message: string,
) {
  if (!requestId) return
  const now = new Date().toISOString()
  const { data: current } = await supabaseService
    .from('grid_owner_information_requests')
    .select('metadata')
    .eq('id', requestId)
    .maybeSingle()
  const baseMetadata =
    current && typeof current.metadata === 'object' && current.metadata !== null
      ? (current.metadata as Record<string, unknown>)
      : {}
  await supabaseService
    .from('grid_owner_information_requests')
    .update({
      status: 'needs_review',
      dispatch_status: 'failed',
      dispatch_error_code: errorCode,
      dispatch_error_message: message.slice(0, 500),
      metadata: {
        ...baseMetadata,
        manual_email_failed_at: now,
        manual_email_error_code: errorCode,
      },
      updated_at: now,
    })
    .eq('id', requestId)
    // Only pull back requests that are still waiting on this outbound send.
    .in('status', ['manual_email_queued', 'ready_to_send_manual_email', 'manual_email_sent', 'waiting_manual_response'])
    .then(() => undefined, () => undefined)
}

const STALE_SENDING_MINUTES = 15

// Recovery for worker crashes: a row claimed as 'sending' whose lock is older
// than STALE_SENDING_MINUTES is moved to 'delivery_uncertain' (the provider may
// already have accepted the send, so it must NEVER be auto-resent). Mirrors the
// tenant email outbox semantics. Degrades to a no-op before migration
// 20260703120000 widens the status CHECK constraint.
async function recoverStaleManualSendingRows(companyId: string | null): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_SENDING_MINUTES * 60 * 1000).toISOString()
  const now = new Date().toISOString()
  let staleQuery = supabaseService
    .from('manual_email_outbox')
    .update({
      status: 'delivery_uncertain',
      last_error: 'delivery_uncertain_after_stale_sending_lock',
      last_error_code: 'delivery_uncertain',
      delivery_uncertain_at: now,
      locked_at: null,
      locked_by: null,
      updated_at: now,
    })
    .eq('status', 'sending')
    .lt('locked_at', cutoff)
  if (companyId) staleQuery = staleQuery.eq('company_id', companyId)

  const { data: recovered, error } = await staleQuery.select('id,request_id')
  if (error && !missingSchema(error)) {
    // Constraint not widened yet (pre-migration) or transient failure: leave
    // rows untouched rather than corrupting status.
    console.warn('manual_email_outbox stale sending recovery skipped:', error.message)
    return
  }

  // The linked grid-owner request must reflect the uncertain send instead of
  // silently staying in manual_email_queued / waiting: operators need the
  // needs_review + send_uncertain signal to decide on a safe requeue.
  for (const row of (recovered ?? []) as Array<{ id: string; request_id: string | null }>) {
    if (!row.request_id) continue
    await supabaseService
      .from('grid_owner_information_requests')
      .update({
        status: 'needs_review',
        dispatch_status: 'failed',
        dispatch_error_code: 'send_uncertain',
        dispatch_error_message:
          'Det är oklart om det manuella e-postmeddelandet skickades. Kontrollera leveransstatus innan nytt utskick.',
        updated_at: now,
      })
      .eq('id', row.request_id)
      .in('status', ['manual_email_queued', 'ready_to_send_manual_email', 'manual_email_sent', 'waiting_manual_response'])
      .then(() => undefined, () => undefined)
  }
}

/**
 * Operator-approved recovery for delivery_uncertain manual e-mails. Requeues
 * the row for the ordinary outbox worker. Safe against double delivery: the
 * row's idempotency_key is forwarded to the provider, so a send that actually
 * went out during the interrupted attempt is deduplicated.
 */
export async function requeueUncertainManualEmail(input: {
  outboxId: string
  companyId?: string | null
  actorUserId: string
}) {
  const now = new Date().toISOString()
  let query = supabaseService
    .from('manual_email_outbox')
    .update({
      status: 'queued',
      last_error: null,
      last_error_code: null,
      delivery_uncertain_at: null,
      locked_at: null,
      locked_by: null,
      updated_at: now,
    })
    .eq('id', input.outboxId)
    .eq('status', 'delivery_uncertain')
  if (clean(input.companyId)) query = query.eq('company_id', clean(input.companyId))

  const { data, error } = await query.select('id').maybeSingle()
  if (error) throw error
  if (!data) return { ok: false as const, error: 'Utskicket är inte i osäkert leveransläge längre.' }
  return { ok: true as const, outboxId: String((data as { id: string }).id) }
}

export async function processManualEmailOutbox(input?: {
  companyId?: string | null
  limit?: number
}): Promise<ProcessManualEmailOutboxResult> {
  const limit = Math.min(Math.max(Number(input?.limit ?? 25) || 25, 1), 100)
  const result: ProcessManualEmailOutboxResult = { scanned: 0, claimed: 0, sent: 0, failed: 0, skipped: 0, errors: [] }
  const workerId = `manual-email:${randomUUID()}`

  await recoverStaleManualSendingRows(clean(input?.companyId))

  let query = supabaseService
    .from('manual_email_outbox')
    .select('*')
    .eq('status', 'queued')
    .order('queued_at', { ascending: true })
    .limit(limit)
  if (clean(input?.companyId)) {
    query = query.eq('company_id', clean(input?.companyId))
  }

  const { data, error } = await query
  if (error) {
    if (missingSchema(error)) return result
    throw error
  }

  const rows = (data ?? []) as JsonRecord[]
  result.scanned = rows.length
  if (rows.length === 0) return result

  const provider = getEmailProvider()

  for (const row of rows) {
    const id = String(row.id)
    // Optimistic lock: only claim if still queued and unlocked.
    const claim = await supabaseService
      .from('manual_email_outbox')
      .update({ status: 'sending', locked_at: new Date().toISOString(), locked_by: workerId, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'queued')
      .select('id')
      .maybeSingle()
    if (claim.error) {
      result.errors.push(`claim ${id}: ${claim.error.message}`)
      continue
    }
    if (!claim.data) {
      result.skipped += 1
      continue
    }
    result.claimed += 1

    const toEmail = clean(row.to_email)
    const fromEmail = clean(row.from_email) ?? clean(process.env.RESEND_FROM_EMAIL) ?? clean(process.env.DEFAULT_FROM_EMAIL)
    if (!toEmail || !fromEmail) {
      await supabaseService
        .from('manual_email_outbox')
        .update({ status: 'failed', delivery_status: 'failed', last_error: 'missing_to_or_from_email', last_error_code: 'missing_to_or_from_email', attempts: Number(row.attempts ?? 0) + 1, updated_at: new Date().toISOString() })
        .eq('id', id)
      await markLinkedRequestFailed(clean(row.request_id), 'missing_to_or_from_email', 'Saknar avsändar- eller mottagaradress för manuell e-post.')
      result.failed += 1
      continue
    }

    // The Ediel transport sender (ediel@gridex.se) must NEVER be used for manual
    // e-mail. Refuse unless an explicit emergency override env flag is set
    // (MANUAL_EMAIL_ALLOW_EDIEL_SENDER=true), which is surfaced in superadmin
    // diagnostics. No silent fallback.
    const allowEdielOverride = String(process.env.MANUAL_EMAIL_ALLOW_EDIEL_SENDER ?? '').trim().toLowerCase() === 'true'
    if (isEdielReservedSender(fromEmail) && !allowEdielOverride) {
      await supabaseService
        .from('manual_email_outbox')
        .update({
          status: 'failed',
          delivery_status: 'failed',
          last_error: 'blocked_ediel_reserved_sender: manuell e-post får inte skickas från Ediel-brevlådan (ediel@gridex.se).',
          last_error_code: 'blocked_ediel_reserved_sender',
          attempts: Number(row.attempts ?? 0) + 1,
          locked_at: null,
          locked_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
      await markLinkedRequestFailed(clean(row.request_id), 'blocked_ediel_reserved_sender', 'Manuell e-post blockerades eftersom avsändaren är Ediel-brevlådan.')
      result.failed += 1
      result.errors.push(`send ${id}: blocked_ediel_reserved_sender`)
      continue
    }

    try {
      const sent = await provider.sendEmail({
        from: fromEmail,
        to: toEmail,
        replyTo: clean(row.reply_to) ?? undefined,
        subject: String(row.subject ?? ''),
        html: String(row.body_html ?? ''),
        text: clean(row.body_text) ?? undefined,
        attachments: toAttachments(row.attachments),
        idempotencyKey: clean(row.idempotency_key) ?? undefined,
      })
      await supabaseService
        .from('manual_email_outbox')
        .update({
          status: 'sent',
          delivery_status: 'sent',
          provider_message_id: sent.providerMessageId,
          sent_at: new Date().toISOString(),
          attempts: Number(row.attempts ?? 0) + 1,
          last_error: null,
          last_error_code: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
      await advanceLinkedRequest(clean(row.request_id), {
        outboxId: clean(id),
        providerMessageId: clean(sent.providerMessageId),
      })
      result.sent += 1
    } catch (sendError) {
      const attempts = Number(row.attempts ?? 0) + 1
      const message = sendError instanceof Error ? sendError.message : String(sendError)
      const permanentlyFailed = attempts >= MAX_ATTEMPTS
      await supabaseService
        .from('manual_email_outbox')
        .update({
          // Re-queue for retry until max attempts, then fail.
          status: permanentlyFailed ? 'failed' : 'queued',
          delivery_status: permanentlyFailed ? 'failed' : 'queued',
          attempts,
          last_error: message.slice(0, 500),
          last_error_code: permanentlyFailed ? 'send_failed' : 'send_retry',
          locked_at: null,
          locked_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (permanentlyFailed) {
        await markLinkedRequestFailed(clean(row.request_id), 'send_failed', message)
      }
      result.failed += 1
      result.errors.push(`send ${id}: ${message}`)
    }
  }

  return result
}
