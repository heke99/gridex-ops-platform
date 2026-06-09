import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import {
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function limitFromRequest(request: NextRequest): number {
  const parsed = Number.parseInt(request.nextUrl.searchParams.get('limit') ?? '200', 10)
  if (!Number.isFinite(parsed)) return 200
  return Math.min(Math.max(parsed, 1), 1000)
}

export async function GET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_portal.read'])
  if (!context.ok) return context.response

  try {
    let query = supabaseService
      .from('metering_values')
      .select('id,customer_id,site_id,metering_point_id,reading_type,value_kwh,quality_code,read_at,period_start,period_end,source_system,value_status,is_current,created_at')
      .eq('company_id', context.client.company_id)
      .eq('customer_id', context.identity.customer_id)
      .order('period_start', { ascending: false, nullsFirst: false })
      .limit(limitFromRequest(request))

    const from = request.nextUrl.searchParams.get('from')
    const to = request.nextUrl.searchParams.get('to')
    if (from) query = query.gte('period_start', from)
    if (to) query = query.lte('period_end', to)

    const { data, error } = await query
    if (error) throw error

    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: data?.length ?? 0 })
    return NextResponse.json({ data: data ?? [] })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
