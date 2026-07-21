import { NextRequest } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { logIntegrationApiRequest, requireIntegrationApiAccess } from '@/lib/integrations/apiAuth'
import { diagnosePublicContractOffers } from '@/lib/website/publicContracts'
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
    const [publication, revision] = await Promise.all([
      diagnosePublicContractOffers({ client: auth.client, customerType: query.customerType }),
      loadPublicationRevision(auth.client.company_id, 'website'),
    ])
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 200, startedAt, metadata: { request_id: currentRequestId } })
    return customerPortalJson({
      data: [],
      diagnostics: {
        publication,
        graph: { source_of_truth: 'contract_publication_versions', canonical_graph_consistent: publication.hidden === 0 },
      },
      meta: { api_version: 'v1', channel: 'website', publication_revision: revision.revision },
      request_id: currentRequestId,
    }, { status: 200, headers: { ETag: revision.etag, 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[public-contracts-diagnostics] failed', { requestId: currentRequestId, error })
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 500, startedAt, errorCode: 'public_contract_diagnostics_unavailable' })
    return customerPortalJson({ error: { code: 'public_contract_diagnostics_unavailable', message: 'Avtalsdiagnostiken kunde inte hämtas.', request_id: currentRequestId } }, { status: 500 })
  }
}
