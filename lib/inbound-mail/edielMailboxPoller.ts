import { ImapFlow } from 'imapflow'
import { extractEdifactPayload, parseEdifactPayload } from '@/lib/inbound-mail/edielEmailParser'
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
  environment?: string | null
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
  environment: string
  fetched: number
  stored: number
  deduped: number
  skippedLocked: boolean
  inboundEmailMessageIds: string[]
  dedupedInboundEmailMessageIds: string[]
  processed: number
  errors: string[]
}

export type MailboxPollDebugItem = {
  mailboxId: string
  mailboxName: string
  companyId: string | null
  environment: string
  lastPolledAt: string | null
  lockedAt: string | null
  pollIntervalMinutes: number
  skipReason?: 'locked' | 'not_due'
}

export type InboundEngineRunResult = {
  workerId: string
  startedAt: string
  finishedAt: string
  mailboxesChecked: number
  configuredMailboxes: number
  dueMailboxes: number
  skippedLockedMailboxes: number
  skippedNotDueMailboxes: number
  fetchedMessages: number
  storedEmails: number
  dedupedEmails: number
  processedJobs: number
  failedJobs: number
  overdueTasks: { ackOverdue: number; z04Overdue: number; z14Overdue: number }
  inboundEmailMessageIds: string[]
  edielMessageIds: string[]
  debug: {
    configuredMailboxes: MailboxPollDebugItem[]
    dueMailboxes: MailboxPollDebugItem[]
    skippedLocked: MailboxPollDebugItem[]
    skippedNotDue: MailboxPollDebugItem[]
    messagesFetched: number
    messagesStored: number
    jobsProcessed: number
    errorsByMailbox: Array<{ mailboxId: string; mailboxName: string; errors: string[] }>
    configurationError: string | null
  }
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

function isPlatformSharedMailbox(mailbox: Pick<EdielMailboxRow, 'company_id' | 'environment' | 'metadata'>): boolean {
  const scope = typeof mailbox.metadata?.scope === 'string' ? mailbox.metadata.scope : null
  if (scope === 'platform_shared') return mailbox.company_id === null
  return mailbox.company_id === null && mailbox.environment === 'test'
}

function normalizeEnvironment(value: string | null | undefined): 'test' | 'production' | null {
  if (value === 'test' || value === 'production') return value
  return null
}

function envValue(...names: string[]): string | null {
  for (const name of names) {
    const value = stringOrNull(process.env[name])
    if (value) return value
  }
  return null
}

function envIntValue(fallback: number, ...names: string[]): number {
  for (const name of names) {
    const value = Number.parseInt(process.env[name] ?? '', 10)
    if (Number.isFinite(value) && value > 0) return value
  }
  return fallback
}

function envSecretReference(environment: 'test' | 'production'): string | null {
  const envKey = environment.toUpperCase()
  const explicit = envValue(
    `GRIDEX_SHARED_EDIEL_${envKey}_IMAP_SECRET_REFERENCE`,
    'GRIDEX_SHARED_EDIEL_IMAP_SECRET_REFERENCE'
  )
  if (explicit) return explicit

  const passwordEnvName = [
    `GRIDEX_SHARED_EDIEL_${envKey}_IMAP_PASS`,
    `GRIDEX_SHARED_EDIEL_${envKey}_IMAP_PASSWORD`,
    'GRIDEX_SHARED_EDIEL_IMAP_PASS',
    'GRIDEX_SHARED_EDIEL_IMAP_PASSWORD',
    `EDIEL_${envKey}_IMAP_PASS`,
    `EDIEL_${envKey}_IMAP_PASSWORD`,
    'EDIEL_IMAP_PASS',
    'EDIEL_IMAP_PASSWORD',
  ].find((name) => stringOrNull(process.env[name]))

  return passwordEnvName ? `env:${passwordEnvName}` : null
}

async function bootstrapSharedMailboxFromEnv(environmentInput: string | null | undefined): Promise<EdielMailboxRow | null> {
  const environment = normalizeEnvironment(environmentInput) ?? 'test'
  const envKey = environment.toUpperCase()
  const emailAddress = envValue(
    `GRIDEX_SHARED_EDIEL_${envKey}_EMAIL`,
    `GRIDEX_SHARED_EDIEL_${envKey}_IMAP_EMAIL`,
    'GRIDEX_SHARED_EDIEL_EMAIL',
    'GRIDEX_SHARED_EDIEL_IMAP_EMAIL',
    'EDIEL_INBOUND_EMAIL',
    `EDIEL_${envKey}_IMAP_EMAIL`,
    'EDIEL_IMAP_EMAIL',
    `EDIEL_${envKey}_IMAP_USER`,
    'EDIEL_IMAP_USER'
  )
  const imapHost = envValue(
    `GRIDEX_SHARED_EDIEL_${envKey}_IMAP_HOST`,
    `GRIDEX_SHARED_${envKey}_EDIEL_IMAP_HOST`,
    'GRIDEX_SHARED_EDIEL_IMAP_HOST',
    'EDIEL_INBOUND_IMAP_HOST',
    `EDIEL_${envKey}_IMAP_HOST`,
    'EDIEL_IMAP_HOST'
  )
  const username = envValue(
    `GRIDEX_SHARED_EDIEL_${envKey}_IMAP_USERNAME`,
    `GRIDEX_SHARED_EDIEL_${envKey}_IMAP_USER`,
    'GRIDEX_SHARED_EDIEL_IMAP_USERNAME',
    'GRIDEX_SHARED_EDIEL_IMAP_USER',
    'EDIEL_INBOUND_IMAP_USERNAME',
    'EDIEL_INBOUND_IMAP_USER',
    `EDIEL_${envKey}_IMAP_USERNAME`,
    `EDIEL_${envKey}_IMAP_USER`,
    'EDIEL_IMAP_USERNAME',
    'EDIEL_IMAP_USER'
  ) ?? emailAddress
  const secretReference = envSecretReference(environment)

  if (!emailAddress || !imapHost || !username || !secretReference) return null

  const payload = {
    company_id: null,
    environment,
    mailbox_name: `Gridex shared ${environment} Ediel`,
    email_address: emailAddress,
    imap_host: imapHost,
    imap_port: envIntValue(
      993,
      `GRIDEX_SHARED_EDIEL_${envKey}_IMAP_PORT`,
      'GRIDEX_SHARED_EDIEL_IMAP_PORT',
      'EDIEL_INBOUND_IMAP_PORT',
      `EDIEL_${envKey}_IMAP_PORT`,
      'EDIEL_IMAP_PORT'
    ),
    username,
    secret_reference: secretReference,
    is_active: true,
    poll_interval_minutes: 5,
    metadata: {
      scope: 'platform_shared',
      imap_folder: envValue(
        `GRIDEX_SHARED_EDIEL_${envKey}_IMAP_FOLDER`,
        'GRIDEX_SHARED_EDIEL_IMAP_FOLDER',
        'EDIEL_INBOUND_IMAP_FOLDER',
        `EDIEL_${envKey}_IMAP_FOLDER`,
        'EDIEL_IMAP_FOLDER'
      ) ?? 'INBOX',
      bootstrappedFromEnv: true,
    },
    updated_at: nowIso(),
  }

  const { data, error } = await supabaseService
    .from('ediel_mailboxes')
    .insert(payload)
    .select('*')
    .single()

  if (error) throw error
  return data as EdielMailboxRow
}

function parseInboundDedupeFacts(rawPayload: string | null | undefined): {
  senderEdielId: string | null
  receiverEdielId: string | null
  interchangeReference: string | null
  transactionReference: string | null
  externalReference: string | null
  messageFamily: string | null
  messageCode: string | null
} {
  if (!rawPayload) {
    return {
      senderEdielId: null,
      receiverEdielId: null,
      interchangeReference: null,
      transactionReference: null,
      externalReference: null,
      messageFamily: null,
      messageCode: null,
    }
  }

  try {
    const parsed = parseEdifactPayload(rawPayload)
    return {
      senderEdielId: parsed.senderEdielId,
      receiverEdielId: parsed.receiverEdielId,
      interchangeReference: parsed.interchangeReference,
      transactionReference: parsed.transactionReference,
      externalReference: parsed.bgmReference ?? parsed.references.ACW?.[0] ?? parsed.references.TN?.[0] ?? parsed.references.LI?.[0] ?? null,
      messageFamily: parsed.messageFamily === 'OTHER' ? null : parsed.messageFamily,
      messageCode: parsed.messageCode,
    }
  } catch {
    return {
      senderEdielId: null,
      receiverEdielId: null,
      interchangeReference: null,
      transactionReference: null,
      externalReference: null,
      messageFamily: null,
      messageCode: null,
    }
  }
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

function mailboxDebugItem(mailbox: EdielMailboxRow, skipReason?: MailboxPollDebugItem['skipReason']): MailboxPollDebugItem {
  return {
    mailboxId: mailbox.id,
    mailboxName: mailbox.mailbox_name,
    companyId: mailbox.company_id,
    environment: mailbox.environment,
    lastPolledAt: mailbox.last_polled_at,
    lockedAt: mailbox.locked_at,
    pollIntervalMinutes: Number(mailbox.poll_interval_minutes || 10),
    ...(skipReason ? { skipReason } : {}),
  }
}

function mailboxSkipReason(
  mailbox: EdielMailboxRow,
  options: { nowMs?: number; includeLockedOlderThanMinutes?: number; force?: boolean } = {}
): MailboxPollDebugItem['skipReason'] | null {
  const now = options.nowMs ?? Date.now()
  const staleLockMs = (options.includeLockedOlderThanMinutes ?? 30) * 60_000

  if (mailbox.locked_at) {
    const lockedAt = new Date(mailbox.locked_at).getTime()
    if (!options.force && !Number.isNaN(lockedAt) && now - lockedAt < staleLockMs) return 'locked'
  }

  if (options.force || !mailbox.last_polled_at) return null
  const last = new Date(mailbox.last_polled_at).getTime()
  if (Number.isNaN(last)) return null
  return now - last >= Number(mailbox.poll_interval_minutes || 10) * 60_000 ? null : 'not_due'
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
  sharedOnly?: boolean
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

  const rows = (data ?? []) as EdielMailboxRow[]
  if (!options.sharedOnly) return rows

  const shared = rows.filter(isPlatformSharedMailbox)
  if (shared.length > 0) return shared

  const bootstrapped = await bootstrapSharedMailboxFromEnv(options.environment)
  if (bootstrapped) return [bootstrapped]

  return rows.filter((mailbox) => mailbox.company_id === null && mailbox.environment === 'test')
}

export async function listDueEdielMailboxes(options: {
  companyId?: string | null
  environment?: string | null
  mailboxId?: string | null
  includeLockedOlderThanMinutes?: number
  force?: boolean
  sharedOnly?: boolean
} = {}): Promise<EdielMailboxRow[]> {
  const configuredMailboxes = await listConfiguredEdielMailboxes(options)
  if (configuredMailboxes.length === 0) {
    throw new Error(NO_ACTIVE_EDIEL_MAILBOX_ERROR)
  }

  return configuredMailboxes.filter((mailbox) => isEdielMailboxDueForPolling(mailbox, options))
}

export async function markMailboxPollStarted(mailboxId: string, workerId = 'inbound-mail-engine', forceLock = false): Promise<boolean> {
  const staleCutoff = new Date(Date.now() - envInt('EDIEL_INBOUND_STALE_MAILBOX_LOCK_MINUTES', 30) * 60_000).toISOString()
  let query = supabaseService
    .from('ediel_mailboxes')
    .update({ last_polled_at: nowIso(), locked_at: nowIso(), locked_by: workerId, last_error: null, updated_at: nowIso() })
    .eq('id', mailboxId)

  if (!forceLock) {
    query = query.or(`locked_at.is.null,locked_at.lt.${staleCutoff}`)
  }

  const { data, error } = await query
    .select('id')
    .maybeSingle()

  if (error) throw error
  return Boolean(data)
}

export async function markMailboxPollFinished(input: {
  mailboxId: string
  ok: boolean
  errorMessage?: string | null
}): Promise<void> {
  const payload = input.ok
    ? { last_successful_poll_at: nowIso(), locked_at: null, locked_by: null, last_error: null, updated_at: nowIso() }
    : { locked_at: null, locked_by: null, last_error: input.errorMessage ?? 'Mailbox polling failed', updated_at: nowIso() }

  const { error } = await supabaseService.from('ediel_mailboxes').update(payload).eq('id', input.mailboxId)
  if (error) throw error
}

async function findExistingInboundEmail(input: {
  mailboxId: string
  internetMessageId?: string | null
  senderEdielId?: string | null
  interchangeReference?: string | null
  transactionReference?: string | null
  externalReference?: string | null
}): Promise<string | null> {
  if (input.internetMessageId) {
    const { data, error } = await supabaseService
      .from('inbound_email_messages')
      .select('id')
      .eq('mailbox_id', input.mailboxId)
      .eq('internet_message_id', input.internetMessageId)
      .limit(1)
      .maybeSingle()

    if (error) throw error
    const id = (data as { id?: string } | null)?.id
    if (id) return id
  }

  if (input.senderEdielId && input.interchangeReference) {
    const { data, error } = await supabaseService
      .from('inbound_email_messages')
      .select('id')
      .eq('sender_ediel_id', input.senderEdielId)
      .eq('interchange_reference', input.interchangeReference)
      .limit(1)
      .maybeSingle()

    if (error) throw error
    const id = (data as { id?: string } | null)?.id
    if (id) return id
  }

  if (input.senderEdielId && input.transactionReference && input.externalReference) {
    const { data, error } = await supabaseService
      .from('inbound_email_messages')
      .select('id')
      .eq('sender_ediel_id', input.senderEdielId)
      .eq('transaction_reference', input.transactionReference)
      .eq('external_reference', input.externalReference)
      .limit(1)
      .maybeSingle()

    if (error) throw error
    return (data as { id?: string } | null)?.id ?? null
  }

  return null
}

export async function storeInboundEmail(input: StoreInboundEmailInput): Promise<{ id: string; deduped: boolean }> {
  const dedupeKey = input.internetMessageId ? `${input.mailboxId}:${input.internetMessageId}` : null
  const dedupeFacts = parseInboundDedupeFacts(input.rawEdifactPayload)
  const existing = await findExistingInboundEmail({
    mailboxId: input.mailboxId,
    internetMessageId: input.internetMessageId ?? null,
    senderEdielId: dedupeFacts.senderEdielId,
    interchangeReference: dedupeFacts.interchangeReference,
    transactionReference: dedupeFacts.transactionReference,
    externalReference: dedupeFacts.externalReference,
  })

  if (existing) return { id: existing, deduped: true }

  const { data, error } = await supabaseService
    .from('inbound_email_messages')
    .insert({
      mailbox_id: input.mailboxId,
      company_id: input.companyId ?? null,
      environment: normalizeEnvironment(input.environment) ?? 'test',
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
      sender_ediel_id: dedupeFacts.senderEdielId,
      receiver_ediel_id: dedupeFacts.receiverEdielId,
      interchange_reference: dedupeFacts.interchangeReference,
      transaction_reference: dedupeFacts.transactionReference,
      external_reference: dedupeFacts.externalReference,
      message_family: dedupeFacts.messageFamily,
      message_code: dedupeFacts.messageCode,
    })
    .select('id')
    .single()

  if (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : ''
    if (code === '23505') {
      const existingAfterConflict = await findExistingInboundEmail({
        mailboxId: input.mailboxId,
        internetMessageId: input.internetMessageId ?? null,
        senderEdielId: dedupeFacts.senderEdielId,
        interchangeReference: dedupeFacts.interchangeReference,
        transactionReference: dedupeFacts.transactionReference,
        externalReference: dedupeFacts.externalReference,
      })
      if (existingAfterConflict) return { id: existingAfterConflict, deduped: true }
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
    companyId: isPlatformSharedMailbox(input.mailbox) ? null : input.mailbox.company_id,
    environment: input.mailbox.environment,
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
  forceLock?: boolean
}): Promise<PollMailboxResult> {
  const workerId = input.workerId ?? 'inbound-mail-engine'
  const result: PollMailboxResult = {
    mailboxId: input.mailbox.id,
    mailboxName: input.mailbox.mailbox_name,
    environment: input.mailbox.environment,
    fetched: 0,
    stored: 0,
    deduped: 0,
    skippedLocked: false,
    inboundEmailMessageIds: [],
    dedupedInboundEmailMessageIds: [],
    processed: 0,
    errors: [],
  }

  const locked = await markMailboxPollStarted(input.mailbox.id, workerId, input.forceLock ?? false)
  if (!locked) {
    result.skippedLocked = true
    return result
  }

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
        result.fetched += 1

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

async function listRecentParsedInboundEmailIds(limit = 50): Promise<string[]> {
  const { data, error } = await supabaseService
    .from('inbound_ediel_parse_results')
    .select('inbound_email_message_id')
    .not('inbound_email_message_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  return Array.from(new Set(
    ((data ?? []) as Array<{ inbound_email_message_id?: string | null }>)
      .map((row) => row.inbound_email_message_id)
      .filter((id): id is string => Boolean(id))
  ))
}

async function ensureDiagnosticEdielMessagesForInboundEmails(inboundEmailMessageIds: string[]): Promise<string[]> {
  const ids = Array.from(new Set(inboundEmailMessageIds.filter(Boolean)))
  if (ids.length === 0) return []

  const existingIds = await listEdielMessageIdsForInboundEmails(ids)
  const { data: existingMessages, error: existingError } = await supabaseService
    .from('ediel_messages')
    .select('inbound_email_message_id')
    .in('inbound_email_message_id', ids)

  if (existingError) throw existingError
  const existingInboundIds = new Set(
    ((existingMessages ?? []) as Array<{ inbound_email_message_id?: string | null }>)
      .map((row) => row.inbound_email_message_id)
      .filter((value): value is string => Boolean(value))
  )
  const missingIds = ids.filter((id) => !existingInboundIds.has(id))
  if (missingIds.length === 0) return existingIds

  const { data: parseRows, error: parseError } = await supabaseService
    .from('inbound_ediel_parse_results')
    .select('*')
    .in('inbound_email_message_id', missingIds)

  if (parseError) throw parseError

  const inserts = ((parseRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
    company_id: row.company_id ?? null,
    direction: 'inbound',
    message_standard: 'edifact',
    message_family: row.message_family ?? 'OTHER',
    message_code: row.message_code ?? null,
    environment: 'test',
    status: 'received',
    transport_type: 'email',
    sender_ediel_id: row.sender_ediel_id ?? null,
    sender_sub_address: row.sender_sub_address ?? null,
    receiver_ediel_id: row.receiver_ediel_id ?? null,
    receiver_sub_address: row.receiver_sub_address ?? null,
    interchange_reference: row.interchange_reference ?? null,
    transaction_reference: row.transaction_reference ?? null,
    application_reference: row.application_reference ?? null,
    external_reference: typeof row.parsed_payload === 'object' && row.parsed_payload
      ? (row.parsed_payload as Record<string, unknown>).bgmReference ?? null
      : null,
    raw_payload: row.raw_payload ?? null,
    parsed_payload: row.parsed_payload ?? {},
    validation_report: {
      status: 'diagnostic_message_created_from_inbound_parse_result',
      reason: 'Inbound mail was parsed but no ediel_messages row existed after tenant routing/manual review.',
      parseResultId: row.id,
    },
    tenant_resolution_status: row.company_id ? 'tenant_resolved' : 'tenant_unresolved',
    business_match_status: row.company_id ? 'not_checked' : 'business_blocked',
    processing_status: row.company_id ? 'received' : 'tenant_unresolved',
    inbound_email_message_id: row.inbound_email_message_id,
    message_received_at: nowIso(),
    parsed_at: nowIso(),
    failure_reason: row.company_id ? null : 'Tenant kunde inte lösas säkert; teknisk systemtest-rad skapades utan affärsuppdatering.',
  }))

  if (inserts.length === 0) return existingIds

  const { data: inserted, error: insertError } = await supabaseService
    .from('ediel_messages')
    .insert(inserts)
    .select('id')

  if (insertError) throw insertError

  return [
    ...existingIds,
    ...((inserted ?? []) as Array<{ id?: string | null }>)
      .map((row) => row.id)
      .filter((id): id is string => Boolean(id)),
  ]
}

async function logInboundPollRun(result: InboundEngineRunResult, requestedEnvironment: string | null): Promise<void> {
  await supabaseService.from('ediel_inbound_poll_runs').insert({
    worker_id: result.workerId,
    environment: normalizeEnvironment(requestedEnvironment) ?? null,
    started_at: result.startedAt,
    finished_at: result.finishedAt,
    status: result.failedJobs > 0 || result.debug.errorsByMailbox.length > 0 ? 'warning' : 'success',
    configured_mailboxes: result.configuredMailboxes,
    due_mailboxes: result.dueMailboxes,
    skipped_locked: result.skippedLockedMailboxes,
    skipped_not_due: result.skippedNotDueMailboxes,
    fetched_messages: result.fetchedMessages,
    stored_emails: result.storedEmails,
    deduped_emails: result.dedupedEmails,
    processed_jobs: result.processedJobs,
    failed_jobs: result.failedJobs,
    errors_by_mailbox: result.debug.errorsByMailbox,
    metadata: {
      inboundEmailMessageIds: result.inboundEmailMessageIds,
      edielMessageIds: result.edielMessageIds,
      overdueTasks: result.overdueTasks,
      configurationError: result.debug.configurationError,
    },
  })
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
  allowMissingMailboxConfig?: boolean
  actorUserId?: string | null
  sharedOnly?: boolean
  createDiagnosticMessagesForUnresolved?: boolean
} = {}): Promise<InboundEngineRunResult> {
  const startedAt = nowIso()
  const workerId = input.workerId ?? `inbound-mail-engine-${startedAt}`
  const force = input.force ?? input.forcePoll ?? false
  const sharedOnly = input.sharedOnly ?? (!input.companyId && !input.mailboxId)
  const configuredMailboxes = await listConfiguredEdielMailboxes({
    companyId: input.companyId,
    environment: input.environment,
    mailboxId: input.mailboxId,
    sharedOnly,
  })

  if (configuredMailboxes.length === 0 && !input.allowMissingMailboxConfig) {
    throw new Error(
      `${NO_ACTIVE_EDIEL_MAILBOX_ERROR} Skapa en platform_shared rad i ediel_mailboxes eller sätt env för bootstrap: GRIDEX_SHARED_EDIEL_${String(input.environment ?? 'TEST').toUpperCase()}_EMAIL, GRIDEX_SHARED_EDIEL_${String(input.environment ?? 'TEST').toUpperCase()}_IMAP_HOST, GRIDEX_SHARED_EDIEL_${String(input.environment ?? 'TEST').toUpperCase()}_IMAP_USER/USERNAME och GRIDEX_SHARED_EDIEL_${String(input.environment ?? 'TEST').toUpperCase()}_IMAP_PASS.`
    )
  }

  const eligibilityOptions = { force, includeLockedOlderThanMinutes: envInt('EDIEL_INBOUND_STALE_MAILBOX_LOCK_MINUTES', 30) }
  const dueMailboxes = configuredMailboxes.filter((mailbox) => mailboxSkipReason(mailbox, eligibilityOptions) === null)
  const skippedLocked = configuredMailboxes.filter((mailbox) => mailboxSkipReason(mailbox, eligibilityOptions) === 'locked')
  const skippedNotDue = configuredMailboxes.filter((mailbox) => mailboxSkipReason(mailbox, eligibilityOptions) === 'not_due')
  const mailboxes = dueMailboxes.slice(0, input.pollLimit ?? envInt('EDIEL_INBOUND_MAILBOX_POLL_LIMIT', 10))
  const results: PollMailboxResult[] = []

  for (const mailbox of mailboxes) {
    results.push(await pollEdielMailbox({
      mailbox,
      workerId,
      maxMessages: input.messageLimitPerMailbox ?? envInt('EDIEL_INBOUND_MESSAGE_LIMIT_PER_MAILBOX', 25),
      forceLock: force,
    }))
  }

  const queueResult = await processQueuedInboundProcessingJobs({
    workerId,
    limit: input.processLimit ?? envInt('EDIEL_INBOUND_PROCESS_LIMIT', 50),
    actorUserId: input.actorUserId ?? null,
  })
  const overdueTasks = await createInboundOverdueTasks()
  const inboundEmailMessageIds = results.flatMap((item) => item.inboundEmailMessageIds)
  const allInboundEmailMessageIds = results.flatMap((item) => [
    ...item.inboundEmailMessageIds,
    ...item.dedupedInboundEmailMessageIds,
  ])
  const diagnosticInboundEmailIds = input.createDiagnosticMessagesForUnresolved
    ? Array.from(new Set([
        ...allInboundEmailMessageIds,
        ...(await listRecentParsedInboundEmailIds(input.processLimit ?? 50)),
      ]))
    : allInboundEmailMessageIds
  const edielMessageIds = input.createDiagnosticMessagesForUnresolved
    ? await ensureDiagnosticEdielMessagesForInboundEmails(diagnosticInboundEmailIds)
    : await listEdielMessageIdsForInboundEmails(allInboundEmailMessageIds)
  const fetchedMessages = results.reduce((sum, item) => sum + item.fetched, 0)
  const storedEmails = results.reduce((sum, item) => sum + item.stored, 0)

  const result: InboundEngineRunResult = {
    workerId,
    startedAt,
    finishedAt: nowIso(),
    mailboxesChecked: mailboxes.length,
    configuredMailboxes: configuredMailboxes.length,
    dueMailboxes: dueMailboxes.length,
    skippedLockedMailboxes: skippedLocked.length,
    skippedNotDueMailboxes: skippedNotDue.length,
    fetchedMessages,
    storedEmails,
    dedupedEmails: results.reduce((sum, item) => sum + item.deduped, 0),
    processedJobs: queueResult.processed,
    failedJobs: queueResult.failed,
    overdueTasks,
    inboundEmailMessageIds,
    edielMessageIds,
    debug: {
      configuredMailboxes: configuredMailboxes.map((mailbox) => mailboxDebugItem(mailbox)),
      dueMailboxes: dueMailboxes.map((mailbox) => mailboxDebugItem(mailbox)),
      skippedLocked: skippedLocked.map((mailbox) => mailboxDebugItem(mailbox, 'locked')),
      skippedNotDue: skippedNotDue.map((mailbox) => mailboxDebugItem(mailbox, 'not_due')),
      messagesFetched: fetchedMessages,
      messagesStored: storedEmails,
      jobsProcessed: queueResult.processed,
      errorsByMailbox: results
        .filter((result) => result.errors.length > 0)
        .map((result) => ({ mailboxId: result.mailboxId, mailboxName: result.mailboxName, errors: result.errors })),
      configurationError: configuredMailboxes.length === 0 ? NO_ACTIVE_EDIEL_MAILBOX_ERROR : null,
    },
    results,
  }

  await logInboundPollRun(result, input.environment ?? null).catch(() => null)
  return result
}
