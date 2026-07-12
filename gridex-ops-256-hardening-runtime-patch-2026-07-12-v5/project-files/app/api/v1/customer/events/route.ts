import { NextRequest } from 'next/server'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import { listPortalEvents, portalContextFromResolved } from '@/lib/customer-portal/apiData'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_events.read'])
  if (!context.ok) return context.response
  try {
    const portalContext = portalContextFromResolved({ companyId: context.client.company_id, customerId: context.identity.customer_id, externalCustomerId: context.identity.external_customer_id, customerNumber: context.identity.customer_number, provider: context.identity.provider })
    const rows = await listPortalEvents(portalContext)
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: rows.length })
    return customerPortalJson({ data: rows })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
