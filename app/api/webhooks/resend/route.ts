import { NextRequest, NextResponse } from 'next/server'
import {
  getResendWebhookHeaders,
  processResendWebhookEvent,
  verifyResendWebhook,
} from '@/lib/email/resendWebhookEvents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const webhookHeaders = getResendWebhookHeaders(request.headers)
  if (!webhookHeaders) {
    return NextResponse.json({ ok: false, error: 'Missing webhook signature headers' }, { status: 400 })
  }

  const payload = await request.text()

  try {
    const event = verifyResendWebhook(payload, webhookHeaders)
    const result = await processResendWebhookEvent(event, webhookHeaders)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Resend webhook kunde inte verifieras.'
    const status = message.includes('RESEND_WEBHOOK_SECRET') ? 500 : 401
    console.warn('[resend-webhook] rejected event', { message })
    return NextResponse.json({ ok: false, error: status === 500 ? message : 'Invalid webhook signature' }, { status })
  }
}
