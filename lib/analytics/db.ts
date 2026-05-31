import { supabaseService } from '@/lib/supabase/service'
import { addMonths, asNumber, monthEndExclusive, monthStart } from '@/lib/analytics/utils'
import type { AnalyticsFilters, DeviationRow, ForecastSummaryRow, MonthlyMetricRow, ReportDefinition } from '@/lib/analytics/types'

const ACTIVE_STATUSES = ['active', 'live', 'active_customer', 'ongoing']

/* eslint-disable @typescript-eslint/no-explicit-any */

function isMissingRelationError(error: { message?: string } | null): boolean {
  return Boolean(error?.message && /does not exist|schema cache|Could not find|relation .* does not exist/i.test(error.message))
}

async function safeCount(table: string, companyId: string, build?: (query: any) => any): Promise<number> {
  let query = supabaseService.from(table).select('id', { count: 'exact', head: true }).eq('company_id', companyId)
  if (build) query = build(query)
  const { count, error } = await query
  if (error) {
    if (isMissingRelationError(error)) return 0
    throw error
  }
  return count ?? 0
}

async function safeRows<T>(table: string, select: string, companyId: string, build?: (query: any) => any): Promise<T[]> {
  let query = supabaseService.from(table).select(select).eq('company_id', companyId)
  if (build) query = build(query)
  const { data, error } = await query
  if (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }
  return (data ?? []) as T[]
}

export async function listAnalyticsFilterOptions(companyId: string) {
  const [zones, gridOwners] = await Promise.all([
    safeRows<{ bidding_zone_code: string | null }>('metering_points', 'bidding_zone_code', companyId, (query) => query.not('bidding_zone_code', 'is', null).limit(1000)),
    safeRows<{ id: string; name: string }>('grid_owners', 'id, name', companyId, (query) => query.order('name', { ascending: true }).limit(500)),
  ])

  return {
    biddingZones: Array.from(new Set(zones.map((row) => row.bidding_zone_code).filter(Boolean))).sort() as string[],
    gridOwners,
  }
}

export async function getMonthlyMetric(companyId: string, month: string): Promise<MonthlyMetricRow | null> {
  const { data, error } = await supabaseService
    .from('company_monthly_metrics')
    .select('*')
    .eq('company_id', companyId)
    .eq('month', monthStart(month))
    .maybeSingle()

  if (error) {
    if (isMissingRelationError(error)) return null
    throw error
  }
  return data as MonthlyMetricRow | null
}

export async function getCustomerGrowthSeries(companyId: string, month: string): Promise<MonthlyMetricRow[]> {
  const fromMonth = addMonths(month, -11)
  const { data, error } = await supabaseService
    .from('company_monthly_metrics')
    .select('month,total_customers,new_customers,forecast_kwh,actual_kwh,metering_values_missing')
    .eq('company_id', companyId)
    .gte('month', fromMonth)
    .lte('month', monthStart(month))
    .order('month', { ascending: true })

  if (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }
  return (data ?? []) as MonthlyMetricRow[]
}

export async function buildLiveMonthlyFallback(companyId: string, month: string): Promise<MonthlyMetricRow> {
  const start = `${monthStart(month)}T00:00:00.000Z`
  const end = `${monthEndExclusive(month)}T00:00:00.000Z`
  const [
    totalCustomers,
    activeCustomers,
    newCustomers,
    endedCustomers,
    totalSites,
    activeSites,
    totalMeteringPoints,
    activeMeteringPoints,
    meteringValuesReceived,
    openIssues,
  ] = await Promise.all([
    safeCount('customers', companyId),
    safeCount('customers', companyId, (query) => query.in('status', ACTIVE_STATUSES)),
    safeCount('customers', companyId, (query) => query.gte('created_at', start).lt('created_at', end)),
    safeCount('customers', companyId, (query) => query.gte('ended_at', start).lt('ended_at', end)),
    safeCount('customer_sites', companyId),
    safeCount('customer_sites', companyId, (query) => query.in('status', ACTIVE_STATUSES)),
    safeCount('metering_points', companyId),
    safeCount('metering_points', companyId, (query) => query.in('status', ACTIVE_STATUSES)),
    safeCount('metering_values', companyId, (query) => query.gte('period_start', start).lt('period_start', end)),
    safeCount('data_quality_issues', companyId, (query) => query.eq('status', 'open').eq('issue_type', 'missing_metering_values')),
  ])

  return {
    month: monthStart(month),
    total_customers: totalCustomers,
    active_customers: activeCustomers,
    new_customers: newCustomers,
    ended_customers: endedCustomers,
    total_sites: totalSites,
    active_sites: activeSites,
    total_metering_points: totalMeteringPoints,
    active_metering_points: activeMeteringPoints,
    metering_values_received: meteringValuesReceived,
    metering_values_missing: openIssues,
    requested_metering_values: 0,
    successful_metering_requests: 0,
    failed_metering_requests: 0,
    forecast_kwh: 0,
    actual_kwh: 0,
    diff_kwh: 0,
    diff_percent: null,
  }
}

