import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { logIntegrationApiRequest, requireIntegrationApiAccess } from '@/lib/integrations/apiAuth'
import { assertPublicWebhookTarget } from '@/lib/integrations/publicWebhookTransport'
import { handlePartnerBusinessApi } from '@/lib/partner-api/business'
import { synchronizePartnerCreatedSite } from '@/lib/partner-api/businessResolution'
import { handleCanonicalPartnerApi } from '@/lib/partner-api/canonical'
import { handlePartnerApi } from '@/lib/partner-api/core'
import { PARTNER_API_VERSION } from '@/lib/partner-api/openApi'
import { handleSimplePartnerApi } from '@/lib/partner-api/simple'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ path?: string[] }> }

function isWebhookSubscriptionCreate(method: string, path: string[] | undefined) {
  if (method !== 'POST') return false
  const segments = (path ?? []).filter(Boolean)
  return (
    (segments.length === 2 && segments[0] === 'webhook' && segments[1] === 'subscription') ||
    (segments.length === 2 && segments[0] === 'webhooks' && segments[1] === 'subscriptions')
  )
}

async function preflightWebhookTarget(request: NextRequest, path: string[] | undefined) {
  if (!isWebhookSubscriptionCreate(request.method, path)) return null

  const startedAt = Date.now()
  const access = await requireIntegrationApiAccess(request, ['partner_webhooks.manage'])
  if (!access.ok) return null

  let endpointUrl: string | null = null
  try {
    const body = await request.clone().json() as Record<string, unknown>
    const raw = body.target_url ?? body.endpoint_url
    endpointUrl = typeof raw === 'string' ? raw.trim() : null
  } catch {
    return null
  }
  if (!endpointUrl) return null

  try {
    await assertPublicWebhookTarget(endpointUrl)
    return null
  } catch {
    const id = request.headers.get('x-request-id')?.trim() || randomUUID()
    await logIntegrationApiRequest({
      client: access.client,
      request,
      statusCode: 422,
      startedAt,
      errorCode: 'webhook_target_not_public',
      metadata: { request_id: id, api_surface: 'partner_v1', operation: 'webhook.create.preflight' },
    }).catch(() => undefined)
    return NextResponse.json(
      {
        error: {
          code: 'webhook_target_not_public',
          message: 'target_url must be a publicly routable HTTPS endpoint.',
        },
        request_id: id,
      },
      {
        status: 422,
        headers: {
          'Cache-Control': 'no-store',
          'X-Request-ID': id,
          'X-Gridex-API-Version': PARTNER_API_VERSION,
        },
      },
    )
  }
}

async function dispatch(
  request: NextRequest,
  method: 'GET' | 'POST' | 'DELETE',
  context: RouteContext,
) {
  const { path } = await context.params
  const targetRejection = await preflightWebhookTarget(request, path)
  if (targetRejection) return targetRejection

  // Business-first surface: small partner DTOs backed by the same canonical
  // energy, market-price and quote engines as the rest of Gridex.
  const business = await handlePartnerBusinessApi(request, method, path)
  if (business) return business

  const simple = await handleSimplePartnerApi(request, method, path)
  const canonical = simple ? null : await handleCanonicalPartnerApi(request, method, path)
  const response = simple ?? canonical ?? await handlePartnerApi(request, method, path)

  // Contract/site creation remains owned by the existing transaction/idempotency
  // layer. After a successful write we resolve the canonical customer_sites row
  // before returning, so every partner-created site follows the same resolver
  // and database fields as website/OPS flows.
  if (method === 'POST') {
    try {
      await synchronizePartnerCreatedSite(response, path)
    } catch (error) {
      console.error('[partner-api] post-create site resolution failed', {
        path: (path ?? []).join('/'),
        error,
      })
    }
  }
  return response
}

export async function GET(request: NextRequest, context: RouteContext) {
  return dispatch(request, 'GET', context)
}

export async function POST(request: NextRequest, context: RouteContext) {
  return dispatch(request, 'POST', context)
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return dispatch(request, 'DELETE', context)
}
