import { NextRequest } from 'next/server'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import { listPortalMeteringPointsForSites, listPortalSitesPage, portalContextFromResolved } from '@/lib/customer-portal/apiData'
import {
  publicPageInput,
  publicPortalMeteringPoint,
  publicPortalSite,
} from '@/lib/customer-portal/publicDto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_sites.read'])
  if (!context.ok) return context.response

  try {
    const portalContext = portalContextFromResolved({
      companyId: context.client.company_id,
      customerId: context.identity.customer_id,
      externalCustomerId: context.identity.external_customer_id,
      customerNumber: context.identity.customer_number,
      provider: context.identity.provider,
    })
    const sites = await listPortalSitesPage(portalContext, publicPageInput(request.nextUrl.searchParams))
    const meteringPoints = await listPortalMeteringPointsForSites(portalContext, sites.items)

    await logCustomerPortalSuccess({
      request,
      client: context.client,
      startedAt: context.startedAt,
      resultCount: sites.items.length,
      metadata: { metering_points: meteringPoints.length },
    })
    return customerPortalJson({
      data: {
        sites: sites.items.map((row) => publicPortalSite(context.client.company_id, row)),
        metering_points: meteringPoints.map((row) => publicPortalMeteringPoint(context.client.company_id, row)),
      },
      page: { sites: sites.page },
    })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
