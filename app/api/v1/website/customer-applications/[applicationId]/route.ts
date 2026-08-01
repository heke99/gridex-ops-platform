import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { canonicalApiError } from '@/lib/api/apiError'
import { logIntegrationApiRequest, requireIntegrationApiAccess } from '@/lib/integrations/apiAuth'
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
    return customerPortalJson(canonicalApiError({ code: auth.errorCode, message: auth.error, requestId }), { status: auth.status })
  }

  const { applicationId: applicationNumber } = await params
  try {
    const status = await loadWebsiteCustomerApplicationStatus({
      companyId: auth.context.companyId,
      applicationNumber,
    })
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 200, startedAt, metadata: { application_number: applicationNumber, request_id: requestId } })
    return customerPortalJson(
      { data: status, request_id: requestId, correlation_id: requestId },
      { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    if (error instanceof WebsiteCustomerApplicationStatusError) {
      await logIntegrationApiRequest({ client: auth.client, request, statusCode: error.status, startedAt, errorCode: error.code })
      return customerPortalJson(canonicalApiError({ code: error.code, message: error.message, requestId }), { status: error.status })
    }
    console.error('[website-customer-application-status] failed', { requestId, applicationNumber, error })
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 500, startedAt, errorCode: 'application_status_unavailable' })
    return customerPortalJson(canonicalApiError({ code: 'application_status_unavailable', message: 'Kundansökans status kunde inte hämtas.', requestId }), { status: 500 })
  }
}
