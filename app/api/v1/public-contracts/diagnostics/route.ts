import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { logIntegrationApiRequest, requireIntegrationApiAccess } from '@/lib/integrations/apiAuth'
import { classifyPublicContractsError } from '@/lib/integrations/publicApiErrors'
import { publicOrganizationReference } from '@/lib/integrations/publicReferences'
import { loadExternalTenantContext } from '@/lib/integrations/tenantContext'
import { diagnosePublicContractOffers } from '@/lib/website/publicContracts'
import { loadPublicationRevision } from '@/lib/website/publicContractApi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const startedAt = Date.now()
  const requestId = randomUUID()
  const auth = await requireIntegrationApiAccess(request, ['api_contracts.diagnostics'])
  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return customerPortalJson({ error: { code: auth.errorCode, message: auth.error, request_id: requestId } }, { status: auth.status })
  }

  try {
    const [publication, revision, tenant] = await Promise.all([
      diagnosePublicContractOffers({ client: auth.client, channel: 'api' }),
      loadPublicationRevision(auth.context.companyId, 'api'),
      loadExternalTenantContext(auth.client),
    ])
    const organizationReference = publicOrganizationReference(tenant.tenant_reference)
    if (!organizationReference) throw new Error('PUBLIC_ORGANIZATION_REFERENCE_UNAVAILABLE')
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 200, startedAt, metadata: { request_id: requestId, channel: 'api', result_count: publication.total } })
    return customerPortalJson({
      data: publication.offers,
      diagnostics: { publication, source_of_truth: 'canonical_public_contract_diagnostics_v' },
      meta: { count: publication.total, organization_reference: organizationReference, api_version: 'v1', channel: 'api', publication_revision: revision.revision },
      request_id: requestId,
    }, { status: 200, headers: { ETag: revision.etag, 'Cache-Control': 'no-store' } })
  } catch (error) {
    const classified = classifyPublicContractsError(error)
    console.error('[api-public-contracts-diagnostics] failed', {
      requestId,
      companyId: auth.context.companyId,
      apiClientId: auth.client.id,
      endpoint: '/api/v1/public-contracts/diagnostics',
      channel: 'api',
      errorCode: classified.code,
      databaseCode: classified.databaseCode,
      error,
    })
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: classified.status, startedAt, errorCode: classified.code, metadata: { request_id: requestId, channel: 'api', database_code: classified.databaseCode } })
    return customerPortalJson({ error: { code: classified.code, message: classified.message, request_id: requestId } }, { status: classified.status })
  }
}
