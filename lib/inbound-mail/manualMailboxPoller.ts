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
import { createHash } from 'node:crypto'
import { inspectMimeStructure, mimeParameter } from '@/lib/inbound-mail/mimeStructure'
import { binaryToBuffer, decodeTextBytes, toBinaryString } from '@/lib/inbound-mail/mimeCharset'
import { extractAutoReplyHeaders } from '@/lib/inbound-mail/autoReply'
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

// Small deterministic MIME reader for manual replies. It walks nested
// multipart structures (multipart/mixed > multipart/alternative, forwarded
// message/rfc822) and decodes text by each part's own charset without
// executing or opening binary content.
export function parseMimeSource(source: unknown): {
  bodyText: string | null
  bodyHtml: string | null
  attachments: unknown[]
  inReplyTo: string | null
  references: string[]
  autoReplyHeaders: Record<string, string>
} {
  const empty = { bodyText: null, bodyHtml: null, attachments: [], inReplyTo: null, references: [], autoReplyHeaders: {} }
  if (!source) return empty
  const binary = Buffer.isBuffer(source) || source instanceof Uint8Array ? toBinaryString(source) : toBinaryString(String(source))
  const separator = binary.search(/\r?\n\r?\n/)
  const headerText = separator >= 0 ? binary.slice(0, separator) : binary
  const replyHeaders = parseMessageHeaderValues(headerText)
  const autoReplyHeaders = extractAutoReplyHeaders(headerText)

  const { entities } = inspectMimeStructure(binary, { preserveBytes: true })
  const text: string[] = []
  const html: string[] = []
  const attachments: unknown[] = []
  for (const entity of entities) {
    if (entity.mediaType.startsWith('multipart/') || entity.mediaType === 'message/rfc822' || entity.mediaType === 'message/global') continue
    const disposition = entity.headers.get('content-disposition')?.[0] ?? ''
    const filename = mimeParameter(disposition, 'filename') ?? mimeParameter(entity.contentType, 'name')
    const bytes = binaryToBuffer(entity.body)
    const isText = entity.mediaType.startsWith('text/')
    const decoded = isText ? decodeTextBytes(bytes, mimeParameter(entity.contentType, 'charset')) : null
    if (filename || /^attachment/i.test(disposition)) {
      attachments.push({
        filename,
        contentType: entity.mediaType,
        sizeBytes: bytes.length,
        text: decoded ? decoded.slice(0, 200_000) : null,
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
  return Date.now() - lastPolledTime >= effectiveInterval * 60_000
}

async function claimMailbox(mailboxId: string, workerId: string): Promise<boolean> {
  const staleCutoff = new Date(Date.now() - envInt('MANUAL_INBOUND_STALE_MAILBOX_LOCK_MINUTES', 30) * 60_000).toISOString()
  const { data, error } = await supabaseService
    .from('manual_communication_mailboxes')
    .update({ last_polled_at: nowIso(), locked_at: nowIso(), locked_by: workerId, updated_at: nowIso() })
    .eq('id', mailboxId)
    .or(`locked_at.is.null,locked_at.lt.${staleCutoff}`)
    .select('id')
    .maybeSingle()
  if (error) throw error
  return Boolean(data?.id)
}

type MessageAttempt = { attempts: number; last_attempt_at: string; dead_lettered_at?: string; uid?: number | null }

const MAX_TRACKED_MESSAGE_ATTEMPTS = 500

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

function withMessageAttempts(metadata: unknown, attempts: Record<string, MessageAttempt>): JsonRecord {
  const root = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as JsonRecord) : {}
  const newestFirst = Object.entries(attempts)
    .sort(([, a], [, b]) => String(b.last_attempt_at).localeCompare(String(a.last_attempt_at)))
    .slice(0, MAX_TRACKED_MESSAGE_ATTEMPTS)
  return { ...root, message_attempts: Object.fromEntries(newestFirst) }
}

// Stable per-message dedup key: the RFC Message-ID, else the SHA-256 of the
// raw source so mail without a Message-ID is still deduplicated on retry.
export function manualMessageDedupKey(messageId: string | null, source: unknown): string | null {
  if (messageId) return messageId
  if (Buffer.isBuffer(source) || source instanceof Uint8Array) return `sha256:${createHash('sha256').update(source).digest('hex')}`
  if (typeof source === 'string' && source) return `sha256:${createHash('sha256').update(source, 'utf8').digest('hex')}`
  return null
}

async function finishMailbox(mailboxId: string, ok: boolean, errorMessage?: string | null, metadata?: JsonRecord): Promise<void> {
  const patch: JsonRecord = { locked_at: null, locked_by: null, updated_at: nowIso() }
  if (metadata) patch.metadata = metadata
  if (ok) {
    patch.last_successful_poll_at = nowIso()
    patch.last_error = null
  } else if (errorMessage) {
    patch.last_error = String(errorMessage).replace(/[\r\n]+/g, ' ').slice(0, 300)
  }
  await supabaseService.from('manual_communication_mailboxes').update(patch).eq('id', mailboxId).then(() => undefined, () => undefined)
}

function countResolution(result: ManualMailboxPollResult, ingestResult: ManualInboundResult): void {
  if (ingestResult.resolutionStatus === 'matched') result.matched += 1
  else if (ingestResult.resolutionStatus === 'ambiguous') result.ambiguous += 1
  else if (ingestResult.resolutionStatus === 'ignored') result.ignored += 1
  else result.unmatched += 1
}

async function pollOneMailbox(mailbox: JsonRecord, workerId: string, result: ManualMailboxPollResult): Promise<void> {
  const mailboxId = String(mailbox.id)
  const host = clean(mailbox.imap_host)
  const username = clean(mailbox.imap_username) ?? clean(mailbox.from_email)
  if (!host || !username) {
    result.skipped += 1
    return
  }

  if (!isManualMailboxDueForPolling(mailbox)) {
    result.skipped += 1
    return
  }

  const claimed = await claimMailbox(mailboxId, workerId)
  if (!claimed) {
    result.skipped += 1
    return
  }
  result.polled += 1

  const password = resolveManualMailboxSecret(clean(mailbox.imap_secret_reference), mailboxId)
  if (!password) {
    await finishMailbox(mailboxId, false, 'manuell brevlåda saknar giltig IMAP secret_reference/env-lösenord.')
    result.errors.push(`mailbox ${mailboxId}: missing imap secret`)
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

  const maxMessages = envInt('MANUAL_INBOUND_MESSAGE_LIMIT_PER_MAILBOX', 25)
  const maxAttempts = envInt('MANUAL_INBOUND_MAX_ATTEMPTS_PER_MESSAGE', 5)
  const attempts = readMessageAttempts(mailbox.metadata)
  try {
    await client.connect()
    const folder = clean(mailbox.imap_folder) ?? 'INBOX'
    const lock = await client.getMailboxLock(folder)
    try {
      let fetched = 0
      for await (const message of client.fetch({ seen: false }, { uid: true, envelope: true, source: true })) {
        if (fetched >= maxMessages) break
        fetched += 1
        result.fetched += 1

        const envelope = (message as { envelope?: JsonRecord }).envelope ?? {}
        const from = envelopeAddress(envelope.from)
        const to = envelopeAddress(envelope.to)
        const subject = clean(envelope.subject)
        const source = (message as { source?: unknown }).source
        const parsedMime = parseMimeSource(source)
        const envelopeInReplyTo = clean(envelope.inReplyTo)
        const dedupKey = manualMessageDedupKey(clean(envelope.messageId), source)

        const email: ManualInboundEmail = {
          mailbox: clean(mailbox.from_email) ?? username,
          mailboxCompanyId: clean(mailbox.company_id),
          fromEmail: from.address,
          fromName: from.name,
          toEmail: to.address ?? clean(mailbox.from_email),
          subject,
          bodyText: parsedMime.bodyText,
          bodyHtml: parsedMime.bodyHtml,
          providerMessageId: dedupKey,
          threadId: envelopeInReplyTo ?? parsedMime.inReplyTo,
          inReplyTo: parsedMime.inReplyTo ?? envelopeInReplyTo,
          references: parsedMime.references,
          attachments: parsedMime.attachments,
          autoReplyHeaders: parsedMime.autoReplyHeaders,
        }
        const uid = (message as { uid?: unknown }).uid

        try {
          const ingestResult: ManualInboundResult = await ingestManualInboundEmail(email)
          result.ingested += 1
          countResolution(result, ingestResult)
          if (dedupKey) delete attempts[dedupKey]
          if (typeof uid === 'number') await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true })
        } catch (ingestError) {
          // A failed message stays unseen so the next poll retries a transient
          // DB/schema/provider issue. After maxAttempts it is dead-lettered
          // (marked Seen, recorded on the mailbox) so a poison message can never
          // starve newer mail once failures fill the per-poll message limit.
          result.errors.push(`ingest ${mailboxId}: ${ingestError instanceof Error ? ingestError.message : String(ingestError)}`)
          if (dedupKey) {
            const previous = attempts[dedupKey]
            const count = (previous?.attempts ?? 0) + 1
            const deadLetter = count >= maxAttempts
            attempts[dedupKey] = {
              attempts: count,
              last_attempt_at: nowIso(),
              ...(deadLetter ? { dead_lettered_at: nowIso(), uid: typeof uid === 'number' ? uid : null } : {}),
            }
            if (deadLetter) {
              result.deadLettered += 1
              if (typeof uid === 'number') await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }).catch(() => undefined)
            }
          }
        }
      }
    } finally {
      lock.release()
      await client.logout().catch(() => undefined)
    }
    await finishMailbox(mailboxId, true, null, withMessageAttempts(mailbox.metadata, attempts))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt manuellt pollingfel.'
    result.errors.push(`mailbox ${mailboxId}: ${message}`)
    await finishMailbox(mailboxId, false, message, withMessageAttempts(mailbox.metadata, attempts))
  }
}

// Polls every active manual operations mailbox and persists every inbound mail.
// Tenant/entity resolution happens inside manualInboundIngestion; GX-FIR is only
// one of several strong correlation signals.
export async function runManualInboundMailEngine(input?: {
  environment?: string | null
}): Promise<ManualMailboxPollResult> {
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
  const workerId = `manual-inbound:${nowIso()}`

  const mailboxes = await listActiveManualMailboxes(input?.environment)
  result.mailboxes = mailboxes.length
  for (const mailbox of mailboxes) {
    await pollOneMailbox(mailbox, workerId, result)
  }
  return result
}
