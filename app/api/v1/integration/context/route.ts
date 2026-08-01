import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { logIntegrationApiRequest, requireIntegrationApiAccess } from '@/lib/integrations/apiAuth'
import { loadExternalTenantContext } from '@/lib/integrations/tenantContext'
import { classifyPublicContractsError } from '@/lib/integrations/publicApiErrors'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const startedAt = Date.now()
  const requestId = randomUUID()
  const auth = await requireIntegrationApiAccess(request, ['integration_context.read'])
  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return customerPortalJson({ error: { code: auth.errorCode, message: auth.error, request_id: requestId } }, { status: auth.status })
  }

  try {
    const context = await loadExternalTenantContext(auth.client)
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 200, startedAt, metadata: { request_id: requestId } })
    return customerPortalJson({ data: context, request_id: requestId }, {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=300',
        'X-Gridex-Contract-Version': WEBSITE_INTEGRATION_CONTRACT_VERSION,
      },
    })
  } catch (error) {
    const classified = classifyPublicContractsError(error)
    console.error('[integration-context] failed', {
      requestId,
      companyId: auth.context.companyId,
      apiClientId: auth.client.id,
      endpoint: '/api/v1/integration/context',
      errorCode: classified.code,
      databaseCode: classified.databaseCode,
      error,
    })
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: classified.status, startedAt, errorCode: classified.code, metadata: { request_id: requestId, database_code: classified.databaseCode } })
    return customerPortalJson({ error: { code: classified.code, message: classified.message, request_id: requestId } }, { status: classified.status })
  }
}
