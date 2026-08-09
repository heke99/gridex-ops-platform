import { NextRequest } from 'next/server'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import { readPortalSitesPage } from '@/lib/customer-portal/publicReadModel'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_sites.read'])
  if (!context.ok) return context.response

  try {
    const result = await readPortalSitesPage(
      {
        companyId: context.client.company_id,
        customerId: context.identity.customer_id,
        externalCustomerId: context.identity.external_customer_id,
        customerNumber: context.identity.customer_number,
      },
      request.nextUrl.searchParams,
    )

    await logCustomerPortalSuccess({
      request,
      client: context.client,
      startedAt: context.startedAt,
      resultCount: result.sites.length,
      metadata: { metering_points: result.meteringPoints.length },
    })
    return customerPortalJson({
      data: {
        sites: result.sites,
        metering_points: result.meteringPoints,
      },
      page: {
        sites: result.page,
        metering_points: {
          limit: result.meteringPoints.length,
          returned: result.meteringPoints.length,
          has_more: false,
          next_cursor: null,
        },
      },
    })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
