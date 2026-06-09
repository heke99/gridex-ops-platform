import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import {
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
    const payload = await request.json().catch(() => ({})) as Record<string, unknown>
    const title = String(payload.title ?? payload.subject ?? 'Kundärende från Mina sidor').trim()
    const description = String(payload.description ?? payload.message ?? '').trim()

    const { data, error } = await supabaseService
      .from('customer_cases')
      .insert({
        company_id: context.client.company_id,
        customer_id: context.identity.customer_id,
        site_id: typeof payload.site_id === 'string' ? payload.site_id : null,
        metering_point_id: typeof payload.metering_point_id === 'string' ? payload.metering_point_id : null,
        case_type: 'other',
        status: 'open',
        priority: 'normal',
        title: title || 'Kundärende från Mina sidor',
        description,
        source: 'customer_portal_api',
        metadata: {
          external_customer_id: context.identity.external_customer_id,
          payload,
        },
      })
      .select('id,status,created_at')
      .single()

    if (error) throw error
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1, metadata: { case_id: data.id } })
    return NextResponse.json({ data })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
