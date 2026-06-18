import { NextRequest, NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { receiveBillingProviderWebhook } from '@/lib/billing/providerWebhooks'

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
    if (result.status === 'rejected') {
      return NextResponse.json({ ok: false, error: 'Webhook-signaturen kunde inte verifieras.' }, { status: 401 })
    }
    return NextResponse.json({ ok: true, data: result })
  } catch (error) {
    return internalApiError({ context: 'billing_webhook_failed', error, code: 'billing_webhook_failed', message: 'Webhook kunde inte behandlas.' })
  }
}
