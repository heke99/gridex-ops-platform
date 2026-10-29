// lib/inbound-mail/manualMailboxPoller.ts
//
// Inbound IMAP poller for the MANUAL operations mailbox (e.g. leverantorsbyte@
// gridex.se). This is SEPARATE from the Ediel mailbox engine, which serves
// ediel@gridex.se for EDIFACT transport only.
//
// Every manual inbound message is persisted and handed to the tenant-first
// correlation layer. GX-FIR is strong evidence, not a prerequisite. The poller:
//   * NEVER parses EDIFACT, NEVER creates ediel_messages / ediel_outbox,
//   * passes tenant-specific mailbox scope only as correlation evidence,
//   * retains RFC reply headers so normal "Reply" mail can be correlated,
//   * reuses the env-only secret-reference + stale-lock patterns from Ediel.

import { ImapFlow } from 'imapflow'
import { createHash, randomUUID } from 'node:crypto'
import { inspectMimeStructure, mimeParameter } from '@/lib/inbound-mail/mimeStructure'
import { binaryToBuffer, decodeTextBytes, toBinaryString } from '@/lib/inbound-mail/mimeCharset'
import { extractAutoReplyHeaders } from '@/lib/inbound-mail/autoReply'
import { verifyManualMailSender } from '@/lib/inbound-mail/manualSenderVerification'
import { captureManualMailboxReceipt, MANUAL_MAILBOX_RECEIPT } from '@/lib/inbound-mail/manualMailboxReceipt'
import { supabaseService } from '@/lib/supabase/service'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'
import { resolveManualMailboxSecret } from '@/lib/email/manualOperationsMailbox'
import {
  ingestManualInboundEmail,
  type ManualInboundEmail,
  type ManualInboundResult,
} from '@/lib/inbound-mail/manualInboundIngestion'

type JsonRecord = Record<string, unknown>

