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

const CONTRACT_SELECT = [
  'id',
  'customer_id',
  'site_id',
  'customer_site_id',
  'metering_point_id',
  'status',
  'contract_number',
  'contract_name',
  'contract_type',
  'source_type',
  'starts_at',
  'expected_start_at',
  'requested_start_date',
  'requested_start_mode',
  'calculated_earliest_start_date',
  'confirmed_start_date',
  'confirmed_start_at',
  'actual_start_date',
  'actual_start_at',
  'ends_at',
  'signed_at',
  'price_plan_id',
  'price_plan_version_id',
  'contract_price_snapshot_id',
  'price_area_used',
  'grid_area_code_used',
  'resolution_status',
  'monthly_fee_sek',
  'invoice_fee_sek',
  'markup_ore_per_kwh',
  'spot_markup_ore_per_kwh',
  'variable_fee_ore_per_kwh',
  'fixed_price_ore_per_kwh',
  'green_fee_mode',
  'green_fee_value',
  'binding_months',
  'notice_months',
  'terms_version',
  'created_at',
].join(',')

const CONTRACT_LEGACY_SELECT = [
  'id',
  'customer_id',
  'site_id',
  'metering_point_id',
  'status',
  'contract_name',
  'contract_type',
  'starts_at',
  'ends_at',
  'signed_at',
  'monthly_fee_sek',
  'spot_markup_ore_per_kwh',
  'variable_fee_ore_per_kwh',
  'fixed_price_ore_per_kwh',
  'green_fee_mode',
  'green_fee_value',
  'binding_months',
  'notice_months',
  'created_at',
].join(',')

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
    let result = await supabaseService
      .from('customer_contracts')
      .select(CONTRACT_SELECT)
      .eq('company_id', context.client.company_id)
      .eq('customer_id', context.identity.customer_id)
      .order('created_at', { ascending: false })
      .limit(100) as ListResult

    if (result.error && missingSchema(result.error)) {
      result = await supabaseService
        .from('customer_contracts')
        .select(CONTRACT_LEGACY_SELECT)
        .eq('company_id', context.client.company_id)
        .eq('customer_id', context.identity.customer_id)
        .order('created_at', { ascending: false })
        .limit(100) as ListResult
    }

    if (result.error) {
      if (missingSchema(result.error)) {
        await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 0 })
        return customerPortalJson({ data: [] })
      }
      throw result.error
    }
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: result.data?.length ?? 0 })
    return customerPortalJson({ data: result.data ?? [] })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
