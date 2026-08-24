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

function decodeQuotedPrintable(value: string): string {
  return value
    .replace(/=\r?\n/g, '')
    .replace(/=([A-Fa-f0-9]{2})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
}

function decodeMimeBody(value: string, encoding: string | null): string {
  if (encoding === 'base64') {
    try { return Buffer.from(value.replace(/\s+/g, ''), 'base64').toString('utf8') } catch { return '' }
  }
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(value)
  return value
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

// Small deterministic MIME reader for manual replies. It decodes plain text,
// HTML and text attachments without executing or opening binary content.
function parseMimeSource(source: unknown): {
  bodyText: string | null
  bodyHtml: string | null
  attachments: unknown[]
  inReplyTo: string | null
  references: string[]
} {
  if (!source) return { bodyText: null, bodyHtml: null, attachments: [], inReplyTo: null, references: [] }
  const raw = Buffer.isBuffer(source) ? source.toString('utf8') : String(source)
  const [headerText, ...bodyParts] = raw.split(/\r?\n\r?\n/)
  const replyHeaders = parseMessageHeaderValues(headerText)
  const body = bodyParts.join('\n\n')
  const contentType = /content-type:\s*([^;\r\n]+)/i.exec(headerText)?.[1]?.toLowerCase() ?? 'text/plain'
  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(headerText)?.[1] ?? null
  const encoding = /content-transfer-encoding:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim().toLowerCase() ?? null
  if (!boundary) {
    const decoded = decodeMimeBody(body, encoding)
    return contentType.includes('html')
      ? { bodyText: null, bodyHtml: clean(decoded), attachments: [], ...replyHeaders }
      : { bodyText: clean(decoded), bodyHtml: null, attachments: [], ...replyHeaders }
  }

  const text: string[] = []
  const html: string[] = []
  const attachments: unknown[] = []
  for (const rawPart of body.split(`--${boundary}`)) {
    if (!rawPart.trim() || rawPart.trim() === '--') continue
    const [partHeaders, ...partBodyParts] = rawPart.replace(/^\r?\n/, '').split(/\r?\n\r?\n/)
    const partBody = partBodyParts.join('\n\n').replace(/\r?\n--$/, '')
    const partType = /content-type:\s*([^;\r\n]+)/i.exec(partHeaders)?.[1]?.toLowerCase() ?? 'text/plain'
    const partEncoding = /content-transfer-encoding:\s*([^\r\n]+)/i.exec(partHeaders)?.[1]?.trim().toLowerCase() ?? null
    const filename = /filename="?([^";\r\n]+)"?/i.exec(partHeaders)?.[1] ?? /name="?([^";\r\n]+)"?/i.exec(partHeaders)?.[1] ?? null
    const decoded = decodeMimeBody(partBody, partEncoding)
    if (filename) {
      attachments.push({ filename, contentType: partType, text: partType.startsWith('text/') ? decoded.slice(0, 200_000) : null })
    } else if (partType.includes('html')) html.push(decoded)
    else if (partType.startsWith('text/')) text.push(decoded)
  }
  return {
    bodyText: clean(text.join('\n')),
    bodyHtml: clean(html.join('\n')),
    attachments,
    ...replyHeaders,
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
    .select('id,company_id,environment,imap_host,imap_port,imap_username,imap_secret_reference,imap_folder,imap_secure,from_email,locked_at,locked_by,poll_interval_minutes,last_polled_at,is_verified')
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

async function finishMailbox(mailboxId: string, ok: boolean, errorMessage?: string | null): Promise<void> {
  const patch: JsonRecord = { locked_at: null, locked_by: null, updated_at: nowIso() }
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
  })

  const maxMessages = envInt('MANUAL_INBOUND_MESSAGE_LIMIT_PER_MAILBOX', 25)
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
        const parsedMime = parseMimeSource((message as { source?: unknown }).source)
        const envelopeInReplyTo = clean(envelope.inReplyTo)

        const email: ManualInboundEmail = {
          mailbox: clean(mailbox.from_email) ?? username,
          mailboxCompanyId: clean(mailbox.company_id),
          fromEmail: from.address,
          fromName: from.name,
          toEmail: to.address ?? clean(mailbox.from_email),
          subject,
          bodyText: parsedMime.bodyText,
          bodyHtml: parsedMime.bodyHtml,
          providerMessageId: clean(envelope.messageId),
          threadId: envelopeInReplyTo ?? parsedMime.inReplyTo,
          inReplyTo: parsedMime.inReplyTo ?? envelopeInReplyTo,
          references: parsedMime.references,
          attachments: parsedMime.attachments,
        }

        try {
          const ingestResult: ManualInboundResult = await ingestManualInboundEmail(email)
          result.ingested += 1
          countResolution(result, ingestResult)
          const uid = (message as { uid?: unknown }).uid
          if (typeof uid === 'number') await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true })
        } catch (ingestError) {
          // Do not mark failed messages as Seen. The next poll may retry after a
          // transient DB/schema/provider issue and raw mail is never discarded.
          result.errors.push(`ingest ${mailboxId}: ${ingestError instanceof Error ? ingestError.message : String(ingestError)}`)
        }
      }
    } finally {
      lock.release()
      await client.logout().catch(() => undefined)
    }
    await finishMailbox(mailboxId, true)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt manuellt pollingfel.'
    result.errors.push(`mailbox ${mailboxId}: ${message}`)
    await finishMailbox(mailboxId, false, message)
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
