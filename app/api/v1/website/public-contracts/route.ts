import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { logIntegrationApiRequest, requireIntegrationApiAccess } from '@/lib/integrations/apiAuth'
import {
  diagnosePublicContractOffers,
  listPublicContractOffers as loadPublicContracts,
  publicContractResponse,
  PublicContractFeedConsistencyError,
} from '@/lib/website/publicContracts'
import { scheduleUsageEvent } from '@/lib/audit/actionLogger'
import { loadExternalTenantContext } from '@/lib/integrations/tenantContext'
import { classifyPublicContractsError } from '@/lib/integrations/publicApiErrors'
import {
  buildPublicContractRepresentationEtag,
  ifNoneMatchMatches,
  loadPublicationRevision,
  parsePublicContractsQuery,
  PublicContractsQueryError,
  PUBLIC_CONTRACT_RESPONSE_SCHEMA_VERSION,
  requestId,
} from '@/lib/website/publicContractApi'
import { mapContractPublicationToPublicDto } from '@/lib/external-contracts/publicationDto'
import { supabaseService } from '@/lib/supabase/service'
import { assertPublicResponsePayload } from '@/lib/api/publicPayloadSafety'
import { publicOrganizationReference } from '@/lib/integrations/publicReferences'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function responseHeaders(input: { etag?: string; limit: number; remaining: number; resetAt: string | null; requestId: string }): Record<string, string> {
  return {
    'Cache-Control': 'private, no-store, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    ...(input.etag ? { ETag: input.etag } : {}),
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

  let currentTenantReference: string | null = null
  try {
    const { data: fingerprintRows, error: fingerprintError } = await supabaseService.rpc('public_contract_feed_fingerprint_v1', {
      p_company_id: auth.context.companyId,
      p_customer_type: query.customerType,
      p_channel: 'website',
    })
    if (fingerprintError) throw fingerprintError
    const fingerprintRow = (Array.isArray(fingerprintRows) ? fingerprintRows[0] : fingerprintRows) as {
      fingerprint?: string | null
    } | null
    const fingerprint = String(fingerprintRow?.fingerprint ?? '').trim()
    if (!/^[a-f0-9]{32}$/.test(fingerprint)) {
      throw new Error('public_contract_feed_fingerprint_invalid')
    }
    const fingerprintEtag = `"pcf-${fingerprint}"`
    const earlyHeaders = responseHeaders({
      etag: fingerprintEtag,
      limit: auth.rateLimit.limit,
      remaining: auth.rateLimit.remaining,
      resetAt: auth.rateLimit.resetAt,
      requestId: currentRequestId,
    })
    if (!query.diagnostics && ifNoneMatchMatches(request, fingerprintEtag)) {
      await logIntegrationApiRequest({
        client: auth.client,
        request,
        statusCode: 304,
        startedAt,
        metadata: { request_id: currentRequestId, feed_fingerprint: fingerprint },
      })
      return new NextResponse(null, { status: 304, headers: earlyHeaders })
    }

    // These reads are independent once the feed fingerprint misses. Starting
    // them together removes an avoidable network/database waterfall from the
    // website checkout path without changing freshness or validation rules.
    const [revision, tenant, offers] = await Promise.all([
      loadPublicationRevision(auth.context.companyId, 'website'),
      loadExternalTenantContext(auth.client),
      loadPublicContracts({ client: auth.client, customerType: query.customerType }),
    ])
    currentTenantReference = tenant.tenant_reference
    const organizationReference = publicOrganizationReference(tenant.tenant_reference)
    if (!organizationReference) throw new Error('PUBLIC_ORGANIZATION_REFERENCE_UNAVAILABLE')
    const headers = responseHeaders({
      limit: auth.rateLimit.limit,
      remaining: auth.rateLimit.remaining,
      resetAt: auth.rateLimit.resetAt,
      requestId: currentRequestId,
    })

    const data: Record<string, unknown>[] = []
    const mappingIssues: Array<{
      canonical_offer_reference: string
      publication_version_id: string | null
      diagnostic_code: string
    }> = []
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
        const mapping = mappingError as {
          name?: unknown
          code?: unknown
          path?: unknown
        }
        const offerReference =
          offer.canonical_offer_reference ?? offer.offer_code ?? offer.id
        mappingIssues.push({
          canonical_offer_reference: offerReference,
          publication_version_id:
            offer.contract_publication_version_id ?? null,
          diagnostic_code:
            typeof mapping.code === 'string'
              ? mapping.code
              : 'PUBLIC_CONTRACT_SCHEMA_INVALID',
        })
        console.error('[public-contracts] rejected malformed publication', {
          requestId: currentRequestId,
          companyId: auth.context.companyId,
          organizationReference,
          apiClientId: auth.client.id,
          channel: 'website',
          offerReference,
          publicationVersionId: offer.contract_publication_version_id ?? null,
          contractVersion: PUBLIC_CONTRACT_RESPONSE_SCHEMA_VERSION,
          schema: 'website-integration-v1.json',
          errorName: typeof mapping.name === 'string' ? mapping.name : null,
          errorCode: typeof mapping.code === 'string' ? mapping.code : null,
          errorPath: typeof mapping.path === 'string' ? mapping.path : null,
        })
      }
    }
    if (mappingIssues.length > 0) {
      throw new PublicContractFeedConsistencyError(mappingIssues)
    }
    const canonicalDiagnostics = query.diagnostics || data.length === 0
      ? await diagnosePublicContractOffers({ client: auth.client, customerType: query.customerType })
      : null
    const diagnostics = query.diagnostics ? canonicalDiagnostics : null
    if (query.diagnostics) {
      headers.Deprecation = 'true'
      headers.Sunset = 'Sat, 31 Oct 2026 23:59:59 GMT'
    }

    const diagnosticsPayload = diagnostics
      ? { publication: diagnostics, source_of_truth: 'canonical_public_contract_delivery_readiness_v' }
      : null
    const emptyFeedAuthorization = (() => {
      if (data.length > 0) return null
      if (!canonicalDiagnostics || canonicalDiagnostics.visible !== 0) {
        throw new PublicContractFeedConsistencyError([
          {
            canonical_offer_reference: 'canonical_feed',
            publication_version_id: null,
            diagnostic_code: 'EMPTY_FEED_AUTHORIZATION_INCONSISTENT',
          },
        ])
      }
      const blockers = Array.from(
        new Set(canonicalDiagnostics.offers.flatMap((offer) => offer.blockers)),
      ).sort()
      const affectedOfferReferences = Array.from(
        new Set(
          canonicalDiagnostics.offers
            .map((offer) => offer.offer_reference)
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort()
      const reason = canonicalDiagnostics.total === 0
        ? 'no_canonical_publications'
        : canonicalDiagnostics.offers.every((offer) =>
            offer.blockers.includes('PUBLICATION_EXPIRED'),
          )
          ? 'publication_validity_ended'
          : canonicalDiagnostics.offers.every((offer) =>
              offer.blockers.some((blocker) =>
                [
                  'PUBLICATION_NOT_PUBLISHED',
                  'PUBLICATION_VERSION_NOT_PUBLISHED',
                  'WEBSITE_PUBLICATION_NOT_PUBLISHED',
                  'PUBLICATION_MISSING',
                ].includes(blocker),
              ),
            )
            ? 'canonical_unpublished_or_archived'
            : 'canonical_no_visible_contracts'
      return {
        authorized: true as const,
        reason,
        publication_revision: revision.revision,
        canonical_source: 'canonical_public_contract_delivery_readiness_v' as const,
        affected_offer_references: affectedOfferReferences,
        blockers,
      }
    })()
    const responseBody = {
      data,
      contracts: data,
      meta: {
        organization_reference: organizationReference,
        api_version: 'v1',
        channel: 'website',
        count: data.length,
        publication_revision: revision.revision,
        publication_updated_at: revision.updatedAt,
        contract_schema_version: PUBLIC_CONTRACT_RESPONSE_SCHEMA_VERSION,
        feed_state: data.length === 0 ? 'canonical_empty' : 'contracts_present',
        empty_feed_authorization: emptyFeedAuthorization,
        deprecated_aliases: ['contracts', 'contract_offer_id', 'publication_reference'],
      },
      ...(diagnosticsPayload ? { diagnostics: diagnosticsPayload } : {}),
      request_id: currentRequestId,
    }
    const representationEtag = buildPublicContractRepresentationEtag({
      organizationReference,
      channel: 'website',
      customerType: query.customerType,
      contractSchemaVersion: PUBLIC_CONTRACT_RESPONSE_SCHEMA_VERSION,
      contracts: data,
      feedState: data.length === 0 ? 'canonical_empty' : 'contracts_present',
      emptyFeedAuthorization,
      ...(diagnosticsPayload ? { diagnostics: diagnosticsPayload } : {}),
    })
    const responseEtag = query.diagnostics ? representationEtag : fingerprintEtag
    headers.ETag = responseEtag

    if (!query.diagnostics && ifNoneMatchMatches(request, responseEtag)) {
      await logIntegrationApiRequest({
        client: auth.client,
        request,
        statusCode: 304,
        startedAt,
        metadata: {
          request_id: currentRequestId,
          publication_revision: revision.revision,
          representation_etag: responseEtag,
        },
      })
      return new NextResponse(null, { status: 304, headers })
    }

    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 200,
      startedAt,
      metadata: {
        request_id: currentRequestId,
        result_count: data.length,
        rejected_contracts: 0,
        customer_type: query.customerType,
        diagnostics: query.diagnostics,
        publication_revision: revision.revision,
        representation_etag: responseEtag,
      },
    })
    await scheduleUsageEvent({
      companyId: auth.context.companyId,
      apiClientId: auth.client.id,
      entityType: 'api_client',
      entityId: auth.client.id,
      eventKey: 'api.website_contracts.read',
      actionLabel: 'Hämtade publicerade avtal',
      source: 'website_api',
      billable: true,
      billingUnit: 'api_request',
      metadata: {
        result_count: data.length,
        rejected_contracts: 0,
        customer_type: query.customerType,
        diagnostics: query.diagnostics,
        representation_etag: responseEtag,
      },
    })

    assertPublicResponsePayload(responseBody)
    return NextResponse.json(responseBody, { status: 200, headers })
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
          correlation_id: auth.context.correlationId,
          ...(error instanceof PublicContractFeedConsistencyError
            ? {
                retryable: true,
                details: {
                  tenant_reference: currentTenantReference,
                  affected_contracts: error.issues,
                },
              }
            : {}),
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
