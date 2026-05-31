import { NextRequest, NextResponse } from 'next/server'
import { dispatchDueWebhookDeliveries } from '@/lib/integrations/webhooks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isAuthorized(request: NextRequest): boolean {
  const configuredSecret = process.env.EVENTS_CRON_SECRET ?? process.env.CRON_SECRET
  if (!configuredSecret) return false

  const authorization = request.headers.get('authorization') ?? ''
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null
  const headerSecret = request.headers.get('x-cron-secret')

  return bearer === configuredSecret || headerSecret === configuredSecret
}

function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? '25', 10)
  if (!Number.isFinite(parsed)) return 25
  return Math.min(Math.max(parsed, 1), 100)
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await dispatchDueWebhookDeliveries(parseLimit(request.nextUrl.searchParams.get('limit')))
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook-dispatch misslyckades.'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
