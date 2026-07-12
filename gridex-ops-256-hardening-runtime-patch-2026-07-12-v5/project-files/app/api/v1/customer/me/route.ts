import { NextRequest } from 'next/server'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'

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
    const customer = { ...context.identity.customer }
    const fullName = displayName(customer)
    if (fullName) customer.full_name = fullName

    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1 })
    return customerPortalJson({
      data: {
        ...customer,
        customer_id: context.identity.customer_id,
        external_customer_id: context.identity.external_customer_id,
        customer_number: context.identity.customer_number ?? customer.customer_number ?? null,
        email: context.identity.email ?? customer.email ?? null,
        portal_identity: {
          id: context.identity.id,
          external_customer_id: context.identity.external_customer_id,
          customer_number: context.identity.customer_number,
          auth_user_id: context.identity.auth_user_id,
          customer_portal_user_id: context.identity.customer_portal_user_id,
          match_strength: context.identity.match_strength,
          match_method: context.identity.match_method,
          provider: context.identity.provider,
        },
      },
    })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