export type ManualMailboxPollResult = {
  mailboxes: number
  polled: number
  fetched: number
  ingested: number
  matched: number
  ambiguous: number
  unmatched: number
  ignored: number
  skipped: number
  deadLettered: number
  errors: string[]
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function nowIso(): string {
  return new Date().toISOString()
}

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function parseMessageHeaderValues(headerText: string): { inReplyTo: string | null; references: string[] } {
  const unfolded = headerText.replace(/\r?\n[ \t]+/g, ' ')
  const inReplyTo = clean(/^in-reply-to:\s*(.+)$/im.exec(unfolded)?.[1])
  const referencesRaw = clean(/^references:\s*(.+)$/im.exec(unfolded)?.[1])
  const references = referencesRaw
    ? (referencesRaw.match(/<[^>]+>|[^\s]+/g) ?? []).map((value) => value.trim()).filter(Boolean).slice(0, 50)
    : []
  return { inReplyTo, references }
}

const MAX_CAPTURED_ATTACHMENTS = 5
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 6 * 1024 * 1024
const MAX_ATTACHMENT_TEXT_CHARACTERS = 200_000

// Small deterministic MIME reader for manual replies. It walks nested
// multipart structures (multipart/mixed > multipart/alternative) and decodes
// text by each part's own charset without executing or opening binary content.
// Forwarded messages and attached MIME subtrees remain separate from the
// newly authored reply, including when only their ancestor is an attachment.
export function parseMimeSource(source: unknown): {
  bodyText: string | null
  bodyHtml: string | null
  attachments: unknown[]
  inReplyTo: string | null
  references: string[]
  autoReplyHeaders: Record<string, string>
  mimeRequiresReview: boolean
} {
  const empty = { bodyText: null, bodyHtml: null, attachments: [], inReplyTo: null, references: [], autoReplyHeaders: {}, mimeRequiresReview: false }
  if (!source) return empty
  const binary = Buffer.isBuffer(source) || source instanceof Uint8Array ? toBinaryString(source) : toBinaryString(String(source))
  const separator = binary.search(/\r?\n\r?\n/)
  const headerText = separator >= 0 ? binary.slice(0, separator) : binary
  const replyHeaders = parseMessageHeaderValues(headerText)
  const autoReplyHeaders = extractAutoReplyHeaders(headerText)

  const { entities, issues, exceededLimits } = inspectMimeStructure(binary, { preserveBytes: true })
  const text: string[] = []
  const html: string[] = []
  const attachments: unknown[] = []
  const excludedSubtrees = new Set<number>()
  let totalAttachmentBytes = 0
  let captureRequiresReview = false
  for (const entity of entities) {
    // Entities are in document order. Propagate an excluded parent's status so
    // no nested text can be promoted to a current customer answer.
    if (entity.parent !== null && excludedSubtrees.has(entity.parent)) {
      excludedSubtrees.add(entity.index)
      continue
    }
    const disposition = entity.headers.get('content-disposition')?.[0] ?? ''
    const filename = mimeParameter(disposition, 'filename') ?? mimeParameter(entity.contentType, 'name')
    const forwardedMessage = entity.mediaType === 'message/rfc822' || entity.mediaType === 'message/global'
    const attachment = Boolean(filename) || /^attachment/i.test(disposition)
    if (!forwardedMessage && !attachment && entity.mediaType.startsWith('multipart/')) continue
    const bytes = binaryToBuffer(entity.body)
    const isText = entity.mediaType.startsWith('text/')
    const decoded = isText ? decodeTextBytes(bytes, mimeParameter(entity.contentType, 'charset')) : null
    const inlineBinary = !isText && !entity.mediaType.startsWith('multipart/')
    if (forwardedMessage || attachment || inlineBinary) {
      excludedSubtrees.add(entity.index)
      totalAttachmentBytes += bytes.length
      const withinCaptureBudget = attachments.length < MAX_CAPTURED_ATTACHMENTS
        && bytes.length <= MAX_ATTACHMENT_BYTES && totalAttachmentBytes <= MAX_TOTAL_ATTACHMENT_BYTES
      const capturedIssue = !bytes.length ? 'attachment_content_missing'
        : attachments.length >= MAX_CAPTURED_ATTACHMENTS ? 'attachment_count_limit'
          : bytes.length > MAX_ATTACHMENT_BYTES ? 'attachment_size_limit'
            : totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES ? 'attachment_total_size_limit'
              : decoded && decoded.length > MAX_ATTACHMENT_TEXT_CHARACTERS ? 'attachment_text_limit' : null
      if (capturedIssue) captureRequiresReview = true
      attachments.push({
        filename,
        contentType: entity.mediaType,
        sizeBytes: bytes.length,
        text: !capturedIssue && decoded ? decoded : null,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        mimePart: entity.index,
        sourceRole: forwardedMessage ? 'forwarded' : /^inline\b/i.test(disposition) || !attachment ? 'inline' : 'attachment',
        ...(withinCaptureBudget && bytes.length ? { contentBase64: bytes.toString('base64') } : {}),
        ...(capturedIssue ? { capturedIssue } : {}),
      })
    } else if (entity.mediaType === 'text/html') html.push(decoded ?? '')
    else if (isText) text.push(decoded ?? '')
  }
  return {
    bodyText: clean(text.join('\n')),
    bodyHtml: clean(html.join('\n')),
    attachments,
    ...replyHeaders,
    autoReplyHeaders,
    mimeRequiresReview: exceededLimits || issues.length > 0 || captureRequiresReview,
  }
}

function envelopeAddress(list: unknown): { address: string | null; name: string | null } {
  if (!Array.isArray(list) || list.length === 0) return { address: null, name: null }
  const first = list[0] as { address?: unknown; name?: unknown }
  return { address: clean(first.address), name: clean(first.name) }
}

async function listActiveManualMailboxes(environment?: string | null): Promise<JsonRecord[]> {
  let query = supabaseService
    .from('manual_communication_mailboxes')
    .select('id,company_id,environment,imap_host,imap_port,imap_username,imap_secret_reference,imap_folder,imap_secure,from_email,metadata,locked_at,locked_by,poll_interval_minutes,last_polled_at,is_verified')
    .eq('is_active', true)
    .eq('is_verified', true)
    .not('imap_host', 'is', null)
  if (clean(environment)) query = query.eq('environment', clean(environment))
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as JsonRecord[]
}

function isManualMailboxDueForPolling(mailbox: JsonRecord): boolean {
  const lastPolledAt = clean(mailbox.last_polled_at)
  if (!lastPolledAt) return true
  const intervalMinutes = Number(mailbox.poll_interval_minutes)
  const effectiveInterval = Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : 5
  const lastPolledTime = Date.parse(lastPolledAt)
  if (Number.isNaN(lastPolledTime)) return true
  // Cron starts have small scheduling jitter. Without this bounded tolerance,
  // a poll starting just before its configured interval skips a whole tick.
  const intervalMs = effectiveInterval * 60_000
  const earlyToleranceMs = Math.min(10_000, intervalMs / 2)
  return Date.now() - lastPolledTime >= intervalMs - earlyToleranceMs
}

async function claimMailbox(mailbox: JsonRecord, workerId: string): Promise<JsonRecord | null> {
  const staleCutoff = new Date(Date.now() - envInt('MANUAL_INBOUND_STALE_MAILBOX_LOCK_MINUTES', 30) * 60_000).toISOString()
  let query = supabaseService
    .from('manual_communication_mailboxes')
    .update({ last_polled_at: nowIso(), locked_at: nowIso(), locked_by: workerId, updated_at: nowIso() })
    .eq('id', String(mailbox.id)).eq('is_active', true).eq('is_verified', true)
    .or(`locked_at.is.null,locked_at.lt.${staleCutoff}`)
  const lastPolledAt = clean(mailbox.last_polled_at)
  query = lastPolledAt ? query.eq('last_polled_at', lastPolledAt) : query.is('last_polled_at', null)
  const { data, error } = await query.select('*').maybeSingle()
  if (error) throw error
  return data as JsonRecord | null
}

type MessageAttempt = {
  attempts: number; last_attempt_at: string; dead_lettered_at?: string; uid?: number | null
  uid_validity?: string; mailbox_fingerprint?: string
}
type MailboxScan = { version: 1; uid_validity: string; mailbox_fingerprint: string; last_scanned_uid: number }

const MAX_TRACKED_MESSAGE_ATTEMPTS = 500
const RUN_BUDGET_MS = 150_000

function validUid(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 0xffff_ffff
}

function attemptInScan(attempt: MessageAttempt, scan: MailboxScan): boolean {
  return attempt.uid_validity === scan.uid_validity && attempt.mailbox_fingerprint === scan.mailbox_fingerprint
}

function readMessageAttempts(metadata: unknown): Record<string, MessageAttempt> {
  const root = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as JsonRecord) : {}
  const stored = root.message_attempts
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
  const attempts: Record<string, MessageAttempt> = {}
  for (const [key, value] of Object.entries(stored as JsonRecord)) {
    const count = Number((value as JsonRecord | null)?.attempts)
    if (Number.isFinite(count) && count > 0) attempts[key] = { ...(value as MessageAttempt), attempts: Math.floor(count) }
  }
  return attempts
}

