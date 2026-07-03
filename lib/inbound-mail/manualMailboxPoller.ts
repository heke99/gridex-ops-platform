// lib/inbound-mail/manualMailboxPoller.ts
//
// Inbound IMAP poller for the MANUAL operations mailbox (e.g. leverantorsbyte@
// gridex.se). This is SEPARATE from the Ediel mailbox engine, which serves
// ediel@gridex.se for EDIFACT transport only.
//
// Manual replies from grid owners are received here, matched to an open manual
// request by GX-FIR case_reference, and handed to ingestManualInboundEmail. This
// poller:
//   * NEVER parses EDIFACT, NEVER creates ediel_messages / ediel_outbox,
//   * resolves the tenant FROM the matched request (never the mailbox),
//   * reuses the env-only secret-reference + stale-lock patterns from Ediel.

import { ImapFlow } from 'imapflow'
import { supabaseService } from '@/lib/supabase/service'
import { resolveManualMailboxSecret } from '@/lib/email/manualOperationsMailbox'
import {
  ingestManualInboundEmail,
  extractCaseReference,
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

function nowIso(): string {
  return new Date().toISOString()
}

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

// Decodes a body from a fetched IMAP source buffer: drop MIME headers (text after
// the first blank line). Good enough for plain-text replies; ingestion only
// auto-applies on high confidence + credible sender + valid facility format,
// otherwise it stores the reply as needs_review.
function extractBodyText(source: unknown): string | null {
  if (!source) return null
  const raw = Buffer.isBuffer(source) ? source.toString('utf8') : String(source)
  const separator = raw.indexOf('\r\n\r\n')
  const body = separator >= 0 ? raw.slice(separator + 4) : raw
  return clean(body)
}

function envelopeAddress(list: unknown): { address: string | null; name: string | null } {
  if (!Array.isArray(list) || list.length === 0) return { address: null, name: null }
  const first = list[0] as { address?: unknown; name?: unknown }
  return { address: clean(first.address), name: clean(first.name) }
}

async function listActiveManualMailboxes(environment?: string | null): Promise<JsonRecord[]> {
  let query = supabaseService
    .from('manual_communication_mailboxes')
    .select('id,environment,imap_host,imap_port,imap_username,imap_secret_reference,imap_folder,imap_secure,from_email,locked_at,locked_by,poll_interval_minutes,last_polled_at')
    .eq('is_active', true)
    .not('imap_host', 'is', null)
  if (clean(environment)) query = query.eq('environment', clean(environment))
  const { data, error } = await query
  if (error) {
    if (missingSchema(error)) return []
    throw error
  }
  return (data ?? []) as JsonRecord[]
}

// Respect poll_interval_minutes (default 5) so the 5-minute cron does not
// hammer the IMAP provider for mailboxes configured with a longer interval.
// Mirrors the Ediel poller's due-check. Missing/invalid data means "due".
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
  if (error) {
    if (missingSchema(error)) return false
    throw error
  }
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
        const bodyText = extractBodyText((message as { source?: unknown }).source)

        const email: ManualInboundEmail = {
          mailbox: clean(mailbox.from_email) ?? username,
          fromEmail: from.address,
          fromName: from.name,
          toEmail: to.address ?? clean(mailbox.from_email),
          subject,
          bodyText,
          bodyHtml: null,
          providerMessageId: clean(envelope.messageId),
          threadId: clean(envelope.inReplyTo),
          attachments: [],
        }

        // Only ingest messages that carry a GX-FIR case reference; everything
        // else stays in the mailbox untouched (Ediel-only mail never lands here).
        if (!extractCaseReference(email)) {
          continue
        }

        try {
          const ingestResult: ManualInboundResult = await ingestManualInboundEmail(email)
          result.ingested += 1
          if (ingestResult.resolutionStatus === 'matched') result.matched += 1
          const uid = (message as { uid?: unknown }).uid
          if (typeof uid === 'number') {
            await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true })
          }
        } catch (ingestError) {
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

// Polls all active manual operations mailboxes and routes GX-FIR replies to the
// manual inbound ingestion. Kept fully separate from the Ediel mail engine.
export async function runManualInboundMailEngine(input?: {
  environment?: string | null
}): Promise<ManualMailboxPollResult> {
  const result: ManualMailboxPollResult = { mailboxes: 0, polled: 0, fetched: 0, ingested: 0, matched: 0, skipped: 0, errors: [] }
  const workerId = `manual-inbound:${nowIso()}`

  const mailboxes = await listActiveManualMailboxes(input?.environment)
  result.mailboxes = mailboxes.length
  for (const mailbox of mailboxes) {
    await pollOneMailbox(mailbox, workerId, result)
  }
  return result
}
