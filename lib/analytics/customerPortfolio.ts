import { createSupabaseServerClient } from '@/lib/supabase/server'
import { asNumber, buildCsv, monthStart } from '@/lib/analytics/utils'
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

// Supplied customers/points at a date, batched. The one "active customer"
// definition used by every KPI (dashboard, platform usage, Kundportfölj).
export async function getActiveCustomerCounts(companyIds: string[], at?: string): Promise<Map<string, { activeCustomers: number; activeMeteringPoints: number }>> {
  const result = new Map<string, { activeCustomers: number; activeMeteringPoints: number }>()
  if (companyIds.length === 0) return result
  const { data, error } = await supabaseService.rpc('gridex_customer_portfolio_active_counts', {
    p_company_ids: companyIds,
    p_at: at ?? new Date().toISOString().slice(0, 10),
  })
  if (error) throw error
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    result.set(String(row.company_id), {
      activeCustomers: asNumber(row.active_customers),
      activeMeteringPoints: asNumber(row.active_metering_points),
    })
  }
  return result
}

export type ChurnReasonRow = { month: string; reason: string; customers: number }
export type ForecastAccuracyRow = { month: string; forecastKwh: number | null; actualKwh: number | null; diffKwh: number | null; diffPercent: number | null }
export type CohortRow = { cohortMonth: string; customers: number; retained1m: number | null; retained3m: number | null; retained6m: number | null; retained12m: number | null }
export type BiddingZoneRow = { zone: string; activeCustomers: number; meteringPoints: number; forecast12mKwh: number }
export type ExpiringPoaRow = { id: string; customerId: string | null; customerName: string | null; scope: string | null; validTo: string; daysLeft: number }

export type PortfolioInsights = {
  churnReasons: ChurnReasonRow[]
  accuracy: ForecastAccuracyRow[]
  cohorts: CohortRow[]
  zones: BiddingZoneRow[]
  expiringPoa: ExpiringPoaRow[]
}

const nullableNumber = (value: unknown) => (value === null || value === undefined ? null : asNumber(value))

export async function getCustomerPortfolioInsights(companyId: string, from: string, to: string): Promise<PortfolioInsights> {
  const supabase = await createSupabaseServerClient()
  const [churn, accuracy, cohorts, zones, poa] = await Promise.all([
    supabase.rpc('gridex_customer_portfolio_churn_reasons', { p_company_id: companyId, p_from: from, p_to: to }),
    supabase.rpc('gridex_customer_portfolio_forecast_accuracy', { p_company_id: companyId, p_from: from, p_to: to }),
    supabase.rpc('gridex_customer_portfolio_cohorts', { p_company_id: companyId, p_months: 12 }),
    supabase.rpc('gridex_customer_portfolio_bidding_zones', { p_company_id: companyId }),
    supabase.rpc('gridex_customer_portfolio_expiring_poa', { p_company_id: companyId, p_days: 30 }),
  ])
  for (const response of [churn, accuracy, cohorts, zones, poa]) if (response.error) throw response.error
  const rows = (value: unknown) => (value ?? []) as Record<string, unknown>[]
  return {
    churnReasons: rows(churn.data).map((row) => ({ month: String(row.month).slice(0, 10), reason: String(row.reason ?? 'unknown'), customers: asNumber(row.customers) })),
    accuracy: rows(accuracy.data).map((row) => ({
      month: String(row.month).slice(0, 10),
      forecastKwh: nullableNumber(row.forecast_kwh),
      actualKwh: nullableNumber(row.actual_kwh),
      diffKwh: nullableNumber(row.diff_kwh),
      diffPercent: nullableNumber(row.diff_percent),
    })),
    cohorts: rows(cohorts.data).map((row) => ({
      cohortMonth: String(row.cohort_month).slice(0, 10),
      customers: asNumber(row.customers),
      retained1m: nullableNumber(row.retained_1m),
      retained3m: nullableNumber(row.retained_3m),
      retained6m: nullableNumber(row.retained_6m),
      retained12m: nullableNumber(row.retained_12m),
    })),
    zones: rows(zones.data).map((row) => ({
      zone: String(row.bidding_zone_code ?? 'UNKNOWN'),
      activeCustomers: asNumber(row.active_customers),
      meteringPoints: asNumber(row.metering_points),
      forecast12mKwh: asNumber(row.forecast_12m_kwh),
    })),
    expiringPoa: rows(poa.data).map((row) => ({
      id: String(row.power_of_attorney_id),
      customerId: (row.customer_id as string | null) ?? null,
      customerName: (row.customer_name as string | null) ?? null,
      scope: (row.scope as string | null) ?? null,
      validTo: String(row.valid_to).slice(0, 10),
      daysLeft: asNumber(row.days_left),
    })),
  }
}

export const CHURN_REASON_LABELS: Record<string, string> = {
  unknown: 'Okänd',
  move_out: 'Flytt',
  terminate: 'Uppsägning',
  switch_away: 'Bytt leverantör',
  price: 'Pris',
}

export function churnReasonLabel(reason: string): string {
  return CHURN_REASON_LABELS[reason] ?? reason
}

const CSV_HEADERS = ['typ', 'manad', 'aktiva_kunder', 'nya_kunder', 'lamnade_kunder', 'netto', 'churn', 'fullmakter_begarda', 'fullmakter_signerade', 'fullmakter_giltiga', 'matvardesbegaran', 'varav_historiska', 'varav_lopande', 'misslyckade', 'prognos_kwh', 'prognos_lag_kwh', 'prognos_hog_kwh']

export function portfolioMonthsCsv(months: PortfolioMonthRow[], forecast: PortfolioForecastMonth[]): string {
  return buildCsv(CSV_HEADERS, [
    ...months.map((row) => ({
      typ: 'utfall', manad: row.month, aktiva_kunder: row.activeCustomers, nya_kunder: row.newCustomers,
      lamnade_kunder: row.churnedCustomers, netto: row.netChange, churn: row.churnRate,
      fullmakter_begarda: row.poaRequested, fullmakter_signerade: row.poaSigned, fullmakter_giltiga: row.poaActive,
      matvardesbegaran: row.meteringRequestsTotal, varav_historiska: row.meteringRequestsHistorical,
      varav_lopande: row.meteringRequestsOngoing, misslyckade: row.meteringRequestsFailed,
    })),
    ...forecast.map((row) => ({ typ: 'prognos', manad: row.month, prognos_kwh: row.forecastKwh, prognos_lag_kwh: row.lowKwh, prognos_hog_kwh: row.highKwh })),
  ])
}
