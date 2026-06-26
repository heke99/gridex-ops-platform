import { NextRequest, NextResponse } from 'next/server'
import {
  ResendWebhookError,
  getResendWebhookHeaders,
  getResendWebhookSecret,
  processResendWebhookEvent,
  verifyResendWebhook,
} from '@/lib/email/resendWebhookEvents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Safe diagnostics: we never echo the signing secret. We distinguish the four
// failure classes so superadmin can tell a misconfiguration (missing secret /
// missing headers) from a real signature mismatch or a post-processing fault.
export async function POST(request: NextRequest) {
  const webhookHeaders = getResendWebhookHeaders(request.headers)
  if (!webhookHeaders) {
    return NextResponse.json(
      { ok: false, error: 'Webhook-signaturhuvuden saknas.', code: 'missing_headers' },
      { status: 400 },
    )
  }

  if (!getResendWebhookSecret()) {
    return NextResponse.json(
      { ok: false, error: 'Webhook-konfiguration saknas.', code: 'missing_secret' },
      { status: 500 },
    )
  }

  // The raw body MUST be used for signature verification; do not parse first.
  const payload = await request.text()

  let event
  try {
    event = verifyResendWebhook(payload, webhookHeaders)
  } catch (error) {
    if (error instanceof ResendWebhookError && error.code === 'missing_secret') {
      return NextResponse.json(
        { ok: false, error: 'Webhook-konfiguration saknas.', code: 'missing_secret' },
        { status: 500 },
      )
    }
    console.warn('[resend-webhook] signature verification failed', {
      code: error instanceof ResendWebhookError ? error.code : 'invalid_signature',
    })
    return NextResponse.json(
      { ok: false, error: 'Invalid webhook signature', code: 'resend_webhook_invalid_signature' },
      { status: 401 },
    )
  }

  // The signature is valid. A failure here is a server-side processing problem,
  // NOT an auth failure: never return 401 once the event is verified.
  try {
    const result = await processResendWebhookEvent(event, webhookHeaders)
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    console.error('[resend-webhook] event processing failed', { error })
    return NextResponse.json(
      { ok: false, error: 'Event-bearbetning misslyckades.', code: 'event_processing_failed' },
      { status: 500 },
    )
  }
}
