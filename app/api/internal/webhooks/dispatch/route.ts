import { randomUUID, timingSafeEqual } from 'node:crypto'
import { NextRequest } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { dispatchDueWebhookDeliveries } from '@/lib/integrations/webhooks'
import { hydrateVaultWebhookSecretsForDispatch } from '@/lib/integrations/webhookVaultSecrets'
import { processDomainEventWebhookFanout } from '@/lib/events/domainEvents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function configuredSecrets(): string[] {
  return [process.env.GRIDEX_CRON_SECRET, process.env.CRON_SECRET]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
}

function sameSecret(candidate: string | null, expected: string): boolean {
  if (!candidate) return false
  const left = Buffer.from(candidate)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function authorized(request: NextRequest): boolean {
  const header = request.headers.get('authorization') ?? ''
  const token = header.toLowerCase().startsWith('bearer ')
    ? header.slice('bearer '.length).trim()
    : request.headers.get('x-gridex-cron-secret')?.trim() ?? null
  return configuredSecrets().some((secret) => sameSecret(token, secret))
}

async function run(request: NextRequest) {
  if (!configuredSecrets().length) {
    return customerPortalJson({ error: 'Webhook-dispatch är inte konfigurerad.' }, { status: 503 })
  }
  if (!authorized(request)) {
    return customerPortalJson({ error: 'Webhook-dispatch saknar giltig cron secret.' }, { status: 401 })
  }

  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') ?? '25') || 25, 1), 100)
  let cleanupVaultSecrets: (() => void) | null = null
  try {
    const fanout = await processDomainEventWebhookFanout({ limit })
    cleanupVaultSecrets = await hydrateVaultWebhookSecretsForDispatch()
    const deliveries = await dispatchDueWebhookDeliveries(limit)
    return customerPortalJson({ data: { fanout, deliveries } })
  } catch (error) {
    const traceId = randomUUID()
    console.error('[webhook-dispatch] failed', { traceId, error })
    return customerPortalJson({ error: 'Webhook-dispatch kunde inte slutföras.', code: 'webhook_dispatch_failed', trace_id: traceId }, { status: 500 })
  } finally {
    cleanupVaultSecrets?.()
  }
}

export async function GET(request: NextRequest) {
  return run(request)
}

export async function POST(request: NextRequest) {
  return run(request)
}
