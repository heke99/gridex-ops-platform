import { NextRequest } from 'next/server'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import { listPortalInvoices, portalContextFromResolved } from '@/lib/customer-portal/apiData'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_portal.read'])
  if (!context.ok) return context.response

  try {
    const portalContext = portalContextFromResolved({
      companyId: context.client.company_id,
      customerId: context.identity.customer_id,
      externalCustomerId: context.identity.external_customer_id,
      customerNumber: context.identity.customer_number,
      provider: context.identity.provider,
    })
    const invoices = await listPortalInvoices(portalContext)
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: invoices.length })
    return customerPortalJson({ data: invoices })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
