import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
} from '@/lib/integrations/apiAuth'
import { diagnosePublicContractOffers, listPublicContractOffers, publicContractResponse } from '@/lib/website/publicContracts'
import { logUsageEvent } from '@/lib/audit/actionLogger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function publicContractsJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=60')
  return NextResponse.json(body, { ...init, headers })
}

function wantsDiagnostics(request: NextRequest): boolean {
  const value = request.nextUrl.searchParams.get('diagnostics') ?? request.nextUrl.searchParams.get('debug')
  return value === '1' || value === 'true'
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now()
  const auth = await requireIntegrationApiAccess(request, ['website_contracts.read'])

  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    const headers = new Headers()
    if (auth.retryAfterSeconds) headers.set('Retry-After', String(auth.retryAfterSeconds))
    if (auth.rateLimit) {
      headers.set('X-RateLimit-Limit', String(auth.rateLimit.limit))
      headers.set('X-RateLimit-Remaining', String(auth.rateLimit.remaining))
      if (auth.rateLimit.resetAt) headers.set('X-RateLimit-Reset', auth.rateLimit.resetAt)
    }
    return customerPortalJson(
      { error: { code: auth.errorCode, message: auth.error } },
      { status: auth.status, headers },
    )
  }

  try {
    const customerType = request.nextUrl.searchParams.get('customer_type')
    const diagnostics = wantsDiagnostics(request)
    const offers = await listPublicContractOffers({ client: auth.client, customerType })
    const contracts = offers.map(publicContractResponse)
    const offerDiagnostics = diagnostics
      ? await diagnosePublicContractOffers({ client: auth.client, customerType })
      : null
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 200,
      startedAt,
      metadata: { result_count: offers.length, customer_type: customerType, diagnostics },
    })
    await logUsageEvent({
      companyId: auth.client.company_id,
      apiClientId: auth.client.id,
      entityType: 'api_client',
      entityId: auth.client.id,
      eventKey: 'api.website_contracts.read',
      actionLabel: 'Hämtade publicerade avtal',
      source: 'website_api',
      billable: true,
      billingUnit: 'api_request',
      metadata: { result_count: offers.length, customer_type: customerType, diagnostics },
    })

    return publicContractsJson(
      {
        data: contracts,
        contracts,
        ...(diagnostics ? {
          diagnostics: {
            authenticated: true,
            company_id: auth.client.company_id,
            api_client_id: auth.client.id,
            result_count: offers.length,
            publication: offerDiagnostics,
            source_of_truth: 'contract_publication_versions',
          },
        } : {}),
      },
      {
        headers: {
          'X-RateLimit-Limit': String(auth.rateLimit.limit),
          'X-RateLimit-Remaining': String(auth.rateLimit.remaining),
          ...(auth.rateLimit.resetAt ? { 'X-RateLimit-Reset': auth.rateLimit.resetAt } : {}),
        },
      },
    )
  } catch (error) {
    const traceId = randomUUID()
    console.error('[public-contracts] failed', { traceId, error })
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 500, startedAt, errorCode: 'public_contracts_unavailable', metadata: { trace_id: traceId } })
    return customerPortalJson({ error: { code: 'public_contracts_unavailable', message: 'Publicerade avtal kunde inte hämtas.', trace_id: traceId } }, { status: 500 })
  }
}
