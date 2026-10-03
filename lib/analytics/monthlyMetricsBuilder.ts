import { supabaseService } from '@/lib/supabase/service'
import { monthStart } from '@/lib/analytics/utils'

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
