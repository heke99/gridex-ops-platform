import { NextRequest } from 'next/server'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import { publicPortalCustomer } from '@/lib/customer-portal/publicDto'
import { publicPortalIdentity } from '@/lib/customer-portal/publicIdentity'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_profile.read'])
  if (!context.ok) return context.response

  try {
    const customer = publicPortalCustomer(context.identity.customer, {
      external_customer_id: context.identity.external_customer_id,
      customer_number: context.identity.customer_number,
      email: context.identity.email,
    })
    const portalIdentity = publicPortalIdentity(
      context.client.company_id,
      context.identity,
    )

    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1 })
    return customerPortalJson({
      data: {
        ...customer,
        portal_identity: portalIdentity,
      },
    })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
