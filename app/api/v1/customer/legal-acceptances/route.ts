import { NextRequest } from 'next/server'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import { listPortalLegalAcceptancesPage, portalContextFromResolved } from '@/lib/customer-portal/apiData'
import {
  publicPageInput,
  publicPortalLegalAcceptance,
} from '@/lib/customer-portal/publicDto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_legal.read'])
  if (!context.ok) return context.response
  try {
    const portalContext = portalContextFromResolved({ companyId: context.client.company_id, customerId: context.identity.customer_id, externalCustomerId: context.identity.external_customer_id, customerNumber: context.identity.customer_number, provider: context.identity.provider })
    const page = await listPortalLegalAcceptancesPage(portalContext, publicPageInput(request.nextUrl.searchParams))
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: page.items.length })
    return customerPortalJson({
      data: page.items.map((row) => publicPortalLegalAcceptance(context.client.company_id, row)),
      page: page.page,
    })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
