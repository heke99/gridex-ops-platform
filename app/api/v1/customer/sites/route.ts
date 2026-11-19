import { withApiContractRepresentation } from '@/lib/integrations/apiResponseProfile'
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
  publicPortalSiteRows,
} from '@/lib/customer-portal/publicDto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

 async function profiledGET(request: NextRequest) {
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
    const publicRows = publicPortalSiteRows(context.client.company_id, sites.items, meteringPoints)

    await logCustomerPortalSuccess({
      request,
      client: context.client,
      startedAt: context.startedAt,
      resultCount: sites.items.length,
      metadata: { metering_points: meteringPoints.length },
    })
    return customerPortalJson({
      data: {
        sites: publicRows.sites,
        metering_points: publicRows.meteringPoints,
      },
      page: { sites: sites.page },
    })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}

export const GET = withApiContractRepresentation('customer', profiledGET)
