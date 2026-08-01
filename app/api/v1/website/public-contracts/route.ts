import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { logIntegrationApiRequest, requireIntegrationApiAccess } from '@/lib/integrations/apiAuth'
import { diagnosePublicContractOffers, listPublicContractOffers, publicContractResponse } from '@/lib/website/publicContracts'
import { logUsageEvent } from '@/lib/audit/actionLogger'
import { loadExternalTenantContext } from '@/lib/integrations/tenantContext'
import { classifyPublicContractsError } from '@/lib/integrations/publicApiErrors'
import {
  ifNoneMatchMatches,
  loadPublicationRevision,
  parsePublicContractsQuery,
  PublicContractsQueryError,
  PUBLIC_CONTRACT_RESPONSE_SCHEMA_VERSION,
  requestId,
} from '@/lib/website/publicContractApi'
import { mapContractPublicationToPublicDto } from '@/lib/external-contracts/publicationDto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function responseHeaders(input: { etag: string; limit: number; remaining: number; resetAt: string | null; requestId: string }): Record<string, string> {
  return {
    'Cache-Control': 'private, max-age=0, must-revalidate',
    ETag: input.etag,
    'X-Gridex-Contract-Version': PUBLIC_CONTRACT_RESPONSE_SCHEMA_VERSION,
    'X-Request-ID': input.requestId,
    'X-RateLimit-Limit': String(input.limit),
    'X-RateLimit-Remaining': String(input.remaining),
    ...(input.resetAt ? { 'X-RateLimit-Reset': input.resetAt } : {}),
  }
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now()
  const currentRequestId = requestId()
  let query
  try {
    query = parsePublicContractsQuery(request)
  } catch (error) {
    if (error instanceof PublicContractsQueryError) {
      return customerPortalJson(
        { error: { code: error.code, message: error.message, field: error.field, request_id: currentRequestId } },
        {
          status: 400,
          headers: {
            'X-Gridex-Contract-Version': PUBLIC_CONTRACT_RESPONSE_SCHEMA_VERSION,
            'X-Request-ID': currentRequestId,
          },
        },
      )
    }
    throw error
  }

  const requiredScopes = query.diagnostics
    ? ['website_contracts.read', 'website_contracts.diagnostics']
    : ['website_contracts.read']
  const auth = await requireIntegrationApiAccess(request, requiredScopes)
  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    const headers = new Headers({
      'X-Gridex-Contract-Version': PUBLIC_CONTRACT_RESPONSE_SCHEMA_VERSION,
      'X-Request-ID': currentRequestId,
    })
    if (auth.retryAfterSeconds) headers.set('Retry-After', String(auth.retryAfterSeconds))
    return customerPortalJson({ error: { code: auth.errorCode, message: auth.error, request_id: currentRequestId } }, { status: auth.status, headers })
  }

  try {
    const [revision, tenant] = await Promise.all([
      loadPublicationRevision(auth.context.companyId, 'website'),
      loadExternalTenantContext(auth.client),
    ])
    const headers = responseHeaders({
      etag: revision.etag,
      limit: auth.rateLimit.limit,
      remaining: auth.rateLimit.remaining,
      resetAt: auth.rateLimit.resetAt,
      requestId: currentRequestId,
    })
    if (!query.diagnostics && ifNoneMatchMatches(request, revision.etag)) {
      await logIntegrationApiRequest({ client: auth.client, request, statusCode: 304, startedAt, metadata: { request_id: currentRequestId, publication_revision: revision.revision } })
      return new NextResponse(null, { status: 304, headers })
    }

    const offers = await listPublicContractOffers({ client: auth.client, customerType: query.customerType })
    const data: Record<string, unknown>[] = []
    let rejectedContracts = 0
    let firstMappingError: unknown = null
    for (const offer of offers) {
      try {
        data.push(
          mapContractPublicationToPublicDto({
            publication: publicContractResponse(offer),
            channel: 'website',
            companyId: auth.context.companyId,
          }),
        )
      } catch (mappingError) {
        rejectedContracts += 1
        firstMappingError ??= mappingError
        const mapping = mappingError as {
          name?: unknown
          code?: unknown
          path?: unknown
        }
        console.error('[public-contracts] rejected malformed publication', {
          requestId: currentRequestId,
          companyId: auth.context.companyId,
          tenantReference: tenant.tenant_reference,
          apiClientId: auth.client.id,
          channel: 'website',
          offerReference:
            offer.canonical_offer_reference ?? offer.offer_code ?? offer.id,
          publicationVersionId: offer.contract_publication_version_id ?? null,
          contractVersion: PUBLIC_CONTRACT_RESPONSE_SCHEMA_VERSION,
          schema: 'website-integration-v1.json',
          errorName: typeof mapping.name === 'string' ? mapping.name : null,
          errorCode: typeof mapping.code === 'string' ? mapping.code : null,
          errorPath: typeof mapping.path === 'string' ? mapping.path : null,
        })
      }
    }
    if (rejectedContracts > 0 && data.length === 0) {
      throw firstMappingError ?? new Error('PUBLICATION_GRAPH_INCOMPLETE')
    }
    const diagnostics = query.diagnostics
      ? await diagnosePublicContractOffers({ client: auth.client, customerType: query.customerType })
      : null
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 200,
      startedAt,
      metadata: { request_id: currentRequestId, result_count: data.length, rejected_contracts: rejectedContracts, customer_type: query.customerType, diagnostics: query.diagnostics, publication_revision: revision.revision },
    })
    await logUsageEvent({
      companyId: auth.context.companyId,
      apiClientId: auth.client.id,
      entityType: 'api_client',
      entityId: auth.client.id,
      eventKey: 'api.website_contracts.read',
      actionLabel: 'Hämtade publicerade avtal',
      source: 'website_api',
      billable: true,
      billingUnit: 'api_request',
      metadata: { result_count: data.length, rejected_contracts: rejectedContracts, customer_type: query.customerType, diagnostics: query.diagnostics },
    })

    if (query.diagnostics) {
      headers.Deprecation = 'true'
      headers.Sunset = 'Sat, 31 Oct 2026 23:59:59 GMT'
    }

    return NextResponse.json({
      data,
      contracts: data,
      meta: {
        tenant_reference: tenant.tenant_reference,
        api_version: 'v1',
        channel: 'website',
        count: data.length,
        publication_revision: revision.revision,
        publication_updated_at: revision.updatedAt,
        contract_schema_version: PUBLIC_CONTRACT_RESPONSE_SCHEMA_VERSION,
        deprecated_aliases: ['contracts', 'contract_offer_id', 'publication_reference'],
      },
      ...(diagnostics ? { diagnostics: { publication: diagnostics, source_of_truth: 'canonical_public_contract_diagnostics_v' } } : {}),
      request_id: currentRequestId,
    }, { status: 200, headers })
  } catch (error) {
    const traceId = randomUUID()
    const classified = classifyPublicContractsError(error)
    console.error('[public-contracts] failed', {
      traceId,
      requestId: currentRequestId,
      companyId: auth.context.companyId,
      apiClientId: auth.client.id,
      endpoint: '/api/v1/website/public-contracts',
      channel: 'website',
      errorCode: classified.code,
      errorPath: classified.path,
      databaseCode: classified.databaseCode,
      contractVersion: PUBLIC_CONTRACT_RESPONSE_SCHEMA_VERSION,
      schema: 'website-integration-v1.json',
      errorName:
        error && typeof error === 'object' && 'name' in error
          ? String((error as { name?: unknown }).name ?? '')
          : null,
    })
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: classified.status,
      startedAt,
      errorCode: classified.code,
      metadata: {
        trace_id: traceId,
        request_id: currentRequestId,
        channel: 'website',
        database_code: classified.databaseCode,
        error_path: classified.path,
      },
    })
    return customerPortalJson(
      {
        error: {
          code: classified.code,
          message: classified.message,
          trace_id: traceId,
          request_id: currentRequestId,
        },
      },
      {
        status: classified.status,
        headers: {
          'X-Gridex-Contract-Version': PUBLIC_CONTRACT_RESPONSE_SCHEMA_VERSION,
          'X-Request-ID': currentRequestId,
        },
      },
    )
  }
}
