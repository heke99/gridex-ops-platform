import { NextRequest } from 'next/server'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import {
  publicPortalCustomer,
  publicPortalIdentity,
} from '@/lib/customer-portal/publicDto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function displayName(customer: Record<string, unknown>): string | null {
  const direct = typeof customer.full_name === 'string' && customer.full_name.trim() ? customer.full_name.trim() : null
  if (direct) return direct
  const first = typeof customer.first_name === 'string' ? customer.first_name.trim() : ''
  const last = typeof customer.last_name === 'string' ? customer.last_name.trim() : ''
  const combined = [first, last].filter(Boolean).join(' ').trim()
  if (combined) return combined
  return typeof customer.company_name === 'string' && customer.company_name.trim() ? customer.company_name.trim() : null
}

export async function GET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_profile.read'])
  if (!context.ok) return context.response

  try {
    const customer = context.identity.customer
    const fullName = displayName(customer)
    const publicCustomer = publicPortalCustomer(customer, {
      external_customer_id: context.identity.external_customer_id,
      customer_number: context.identity.customer_number,
      email: context.identity.email,
    })

    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1 })
    return customerPortalJson({
      data: {
        ...publicCustomer,
        display_name: fullName ?? publicCustomer.display_name,
        portal_identity: publicPortalIdentity(context.client.company_id, context.identity),
      },
    })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
