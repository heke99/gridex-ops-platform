import { ImapFlow } from 'imapflow'
import { extractEdifactPayload } from '@/lib/inbound-mail/edielEmailParser'
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

export type InboundEmailAttachmentInput = {
  filename?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
  rawText?: string | null
  isEdifactCandidate?: boolean
  metadata?: Record<string, unknown>
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
  attachments?: InboundEmailAttachmentInput[]
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
  inboundEmailMessageIds: string[]
  dedupedInboundEmailMessageIds: string[]
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
  inboundEmailMessageIds: string[]
  edielMessageIds: string[]
  results: PollMailboxResult[]
}

export const NO_ACTIVE_EDIEL_MAILBOX_ERROR = 'No active Ediel mailbox is configured for this company/environment.'

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

export function resolveMailboxPasswordFromSecretReference(mailbox: Pick<EdielMailboxRow, 'id' | 'secret_reference'>): string | null {
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

export function normalizeImapMailboxFolder(value: unknown): string {
  const folder = typeof value === 'string' ? value.trim() : ''
  if (!folder || folder.includes('@') || folder.toLowerCase().startsWith('smtp://')) return 'INBOX'
  return folder
}

export function isEdielMailboxDueForPolling(
  mailbox: Pick<EdielMailboxRow, 'locked_at' | 'last_polled_at' | 'poll_interval_minutes'>,
  options: { nowMs?: number; includeLockedOlderThanMinutes?: number; force?: boolean } = {}
): boolean {
  const now = options.nowMs ?? Date.now()
  const staleLockMs = (options.includeLockedOlderThanMinutes ?? 30) * 60_000

  if (mailbox.locked_at) {
    const lockedAt = new Date(mailbox.locked_at).getTime()
    if (!Number.isNaN(lockedAt) && now - lockedAt < staleLockMs) return false
  }

  if (options.force) return true
  if (!mailbox.last_polled_at) return true
  const intervalMinutes = Number(mailbox.poll_interval_minutes || 10)
  const last = new Date(mailbox.last_polled_at).getTime()
  if (Number.isNaN(last)) return true
  return now - last >= intervalMinutes * 60_000
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

function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
}

function decodeMimePart(body: string, transferEncoding: string | null): string {
  const encoding = transferEncoding?.toLowerCase()
  if (encoding === 'base64') {
    try {
      return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8')
    } catch {
      return body
    }
  }

  if (encoding === 'quoted-printable') return decodeQuotedPrintable(body)
  return body
}

function parseHeaderBlock(block: string): Record<string, string> {
  const headers: Record<string, string> = {}
  const unfolded = block.replace(/\r?\n[\t ]+/g, ' ')
  for (const line of unfolded.split(/\r?\n/)) {
    const index = line.indexOf(':')
    if (index <= 0) continue
    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim()
  }
  return headers
}

function headerParam(header: string | null | undefined, name: string): string | null {
  if (!header) return null
  const regex = new RegExp(`${name}\\*?=(?:UTF-8''|\")?([^\";]+)`, 'i')
  const match = header.match(regex)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1].replace(/"/g, '').trim())
  } catch {
    return match[1].replace(/"/g, '').trim()
  }
}

function splitMimeParts(rawEmail: string | null): { bodyText: string | null; bodyHtml: string | null; attachments: InboundEmailAttachmentInput[]; rawEdifactPayload: string | null } {
  if (!rawEmail) return { bodyText: null, bodyHtml: null, attachments: [], rawEdifactPayload: null }

  const firstBlank = rawEmail.search(/\r?\n\r?\n/)
  const rootHeader = firstBlank >= 0 ? rawEmail.slice(0, firstBlank) : ''
  const rootHeaders = parseHeaderBlock(rootHeader)
  const boundary = headerParam(rootHeaders['content-type'], 'boundary')

  const bodies: string[] = []
  const htmlBodies: string[] = []
  const attachments: InboundEmailAttachmentInput[] = []

  if (!boundary) {
    const body = firstBlank >= 0 ? rawEmail.slice(firstBlank).trim() : rawEmail
    const decoded = decodeMimePart(body, extractHeader(rawEmail, 'Content-Transfer-Encoding'))
    const payload = extractEdifactPayload(decoded)
    return { bodyText: decoded, bodyHtml: null, attachments: [], rawEdifactPayload: payload }
  }

  const delimiter = `--${boundary}`
  const rawParts = rawEmail.split(delimiter).slice(1).filter((part) => !part.trim().startsWith('--'))

  for (const rawPart of rawParts) {
    const part = rawPart.replace(/^\r?\n/, '')
    const separator = part.search(/\r?\n\r?\n/)
    if (separator < 0) continue

    const headerBlock = part.slice(0, separator)
    const bodyBlock = part.slice(separator).replace(/^\r?\n\r?\n/, '').replace(/\r?\n--$/, '').trim()
    const headers = parseHeaderBlock(headerBlock)
    const contentType = headers['content-type'] ?? ''
    const disposition = headers['content-disposition'] ?? ''
    const transferEncoding = headers['content-transfer-encoding'] ?? null
    const filename = headerParam(disposition, 'filename') ?? headerParam(contentType, 'name')
    const decoded = decodeMimePart(bodyBlock, transferEncoding)
    const lowerFilename = filename?.toLowerCase() ?? ''
    const isAttachment = /attachment/i.test(disposition) || Boolean(filename)
    const isEdifactCandidate = Boolean(extractEdifactPayload(decoded)) || /\.(edi|edifact|txt|dat)$/i.test(lowerFilename)

    if (isAttachment) {
      attachments.push({
        filename,
        mimeType: contentType.split(';')[0]?.trim() || null,
        sizeBytes: Buffer.byteLength(decoded, 'utf8'),
        rawText: decoded,
        isEdifactCandidate,
        metadata: { contentType, disposition, transferEncoding },
      })
      continue
    }

    if (/text\/html/i.test(contentType)) htmlBodies.push(decoded)
    else bodies.push(decoded)
  }

  const allText = [...attachments.filter((a) => a.isEdifactCandidate).map((a) => a.rawText ?? ''), ...bodies, ...htmlBodies, rawEmail]
  const rawEdifactPayload = allText.map((value) => extractEdifactPayload(value)).find((value): value is string => Boolean(value)) ?? null

  return {
    bodyText: bodies.join('\n\n') || null,
    bodyHtml: htmlBodies.join('\n\n') || null,
    attachments,
    rawEdifactPayload,
  }
}

export async function listConfiguredEdielMailboxes(options: {
  companyId?: string | null
  environment?: string | null
  mailboxId?: string | null
} = {}): Promise<EdielMailboxRow[]> {
  let query = supabaseService
    .from('ediel_mailboxes')
    .select('*')
    .eq('is_active', true)

  if (options.companyId) query = query.eq('company_id', options.companyId)
  if (options.environment) query = query.eq('environment', options.environment)
  if (options.mailboxId) query = query.eq('id', options.mailboxId)

  const { data, error } = await query.order('last_polled_at', { ascending: true, nullsFirst: true })
  if (error) throw error

  return (data ?? []) as EdielMailboxRow[]
}

export async function listDueEdielMailboxes(options: {
  companyId?: string | null
  environment?: string | null
  mailboxId?: string | null
  includeLockedOlderThanMinutes?: number
  force?: boolean
} = {}): Promise<EdielMailboxRow[]> {
  const configuredMailboxes = await listConfiguredEdielMailboxes(options)
  if (configuredMailboxes.length === 0) {
    throw new Error(NO_ACTIVE_EDIEL_MAILBOX_ERROR)
  }

  return configuredMailboxes.filter((mailbox) => isEdielMailboxDueForPolling(mailbox, options))
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
      has_attachments: input.hasAttachments ?? Boolean(input.attachments?.length),
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

  const attachments = input.attachments ?? []
  if (attachments.length > 0) {
    const { error: attachmentError } = await supabaseService.from('inbound_email_attachments').insert(attachments.map((attachment) => ({
      company_id: input.companyId ?? null,
      inbound_email_message_id: id,
      filename: attachment.filename ?? null,
      mime_type: attachment.mimeType ?? null,
      size_bytes: attachment.sizeBytes ?? null,
      raw_text: attachment.rawText ?? null,
      is_edifact_candidate: attachment.isEdifactCandidate ?? false,
      metadata: attachment.metadata ?? {},
    })))
    if (attachmentError) console.warn('[inbound-mail] Kunde inte spara bilagor', attachmentError)
  }

  const { error: jobError } = await supabaseService.from('inbound_processing_jobs').insert({
    company_id: input.companyId ?? null,
    mailbox_id: input.mailboxId,
    inbound_email_message_id: id,
    status: 'queued',
    step: 'received',
    payload: { dedupeKey, hasRawEdifactPayload: Boolean(input.rawEdifactPayload), attachmentCount: attachments.length },
  })
  if (jobError) throw jobError

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
  const parsedMime = splitMimeParts(rawEmail)

  return storeInboundEmail({
    mailboxId: input.mailbox.id,
    companyId: input.mailbox.company_id,
    internetMessageId: messageId,
    fromAddress,
    toAddress,
    subject,
    receivedAt: internalDate,
    rawEmail,
    rawEdifactPayload: parsedMime.rawEdifactPayload,
    bodyText: parsedMime.bodyText ?? rawEmail,
    bodyHtml: parsedMime.bodyHtml,
    hasAttachments: parsedMime.attachments.length > 0,
    attachments: parsedMime.attachments,
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
    inboundEmailMessageIds: [],
    dedupedInboundEmailMessageIds: [],
    processed: 0,
    errors: [],
  }

  await markMailboxPollStarted(input.mailbox.id, workerId)

  try {
    if (!input.mailbox.imap_host || !input.mailbox.username) {
      throw new Error('Mailbox saknar imap_host eller username.')
    }

    const password = resolveMailboxPasswordFromSecretReference(input.mailbox)
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
    const folder = normalizeImapMailboxFolder(input.mailbox.metadata?.imap_folder ?? input.mailbox.metadata?.folder)
    const lock = await client.getMailboxLock(folder)

    try {
      let fetched = 0
      const fetchOptions = { uid: true, envelope: true, source: true, internalDate: true }

      for await (const message of client.fetch({ seen: false }, fetchOptions)) {
        if (fetched >= (input.maxMessages ?? 25)) break
        fetched += 1

        const stored = await storeMailboxFetchMessage({ mailbox: input.mailbox, message: message as unknown as Record<string, unknown> })
        if (stored.deduped) {
          result.deduped += 1
          result.dedupedInboundEmailMessageIds.push(stored.id)
        } else {
          result.stored += 1
          result.inboundEmailMessageIds.push(stored.id)
        }

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
  const staleLockCutoff = new Date(Date.now() - envInt('EDIEL_INBOUND_STALE_JOB_LOCK_MINUTES', 15) * 60_000).toISOString()
  const { data, error } = await supabaseService
    .from('inbound_processing_jobs')
    .select('*')
    .in('status', ['queued', 'retry', 'processing'])
    .or(`locked_at.is.null,locked_at.lt.${staleLockCutoff}`)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) throw error
  const maxAttempts = envInt('EDIEL_INBOUND_MAX_JOB_ATTEMPTS', 5)
  return ((data ?? []) as InboundProcessingJobRow[]).filter((job) => Number(job.attempts_count ?? 0) < maxAttempts)
}

async function markInboundProcessingJobStarted(job: InboundProcessingJobRow, workerId: string): Promise<boolean> {
  const nextAttempts = Number(job.attempts_count ?? 0) + 1
  const { data, error } = await supabaseService
    .from('inbound_processing_jobs')
    .update({
      status: 'processing',
      step: 'processor_started',
      locked_at: nowIso(),
      locked_by: workerId,
      started_at: nowIso(),
      finished_at: null,
      attempts_count: nextAttempts,
      error_message: null,
      updated_at: nowIso(),
    })
    .eq('id', job.id)
    .select('id')
    .maybeSingle()

  if (error) throw error
  return Boolean(data)
}

async function markInboundProcessingJobFinished(input: {
  jobId: string
  status: 'done' | 'manual_review' | 'retry' | 'failed'
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
  const maxAttempts = envInt('EDIEL_INBOUND_MAX_JOB_ATTEMPTS', 5)
  let processed = 0
  let failed = 0

  for (const job of jobs) {
    if (!job.inbound_email_message_id) {
      await markInboundProcessingJobFinished({ jobId: job.id, status: 'failed', step: 'missing_inbound_email_message_id', errorMessage: 'Job saknar inbound_email_message_id.' })
      failed += 1
      continue
    }

    try {
      const locked = await markInboundProcessingJobStarted(job, workerId)
      if (!locked) continue
      const outcome = await processInboundEmailMessage({ inboundEmailMessageId: job.inbound_email_message_id, actorUserId: input.actorUserId ?? null })
      await markInboundProcessingJobFinished({
        jobId: job.id,
        status: outcome.status === 'processed' ? 'done' : 'manual_review',
        step: outcome.status,
      })
      processed += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Okänt processfel.'
      const nextAttempts = Number(job.attempts_count ?? 0) + 1
      const shouldRetry = nextAttempts < maxAttempts
      await markInboundProcessingJobFinished({ jobId: job.id, status: shouldRetry ? 'retry' : 'failed', step: 'processor_failed', errorMessage: message })
      failed += 1
    }
  }

  return { processed, failed }
}

async function listEdielMessageIdsForInboundEmails(inboundEmailMessageIds: string[]): Promise<string[]> {
  const ids = Array.from(new Set(inboundEmailMessageIds.filter(Boolean)))
  if (ids.length === 0) return []

  const { data, error } = await supabaseService
    .from('ediel_messages')
    .select('id')
    .in('inbound_email_message_id', ids)
    .order('created_at', { ascending: false })

  if (error) throw error
  return ((data ?? []) as Array<{ id?: string | null }>)
    .map((row) => row.id)
    .filter((id): id is string => Boolean(id))
}

export async function runInboundEdielMailEngine(input: {
  companyId?: string | null
  environment?: string | null
  mailboxId?: string | null
  workerId?: string
  pollLimit?: number
  messageLimitPerMailbox?: number
  processLimit?: number
  force?: boolean
  forcePoll?: boolean
  actorUserId?: string | null
} = {}): Promise<InboundEngineRunResult> {
  const startedAt = nowIso()
  const workerId = input.workerId ?? `inbound-mail-engine-${startedAt}`
  const force = input.force ?? input.forcePoll ?? false
  const mailboxes = (await listDueEdielMailboxes({
    companyId: input.companyId,
    environment: input.environment,
    mailboxId: input.mailboxId,
    force,
  })).slice(0, input.pollLimit ?? envInt('EDIEL_INBOUND_MAILBOX_POLL_LIMIT', 10))
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
  const inboundEmailMessageIds = results.flatMap((item) => item.inboundEmailMessageIds)
  const edielMessageIds = await listEdielMessageIdsForInboundEmails(inboundEmailMessageIds)

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
    inboundEmailMessageIds,
    edielMessageIds,
    results,
  }
}
