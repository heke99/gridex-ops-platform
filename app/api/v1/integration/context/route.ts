import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { logIntegrationApiRequest, requireIntegrationApiAccess } from '@/lib/integrations/apiAuth'
import { loadExternalTenantContext } from '@/lib/integrations/tenantContext'
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
    console.error('[integration-context] failed', { requestId, error })
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 500, startedAt, errorCode: 'integration_context_unavailable' })
    return customerPortalJson({ error: { code: 'integration_context_unavailable', message: 'Tenantkontext kunde inte hämtas.', request_id: requestId } }, { status: 500 })
  }
}
