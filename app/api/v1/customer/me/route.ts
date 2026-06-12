import { NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_portal.read'])
  if (!context.ok) return context.response

  try {
    const { data, error } = await supabaseService
      .from('customers')
      .select('id,company_id,customer_number,customer_type,status,first_name,last_name,full_name,company_name,email,phone,created_at,intake_status,intake_missing_fields,intake_quality_score')
      .eq('company_id', context.client.company_id)
      .eq('id', context.identity.customer_id)
      .maybeSingle()

    if (error) throw error
    if (!data) {
      await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 0 })
      return customerPortalJson({ error: 'Kunden hittades inte.' }, { status: 404 })
    }

    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1 })
    return customerPortalJson({
      data: {
        ...data,
        portal_identity: {
          id: context.identity.id,
          external_customer_id: context.identity.external_customer_id,
          match_strength: context.identity.match_strength,
          match_method: context.identity.match_method,
        },
      },
    })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
