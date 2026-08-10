import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { assertPublicResponsePayload } from '@/lib/api/publicPayloadSafety'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { normalizeExternalCustomerType } from '@/lib/customers/externalCustomerType'
import { logIntegrationApiRequest, requireIntegrationApiAccess } from '@/lib/integrations/apiAuth'
import { loadExternalTenantContext } from '@/lib/integrations/tenantContext'
import { classifyPublicContractsError } from '@/lib/integrations/publicApiErrors'
import { supabaseService } from '@/lib/supabase/service'
import { ifNoneMatchMatches, loadPublicationRevision } from '@/lib/website/publicContractApi'
import {
  API_CONTRACT_RESPONSE_SCHEMA_VERSION,
  mapContractPublicationToPublicDto,
} from '@/lib/external-contracts/publicationDto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function unwrapContractPublication(value: unknown): Record<string, unknown> {
  const row = asRecord(value)
  if (!row) {
    throw new Error('PUBLICATION_RUNTIME_ROW_INVALID')
  }

  if (Object.prototype.hasOwnProperty.call(row, 'data')) {
    const nested = asRecord(row.data)
    if (!nested) {
      throw new Error('PUBLICATION_RUNTIME_ROW_INVALID')
    }
    return nested
  }

  return row
}


function contractHeaders(requestId: string): Record<string, string> {
  return {
    'X-Gridex-Contract-Version': API_CONTRACT_RESPONSE_SCHEMA_VERSION,
    'X-Request-ID': requestId,
  }
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now()
  const requestId = randomUUID()
  const supported = new Set(['customer_type'])
  for (const key of request.nextUrl.searchParams.keys()) {
    if (!supported.has(key)) {
      return customerPortalJson(
        { error: { code: 'invalid_query_parameter', message: `Query-parametern ${key} stöds inte.`, field: key, request_id: requestId } },
        { status: 400, headers: contractHeaders(requestId) },
      )
    }
  }

  const values = request.nextUrl.searchParams.getAll('customer_type')
  if (values.length > 1) {
    return customerPortalJson(
      { error: { code: 'invalid_query_parameter', message: 'customer_type får bara anges en gång.', field: 'customer_type', request_id: requestId } },
      { status: 400, headers: contractHeaders(requestId) },
    )
  }
  const normalized = normalizeExternalCustomerType(values[0] ?? null)
  if (!normalized.ok) {
    return customerPortalJson(
      {
        error: {
          code: 'invalid_query_parameter',
          message: 'customer_type måste vara private eller business. company är ett tillfälligt deprecated alias.',
          field: 'customer_type',
          request_id: requestId,
        },
      },
      { status: 400, headers: contractHeaders(requestId) },
    )
  }

  const auth = await requireIntegrationApiAccess(request, ['api_contracts.read'])
  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    const headers = new Headers(contractHeaders(requestId))
    if (auth.retryAfterSeconds) {
      headers.set('Retry-After', String(auth.retryAfterSeconds))
    }
    return customerPortalJson(
      { error: { code: auth.errorCode, message: auth.error, request_id: requestId } },
      { status: auth.status, headers },
    )
  }

  try {
    const [revision, tenant] = await Promise.all([
      loadPublicationRevision(auth.context.companyId, 'api'),
      loadExternalTenantContext(auth.client),
    ])
    const headers = {
      'Cache-Control': 'private, max-age=0, must-revalidate',
      ETag: revision.etag,
      ...contractHeaders(requestId),
      'X-RateLimit-Limit': String(auth.rateLimit.limit),
      'X-RateLimit-Remaining': String(auth.rateLimit.remaining),
      ...(auth.rateLimit.resetAt ? { 'X-RateLimit-Reset': auth.rateLimit.resetAt } : {}),
    }
    if (ifNoneMatchMatches(request, revision.etag)) {
      await logIntegrationApiRequest({
        client: auth.client,
        request,
        statusCode: 304,
        startedAt,
        metadata: { request_id: requestId, publication_revision: revision.revision, channel: 'api' },
      })
      return new NextResponse(null, { status: 304, headers })
    }

    const { data, error } = await supabaseService.rpc('gridex_list_external_api_contracts', {
      p_company_id: auth.context.companyId,
      p_customer_type: normalized.value,
    })
    if (error) throw error
    const contracts: Record<string, unknown>[] = []
    let rejectedContracts = 0
    let firstMappingError: unknown = null
    if (data !== null && data !== undefined && !Array.isArray(data)) {
      throw new Error('PUBLICATION_RUNTIME_RESPONSE_INVALID')
    }
    const rows = data ?? []
    for (const row of rows) {
      let publication: Record<string, unknown> | null = null
      try {
        publication = unwrapContractPublication(row)
        contracts.push(
          mapContractPublicationToPublicDto({
            publication,
            channel: 'api',
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
        console.error('[api-contracts] rejected malformed publication', {
          requestId,
          companyId: auth.context.companyId,
          tenantReference: tenant.tenant_reference,
          apiClientId: auth.client.id,
          channel: 'api',
          offerReference:
            publication && typeof publication.offer_reference === 'string'
              ? publication.offer_reference
              : null,
          contractVersion: API_CONTRACT_RESPONSE_SCHEMA_VERSION,
          schema: 'website-integration-v1.json',
          errorName: typeof mapping.name === 'string' ? mapping.name : null,
          errorCode: typeof mapping.code === 'string' ? mapping.code : null,
          errorPath: typeof mapping.path === 'string' ? mapping.path : null,
        })
      }
    }
    if (rejectedContracts > 0 && contracts.length === 0) {
      throw firstMappingError ?? new Error('PUBLICATION_GRAPH_INCOMPLETE')
    }

    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 200,
      startedAt,
      metadata: {
        request_id: requestId,
        result_count: contracts.length,
        customer_type: normalized.value,
        deprecated_customer_type_alias: normalized.deprecatedAlias,
        publication_revision: revision.revision,
        channel: 'api',
        rejected_contracts: rejectedContracts,
      },
    })

    const responseBody = {
        data: contracts,
        contracts,
        meta: {
          count: contracts.length,
          tenant_reference: tenant.tenant_reference,
          api_version: 'v1',
          contract_schema_version: API_CONTRACT_RESPONSE_SCHEMA_VERSION,
          channel: 'api',
          publication_revision: revision.revision,
          publication_updated_at: revision.updatedAt,
          customer_type: normalized.value,
          deprecated_customer_type_alias: normalized.deprecatedAlias,
        },
        request_id: requestId,
      }
    assertPublicResponsePayload(responseBody)
    return NextResponse.json(responseBody, { status: 200, headers })
  } catch (error) {
    const classified = classifyPublicContractsError(error)
    console.error('[api-contracts] failed', {
      requestId,
      companyId: auth.context.companyId,
      apiClientId: auth.client.id,
      endpoint: '/api/v1/public-contracts',
      channel: 'api',
      errorCode: classified.code,
      errorPath: classified.path,
      databaseCode: classified.databaseCode,
      contractVersion: API_CONTRACT_RESPONSE_SCHEMA_VERSION,
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
        request_id: requestId,
        channel: 'api',
        database_code: classified.databaseCode,
        error_path: classified.path,
      },
    })
    return customerPortalJson(
      {
        error: {
          code: classified.code,
          message: classified.message,
          request_id: requestId,
        },
      },
      {
        status: classified.status,
        headers: contractHeaders(requestId),
      },
    )
  }
}
