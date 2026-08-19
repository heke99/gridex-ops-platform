import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { logIntegrationApiRequest, requireIntegrationApiAccess } from '@/lib/integrations/apiAuth'
import { loadExternalTenantContext } from '@/lib/integrations/tenantContext'
import { loadWebsiteSwitchStatus, WebsiteSwitchStatusError } from '@/lib/website/switchStatus'
import { publicOrganizationReference } from '@/lib/integrations/publicReferences'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const startedAt = Date.now()
  const requestId = randomUUID()
  const supported = new Set(['application_number'])
  for (const key of request.nextUrl.searchParams.keys()) {
    if (!supported.has(key)) {
      return customerPortalJson(
        { error: { code: 'invalid_query_parameter', message: `Query parameter ${key} is not supported.`, field: key, request_id: requestId } },
        { status: 400 },
      )
    }
  }
  const applicationNumbers = request.nextUrl.searchParams.getAll('application_number')
  const applicationNumber = applicationNumbers[0]?.trim() ?? ''
  if (applicationNumbers.length !== 1 || !applicationNumber) {
    return customerPortalJson(
      { error: { code: 'application_number_required', message: 'application_number must be specified exactly once.', field: 'application_number', request_id: requestId } },
      { status: 400 },
    )
  }

  const auth = await requireIntegrationApiAccess(request, ['website_switch_status.read'])
  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return customerPortalJson({ error: { code: auth.errorCode, message: auth.error, request_id: requestId } }, { status: auth.status })
  }

  try {
    const [status, tenant] = await Promise.all([
      loadWebsiteSwitchStatus({ companyId: auth.context.companyId, applicationNumber }),
      loadExternalTenantContext(auth.client),
    ])
    const organizationReference = publicOrganizationReference(tenant.tenant_reference)
    if (!organizationReference) throw new Error('PUBLIC_ORGANIZATION_REFERENCE_UNAVAILABLE')
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 200, startedAt, metadata: { request_id: requestId, application_number: applicationNumber } })
    return customerPortalJson(
      { data: status, meta: { organization_reference: organizationReference, api_version: 'v1', channel: 'website' }, request_id: requestId },
      { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    if (error instanceof WebsiteSwitchStatusError) {
      await logIntegrationApiRequest({ client: auth.client, request, statusCode: error.status, startedAt, errorCode: error.code })
      return customerPortalJson({ error: { code: error.code, message: error.code === 'application_not_found' ? 'The application could not be found.' : 'The supplier-switch status request could not be processed.', field: error.field, request_id: requestId } }, { status: error.status })
    }
    console.error('[website-switch-status] failed', { requestId, error })
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 500, startedAt, errorCode: 'switch_status_unavailable' })
    return customerPortalJson({ error: { code: 'switch_status_unavailable', message: 'Supplier-switch status is temporarily unavailable.', request_id: requestId } }, { status: 500 })
  }
}
