import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
} from '@/lib/integrations/apiAuth'
import { buildWebsiteLegalBundle } from '@/lib/website/publicContracts'
import { logUsageEvent } from '@/lib/audit/actionLogger'
import { canonicalApiError } from '@/lib/api/apiError'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ACCEPTED_SCOPES = ['website_legal.read', 'website_contracts.read']

function legalBundleJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=60')
  return NextResponse.json(body, { ...init, headers })
}

function hasAcceptedScope(scopes: string[] | null | undefined): boolean {
  const set = new Set(scopes ?? [])
  if (set.has('*')) return true
  return ACCEPTED_SCOPES.some((scope) => set.has(scope))
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now()
  const requestId = randomUUID()
  // Authenticate without enforcing a single scope, then accept either the
  // dedicated legal scope or the existing website_contracts.read so existing
  // tenant website keys keep working without re-provisioning.
  const auth = await requireIntegrationApiAccess(request, [])

  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return customerPortalJson(canonicalApiError({ code: auth.errorCode, message: auth.error, requestId }), { status: auth.status })
  }

  if (!hasAcceptedScope(auth.client.scopes)) {
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 403, startedAt, errorCode: 'api_scope_missing' })
    return customerPortalJson(
      canonicalApiError({
        code: 'api_scope_missing',
        message: 'API-klienten saknar scope för juridik (website_legal.read eller website_contracts.read).',
        requestId,
      }),
      { status: 403 },
    )
  }

  try {
    const bundle = await buildWebsiteLegalBundle(auth.client)
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 200,
      startedAt,
      metadata: { complete: bundle.complete, missing_types: bundle.missing_types },
    })
    await logUsageEvent({
      companyId: auth.client.company_id,
      apiClientId: auth.client.id,
      entityType: 'api_client',
      entityId: auth.client.id,
      eventKey: 'api.website_legal.read',
      actionLabel: 'Hämtade juridiskt paket (legal bundle)',
      source: 'website_api',
      billable: false,
      metadata: { complete: bundle.complete, missing_types: bundle.missing_types },
    })
    return legalBundleJson({ data: bundle, request_id: requestId, correlation_id: requestId })
  } catch (error) {
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
