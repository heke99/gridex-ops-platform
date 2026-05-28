import { ImapFlow } from 'imapflow'
import { processInboundEmailMessage } from '@/lib/inbound-mail/edielInboundProcessor'
import { createInboundOverdueTasks } from '@/lib/inbound-mail/inboundOverdueMonitor'
import { supabaseService } from '@/lib/supabase/service'

export type EdielMailboxRow = {
  id: string
  company_id: string | null
  mailbox_name: string
  email_address: string | null
  imap_host: string | null
  imap_port: number | null
  smtp_host: string | null
  smtp_port: number | null
  username: string | null
  secret_reference: string | null
  environment: string
  is_active: boolean
  poll_interval_minutes: number
  last_polled_at: string | null
  last_successful_poll_at: string | null
  last_error: string | null
  locked_at: string | null
  locked_by: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type StoreInboundEmailInput = {
  mailboxId: string
  companyId?: string | null
  internetMessageId?: string | null
  fromAddress?: string | null
  toAddress?: string | null
  subject?: string | null
  receivedAt?: string | null
  rawEmail?: string | null
  rawEdifactPayload?: string | null
  bodyText?: string | null
  bodyHtml?: string | null
  hasAttachments?: boolean
}

export type InboundProcessingJobRow = {
  id: string
  company_id: string | null
  mailbox_id: string | null
  inbound_email_message_id: string | null
  status: string
  step: string | null
  attempts_count: number
  locked_at: string | null
  locked_by: string | null
  started_at: string | null
  finished_at: string | null
  error_message: string | null
  payload: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type PollMailboxResult = {
  mailboxId: string
  mailboxName: string
  stored: number
  deduped: number
  processed: number
  errors: string[]
}

export type InboundEngineRunResult = {
  workerId: string
  startedAt: string
  finishedAt: string
  mailboxesChecked: number
  storedEmails: number
  dedupedEmails: number
  processedJobs: number
  failedJobs: number
  overdueTasks: { ackOverdue: number; z04Overdue: number; z14Overdue: number }
  results: PollMailboxResult[]
}

function nowIso(): string {
  return new Date().toISOString()
}

function bufferToUtf8(value: unknown): string | null {
  if (!value) return null
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8')
  return null
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function passwordFromSecretReference(mailbox: EdielMailboxRow): string | null {
  const reference = stringOrNull(mailbox.secret_reference)
  if (!reference) return null

  if (reference.startsWith('env:')) {
    return process.env[reference.slice(4)] ?? null
  }

  const direct = process.env[reference]
  if (direct) return direct

  const mailboxSpecific = process.env[`EDIEL_MAILBOX_${mailbox.id.replace(/-/g, '_').toUpperCase()}_PASSWORD`]
  if (mailboxSpecific) return mailboxSpecific

  return null
}

function extractHeader(rawEmail: string | null, headerName: string): string | null {
  if (!rawEmail) return null
  const escaped = headerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = rawEmail.match(new RegExp(`^${escaped}:\\s*(.+)$`, 'im'))
  return stringOrNull(match?.[1])
}

function envInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export async function listDueEdielMailboxes(options: { environment?: string | null; includeLockedOlderThanMinutes?: number } = {}): Promise<EdielMailboxRow[]> {
  let query = supabaseService
    .from('ediel_mailboxes')
    .select('*')
    .eq('is_active', true)

  if (options.environment) query = query.eq('environment', options.environment)

  const { data, error } = await query.order('last_polled_at', { ascending: true, nullsFirst: true })
  if (error) throw error

  const now = Date.now()
  const staleLockMs = (options.includeLockedOlderThanMinutes ?? 30) * 60_000

  return ((data ?? []) as EdielMailboxRow[]).filter((mailbox) => {
    if (mailbox.locked_at) {
      const lockedAt = new Date(mailbox.locked_at).getTime()
      if (!Number.isNaN(lockedAt) && now - lockedAt < staleLockMs) return false
    }

    if (!mailbox.last_polled_at) return true
    const intervalMinutes = Number(mailbox.poll_interval_minutes || 10)
    const last = new Date(mailbox.last_polled_at).getTime()
    if (Number.isNaN(last)) return true
    return now - last >= intervalMinutes * 60_000
  })
}

export async function markMailboxPollStarted(mailboxId: string, workerId = 'inbound-mail-engine'): Promise<void> {
  const { error } = await supabaseService
    .from('ediel_mailboxes')
    .update({ last_polled_at: nowIso(), locked_at: nowIso(), locked_by: workerId, last_error: null })
    .eq('id', mailboxId)

  if (error) throw error
}

export async function markMailboxPollFinished(input: {
  mailboxId: string
  ok: boolean
  errorMessage?: string | null
}): Promise<void> {
  const payload = input.ok
    ? { last_successful_poll_at: nowIso(), locked_at: null, locked_by: null, last_error: null }
    : { locked_at: null, locked_by: null, last_error: input.errorMessage ?? 'Mailbox polling failed' }

  const { error } = await supabaseService.from('ediel_mailboxes').update(payload).eq('id', input.mailboxId)
  if (error) throw error
}

export async function storeInboundEmail(input: StoreInboundEmailInput): Promise<{ id: string; deduped: boolean }> {
  const dedupeKey = input.internetMessageId ? `${input.mailboxId}:${input.internetMessageId}` : null

  const { data, error } = await supabaseService
    .from('inbound_email_messages')
    .insert({
      mailbox_id: input.mailboxId,
      company_id: input.companyId ?? null,
      internet_message_id: input.internetMessageId ?? null,
      from_address: input.fromAddress ?? null,
      to_address: input.toAddress ?? null,
      subject: input.subject ?? null,
      received_at: input.receivedAt ?? nowIso(),
      raw_email: input.rawEmail ?? null,
      raw_edifact_payload: input.rawEdifactPayload ?? null,
      body_text: input.bodyText ?? null,
      body_html: input.bodyHtml ?? null,
      has_attachments: input.hasAttachments ?? false,
      processing_status: 'received',
      dedupe_key: dedupeKey,
      match_status: 'not_checked',
    })
    .select('id')
    .single()

  if (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : ''
    if (code === '23505' && input.internetMessageId) {
      const existing = await supabaseService
        .from('inbound_email_messages')
        .select('id')
        .eq('mailbox_id', input.mailboxId)
        .eq('internet_message_id', input.internetMessageId)
        .maybeSingle()

      if (existing.error) throw existing.error
      const id = (existing.data as { id?: string } | null)?.id
      if (id) return { id, deduped: true }
    }

    throw error
  }

  const id = (data as { id: string }).id

  await supabaseService.from('inbound_processing_jobs').insert({
    company_id: input.companyId ?? null,
    mailbox_id: input.mailboxId,
    inbound_email_message_id: id,
    status: 'queued',
    step: 'received',
    payload: { dedupeKey },
  })

  return { id, deduped: false }
}

async function storeMailboxFetchMessage(input: {
  mailbox: EdielMailboxRow
  message: Record<string, unknown>
}): Promise<{ id: string; deduped: boolean }> {
  const rawEmail = bufferToUtf8(input.message.source)
  const envelope = input.message.envelope as Record<string, unknown> | null | undefined
  const messageId =
    stringOrNull(envelope?.messageId) ??
    extractHeader(rawEmail, 'Message-ID') ??
    (typeof input.message.uid === 'number' ? `${input.mailbox.id}:uid:${input.message.uid}` : null)

  const fromAddress =
    stringOrNull(extractHeader(rawEmail, 'From')) ??
    stringOrNull((Array.isArray(envelope?.from) ? envelope?.from?.[0] as Record<string, unknown> : null)?.address)

  const toAddress =
    stringOrNull(extractHeader(rawEmail, 'To')) ??
    stringOrNull((Array.isArray(envelope?.to) ? envelope?.to?.[0] as Record<string, unknown> : null)?.address)

  const subject = stringOrNull(envelope?.subject) ?? extractHeader(rawEmail, 'Subject')
  const internalDate = input.message.internalDate instanceof Date ? input.message.internalDate.toISOString() : null

  return storeInboundEmail({
    mailboxId: input.mailbox.id,
    companyId: input.mailbox.company_id,
    internetMessageId: messageId,
    fromAddress,
    toAddress,
    subject,
    receivedAt: internalDate,
    rawEmail,
    bodyText: rawEmail,
    hasAttachments: false,
  })
}

export async function pollEdielMailbox(input: {
  mailbox: EdielMailboxRow
  workerId?: string
  maxMessages?: number
  markSeen?: boolean
}): Promise<PollMailboxResult> {
  const workerId = input.workerId ?? 'inbound-mail-engine'
  const result: PollMailboxResult = {
    mailboxId: input.mailbox.id,
    mailboxName: input.mailbox.mailbox_name,
    stored: 0,
    deduped: 0,
    processed: 0,
    errors: [],
  }

  await markMailboxPollStarted(input.mailbox.id, workerId)

  try {
    if (!input.mailbox.imap_host || !input.mailbox.username) {
      throw new Error('Mailbox saknar imap_host eller username.')
    }

    const password = passwordFromSecretReference(input.mailbox)
    if (!password) {
      throw new Error('Mailbox saknar giltig secret_reference/env-lösenord.')
    }

    const client = new ImapFlow({
      host: input.mailbox.imap_host,
      port: input.mailbox.imap_port ?? 993,
      secure: (input.mailbox.imap_port ?? 993) === 993,
      auth: {
        user: input.mailbox.username,
        pass: password,
      },
      logger: false,
    })

    await client.connect()
    const lock = await client.getMailboxLock('INBOX')

    try {
      let fetched = 0
      const fetchOptions = { uid: true, envelope: true, source: true, internalDate: true }

      for await (const message of client.fetch({ seen: false }, fetchOptions)) {
        if (fetched >= (input.maxMessages ?? 25)) break
        fetched += 1

        const stored = await storeMailboxFetchMessage({ mailbox: input.mailbox, message: message as unknown as Record<string, unknown> })
        if (stored.deduped) result.deduped += 1
        else result.stored += 1

        if (input.markSeen !== false && typeof (message as { uid?: unknown }).uid === 'number') {
          await client.messageFlagsAdd((message as { uid: number }).uid, ['\\Seen'], { uid: true })
        }
      }
    } finally {
      lock.release()
      await client.logout().catch(() => undefined)
    }

    await markMailboxPollFinished({ mailboxId: input.mailbox.id, ok: true })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt pollingfel.'
    result.errors.push(message)
    await markMailboxPollFinished({ mailboxId: input.mailbox.id, ok: false, errorMessage: message })
    return result
  }
}

export async function listQueuedInboundProcessingJobs(limit = 50): Promise<InboundProcessingJobRow[]> {
  const { data, error } = await supabaseService
    .from('inbound_processing_jobs')
    .select('*')
    .in('status', ['queued', 'retry'])
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as InboundProcessingJobRow[]
}

async function markInboundProcessingJobStarted(jobId: string, workerId: string): Promise<void> {
  const { error } = await supabaseService
    .from('inbound_processing_jobs')
    .update({
      status: 'processing',
      step: 'processor_started',
      locked_at: nowIso(),
      locked_by: workerId,
      started_at: nowIso(),
      attempts_count: 1,
      error_message: null,
      updated_at: nowIso(),
    })
    .eq('id', jobId)

  if (error) throw error
}

async function markInboundProcessingJobFinished(input: {
  jobId: string
  status: 'processed' | 'manual_review' | 'failed'
  step?: string | null
  errorMessage?: string | null
}): Promise<void> {
  const { error } = await supabaseService
    .from('inbound_processing_jobs')
    .update({
      status: input.status,
      step: input.step ?? input.status,
      locked_at: null,
      locked_by: null,
      finished_at: nowIso(),
      error_message: input.errorMessage ?? null,
      updated_at: nowIso(),
    })
    .eq('id', input.jobId)

  if (error) throw error
}

export async function processQueuedInboundProcessingJobs(input: {
  workerId?: string
  limit?: number
  actorUserId?: string | null
} = {}): Promise<{ processed: number; failed: number }> {
  const workerId = input.workerId ?? 'inbound-mail-engine'
  const jobs = await listQueuedInboundProcessingJobs(input.limit ?? 50)
  let processed = 0
  let failed = 0

  for (const job of jobs) {
    if (!job.inbound_email_message_id) {
      await markInboundProcessingJobFinished({ jobId: job.id, status: 'failed', step: 'missing_inbound_email_message_id', errorMessage: 'Job saknar inbound_email_message_id.' })
      failed += 1
      continue
    }

    try {
      await markInboundProcessingJobStarted(job.id, workerId)
      const outcome = await processInboundEmailMessage({ inboundEmailMessageId: job.inbound_email_message_id, actorUserId: input.actorUserId ?? null })
      await markInboundProcessingJobFinished({
        jobId: job.id,
        status: outcome.status === 'processed' ? 'processed' : 'manual_review',
        step: outcome.status,
      })
      processed += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Okänt processfel.'
      await markInboundProcessingJobFinished({ jobId: job.id, status: 'failed', step: 'processor_failed', errorMessage: message })
      failed += 1
    }
  }

  return { processed, failed }
}

export async function runInboundEdielMailEngine(input: {
  environment?: string | null
  workerId?: string
  pollLimit?: number
  messageLimitPerMailbox?: number
  processLimit?: number
  actorUserId?: string | null
} = {}): Promise<InboundEngineRunResult> {
  const startedAt = nowIso()
  const workerId = input.workerId ?? `inbound-mail-engine-${startedAt}`
  const mailboxes = (await listDueEdielMailboxes({ environment: input.environment })).slice(0, input.pollLimit ?? envInt('EDIEL_INBOUND_MAILBOX_POLL_LIMIT', 10))
  const results: PollMailboxResult[] = []

  for (const mailbox of mailboxes) {
    results.push(await pollEdielMailbox({
      mailbox,
      workerId,
      maxMessages: input.messageLimitPerMailbox ?? envInt('EDIEL_INBOUND_MESSAGE_LIMIT_PER_MAILBOX', 25),
    }))
  }

  const queueResult = await processQueuedInboundProcessingJobs({
    workerId,
    limit: input.processLimit ?? envInt('EDIEL_INBOUND_PROCESS_LIMIT', 50),
    actorUserId: input.actorUserId ?? null,
  })
  const overdueTasks = await createInboundOverdueTasks()

  return {
    workerId,
    startedAt,
    finishedAt: nowIso(),
    mailboxesChecked: mailboxes.length,
    storedEmails: results.reduce((sum, item) => sum + item.stored, 0),
    dedupedEmails: results.reduce((sum, item) => sum + item.deduped, 0),
    processedJobs: queueResult.processed,
    failedJobs: queueResult.failed,
    overdueTasks,
    results,
  }
}
