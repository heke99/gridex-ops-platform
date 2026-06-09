import { NextRequest } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { dispatchDueWebhookDeliveries } from '@/lib/integrations/webhooks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function configuredSecret(): string | null {
  return (process.env.GRIDEX_CRON_SECRET ?? process.env.CRON_SECRET ?? '').trim() || null
}

function authorized(request: NextRequest): boolean {
  const secret = configuredSecret()
  if (!secret) return false
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : request.headers.get('x-gridex-cron-secret')?.trim()
  return token === secret
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return customerPortalJson({ error: 'Webhook-dispatch saknar giltig cron secret.' }, { status: 401 })
  }

  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') ?? '25') || 25, 1), 100)
  const result = await dispatchDueWebhookDeliveries(limit)
  return customerPortalJson({ data: result })
}
