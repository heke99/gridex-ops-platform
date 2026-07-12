import { NextRequest, NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { BillingProviderWebhookAuthError, receiveBillingProviderWebhook } from '@/lib/billing/providerWebhooks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteProps = {
  params: Promise<{ provider: string }>
}

export async function POST(request: NextRequest, { params }: RouteProps) {
  const { provider } = await params
  const body = await request.text()

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
