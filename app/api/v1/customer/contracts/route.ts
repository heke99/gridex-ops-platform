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
    const { data, error } = await supabaseService
      .from('customer_contracts')
      .select('id,customer_id,site_id,metering_point_id,status,contract_name,contract_type,starts_at,ends_at,signed_at,monthly_fee_sek,spot_markup_ore_per_kwh,variable_fee_ore_per_kwh,fixed_price_ore_per_kwh,green_fee_mode,green_fee_value,binding_months,notice_months,created_at')
      .eq('company_id', context.client.company_id)
      .eq('customer_id', context.identity.customer_id)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw error
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: data?.length ?? 0 })
    return NextResponse.json({ data: data ?? [] })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
