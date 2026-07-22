import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { normalizeExternalCustomerType } from '@/lib/customers/externalCustomerType'
import { logIntegrationApiRequest, requireIntegrationApiAccess } from '@/lib/integrations/apiAuth'
import { loadExternalTenantContext } from '@/lib/integrations/tenantContext'
import { supabaseService } from '@/lib/supabase/service'
import { ifNoneMatchMatches, loadPublicationRevision } from '@/lib/website/publicContractApi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const startedAt = Date.now()
  const requestId = randomUUID()
  const supported = new Set(['customer_type'])
  for (const key of request.nextUrl.searchParams.keys()) {
    if (!supported.has(key)) {
      return customerPortalJson(
        { error: { code: 'invalid_query_parameter', message: `Query-parametern ${key} stöds inte.`, field: key, request_id: requestId } },
        { status: 400 },
      )
    }
  }

  const values = request.nextUrl.searchParams.getAll('customer_type')
  if (values.length > 1) {
    return customerPortalJson(
      { error: { code: 'invalid_query_parameter', message: 'customer_type får bara anges en gång.', field: 'customer_type', request_id: requestId } },
      { status: 400 },
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
      { status: 400 },
    )
  }

  const auth = await requireIntegrationApiAccess(request, ['api_contracts.read'])
  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return customerPortalJson({ error: { code: auth.errorCode, message: auth.error, request_id: requestId } }, { status: auth.status })
  }

  try {
    const [revision, tenant] = await Promise.all([
      loadPublicationRevision(auth.client.company_id, 'api'),
      loadExternalTenantContext(auth.client),
    ])
    const headers = {
      'Cache-Control': 'private, max-age=0, must-revalidate',
      ETag: revision.etag,
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
      p_company_id: auth.client.company_id,
      p_customer_type: normalized.value,
    })
    if (error) throw error
    const contracts = ((data ?? []) as Array<{ data?: Record<string, unknown> }>).map((row) => row.data ?? row)

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
      },
    })

    return NextResponse.json(
      {
        data: contracts,
        meta: {
          tenant_reference: tenant.tenant_reference,
          api_version: 'v1',
          channel: 'api',
          publication_revision: revision.revision,
          publication_updated_at: revision.updatedAt,
          customer_type: normalized.value,
          deprecated_customer_type_alias: normalized.deprecatedAlias,
        },
        request_id: requestId,
      },
      { status: 200, headers },
    )
  } catch (error) {
    console.error('[api-contracts] failed', { requestId, error })
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 500, startedAt, errorCode: 'api_contracts_unavailable' })
    return customerPortalJson(
      { error: { code: 'api_contracts_unavailable', message: 'API-publicerade avtal kunde inte hämtas.', request_id: requestId } },
      { status: 500 },
    )
  }
}
