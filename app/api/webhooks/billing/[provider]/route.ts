import { NextRequest, NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { BillingProviderWebhookAuthError, receiveBillingProviderWebhook } from '@/lib/billing/providerWebhooks'
import { readTextBodyWithLimit } from '@/lib/http/boundedRequestBody'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteProps = {
  params: Promise<{ provider: string }>
}

export async function POST(request: NextRequest, { params }: RouteProps) {
  const { provider } = await params
  const bounded = await readTextBodyWithLimit(request, 512_000)
  if (!bounded.ok) {
    return NextResponse.json(
      { error: 'Webhook-payloaden är för stor.', code: 'payload_too_large' },
      { status: 413 },
    )
  }
  const body = bounded.text

  try {
    const result = await receiveBillingProviderWebhook({ provider, body, headers: request.headers })
    return NextResponse.json({ ok: true, data: result })
  } catch (error) {
    const unauthorized = error instanceof BillingProviderWebhookAuthError
    return internalApiError({
      context: 'billing_webhook_failed',
      error,
      code: unauthorized ? 'billing_webhook_unauthorized' : 'billing_webhook_failed',
      message: unauthorized
        ? 'Webhook-signaturen kunde inte verifieras.'
        : 'Webhook kunde inte behandlas.',
      status: unauthorized ? 401 : 500,
    })
  }
}
