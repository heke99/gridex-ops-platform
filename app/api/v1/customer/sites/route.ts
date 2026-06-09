import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import {
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
    const { data: sites, error: siteError } = await supabaseService
      .from('customer_sites')
      .select('id,customer_id,site_name,facility_id,site_type,status,grid_owner_id,price_area_code,move_in_date,move_out_date,annual_consumption_kwh,street,postal_code,city,country')
      .eq('company_id', context.client.company_id)
      .eq('customer_id', context.identity.customer_id)
      .order('created_at', { ascending: false })
      .limit(100)

    if (siteError) throw siteError
    const siteIds = (sites ?? []).map((site) => site.id)
    const { data: points, error: pointError } = siteIds.length > 0
      ? await supabaseService
          .from('metering_points')
          .select('id,site_id,metering_point_id,meter_point_id,ediel_metering_point_id,status,metering_type,measurement_type,reading_frequency,grid_owner_id,price_area_code,start_date,end_date')
          .eq('company_id', context.client.company_id)
          .in('site_id', siteIds)
      : { data: [], error: null }

    if (pointError) throw pointError
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: sites?.length ?? 0 })
    return NextResponse.json({ data: { sites: sites ?? [], metering_points: points ?? [] } })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