function withMessageAttempts(metadata: unknown, attempts: Record<string, MessageAttempt>, scan?: MailboxScan): JsonRecord {
  const root = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as JsonRecord) : {}
  const priority = (attempt: MessageAttempt) => scan && attemptInScan(attempt, scan) && !attempt.dead_lettered_at
    ? 0 : attempt.dead_lettered_at ? 2 : 1
  const newestFirst = Object.entries(attempts)
    .sort(([, a], [, b]) => priority(a) - priority(b)
      || String(b.last_attempt_at).localeCompare(String(a.last_attempt_at)))
    .slice(0, MAX_TRACKED_MESSAGE_ATTEMPTS)
  return { ...root, message_attempts: Object.fromEntries(newestFirst), ...(scan ? { manual_imap_scan: scan } : {}) }
}

// Stable per-message dedup key: the RFC Message-ID, else the SHA-256 of the
// raw source so mail without a Message-ID is still deduplicated on retry.
export function manualMessageDedupKey(messageId: string | null, source: unknown): string | null {
  if (messageId) return messageId
  if (Buffer.isBuffer(source) || source instanceof Uint8Array) return `sha256:${createHash('sha256').update(source).digest('hex')}`
  if (typeof source === 'string' && source) return `sha256:${createHash('sha256').update(source, 'utf8').digest('hex')}`
  return null
}

async function finishMailbox(mailboxId: string, workerId: string, ok: boolean, errorMessage?: string | null, metadata?: JsonRecord, expectedMetadata?: unknown): Promise<void> {
  const patch: JsonRecord = { locked_at: null, locked_by: null, updated_at: nowIso() }
  if (metadata) patch.metadata = metadata
  if (ok) {
    patch.last_successful_poll_at = nowIso()
    patch.last_error = null
  } else if (errorMessage) {
    patch.last_error = String(errorMessage).replace(/[\r\n]+/g, ' ').slice(0, 300)
  }
  let query = supabaseService.from('manual_communication_mailboxes').update(patch).eq('id', mailboxId).eq('locked_by', workerId)
  if (metadata) query = query.eq('metadata', JSON.stringify(expectedMetadata ?? {}))
  const finished = await query.select('id').maybeSingle()
  if (finished.error) throw finished.error
  if (!finished.data) {
    // A changed metadata document must survive. Release only our own lease;
    // never release or overwrite a replacement worker's checkpoint.
    const released = await supabaseService.from('manual_communication_mailboxes')
      .update({ locked_at: null, locked_by: null, updated_at: nowIso() })
      .eq('id', mailboxId).eq('locked_by', workerId).select('id').maybeSingle()
    if (released.error) throw released.error
    throw new Error('manual_mailbox_state_or_claim_changed')
  }
}

