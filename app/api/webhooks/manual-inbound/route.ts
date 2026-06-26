import { randomUUID, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { ingestManualInboundEmail, type ManualInboundEmail } from '@/lib/inbound-mail/manualInboundIngestion'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function clean(value: unknown): string | null {
  const trimmed = String(value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

function expectedSecrets(): string[] {
  return [process.env.MANUAL_INBOUND_WEBHOOK_SECRET, process.env.CRON_SECRET]
    .map((value) => clean(value))
    .filter((value): value is string => Boolean(value))
}

function sameSecret(candidate: string | null, expected: string): boolean {
  if (!candidate) return false
  const left = Buffer.from(candidate)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function requestToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization') ?? ''
  if (authorization.toLowerCase().startsWith('bearer ')) return clean(authorization.slice('bearer '.length))
  return clean(request.headers.get('x-manual-inbound-secret')) ?? clean(request.headers.get('x-webhook-secret'))
}

// Maps a provider-agnostic inbound e-mail payload into the ingestion shape.
function toInboundEmail(body: Record<string, unknown>): ManualInboundEmail {
  return {
    mailbox: clean(body.mailbox ?? body.to ?? body.recipient),
    fromEmail: clean(body.from ?? body.from_email ?? body.sender),
    fromName: clean(body.from_name ?? body.fromName),
    toEmail: clean(body.to ?? body.to_email ?? body.recipient),
    subject: clean(body.subject),
    bodyText: clean(body.text ?? body.body_text ?? body.bodyText ?? body.plain),
    bodyHtml: clean(body.html ?? body.body_html ?? body.bodyHtml),
    providerMessageId: clean(body.message_id ?? body.messageId ?? body.provider_message_id ?? body.id),
    threadId: clean(body.thread_id ?? body.threadId ?? body.in_reply_to),
    attachments: Array.isArray(body.attachments) ? (body.attachments as unknown[]) : [],
  }
}

export async function POST(request: NextRequest) {
  if (expectedSecrets().length === 0) {
    return NextResponse.json({ ok: false, error: 'Inkommande e-post-webhook är inte konfigurerad.' }, { status: 503 })
  }
  if (!expectedSecrets().some((secret) => sameSecret(requestToken(request), secret))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  try {
    const result = await ingestManualInboundEmail(toInboundEmail(body))
    return NextResponse.json({ ok: true, source: 'manual_inbound_webhook', result })
  } catch (error) {
    const traceId = randomUUID()
    console.error('[manual-inbound-webhook] Ingestion failed', { traceId, error })
    return NextResponse.json({ ok: false, error: 'Inkommande e-post kunde inte hanteras.', code: 'manual_inbound_processing_failed', trace_id: traceId }, { status: 500 })
  }
}
