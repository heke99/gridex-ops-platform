import { NextRequest, NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import {
  BillingProviderWebhookAuthError,
  BillingProviderWebhookRequestError,
  receiveBillingProviderWebhook,
} from '@/lib/billing/providerWebhooks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteProps = {
  params: Promise<{ provider: string }>
}

export async function POST(request: NextRequest, { params }: RouteProps) {
  const { provider } = await params
  const body = await request.text()

  try {
    // The result intentionally carries no tenant identifiers.
    const result = await receiveBillingProviderWebhook({ provider, body, headers: request.headers })
    return NextResponse.json({ ok: true, data: result })
  } catch (error) {
    if (error instanceof BillingProviderWebhookAuthError) {
      return internalApiError({
        context: 'billing_webhook_failed',
        error,
        code: 'billing_webhook_unauthorized',
        message: 'Webhook-signaturen kunde inte verifieras.',
        status: 401,
      })
    }
    if (error instanceof BillingProviderWebhookRequestError) {
      // Non-retryable 4xx: providers must not retry payloads that can never succeed.
      return internalApiError({
        context: 'billing_webhook_failed',
        error,
        code: error.code,
        message: error.message,
        status: error.status,
      })
    }
    return internalApiError({
      context: 'billing_webhook_failed',
      error,
      code: 'billing_webhook_failed',
      message: 'Webhook kunde inte behandlas.',
      status: 500,
    })
  }
}