export async function getBiddingZoneMetrics(companyId: string, month: string): Promise<ForecastSummaryRow[]> {
  const { data, error } = await supabaseService
    .from('bidding_zone_monthly_metrics')
    .select('bidding_zone_code, forecast_kwh, actual_kwh, diff_kwh, diff_percent')
    .eq('company_id', companyId)
    .eq('month', monthStart(month))
    .order('bidding_zone_code', { ascending: true })

  if (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }

  return (data ?? []).map((row: any) => ({
    biddingZoneCode: row.bidding_zone_code ?? 'Saknas',
    forecastKwh: asNumber(row.forecast_kwh),
    forecastMwh: asNumber(row.forecast_kwh) / 1000,
    actualKwh: asNumber(row.actual_kwh),
    diffKwh: asNumber(row.diff_kwh),
    diffPercent: row.diff_percent === null || row.diff_percent === undefined ? null : asNumber(row.diff_percent),
    confidenceScore: 0,
    missingDataCount: 0,
  }))
}

export async function getLatestForecastByBiddingZone(companyId: string, filters: AnalyticsFilters): Promise<ForecastSummaryRow[]> {
  const runQuery = supabaseService
    .from('forecast_runs')
    .select('id')
    .eq('company_id', companyId)
    .eq('forecast_type', 'consumption')
    .lte('period_start', filters.month)
    .gte('period_end', filters.month)
    .order('created_at', { ascending: false })
    .limit(1)

  const { data: runs, error: runError } = await runQuery
  if (runError) {
    if (isMissingRelationError(runError)) return []
    throw runError
  }
  const runId = runs?.[0]?.id
  if (!runId) return getBiddingZoneMetrics(companyId, filters.month)

  let itemQuery = supabaseService
    .from('forecast_run_items')
    .select('bidding_zone_code, grid_owner_id, forecast_kwh, actual_kwh, diff_kwh, diff_percent, confidence_score, method')
    .eq('company_id', companyId)
    .eq('forecast_run_id', runId)

  if (filters.biddingZoneCode) itemQuery = itemQuery.eq('bidding_zone_code', filters.biddingZoneCode)
  if (filters.gridOwnerId) itemQuery = itemQuery.eq('grid_owner_id', filters.gridOwnerId)

  const { data, error } = await itemQuery
  if (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }

  const groups = new Map<string, { forecast: number; actual: number; diff: number; confidence: number; count: number; missing: number }>()
  for (const row of data ?? []) {
    const key = row.bidding_zone_code ?? 'Saknas'
    const current = groups.get(key) ?? { forecast: 0, actual: 0, diff: 0, confidence: 0, count: 0, missing: 0 }
    const forecast = asNumber(row.forecast_kwh)
    current.forecast += forecast
    current.actual += asNumber(row.actual_kwh)
    current.diff += asNumber(row.diff_kwh)
    current.confidence += asNumber(row.confidence_score)
    current.count += 1
    if (!forecast || row.method === 'missing_basis') current.missing += 1
    groups.set(key, current)
  }

  return Array.from(groups.entries()).map(([biddingZoneCode, group]) => ({
    biddingZoneCode,
    forecastKwh: group.forecast,
    forecastMwh: group.forecast / 1000,
    actualKwh: group.actual,
    diffKwh: group.diff,
    diffPercent: group.forecast ? (group.diff / group.forecast) * 100 : null,
    confidenceScore: group.count ? Math.round(group.confidence / group.count) : 0,
    missingDataCount: group.missing,
  })).sort((a, b) => a.biddingZoneCode.localeCompare(b.biddingZoneCode, 'sv'))
}

export async function getDeviationRows(companyId: string): Promise<DeviationRow[]> {
  const issues = await safeRows<any>('data_quality_issues', 'id, entity_type, entity_id, issue_type, severity, message, status', companyId, (query) =>
    query.eq('status', 'open').order('detected_at', { ascending: false }).limit(50)
  )

  return issues.map((issue) => ({
    id: issue.id,
    type: labelIssueType(issue.issue_type),
    affects: labelAffects(issue.entity_type, issue.entity_id),
    severity: issue.severity ?? 'warning',
    status: issue.status ?? 'open',
    actionHref: entityHref(issue.entity_type, issue.entity_id),
    message: issue.message,
    entityType: issue.entity_type,
    entityId: issue.entity_id,
  }))
}

export async function getReportRows(companyId: string, report: string, month: string): Promise<Array<Record<string, unknown>>> {
  const safeMonth = monthStart(month)
  if (report === 'customer_monthly_metrics') {
    return safeRows<Record<string, unknown>>('customer_monthly_metrics', '*', companyId, (query) => query.eq('month', safeMonth).order('actual_kwh', { ascending: false }).limit(5000))
  }
  if (report === 'bidding_zone_metrics') {
    return safeRows<Record<string, unknown>>('bidding_zone_monthly_metrics', '*', companyId, (query) => query.eq('month', safeMonth).order('bidding_zone_code', { ascending: true }))
  }
  if (report === 'grid_owner_metrics') {
    return safeRows<Record<string, unknown>>('grid_owner_monthly_metrics', '*', companyId, (query) => query.eq('month', safeMonth).order('actual_kwh', { ascending: false }))
  }
  if (report === 'forecast_run_items') {
    return safeRows<Record<string, unknown>>('forecast_run_items', '*', companyId, (query) => query.gte('period_start', safeMonth).lt('period_start', addMonths(safeMonth, 1)).limit(5000))
  }
  if (report === 'data_quality_issues' || report === 'missing_metering_values') {
    return safeRows<Record<string, unknown>>('data_quality_issues', '*', companyId, (query) =>
      report === 'missing_metering_values' ? query.eq('issue_type', 'missing_metering_values').limit(5000) : query.limit(5000)
    )
  }
  return safeRows<Record<string, unknown>>('company_monthly_metrics', '*', companyId, (query) => query.eq('month', safeMonth))
}

