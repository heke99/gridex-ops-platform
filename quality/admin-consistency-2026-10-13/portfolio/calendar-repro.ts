import assert from 'node:assert/strict'
const calls: Array<{ name: string, params: Record<string, unknown> }> = []
const databaseTodayMonth = '2026-10-01'
function asNumber(value: unknown) { const n=Number(value ?? 0); return Number.isFinite(n)?n:0 }
async function createSupabaseServerClient() {
  return { async rpc(name: string, params: Record<string, unknown>) {
    calls.push({name,params})
    if(name === 'gridex_customer_portfolio_summary') return {error:null,data:[{month:params.p_to,active_customers:0}]}
    if(name === 'gridex_customer_portfolio_forecast') return {error:null,data:[{month:params.p_as_of ?? databaseTodayMonth,month_index:1,forecast_kwh:0,metering_points:0}]}
    return {error:null,data:[]}
  }}
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


const result = await getCustomerPortfolio('synthetic-company', '2025-10-01', '2026-09-01')
await getCustomerPortfolioInsights('synthetic-company', '2025-10-01', '2026-09-01')
assert.equal(result.months[0].month,'2026-09-01')
assert.equal(result.forecastMonths[0].month,'2026-10-01')
assert.equal(calls.find(c=>c.name==='gridex_customer_portfolio_forecast')!.params.p_as_of,undefined)
assert.equal(calls.find(c=>c.name==='gridex_customer_portfolio_bidding_zones')!.params.p_as_of,undefined)
console.log(JSON.stringify({status:'CONFIRMED',selectedMonth:'2026-09-01',outcomeMonth:result.months[0].month,forecastMonth:result.forecastMonths[0].month,calls},null,2))
