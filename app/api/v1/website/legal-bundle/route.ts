import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
} from '@/lib/integrations/apiAuth'
import {
  buildWebsiteLegalBundle,
  WebsiteLegalBundleError,
} from '@/lib/website/publicContracts'
import { scheduleUsageEvent } from '@/lib/audit/actionLogger'
import { canonicalApiError } from '@/lib/api/apiError'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function legalBundleJson(body: unknown, init: ResponseInit = {}) {
  return customerPortalJson(body, init)
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now()
  const requestId = randomUUID()
  const auth = await requireIntegrationApiAccess(request, { anyOf: ['website_legal.read', 'website_contracts.read'] })

  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return customerPortalJson(canonicalApiError({ code: auth.errorCode, message: auth.error, requestId }), { status: auth.status })
  }

  const offerReference = request.nextUrl.searchParams.get('offer_reference')?.trim() ?? ''
  if (!offerReference) {
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 400, startedAt, errorCode: 'offer_reference_required' })
    return customerPortalJson(
      canonicalApiError({
        code: 'offer_reference_required',
        message: 'offer_reference krävs för att hämta exakt juridiskt paket.',
        requestId,
      }),
      { status: 400 },
    )
  }

  try {
    const bundle = await buildWebsiteLegalBundle(auth.client, offerReference)
    const statusCode = bundle.complete ? 200 : 422
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode,
      startedAt,
      metadata: { offer_reference: offerReference, complete: bundle.complete, missing_types: bundle.missing_types },
    })
    await scheduleUsageEvent({
      companyId: auth.context.companyId,
      apiClientId: auth.client.id,
      entityType: 'api_client',
      entityId: auth.client.id,
      eventKey: 'api.website_legal.read',
      actionLabel: 'Hämtade juridiskt paket (legal bundle)',
      source: 'website_api',
      billable: false,
      metadata: { offer_reference: offerReference, complete: bundle.complete, missing_types: bundle.missing_types },
    })
    return legalBundleJson(
      { data: bundle, request_id: requestId, correlation_id: requestId },
      { status: statusCode },
    )
  } catch (error) {
    if (error instanceof WebsiteLegalBundleError) {
      await logIntegrationApiRequest({
        client: auth.client,
        request,
        statusCode: error.status,
        startedAt,
        errorCode: error.code,
        metadata: { request_id: requestId, offer_reference: offerReference },
      })
      return customerPortalJson(
        canonicalApiError({
          code: error.code,
          message: error.message,
          requestId,
        }),
        { status: error.status },
      )
    }
    console.error('[website-legal-bundle] failed', { requestId, error })
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 503,
      startedAt,
      errorCode: 'legal_bundle_unavailable',
      metadata: { request_id: requestId },
    })
    return customerPortalJson(
      canonicalApiError({
        code: 'legal_bundle_unavailable',
        message: 'Juridiskt paket kunde inte hämtas.',
        requestId,
        retryable: true,
      }),
      { status: 503 },
    )
  }
}
