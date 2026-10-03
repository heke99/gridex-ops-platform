import { createSupabaseServerClient } from '@/lib/supabase/server'
import { asNumber, monthStart } from '@/lib/analytics/utils'
import { supabaseService } from '@/lib/supabase/service'

// "Kundportfölj": customer counts, churn and forward consumption per tenant.
// All figures come from security-checked RPCs; tenant and white-label access is
// enforced in the database (gridex_customer_portfolio_assert_read).

export type PortfolioMonthRow = {
  month: string
  activeCustomersStart: number
  activeCustomers: number
  newCustomers: number
  churnedCustomers: number
  netChange: number
  churnRate: number | null
  activeMeteringPoints: number
  poaRequested: number
  poaSigned: number
  poaActive: number
  meteringRequestsTotal: number
  meteringRequestsHistorical: number
  meteringRequestsOngoing: number
  meteringRequestsFailed: number
}

export type PortfolioForecastMonth = {
  month: string
  monthIndex: number
  forecastKwh: number
  lowKwh: number
  highKwh: number
  meteringPoints: number
  pointsWithHistory: number
}

export type PortfolioHorizon = {
  key: 'month' | '3m' | '6m' | '12m'
  label: string
  months: number
  forecastKwh: number
  lowKwh: number
  highKwh: number
}

export type WhiteLabelPlatformOption = { id: string; name: string; slug: string | null; status: string | null; membershipRole: string | null }

export type WhiteLabelTenantRow = {
  companyId: string
  companyName: string
  companyStatus: string | null
  activeCustomers: number
  newCustomers: number
  churnedCustomers: number
  netChange: number
  poaRequested: number
  poaActive: number
  meteringRequestsTotal: number
  meteringRequestsHistorical: number
  forecastMonthKwh: number
  forecast3mKwh: number
  forecast6mKwh: number
  forecast12mKwh: number
}

const HORIZONS: Array<Pick<PortfolioHorizon, 'key' | 'label' | 'months'>> = [
  { key: 'month', label: 'Innevarande månad', months: 1 },
  { key: '3m', label: '3 månader', months: 3 },
  { key: '6m', label: '6 månader', months: 6 },
  { key: '12m', label: '12 månader', months: 12 },
]

export function summarizeForecastHorizons(rows: PortfolioForecastMonth[]): PortfolioHorizon[] {
  const sorted = [...rows].sort((a, b) => a.monthIndex - b.monthIndex)
  return HORIZONS.map((horizon) => {
    const window = sorted.filter((row) => row.monthIndex >= 1 && row.monthIndex <= horizon.months)
    const sum = (key: 'forecastKwh' | 'lowKwh' | 'highKwh') => window.reduce((total, row) => total + Math.max(0, row[key]), 0)
    return { ...horizon, forecastKwh: sum('forecastKwh'), lowKwh: sum('lowKwh'), highKwh: sum('highKwh') }
  })
}

export function mapPortfolioMonthRow(row: Record<string, unknown>): PortfolioMonthRow {
  return {
    month: String(row.month ?? '').slice(0, 10),
    activeCustomersStart: asNumber(row.active_customers_start),
    activeCustomers: asNumber(row.active_customers),
    newCustomers: asNumber(row.new_customers),
    churnedCustomers: asNumber(row.churned_customers),
    netChange: asNumber(row.net_change),
    churnRate: row.churn_rate === null || row.churn_rate === undefined ? null : asNumber(row.churn_rate),
    activeMeteringPoints: asNumber(row.active_metering_points),
    poaRequested: asNumber(row.poa_requested),
    poaSigned: asNumber(row.poa_signed),
    poaActive: asNumber(row.poa_active),
    meteringRequestsTotal: asNumber(row.metering_requests_total),
    meteringRequestsHistorical: asNumber(row.metering_requests_historical),
    meteringRequestsOngoing: asNumber(row.metering_requests_ongoing),
    meteringRequestsFailed: asNumber(row.metering_requests_failed),
  }
}

export function mapForecastRow(row: Record<string, unknown>): PortfolioForecastMonth {
  return {
    month: String(row.month ?? '').slice(0, 10),
    monthIndex: asNumber(row.month_index),
    forecastKwh: asNumber(row.forecast_kwh),
    lowKwh: asNumber(row.low_kwh),
    highKwh: asNumber(row.high_kwh),
    meteringPoints: asNumber(row.metering_points),
    pointsWithHistory: asNumber(row.points_with_history),
  }
}

export async function getCustomerPortfolio(companyId: string, from: string, to: string) {
  const supabase = await createSupabaseServerClient()
  const [summary, forecast] = await Promise.all([
    supabase.rpc('gridex_customer_portfolio_summary', { p_company_id: companyId, p_from: from, p_to: to }),
    supabase.rpc('gridex_customer_portfolio_forecast', { p_company_id: companyId }),
  ])
  if (summary.error) throw summary.error
  if (forecast.error) throw forecast.error
  const months = ((summary.data ?? []) as Record<string, unknown>[]).map(mapPortfolioMonthRow)
  const forecastMonths = ((forecast.data ?? []) as Record<string, unknown>[]).map(mapForecastRow)
  return { months, forecastMonths, horizons: summarizeForecastHorizons(forecastMonths) }
}

export async function listReadableWhiteLabelPlatforms(): Promise<WhiteLabelPlatformOption[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('gridex_list_readable_whitelabel_platforms')
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ''),
    slug: (row.slug as string | null) ?? null,
    status: (row.status as string | null) ?? null,
    membershipRole: (row.membership_role as string | null) ?? null,
  }))
}

export async function getWhiteLabelPortfolioOverview(platformId: string, month: string): Promise<WhiteLabelTenantRow[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('gridex_whitelabel_portfolio_overview', { p_white_label_platform_id: platformId, p_month: month })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    companyId: String(row.company_id),
    companyName: String(row.company_name ?? ''),
    companyStatus: (row.company_status as string | null) ?? null,
    activeCustomers: asNumber(row.active_customers),
    newCustomers: asNumber(row.new_customers),
    churnedCustomers: asNumber(row.churned_customers),
    netChange: asNumber(row.net_change),
    poaRequested: asNumber(row.poa_requested),
    poaActive: asNumber(row.poa_active),
    meteringRequestsTotal: asNumber(row.metering_requests_total),
    meteringRequestsHistorical: asNumber(row.metering_requests_historical),
    forecastMonthKwh: asNumber(row.forecast_month_kwh),
    forecast3mKwh: asNumber(row.forecast_3m_kwh),
    forecast6mKwh: asNumber(row.forecast_6m_kwh),
    forecast12mKwh: asNumber(row.forecast_12m_kwh),
  }))
}

// Server-side (service role) single-month figures for callers that already
// enforced tenant access, e.g. dashboards and the analytics fallback. Same
// definition as the tenant page, so every screen shows the same numbers.
export async function getPortfolioMonthForCompany(companyId: string, month: string): Promise<PortfolioMonthRow | null> {
  const safeMonth = monthStart(month)
  const { data, error } = await supabaseService.rpc('gridex_customer_portfolio_summary', {
    p_company_id: companyId,
    p_from: safeMonth,
    p_to: safeMonth,
  })
  if (error) throw error
  const row = ((data ?? []) as Record<string, unknown>[])[0]
  return row ? mapPortfolioMonthRow(row) : null
}