function countResolution(result: ManualMailboxPollResult, ingestResult: ManualInboundResult): void {
  if (ingestResult.resolutionStatus === 'matched') result.matched += 1
  else if (ingestResult.resolutionStatus === 'ambiguous') result.ambiguous += 1
  else if (ingestResult.resolutionStatus === 'ignored') result.ignored += 1
  else result.unmatched += 1
}

async function pollOneMailbox(listed: JsonRecord, workerId: string, result: ManualMailboxPollResult, hasBudget: () => boolean): Promise<void> {
  if (!isManualMailboxDueForPolling(listed) || !hasBudget()) {
    result.skipped += 1
    return
  }
  const mailbox = await claimMailbox(listed, workerId)
  if (!mailbox) {
    result.skipped += 1
    return
  }
  result.polled += 1
  const mailboxId = String(mailbox.id)
  const host = clean(mailbox.imap_host)
  const username = clean(mailbox.imap_username) ?? clean(mailbox.from_email)
  const password = resolveManualMailboxSecret(clean(mailbox.imap_secret_reference), mailboxId)
  if (!host || !username || !password) {
    await finishMailbox(mailboxId, workerId, false, 'manuell brevlåda saknar giltig IMAP-konfiguration eller env-lösenord.')
    result.errors.push(`mailbox ${mailboxId}: missing imap configuration or secret`)
    return
  }

  const port = typeof mailbox.imap_port === 'number' ? mailbox.imap_port : 993
  const client = new ImapFlow({
    host,
    port,
    secure: mailbox.imap_secure !== false,
    auth: { user: username, pass: password },
    logger: false,
    // Bounded so a stalled IMAP server fails this mailbox (recorded in
    // last_error) instead of hanging the cron until the 300s platform limit.
    connectionTimeout: 30_000,
    greetingTimeout: 15_000,
    socketTimeout: 90_000,
  })
  // After connect imapflow reports connection failures (e.g. socket timeout) as
  // 'error' events; without a listener Node throws them as uncaughtException.
  // The in-flight command is rejected too, so the catch below records it.
  client.on('error', (error: Error) => {
    console.warn('[manual-inbound] IMAP connection error', { mailboxId, error: error.message })
  })

  const maxMessages = Math.min(envInt('MANUAL_INBOUND_MESSAGE_LIMIT_PER_MAILBOX', 25), 100)
  const maxAttempts = envInt('MANUAL_INBOUND_MAX_ATTEMPTS_PER_MESSAGE', 5)
  const attempts = readMessageAttempts(mailbox.metadata)
  const terminalSeenUids: number[] = []
  let scan: MailboxScan | undefined
  let mailboxError: string | null = null
  try {
    await client.connect()
    const folder = clean(mailbox.imap_folder) ?? 'INBOX'
    const lock = await client.getMailboxLock(folder)
    try {
      const selected = client.mailbox
      if (!selected || typeof selected.uidValidity !== 'bigint' || selected.uidValidity <= BigInt(0)
        || !Number.isInteger(selected.uidNext) || selected.uidNext < 1 || selected.uidNext > 0x1_0000_0000) {
        throw new Error('manual_mailbox_uid_snapshot_missing')
      }
      const fingerprint = createHash('sha256').update(JSON.stringify([
        host.toLowerCase(), port, username, folder, mailbox.environment ?? null, mailbox.company_id ?? null,
      ])).digest('hex')
      const metadata = mailbox.metadata && typeof mailbox.metadata === 'object' ? mailbox.metadata as JsonRecord : {}
      const stored = metadata.manual_imap_scan as Partial<MailboxScan> | undefined
      const sameScan = stored?.version === 1 && stored.mailbox_fingerprint === fingerprint
        && stored.uid_validity === String(selected.uidValidity)
        && typeof stored.last_scanned_uid === 'number' && Number.isInteger(stored.last_scanned_uid)
        && stored.last_scanned_uid >= 0 && stored.last_scanned_uid <= 0xffff_ffff
      scan = { version: 1, mailbox_fingerprint: fingerprint, uid_validity: String(selected.uidValidity),
        last_scanned_uid: sameScan ? stored.last_scanned_uid! : selected.uidNext - 1 }
      if (!sameScan) {
        // UID numbers from another account/folder/epoch must never route history.
        for (const [key, value] of Object.entries(attempts)) {
          const audit = { ...value }
          delete audit.uid
          delete audit.uid_validity
          delete audit.mailbox_fingerprint
          attempts[key] = audit
        }
      }
      const inCurrentScan = (attempt: MessageAttempt) => attemptInScan(attempt, scan!)
      const retryUids = Object.values(attempts).filter(attempt => inCurrentScan(attempt) && !attempt.dead_lettered_at && validUid(attempt.uid)).map(attempt => attempt.uid as number)
      const deadUids = new Set(Object.values(attempts).filter(attempt => inCurrentScan(attempt) && attempt.dead_lettered_at && validUid(attempt.uid)).map(attempt => attempt.uid as number))
      // Bootstrap covers existing UNSEEN only. The captured UIDNEXT boundary
      // excludes historical Seen mail; every later UID is scanned regardless Seen.
      // Search new UIDs LAST so an arrival between searches cannot be skipped.
      const unseenUids = await client.search({ seen: false }, { uid: true })
      const newUids = scan.last_scanned_uid < 0xffff_ffff
        ? await client.search({ uid: `${scan.last_scanned_uid + 1}:*` }, { uid: true }) : []
      if (!Array.isArray(unseenUids) || !Array.isArray(newUids)) throw new Error('manual_mailbox_uid_search_failed')
      // IMAP N:* can include a lower existing UID when N exceeds the highest.
      const discovered = [...unseenUids.filter(validUid), ...newUids.filter(uid => validUid(uid) && uid > scan!.last_scanned_uid)].sort((a, b) => a - b)
      const candidates = [...new Set([...retryUids.sort((a, b) => a - b), ...discovered])].filter(uid => !deadUids.has(uid)).slice(0, maxMessages)
      // ImapFlow holds FETCH backpressure across an async-generator yield.
      // Finish each bounded UID fetch before issuing Seen/STORE commands.
      for (const messageUid of candidates) {
        if (!hasBudget()) break
        const clearUidAttempts = () => {
          for (const [key, attempt] of Object.entries(attempts)) {
            if (inCurrentScan(attempt) && attempt.uid === messageUid) delete attempts[key]
          }
        }
        try {
          const message = await client.fetchOne(String(messageUid), { uid: true, envelope: true, source: true, internalDate: true }, { uid: true })
          if (!message) {
            clearUidAttempts()
            scan.last_scanned_uid = Math.max(scan.last_scanned_uid, messageUid)
            continue // Expunged since SEARCH: there is no source to ingest.
          }
          result.fetched += 1
          const envelope = (message as { envelope?: JsonRecord }).envelope ?? {}
          const from = envelopeAddress(envelope.from)
          const to = envelopeAddress(envelope.to)
          const source = (message as { source?: unknown }).source
          const senderVerification = await verifyManualMailSender(source)
          const parsedMime = parseMimeSource(source)
          const envelopeInReplyTo = clean(envelope.inReplyTo)
          const dedupKey = manualMessageDedupKey(clean(envelope.messageId), source)
          const receipt = captureManualMailboxReceipt({ internalDate: message.internalDate, source,
            mailbox: clean(mailbox.from_email) ?? username, mailboxId,
            mailboxFingerprint: scan.mailbox_fingerprint, uidValidity: scan.uid_validity, uid: messageUid })
          const email: ManualInboundEmail = {
            mailbox: clean(mailbox.from_email) ?? username, mailboxCompanyId: clean(mailbox.company_id),
            fromEmail: from.address, fromName: from.name, toEmail: to.address ?? clean(mailbox.from_email),
            subject: clean(envelope.subject), bodyText: parsedMime.bodyText, bodyHtml: parsedMime.bodyHtml,
            providerMessageId: dedupKey,
            // Correlation remains limited to cryptographically signed headers.
            threadId: senderVerification.status === 'verified' ? parsedMime.inReplyTo : envelopeInReplyTo ?? parsedMime.inReplyTo,
            inReplyTo: senderVerification.status === 'verified' ? parsedMime.inReplyTo : parsedMime.inReplyTo ?? envelopeInReplyTo,
            references: parsedMime.references, attachments: parsedMime.attachments, autoReplyHeaders: parsedMime.autoReplyHeaders,
            senderVerification, mimeRequiresReview: parsedMime.mimeRequiresReview,
            ...(receipt ? { [MANUAL_MAILBOX_RECEIPT]: receipt } : {}),
          }
          const ingestResult: ManualInboundResult = await ingestManualInboundEmail(email)
          result.ingested += 1
          countResolution(result, ingestResult)
          await client.messageFlagsAdd(messageUid, ['\\Seen'], { uid: true })
          clearUidAttempts()
          scan.last_scanned_uid = Math.max(scan.last_scanned_uid, messageUid)
        } catch (ingestError) {
          result.errors.push(`ingest ${mailboxId}: ${ingestError instanceof Error ? ingestError.message : String(ingestError)}`)
          const previous = Object.values(attempts).find(attempt => inCurrentScan(attempt) && attempt.uid === messageUid)
          const count = (previous?.attempts ?? 0) + 1
          const deadLetter = count >= maxAttempts
          clearUidAttempts()
          attempts[`uid:${scan.mailbox_fingerprint}:${scan.uid_validity}:${messageUid}`] = {
            attempts: count, last_attempt_at: nowIso(), uid: messageUid,
            uid_validity: scan.uid_validity, mailbox_fingerprint: scan.mailbox_fingerprint,
            ...(deadLetter ? { dead_lettered_at: nowIso() } : {}),
          }
          if (deadLetter) {
            result.deadLettered += 1
            terminalSeenUids.push(messageUid)
            scan.last_scanned_uid = Math.max(scan.last_scanned_uid, messageUid)
          } else if (messageUid > scan.last_scanned_uid) {
            // Never move the future frontier beyond a failed source, including
            // a committed ingest whose Seen update failed. Retry ignores Seen.
            break
          }
        }
      }
    } finally {
      lock.release()
    }
  } catch (error) {
    mailboxError = error instanceof Error ? error.message : 'Okänt manuellt pollingfel.'
    result.errors.push(`mailbox ${mailboxId}: ${mailboxError}`)
  }
  try {
    await finishMailbox(mailboxId, workerId, !mailboxError, mailboxError,
      withMessageAttempts(mailbox.metadata, attempts, scan), mailbox.metadata)
    // Terminal retry evidence must be durable before hiding a legacy source
    // from UNSEEN. A failed flush leaves its flags and original source intact.
    for (const uid of terminalSeenUids) {
      if (!hasBudget()) break
      await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }).catch(() => undefined)
    }
  } finally {
    await client.logout().catch(() => undefined)
  }
}

