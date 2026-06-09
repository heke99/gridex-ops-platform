import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import {
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  normalizeFacility,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function limitFromRequest(request: NextRequest): number {
  const parsed = Number.parseInt(request.nextUrl.searchParams.get('limit') ?? '200', 10)
  if (!Number.isFinite(parsed)) return 200
  return Math.min(Math.max(parsed, 1), 1000)
}

function optionalParam(request: NextRequest, key: string): string | null {
  const value = request.nextUrl.searchParams.get(key)?.trim()
  return value || null
}

export async function GET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_portal.read'])
  if (!context.ok) return context.response

  try {
    const from = optionalParam(request, 'from')
    const to = optionalParam(request, 'to')
    const facilityId = optionalParam(request, 'facility_id')
    const normalizedFacilityId = facilityId ? normalizeFacility(facilityId) : null

    let query = supabaseService
      .from('normalized_metering_values')
      .select('id,customer_id,customer_site_id,site_id,metering_point_id,facility_id,price_area,period_start,period_end,resolution,quantity_kwh,quality_status,source_type,status,created_at')
      .eq('company_id', context.client.company_id)
      .eq('customer_id', context.identity.customer_id)
      .order('period_start', { ascending: false, nullsFirst: false })
      .limit(limitFromRequest(request))

    if (from) query = query.gte('period_start', from)
    if (to) query = query.lte('period_end', to)
    if (normalizedFacilityId) query = query.eq('facility_id', normalizedFacilityId)

    const { data, error } = await query
    if (error) throw error

    await logCustomerPortalSuccess({
      request,
      client: context.client,
      startedAt: context.startedAt,
      resultCount: data?.length ?? 0,
      metadata: {
        source_table: 'normalized_metering_values',
        external_customer_id: context.identity.external_customer_id,
        customer_id: context.identity.customer_id,
        from,
        to,
        facility_id: normalizedFacilityId,
      },
    })

    return NextResponse.json({ data: data ?? [] })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
