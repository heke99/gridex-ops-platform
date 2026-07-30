import { NextRequest } from 'next/server'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import { listPortalMeteringPoints, listPortalSites, portalContextFromResolved } from '@/lib/customer-portal/apiData'
import {
  pagePublicItems,
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
    const sites = await listPortalSites(portalContext)
    const meteringPoints = await listPortalMeteringPoints(portalContext, sites)

    await logCustomerPortalSuccess({
      request,
      client: context.client,
      startedAt: context.startedAt,
      resultCount: sites.length,
      metadata: { metering_points: meteringPoints.length },
    })
    const pageInput = publicPageInput(request.nextUrl.searchParams)
    const publicSites = pagePublicItems(
      sites.map((row) => publicPortalSite(context.client.company_id, row)),
      pageInput,
    )
    const publicMeteringPoints = pagePublicItems(
      meteringPoints.map((row) =>
        publicPortalMeteringPoint(context.client.company_id, row),
      ),
      pageInput,
    )
    return customerPortalJson({
      data: {
        sites: publicSites.items,
        metering_points: publicMeteringPoints.items,
      },
      page: {
        sites: publicSites.page,
        metering_points: publicMeteringPoints.page,
      },
    })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
