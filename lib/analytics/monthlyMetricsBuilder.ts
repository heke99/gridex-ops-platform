import { supabaseService } from '@/lib/supabase/service'
import { monthStart } from '@/lib/analytics/utils'

// Forecast schedulers and SQL snapshot builders share the same source gate.
// Empty tenant configuration must not be mistaken for a customer portfolio.
export async function hasCustomerAnalyticsData(companyId: string): Promise<boolean> {
  const { data, error } = await supabaseService.rpc('gridex_company_has_customer_data', {
    p_company_id: companyId,
  })
  if (error) throw error
  if (typeof data !== 'boolean') throw new Error('Invalid customer analytics source result')
  return data
}

// Company, customer, bidding-zone and grid-owner monthly metrics plus the customer
// portfolio snapshot, computed set-based in one transaction in the database
// (gridex_rebuild_company_analytics_month). Consumption comes from the monthly rollup
// metering_point_monthly_consumption, so totals are never truncated by API row limits.
export async function buildCompanyMonthlyMetrics(companyId: string, month: string): Promise<void> {
  const { error } = await supabaseService.rpc('gridex_rebuild_company_analytics_month', {
    p_company_id: companyId,
    p_month: monthStart(month),
  })
  if (error) throw error
}

// Re-reads hourly values for a range of months (late corrections, initial backfill).
export async function rebuildMeteringMonthlyConsumption(companyId: string, fromMonth: string, toMonth: string): Promise<void> {
  const { error } = await supabaseService.rpc('gridex_rebuild_metering_monthly_consumption', {
    p_company_id: companyId,
    p_from_month: monthStart(fromMonth),
    p_to_month: monthStart(toMonth),
  })
  if (error) throw error
}
