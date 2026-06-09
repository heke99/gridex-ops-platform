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

export async function POST(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_portal.write'])
  if (!context.ok) return context.response

  try {
    const payload = await request.json().catch(() => ({}))
    const { data, error } = await supabaseService
      .from('customer_portal_completions')
      .insert({
        company_id: context.client.company_id,
        customer_id: context.identity.customer_id,
        site_id: typeof payload.site_id === 'string' ? payload.site_id : null,
        completion_type: 'move_out',
        status: 'submitted',
        submitted_payload: payload,
      })
      .select('id,status,created_at')
      .single()

    if (error) throw error
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1, metadata: { completion_id: data.id } })
    return customerPortalJson({ data })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
