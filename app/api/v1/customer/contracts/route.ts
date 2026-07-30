import { NextRequest } from 'next/server'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import { listPortalContracts, portalContextFromResolved } from '@/lib/customer-portal/apiData'
import {
  pagePublicItems,
  publicPageInput,
  publicPortalContract,
} from '@/lib/customer-portal/publicDto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_contracts.read'])
  if (!context.ok) return context.response

  try {
    const portalContext = portalContextFromResolved({
      companyId: context.client.company_id,
      customerId: context.identity.customer_id,
      externalCustomerId: context.identity.external_customer_id,
      customerNumber: context.identity.customer_number,
      provider: context.identity.provider,
    })
    const contracts = await listPortalContracts(portalContext)
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: contracts.length })
    const page = pagePublicItems(
      contracts.map((row) =>
        publicPortalContract(context.client.company_id, row),
      ),
      publicPageInput(request.nextUrl.searchParams),
    )
    return customerPortalJson({ data: page.items, page: page.page })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
