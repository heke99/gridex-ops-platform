import { NextRequest } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { logIntegrationApiRequest, requireIntegrationApiAccess } from '@/lib/integrations/apiAuth'
import { diagnosePublicContractOffers } from '@/lib/website/publicContracts'
import { loadExternalTenantContext } from '@/lib/integrations/tenantContext'
import { classifyPublicContractsError } from '@/lib/integrations/publicApiErrors'
import { publicOrganizationReference } from '@/lib/integrations/publicReferences'
import { loadPublicationRevision, parsePublicContractsQuery, PublicContractsQueryError, requestId } from '@/lib/website/publicContractApi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const startedAt = Date.now()
  const currentRequestId = requestId()
  let query
  try {
    query = parsePublicContractsQuery(request)
  } catch (error) {
    if (error instanceof PublicContractsQueryError) {
      return customerPortalJson({ error: { code: error.code, message: error.message, field: error.field, request_id: currentRequestId } }, { status: 400 })
    }
    throw error
  }
  const auth = await requireIntegrationApiAccess(request, ['website_contracts.diagnostics'])
  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return customerPortalJson({ error: { code: auth.errorCode, message: auth.error, request_id: currentRequestId } }, { status: auth.status })
  }
  try {
    const [publication, revision, tenant] = await Promise.all([
      diagnosePublicContractOffers({ client: auth.client, customerType: query.customerType }),
      loadPublicationRevision(auth.context.companyId, 'website'),
      loadExternalTenantContext(auth.client),
    ])
    const canonicalGraphConsistent = publication.offers.every(
      (offer) => offer.graph?.canonical_graph_consistent === true,
    )
    const organizationReference = publicOrganizationReference(tenant.tenant_reference)
    if (!organizationReference) throw new Error('PUBLIC_ORGANIZATION_REFERENCE_UNAVAILABLE')
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 200, startedAt, metadata: { request_id: currentRequestId } })
    return customerPortalJson({
      data: [],
      diagnostics: {
        publication,
        graph: {
          source_of_truth: 'canonical_public_contract_diagnostics_v',
          canonical_graph_consistent: canonicalGraphConsistent,
        },
      },
      meta: { count: publication.total, organization_reference: organizationReference, api_version: 'v1', channel: 'website', publication_revision: revision.revision },
      request_id: currentRequestId,
    }, { status: 200, headers: { ETag: revision.etag, 'Cache-Control': 'no-store' } })
  } catch (error) {
    const classified = classifyPublicContractsError(error)
    console.error('[public-contracts-diagnostics] failed', {
      requestId: currentRequestId,
      companyId: auth.context.companyId,
      apiClientId: auth.client.id,
      endpoint: '/api/v1/website/public-contracts/diagnostics',
      channel: 'website',
      errorCode: classified.code,
      databaseCode: classified.databaseCode,
      error,
    })
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: classified.status,
      startedAt,
      errorCode: classified.code,
      metadata: { request_id: currentRequestId, channel: 'website', database_code: classified.databaseCode },
    })
    return customerPortalJson(
      { error: { code: classified.code, message: classified.message, request_id: currentRequestId } },
      { status: classified.status },
    )
  }
}
