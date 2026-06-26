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

async function advanceLinkedRequest(requestId: string | null) {
  if (!requestId) return
  const now = new Date().toISOString()
  await supabaseService
    .from('grid_owner_information_requests')
    .update({ status: 'waiting_manual_response', sent_at: now, updated_at: now })
    .eq('id', requestId)
    .in('status', ['manual_email_queued', 'ready_to_send_manual_email', 'manual_email_sent'])
    .then(() => undefined, () => undefined)
}

export async function processManualEmailOutbox(input?: {
  companyId?: string | null
  limit?: number
}): Promise<ProcessManualEmailOutboxResult> {
  const limit = Math.min(Math.max(Number(input?.limit ?? 25) || 25, 1), 100)
  const result: ProcessManualEmailOutboxResult = { scanned: 0, claimed: 0, sent: 0, failed: 0, skipped: 0, errors: [] }
  const workerId = `manual-email:${randomUUID()}`

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
        .update({ status: 'failed', last_error: 'missing_to_or_from_email', attempts: Number(row.attempts ?? 0) + 1, updated_at: new Date().toISOString() })
        .eq('id', id)
      result.failed += 1
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
          provider_message_id: sent.providerMessageId,
          sent_at: new Date().toISOString(),
          attempts: Number(row.attempts ?? 0) + 1,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
      await advanceLinkedRequest(clean(row.request_id))
      result.sent += 1
    } catch (sendError) {
      const attempts = Number(row.attempts ?? 0) + 1
      const message = sendError instanceof Error ? sendError.message : String(sendError)
      await supabaseService
        .from('manual_email_outbox')
        .update({
          // Re-queue for retry until max attempts, then fail.
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'queued',
          attempts,
          last_error: message.slice(0, 500),
          locked_at: null,
          locked_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
      result.failed += 1
      result.errors.push(`send ${id}: ${message}`)
    }
  }

  return result
}