// Polls every active manual operations mailbox and persists every inbound mail.
// Tenant/entity resolution happens inside manualInboundIngestion; GX-FIR is only
// one of several strong correlation signals.
export async function runManualInboundMailEngine(input?: {
  environment?: string | null
}): Promise<ManualMailboxPollResult> {
  const deadline = performance.now() + RUN_BUDGET_MS
  const hasBudget = () => performance.now() < deadline
  await assertPlatformSchemaReady()
  const result: ManualMailboxPollResult = {
    mailboxes: 0,
    polled: 0,
    fetched: 0,
    ingested: 0,
    matched: 0,
    ambiguous: 0,
    unmatched: 0,
    ignored: 0,
    skipped: 0,
    deadLettered: 0,
    errors: [],
  }
  const workerId = `manual-inbound:${randomUUID()}`

  const mailboxes = await listActiveManualMailboxes(input?.environment)
  result.mailboxes = mailboxes.length
  mailboxes.sort((a, b) => (Date.parse(clean(a.last_polled_at) ?? '') || 0) - (Date.parse(clean(b.last_polled_at) ?? '') || 0))
  for (const mailbox of mailboxes) {
    if (!hasBudget()) break
    try {
      await pollOneMailbox(mailbox, workerId, result, hasBudget)
    } catch (error) {
      // A failed checkpoint remains uncommitted and must be visible, while an
      // unrelated mailbox can still use the remaining run budget.
      result.errors.push(`mailbox ${String(mailbox.id)}: ${error instanceof Error ? error.message : 'manual_mailbox_checkpoint_failed'}`)
    }
  }
  return result
}
