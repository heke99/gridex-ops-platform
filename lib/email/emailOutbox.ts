import { supabaseService } from '@/lib/supabase/service'
import { markCommunicationFailed, markCommunicationSent } from './communicationLogs'
import { getEmailProvider } from './providers'

type TenantEmailOutboxRow = {
  id: string
  company_id: string
  customer_id?: string | null
  customer_case_id?: string | null
  communication_log_id?: string | null
  email_type: string
  to_email: string
  from_email: string | null
  reply_to_email: string | null
  subject: string
  html_body: string
  text_body: string | null
  status: 'queued' | 'processing' | 'sent' | 'failed' | 'cancelled'
  attempts: number | null
  max_attempts: number | null
  next_attempt_at: string | null
  provider_message_id: string | null
  failure_reason: string | null
  last_error?: string | null
  branding_snapshot: Record<string, unknown> | null
  request_id?: string | null
  trace_id?: string | null
}

type EnqueueTenantEmailInput = {
  companyId: string
  to: string
  from: string
  subject: string
  html: string
  text?: string | null
  emailType: string
  replyTo?: string | null
  customerId?: string | null
  customerCaseId?: string | null
  communicationLogId?: string | null
  brandingSnapshot?: Record<string, unknown> | null
  requestId?: string | null
  traceId?: string | null
  maxAttempts?: number
}

type ProcessTenantEmailOutboxInput = {
  companyId?: string | null
  limit?: number
}

