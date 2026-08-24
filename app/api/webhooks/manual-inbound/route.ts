import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { ingestManualInboundEmail, type ManualInboundEmail } from '@/lib/inbound-mail/manualInboundIngestion'
import { supabaseService } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 2_000_000
const MAX_ATTACHMENTS = 10
const MAX_ATTACHMENT_TEXT_BYTES = 200_000
const MAX_REFERENCES = 50

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeMailboxAddress(value: unknown): string | null {
  const raw = clean(value)?.toLowerCase()
  if (!raw) return null
  const angleAddress = raw.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1]
  return (angleAddress ?? raw).trim() || null
}

function verifyRequest(request: NextRequest, rawBody: string) {
  const secret = clean(process.env.MANUAL_INBOUND_WEBHOOK_SECRET)
  if (!secret) throw new Error('Inkommande e-post-webhook är inte konfigurerad.')
  const timestampRaw = request.headers.get('x-manual-inbound-timestamp') ?? request.headers.get('x-gridex-timestamp') ?? request.headers.get('x-webhook-timestamp')
  const timestamp = Number(timestampRaw)
  if (!Number.isInteger(timestamp) || Math.abs(Math.floor(Date.now() / 1_000) - timestamp) > 300) {
    throw new Error('Webhookens signaturtimestamp är ogiltig eller för gammal.')
  }
  const signature = (request.headers.get('x-gridex-signature') ?? request.headers.get('x-webhook-signature') ?? '')
    .replace(/^sha256=/i, '')
    .trim()
  if (!/^[a-f0-9]{64}$/i.test(signature)) throw new Error('Webhookens signaturformat är ogiltigt.')
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  const left = Buffer.from(expected, 'hex')
  const right = Buffer.from(signature, 'hex')
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new Error('Webhookens signatur kunde inte verifieras.')
}

function attachments(value: unknown): unknown[] {
  if (!Array.isArray(value)) return []
  if (value.length > MAX_ATTACHMENTS) throw new Error('För många bilagor i inkommande e-post.')
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Ogiltigt bilageformat.')
    const row = entry as Record<string, unknown>
    const content = clean(row.content ?? row.text)
    if (content && Buffer.byteLength(content, 'utf8') > MAX_ATTACHMENT_TEXT_BYTES) throw new Error('En bilaga är för stor.')
    return row
  })
}

function messageReferences(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(clean)
      .filter((entry): entry is string => Boolean(entry))
      .slice(0, MAX_REFERENCES)
  }
  const raw = clean(value)
  if (!raw) return []
  return (raw.match(/<[^>]+>|[^\s]+/g) ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, MAX_REFERENCES)
}

async function resolveWebhookMailboxCompanyId(mailbox: string): Promise<string | null> {
  const address = normalizeMailboxAddress(mailbox)
  if (!address) return null

  // Do not trust a tenant id from the webhook body. Resolve mailbox scope from
  // the same verified mailbox registry used by the IMAP path. A platform-default
  // shared mailbox has company_id=null and therefore never becomes tenant proof.
  const [fromResult, replyResult] = await Promise.all([
    supabaseService
      .from('manual_communication_mailboxes')
      .select('id,company_id')
      .eq('is_active', true)
      .eq('is_verified', true)
      .ilike('from_email', address)
      .limit(20),
    supabaseService
      .from('manual_communication_mailboxes')
      .select('id,company_id')
      .eq('is_active', true)
      .eq('is_verified', true)
      .ilike('reply_to_email', address)
      .limit(20),
  ])
  if (fromResult.error) throw fromResult.error
  if (replyResult.error) throw replyResult.error

  const tenantIds = Array.from(new Set(
    [...(fromResult.data ?? []), ...(replyResult.data ?? [])]
      .map((row) => clean((row as { company_id?: unknown }).company_id))
      .filter((value): value is string => Boolean(value)),
  ))

  return tenantIds.length === 1 ? tenantIds[0] : null
}

function toInboundEmail(body: Record<string, unknown>): ManualInboundEmail {
  const providerMessageId = clean(body.message_id ?? body.messageId ?? body.provider_message_id ?? body.id)
  if (!providerMessageId || providerMessageId.length > 500) throw new Error('Stabilt provider-message-ID krävs.')
  const mailbox = normalizeMailboxAddress(body.mailbox ?? body.to ?? body.recipient)
  const fromEmail = clean(body.from ?? body.from_email ?? body.sender)
  if (!mailbox || !fromEmail) throw new Error('Mailbox och avsändaradress krävs.')

  const inReplyTo = clean(body.in_reply_to ?? body.inReplyTo)
  return {
    mailbox,
    fromEmail,
    fromName: clean(body.from_name ?? body.fromName),
    toEmail: clean(body.to ?? body.to_email ?? body.recipient),
    subject: clean(body.subject),
    bodyText: clean(body.text ?? body.body_text ?? body.bodyText ?? body.plain),
    bodyHtml: clean(body.html ?? body.body_html ?? body.bodyHtml),
    providerMessageId,
    threadId: clean(body.thread_id ?? body.threadId) ?? inReplyTo,
    inReplyTo,
    references: messageReferences(body.references ?? body.reference_message_ids ?? body.referenceMessageIds),
    attachments: attachments(body.attachments),
  }
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: 'Payload för stor.', code: 'payload_too_large' }, { status: 413 })
  }
  const rawBody = await request.text()
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: 'Payload för stor.', code: 'payload_too_large' }, { status: 413 })
  }

  try {
    verifyRequest(request, rawBody)
  } catch {
    const unavailable = !process.env.MANUAL_INBOUND_WEBHOOK_SECRET
    return NextResponse.json({
      ok: false,
      error: unavailable ? 'Inkommande e-post-webhook är inte konfigurerad.' : 'Unauthorized.',
      code: unavailable ? 'manual_inbound_webhook_unconfigured' : 'invalid_webhook_signature',
    }, { status: unavailable ? 503 : 401 })
  }

  try {
    const parsed = JSON.parse(rawBody) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON payload måste vara ett objekt.')
    const inboundEmail = toInboundEmail(parsed as Record<string, unknown>)
    inboundEmail.mailboxCompanyId = await resolveWebhookMailboxCompanyId(inboundEmail.mailbox ?? '')
    const result = await ingestManualInboundEmail(inboundEmail)
    return NextResponse.json({ ok: true, source: 'manual_inbound_webhook', result })
  } catch (error) {
    const traceId = randomUUID()
    console.error('[manual-inbound-webhook] Ingestion failed', { traceId, error })
    return NextResponse.json({ ok: false, error: 'Inkommande e-post kunde inte hanteras.', code: 'manual_inbound_processing_failed', trace_id: traceId }, { status: 422 })
  }
}