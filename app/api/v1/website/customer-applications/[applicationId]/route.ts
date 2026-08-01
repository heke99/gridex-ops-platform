import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { logIntegrationApiRequest, requireIntegrationApiAccess } from '@/lib/integrations/apiAuth'
import { loadExternalTenantContext } from '@/lib/integrations/tenantContext'
import { loadWebsiteCustomerApplicationStatus, WebsiteCustomerApplicationStatusError } from '@/lib/website/customerApplicationStatus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ applicationId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const startedAt = Date.now()
  const requestId = randomUUID()
  const auth = await requireIntegrationApiAccess(request, ['website_switch_status.read'])
  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return customerPortalJson({ error: { code: auth.errorCode, message: auth.error, request_id: requestId } }, { status: auth.status })
  }

  const { applicationId } = await params
  try {
    const [status, tenant] = await Promise.all([
      loadWebsiteCustomerApplicationStatus({ companyId: auth.context.companyId, applicationId }),
      loadExternalTenantContext(auth.client),
    ])
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 200, startedAt, metadata: { application_id: applicationId, request_id: requestId } })
    return customerPortalJson(
      { data: status, meta: { tenant_reference: tenant.tenant_reference, api_version: 'v1', channel: 'website' }, request_id: requestId },
      { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    if (error instanceof WebsiteCustomerApplicationStatusError) {
      await logIntegrationApiRequest({ client: auth.client, request, statusCode: error.status, startedAt, errorCode: error.code })
      return customerPortalJson({ error: { code: error.code, message: error.message, request_id: requestId } }, { status: error.status })
    }
    console.error('[website-customer-application-status] failed', { requestId, applicationId, error })
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 500, startedAt, errorCode: 'application_status_unavailable' })
    return customerPortalJson({ error: { code: 'application_status_unavailable', message: 'Kundansökans status kunde inte hämtas.', request_id: requestId } }, { status: 500 })
  }
}