export async function getCustomerAnalytics(companyId: string, customerId: string, month: string) {
  const safeMonth = monthStart(month)
  const current = await safeRows<any>('customer_monthly_metrics', '*', companyId, (query) =>
    query.eq('customer_id', customerId).eq('month', safeMonth).limit(1)
  )
  const next = await safeRows<any>('customer_monthly_metrics', '*', companyId, (query) =>
    query.eq('customer_id', customerId).eq('month', addMonths(safeMonth, 1)).limit(1)
  )
  const [sites, meteringPoints, missingIssues] = await Promise.all([
    safeCount('customer_sites', companyId, (query) => query.eq('customer_id', customerId)),
    safeCount('metering_points', companyId, (query) => query.eq('customer_id', customerId)),
    safeCount('data_quality_issues', companyId, (query) => query.eq('status', 'open').eq('entity_type', 'metering_point').eq('issue_type', 'missing_metering_values')),
  ])
  const pointRows = await safeRows<{ bidding_zone_code: string | null; grid_owner_id: string | null }>('metering_points', 'bidding_zone_code, grid_owner_id', companyId, (query) =>
    query.eq('customer_id', customerId).limit(500)
  )
  const ownerIds = Array.from(new Set(pointRows.map((row) => row.grid_owner_id).filter(Boolean))) as string[]
  const owners = ownerIds.length
    ? await safeRows<{ id: string; name: string }>('grid_owners', 'id, name', companyId, (query) => query.in('id', ownerIds))
    : []

  return {
    current: current[0] ?? null,
    next: next[0] ?? null,
    sites,
    meteringPoints,
    biddingZones: Array.from(new Set(pointRows.map((row) => row.bidding_zone_code).filter(Boolean))).sort() as string[],
    gridOwners: owners.map((owner) => owner.name),
    missingMeteringValues: missingIssues,
  }
}

export const ANALYTICS_REPORTS: ReportDefinition[] = [
  { key: 'company_monthly_metrics', label: 'Kundstatistik per månad', description: 'Kunder, anläggningar, mätpunkter och summerad volym.' },
  { key: 'bidding_zone_metrics', label: 'Prognos per SE-område', description: 'Prognos, faktiskt utfall och differens per elområde.' },
  { key: 'grid_owner_metrics', label: 'Prognos per nätägare', description: 'Volym och saknade mätvärden per nätägare.' },
  { key: 'missing_metering_values', label: 'Saknade mätvärden', description: 'Öppna datakvalitetsärenden för saknade mätvärden.' },
  { key: 'data_quality_issues', label: 'Datakvalitet', description: 'Alla öppna och historiska datakvalitetsärenden.' },
  { key: 'customer_monthly_metrics', label: 'Kundtillväxt', description: 'Kundnivå per månad med prognos och faktiskt utfall.' },
  { key: 'forecast_run_items', label: 'Förbrukning per månad', description: 'Detaljerade prognosrader för mätpunkter och kunder.' },
]

function labelIssueType(type: string): string {
  const labels: Record<string, string> = {
    missing_bidding_zone: 'Saknat SE-område',
    missing_grid_owner: 'Saknad nätägare',
    missing_estimated_annual_consumption: 'Saknad årsförbrukning',
    missing_metering_values: 'Saknade mätvärden',
    metering_value_gap: 'Mätvärdeslucka',
    invalid_metering_value: 'Felaktigt mätvärde',
    forecast_deviation: 'Prognosavvikelse',
    forecast_basis_missing: 'Prognosunderlag saknas',
    active_metering_point_without_active_customer: 'Aktiv mätpunkt utan aktiv kund',
    missing_site_address: 'Saknad anläggningsadress',
  }
  return labels[type] ?? type
}

function labelAffects(entityType?: string | null, entityId?: string | null): string {
  if (!entityType) return 'Bolaget'
  if (entityType === 'metering_point') return entityId ? '1 mätpunkt' : 'Mätpunkter'
  if (entityType === 'customer') return entityId ? '1 kund' : 'Kunder'
  if (entityType === 'site') return entityId ? '1 anläggning' : 'Anläggningar'
  return entityId ? `1 ${entityType}` : entityType
}

function entityHref(entityType?: string | null, entityId?: string | null): string | undefined {
  if (!entityId) return undefined
  if (entityType === 'customer') return `/admin/customers/${entityId}`
  return undefined
}
