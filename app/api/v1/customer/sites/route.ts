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

const SITE_SELECT = 'id,customer_id,site_name,facility_id,site_type,status,grid_owner_id,grid_area_code,price_area_code,resolution_status,move_in_date,move_out_date,annual_consumption_kwh,street,postal_code,city,country,created_at'
const SITE_LEGACY_SELECT = 'id,customer_id,site_name,facility_id,site_type,status,grid_owner_id,price_area_code,move_in_date,move_out_date,annual_consumption_kwh,street,postal_code,city,country'
const POINT_SELECT = 'id,site_id,customer_site_id,metering_point_id,meter_point_id,ediel_metering_point_id,site_facility_id,status,metering_type,measurement_type,reading_frequency,grid_owner_id,grid_area_code,price_area_code,start_date,end_date,verification_status,onboarding_status,data_quality_status'
const POINT_LEGACY_SELECT = 'id,site_id,metering_point_id,meter_point_id,ediel_metering_point_id,status,metering_type,measurement_type,reading_frequency,grid_owner_id,price_area_code,start_date,end_date'

type ListResult = { data: Array<Record<string, unknown>> | null; error: unknown | null }

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

export async function GET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_portal.read'])
  if (!context.ok) return context.response

  try {
    let siteResult = await supabaseService
      .from('customer_sites')
      .select(SITE_SELECT)
      .eq('company_id', context.client.company_id)
      .eq('customer_id', context.identity.customer_id)
      .order('created_at', { ascending: false })
      .limit(100) as ListResult

    if (siteResult.error && missingSchema(siteResult.error)) {
      siteResult = await supabaseService
        .from('customer_sites')
        .select(SITE_LEGACY_SELECT)
        .eq('company_id', context.client.company_id)
        .eq('customer_id', context.identity.customer_id)
        .order('created_at', { ascending: false })
        .limit(100) as ListResult
    }

    if (siteResult.error) throw siteResult.error
    const sites = siteResult.data ?? []
    const siteIds = sites.map((site) => String(site.id)).filter(Boolean)
    let pointResult: ListResult = siteIds.length > 0
      ? await supabaseService
          .from('metering_points')
          .select(POINT_SELECT)
          .eq('company_id', context.client.company_id)
          .in('site_id', siteIds) as ListResult
      : { data: [], error: null }

    if (pointResult.error && missingSchema(pointResult.error) && siteIds.length > 0) {
      pointResult = await supabaseService
        .from('metering_points')
        .select(POINT_LEGACY_SELECT)
        .eq('company_id', context.client.company_id)
        .in('site_id', siteIds) as ListResult
    }

    if (pointResult.error) throw pointResult.error
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: sites.length })
    return customerPortalJson({ data: { sites, metering_points: pointResult.data ?? [] } })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