function clean(value: string | null | undefined) {
  const trimmed = String(value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

function safeError(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'Utskicket kunde inte skickas. Kontrollera e-postinställningarna och försök igen.'
}

function retryDelayMinutes(attempts: number) {
  return Math.min(60, Math.max(5, attempts * attempts * 5))
}

function parseLimit(value: number | null | undefined) {
  if (!Number.isFinite(value) || !value || value < 1) return 25
  return Math.min(Math.floor(value), 100)
}

export async function enqueueTenantEmail(input: EnqueueTenantEmailInput): Promise<TenantEmailOutboxRow> {
  const now = new Date().toISOString()
  const from = clean(input.from)
  const to = clean(input.to)?.toLowerCase()
  const subject = clean(input.subject)
  const html = clean(input.html)

  if (!from) throw new Error('Avsändare saknas för e-postutskicket.')
  if (!to) throw new Error('Mottagare saknas för e-postutskicket.')
  if (!subject) throw new Error('Ämnesrad saknas för e-postutskicket.')
  if (!html) throw new Error('Mallinnehåll saknas för e-postutskicket.')

  const { data, error } = await supabaseService
    .from('tenant_email_outbox')
    .insert({
      company_id: input.companyId,
      customer_id: input.customerId ?? null,
      customer_case_id: input.customerCaseId ?? null,
      communication_log_id: input.communicationLogId ?? null,
      email_type: input.emailType,
      to_email: to,
      from_email: from,
      reply_to_email: clean(input.replyTo),
      subject,
      html_body: html,
      text_body: clean(input.text),
      status: 'queued',
      attempts: 0,
      max_attempts: input.maxAttempts ?? 5,
      next_attempt_at: now,
      dead_letter_at: null,
      last_error: null,
      failure_reason: null,
      branding_snapshot: input.brandingSnapshot ?? {},
      request_id: input.requestId ?? null,
      trace_id: input.traceId ?? null,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as TenantEmailOutboxRow
}

async function loadDueRows(input: ProcessTenantEmailOutboxInput) {
  const now = new Date().toISOString()
  let query = supabaseService
    .from('tenant_email_outbox')
    .select('*')
    .eq('status', 'queued')
    .is('dead_letter_at', null)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
    .order('created_at', { ascending: true })
    .limit(parseLimit(input.limit))

  if (input.companyId) query = query.eq('company_id', input.companyId)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as TenantEmailOutboxRow[]
}

async function claimRow(row: TenantEmailOutboxRow) {
  const { data, error } = await supabaseService
    .from('tenant_email_outbox')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .eq('company_id', row.company_id)
    .eq('status', 'queued')
    .select('*')
    .maybeSingle()

  if (error) throw error
  return data as TenantEmailOutboxRow | null
}

async function markOutboxSent(row: TenantEmailOutboxRow, providerMessageId: string | null) {
  const now = new Date().toISOString()
  const { error } = await supabaseService
    .from('tenant_email_outbox')
    .update({
      status: 'sent',
      provider_message_id: providerMessageId,
      failure_reason: null,
      last_error: null,
      sent_at: now,
      updated_at: now,
    })
    .eq('id', row.id)
    .eq('company_id', row.company_id)

  if (error) throw error

  if (row.communication_log_id && providerMessageId) {
    await markCommunicationSent(row.communication_log_id, providerMessageId).catch((error) => {
      console.warn('[email-outbox] communication log sent update failed', safeError(error))
    })
  }
}

async function markOutboxFailed(row: TenantEmailOutboxRow, errorMessage: string) {
  const attempts = Number(row.attempts ?? 0) + 1
  const maxAttempts = Number(row.max_attempts ?? 5)
  const deadLetter = attempts >= maxAttempts
  const now = new Date().toISOString()
  const nextAttempt = new Date(Date.now() + retryDelayMinutes(attempts) * 60_000).toISOString()

  const { error } = await supabaseService
    .from('tenant_email_outbox')
    .update({
      status: deadLetter ? 'failed' : 'queued',
      attempts,
      failure_reason: errorMessage,
      last_error: errorMessage,
      failed_at: deadLetter ? now : null,
      next_attempt_at: deadLetter ? null : nextAttempt,
      dead_letter_at: deadLetter ? now : null,
      updated_at: now,
    })
    .eq('id', row.id)
    .eq('company_id', row.company_id)

  if (error) throw error

  if (deadLetter && row.communication_log_id) {
    await markCommunicationFailed(row.communication_log_id, errorMessage).catch((error) => {
      console.warn('[email-outbox] communication log failed update failed', safeError(error))
    })
  }
}

export async function sendTenantEmailOutboxRow(row: TenantEmailOutboxRow) {
  if (!clean(row.from_email)) throw new Error('Avsändare saknas för e-postutskicket.')
  if (!clean(row.to_email)) throw new Error('Mottagare saknas för e-postutskicket.')
  if (!clean(row.subject)) throw new Error('Ämnesrad saknas för e-postutskicket.')
  if (!clean(row.html_body)) throw new Error('Mallinnehåll saknas för e-postutskicket.')

  const result = await getEmailProvider().sendEmail({
    from: row.from_email!,
    to: row.to_email,
    replyTo: row.reply_to_email ?? undefined,
    subject: row.subject,
    html: row.html_body,
    text: row.text_body ?? undefined,
  })

  return result.providerMessageId
}

export async function processTenantEmailOutbox(input: ProcessTenantEmailOutboxInput = {}) {
  const rows = await loadDueRows(input)
  const result = {
    scanned: rows.length,
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
    errors: [] as Array<{ id: string; error: string }>,
  }

  for (const row of rows) {
    const claimed = await claimRow(row)
    if (!claimed) {
      result.skipped += 1
      continue
    }

    result.claimed += 1
    try {
      const providerMessageId = await sendTenantEmailOutboxRow(claimed)
      await markOutboxSent(claimed, providerMessageId)
      result.sent += 1
    } catch (error) {
      const message = safeError(error)
      await markOutboxFailed(claimed, message)
      const attempts = Number(claimed.attempts ?? 0) + 1
      const maxAttempts = Number(claimed.max_attempts ?? 5)
      if (attempts >= maxAttempts) result.failed += 1
      else result.retried += 1
      result.errors.push({ id: claimed.id, error: message })
    }
  }

  return result
}

export async function sendTenantEmailNow(outboxId: string) {
  const { data, error } = await supabaseService
    .from('tenant_email_outbox')
    .select('*')
    .eq('id', outboxId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('E-postutskicket hittades inte.')

  const row = data as TenantEmailOutboxRow
  if (row.status === 'sent') return { ok: true, messageId: row.provider_message_id ?? null }
  if (row.status === 'cancelled') return { ok: false, error: 'Utskicket är avstängt eller annullerat.' }
  if (row.status === 'processing') return { ok: false, error: 'Utskicket behandlas redan.' }

  const claimed = row.status === 'queued' ? await claimRow(row) : row
  if (!claimed) return { ok: false, error: 'Utskicket behandlas redan.' }

  try {
    const providerMessageId = await sendTenantEmailOutboxRow(claimed)
    await markOutboxSent(claimed, providerMessageId)
    return { ok: true, messageId: providerMessageId }
  } catch (error) {
    const message = safeError(error)
    await markOutboxFailed(claimed, message)
    return { ok: false, error: message }
  }
}
