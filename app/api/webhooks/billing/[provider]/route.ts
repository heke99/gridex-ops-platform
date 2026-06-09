import { NextRequest, NextResponse } from 'next/server'
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
    const message = error instanceof Error ? error.message : 'Webhook kunde inte hanteras.'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
