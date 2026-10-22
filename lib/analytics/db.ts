import { getPortfolioMonthForCompany } from '@/lib/analytics/customerPortfolio'
import { supabaseService } from '@/lib/supabase/service'
import { addMonths, asNumber, monthEndExclusive, monthStart } from '@/lib/analytics/utils'
import { stockholmMonthBounds } from '@/lib/time/stockholm'
import type { AnalyticsFilters, DeviationRow, ForecastSummaryRow, MonthlyMetricRow, ReportDefinition, SimpleChartRow } from '@/lib/analytics/types'

const ACTIVE_STATUSES = ['active', 'live', 'active_customer', 'ongoing']

/* eslint-disable @typescript-eslint/no-explicit-any */

function isMissingRelationError(error: { message?: string } | null): boolean {
  return Boolean(error?.message && /does not exist|schema cache|Could not find|relation .* does not exist|column .* does not exist/i.test(error.message))
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

// PostgREST returns at most max_rows (1 000) rows per request whatever .limit() asks for (supabase/config.toml).
// Every statistic that sums or filters rows reads all pages, keyed on id (FINDINGS K-09, same class as DST-C1).
const PAGE_ROWS = 1000

async function safeAllRows<T>(table: string, select: string, companyId: string, build?: (query: any) => any, cap = 1_000_000): Promise<T[]> {
  const rows: T[] = []
  let after: string | null = null
  while (rows.length < cap) {
    let query = supabaseService.from(table).select(select).eq('company_id', companyId)
    if (build) query = build(query)
    if (after !== null) query = query.gt('id', after)
    const { data, error } = await query.order('id', { ascending: true }).limit(Math.min(PAGE_ROWS, cap - rows.length))
    if (error) {
      if (isMissingRelationError(error)) return rows
      throw error
    }
    const batch = (data ?? []) as unknown as T[]
    rows.push(...batch)
    const last = (batch.at(-1) as { id?: unknown } | undefined)?.id
    if (batch.length < PAGE_ROWS || last === undefined || last === null) break
    after = String(last)
  }
  return rows
}

const HIDDEN_CUSTOMER_STATUSES = ['archived', 'deleted', 'deleted_test_only', 'pending_deletion']

export async function listAnalyticsFilterOptions(companyId: string) {
  const [meteringRows, gridOwners] = await Promise.all([
    safeAllRows<{ bidding_zone_code: string | null; metering_method: string | null; status: string | null }>('metering_points', 'id, bidding_zone_code, metering_method, status', companyId),
    safeRows<{ id: string; name: string }>('grid_owners', 'id, name', companyId, (query) => query.order('name', { ascending: true }).limit(500)),
  ])

  return {
    biddingZones: Array.from(new Set(meteringRows.map((row) => row.bidding_zone_code).filter(Boolean))).sort() as string[],
    gridOwners,
    meteringMethods: Array.from(new Set(meteringRows.map((row) => row.metering_method).filter(Boolean))).sort() as string[],
    statuses: Array.from(new Set(meteringRows.map((row) => row.status).filter(Boolean))).sort() as string[],
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

export async function countMissingMeteringPoints(companyId: string, month: string, customerId: string | null = null): Promise<number> {
  const { data, error } = await supabaseService.rpc('gridex_missing_metering_points_count_v1', {
    p_company: companyId,
    p_month: monthStart(month),
    p_customer: customerId,
  })
  if (error) throw error
  const count = typeof data === 'number' ? data : typeof data === 'string' && /^\d+$/.test(data) ? Number(data) : NaN
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid missing-metering-point count')
  return count
}

// Same definitions as the monthly snapshot (gridex_rebuild_company_analytics_month), so the page shows the same
// numbers before and after the cron: customers without test-portal and hidden rows, supplied metering points
// and current consumption values of the Swedish month (FINDINGS K-03, K-07, K-08).
export async function buildLiveMonthlyFallback(companyId: string, month: string): Promise<MonthlyMetricRow> {
  const bounds = stockholmMonthBounds(monthStart(month).slice(0, 7))
  const start = bounds.start
  const end = bounds.end
  const [
    totalCustomers,
    portfolio,
    totalSites,
    activeSites,
    totalMeteringPoints,
    activeMeteringPoints,
    meteringValuesReceived,
    openIssues,
  ] = await Promise.all([
    safeCount('customers', companyId, (query) => query
      .or('source.is.null,source.neq.ediel_portal_test')
      .or(`status.is.null,status.not.in.(${HIDDEN_CUSTOMER_STATUSES.join(',')})`)),
    getPortfolioMonthForCompany(companyId, month).catch((error: unknown) => {
      console.error('customer portfolio fallback failed', { companyId, month, error })
      return undefined
    }),
    safeCount('customer_sites', companyId),
    safeCount('customer_sites', companyId, (query) => query.in('status', ACTIVE_STATUSES)),
    safeCount('metering_points', companyId),
    safeCount('metering_points', companyId, (query) => query.in('status', ACTIVE_STATUSES)),
    safeCount('metering_values', companyId, (query) => query
      .not('metering_point_id', 'is', null)
      .or('is_current.is.null,is_current.eq.true')
      .or('reading_type.is.null,reading_type.eq.consumption')
      .or('value_kwh.not.is.null,quantity_kwh.not.is.null,quantity.not.is.null')
      .gte('period_start', start).lt('period_start', end)),
    countMissingMeteringPoints(companyId, month),
  ])

  return {
    month: monthStart(month),
    total_customers: totalCustomers,
    // undefined = the RPC failed: keep null so the page shows "–" rather than 0
    active_customers: portfolio === undefined ? null : portfolio?.activeCustomers ?? 0,
    new_customers: portfolio === undefined ? null : portfolio?.newCustomers ?? 0,
    ended_customers: portfolio === undefined ? null : portfolio?.churnedCustomers ?? 0,
    total_sites: totalSites,
    active_sites: activeSites,
    total_metering_points: totalMeteringPoints,
    // Supplied at month end: the portfolio definition; status counts stay only if that RPC failed.
    active_metering_points: portfolio === undefined ? activeMeteringPoints : portfolio?.activeMeteringPoints ?? 0,
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

export async function getOverviewBreakdowns(companyId: string, month: string): Promise<{
  biddingZones: SimpleChartRow[]
  missingByGridOwner: SimpleChartRow[]
}> {
  const safeMonth = monthStart(month)
  const zoneMetrics = await safeRows<any>('bidding_zone_monthly_metrics', 'bidding_zone_code, metering_points_count, forecast_kwh', companyId, (query) =>
    query.eq('month', safeMonth).order('bidding_zone_code', { ascending: true })
  )
  let biddingZones: SimpleChartRow[] = zoneMetrics.map((row) => ({
    key: row.bidding_zone_code ?? 'saknas',
    label: row.bidding_zone_code ?? 'Saknas',
    // Metering points per zone; a zone without points is 0, never its forecast kWh (FINDINGS K-11).
    value: asNumber(row.metering_points_count),
    hint: row.forecast_kwh ? `${Math.round(asNumber(row.forecast_kwh) / 1000)} MWh prognos` : undefined,
  }))

  if (biddingZones.length === 0) {
    const points = await safeAllRows<{ bidding_zone_code: string | null }>('metering_points', 'id, bidding_zone_code', companyId)
    const groups = new Map<string, number>()
    for (const point of points) {
      const key = point.bidding_zone_code ?? 'Saknas'
      groups.set(key, (groups.get(key) ?? 0) + 1)
    }
    biddingZones = Array.from(groups.entries()).map(([label, value]) => ({ key: label, label, value })).sort((a, b) => a.label.localeCompare(b.label, 'sv'))
  }

  const ownerMetrics = await safeRows<any>('grid_owner_monthly_metrics', 'grid_owner_id, metering_values_missing', companyId, (query) =>
    query.eq('month', safeMonth).gt('metering_values_missing', 0).order('metering_values_missing', { ascending: false }).limit(6)
  )
  const ownerIds = ownerMetrics.map((row) => row.grid_owner_id).filter(Boolean) as string[]
  const owners = ownerIds.length ? await safeRows<{ id: string; name: string }>('grid_owners', 'id, name', companyId, (query) => query.in('id', ownerIds)) : []
  const ownerName = new Map(owners.map((owner) => [owner.id, owner.name]))
  const missingByGridOwner = ownerMetrics.map((row) => ({
    key: row.grid_owner_id ?? 'saknas',
    label: ownerName.get(row.grid_owner_id) ?? 'Saknad nätägare',
    value: asNumber(row.metering_values_missing),
  }))

  return { biddingZones, missingByGridOwner }
}

function latestCompletedConsumptionRunQuery(companyId: string, month: string) {
  return supabaseService
    .from('forecast_runs')
    .select('id')
    .eq('company_id', companyId)
    .eq('forecast_type', 'consumption')
    .eq('status', 'completed')
    .lte('period_start', month)
    .gt('period_end', month)
    .order('created_at', { ascending: false })
    .limit(1)
}

type ForecastItemRow = {
  bidding_zone_code: string | null
  grid_owner_id: string | null
  customer_id: string | null
  metering_point_id: string | null
  forecast_kwh: unknown
  actual_kwh: unknown
  diff_kwh: unknown
  confidence_score: unknown
  method: string | null
}

// Every forecast item of the run and month (all pages), narrowed by the page filters. The point and customer
// filter sets are read completely too: a truncated allow-list silently dropped items (FINDINGS K-09).
async function loadForecastItems(companyId: string, runId: string, targetMonth: string, filters: AnalyticsFilters): Promise<ForecastItemRow[]> {
  let rows = await safeAllRows<ForecastItemRow>('forecast_run_items', 'id, bidding_zone_code, grid_owner_id, customer_id, metering_point_id, forecast_kwh, actual_kwh, diff_kwh, confidence_score, method', companyId, (query) => {
    let itemQuery = query.eq('forecast_run_id', runId).gte('period_start', targetMonth).lt('period_start', monthEndExclusive(targetMonth))
    if (filters.biddingZoneCode) itemQuery = itemQuery.eq('bidding_zone_code', filters.biddingZoneCode)
    if (filters.gridOwnerId) itemQuery = itemQuery.eq('grid_owner_id', filters.gridOwnerId)
    return itemQuery
  })
  if (filters.status || filters.meteringMethod) {
    const points = await safeAllRows<{ id: string }>('metering_points', 'id', companyId, (query) => {
      let pointQuery = query
      if (filters.status) pointQuery = pointQuery.eq('status', filters.status)
      if (filters.meteringMethod) pointQuery = pointQuery.eq('metering_method', filters.meteringMethod)
      return pointQuery
    })
    const allowedPointIds = new Set(points.map((point) => point.id))
    rows = rows.filter((row) => row.metering_point_id && allowedPointIds.has(row.metering_point_id))
  }
  if (filters.customerType) {
    const customers = await safeAllRows<{ id: string }>('customers', 'id', companyId, (query) => query.eq('customer_type', filters.customerType))
    const allowedCustomerIds = new Set(customers.map((customer) => customer.id))
    rows = rows.filter((row) => row.customer_id && allowedCustomerIds.has(row.customer_id))
  }
  return rows
}

export async function getLatestForecastByBiddingZone(companyId: string, filters: AnalyticsFilters): Promise<ForecastSummaryRow[]> {
  const targetMonth = monthStart(filters.month)
  const { data: runs, error: runError } = await latestCompletedConsumptionRunQuery(companyId, targetMonth)
  if (runError) {
    if (isMissingRelationError(runError)) return []
    throw runError
  }
  const runId = runs?.[0]?.id
  if (!runId) return getBiddingZoneMetrics(companyId, filters.month)

  const filteredRows = await loadForecastItems(companyId, runId, targetMonth, filters)

  const groups = new Map<string, { forecast: number; actual: number; diff: number; confidence: number; count: number; missing: number }>()
  for (const row of filteredRows) {
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

export async function getLatestForecastByGridOwner(companyId: string, filters: AnalyticsFilters): Promise<ForecastSummaryRow[]> {
  const targetMonth = monthStart(filters.month)
  const { data: runs, error: runError } = await latestCompletedConsumptionRunQuery(companyId, targetMonth)
  if (runError) {
    if (isMissingRelationError(runError)) return []
    throw runError
  }
  const runId = runs?.[0]?.id
  if (!runId) return []

  const filteredRows = await loadForecastItems(companyId, runId, targetMonth, filters)

  const groups = new Map<string, { forecast: number; actual: number; diff: number; confidence: number; count: number; missing: number }>()
  for (const row of filteredRows) {
    const key = row.grid_owner_id ?? 'saknas'
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

  const ownerIds = Array.from(groups.keys()).filter((key) => key !== 'saknas')
  const owners = ownerIds.length ? await safeRows<{ id: string; name: string }>('grid_owners', 'id, name', companyId, (query) => query.in('id', ownerIds)) : []
  const ownerName = new Map(owners.map((owner) => [owner.id, owner.name]))

  return Array.from(groups.entries()).map(([gridOwnerId, group]) => ({
    biddingZoneCode: 'Alla',
    gridOwnerId: gridOwnerId === 'saknas' ? null : gridOwnerId,
    gridOwnerName: ownerName.get(gridOwnerId) ?? 'Saknad nätägare',
    forecastKwh: group.forecast,
    forecastMwh: group.forecast / 1000,
    actualKwh: group.actual,
    diffKwh: group.diff,
    diffPercent: group.forecast ? (group.diff / group.forecast) * 100 : null,
    confidenceScore: group.count ? Math.round(group.confidence / group.count) : 0,
    missingDataCount: group.missing,
  })).sort((a, b) => b.forecastKwh - a.forecastKwh)
}

export async function getDeviationRows(companyId: string): Promise<DeviationRow[]> {
  const issues = await safeRows<any>('gridex_actionable_data_quality_issues_v', 'id, entity_type, entity_id, issue_type, severity, message, status', companyId, (query) =>
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

export async function getPlatformAnalyticsIssueSummary(month = monthStart()) {
  const { data: companies, error } = await supabaseService
    .from('companies')
    .select('id, name, status')
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) throw error
  const start = `${monthStart(month)}T00:00:00.000Z`
  const rows = await Promise.all((companies ?? []).map(async (company) => {
    const [failedEdiel, unresolvedEdiel, issues, forecast] = await Promise.all([
      safeCount('ediel_messages', company.id, (query) => query.in('status', ['failed', 'error', 'rejected', 'blocked'])),
      safeCount('ediel_messages', company.id, (query) => query.in('status', ['pending', 'queued', 'received', 'manual_review'])),
      safeCount('gridex_actionable_data_quality_issues_v', company.id),
      getMonthlyMetric(company.id, month),
    ])
    return {
      companyId: company.id,
      companyName: company.name ?? 'Bolag utan namn',
      companyStatus: company.status ?? null,
      failedEdiel,
      unresolvedEdiel,
      openIssues: issues,
      missingMeteringValues: asNumber(forecast?.metering_values_missing),
      forecastKwh: asNumber(forecast?.forecast_kwh),
      monthStartedAt: start,
    }
  }))

  return rows.sort((a, b) => (b.openIssues + b.failedEdiel + b.unresolvedEdiel) - (a.openIssues + a.failedEdiel + a.unresolvedEdiel))
}

// CSV exports: up to 5 000 rows in the report's order, from every page (one request returned at most 1 000:
// FINDINGS K-09). Rows are read by id and ordered here.
const REPORT_ROW_CAP = 5000
type ReportRow = Record<string, unknown> & { id?: unknown }

function orderedReport(rows: ReportRow[], key?: string, direction: 'asc' | 'desc' = 'asc'): ReportRow[] {
  if (!key) return rows.slice(0, REPORT_ROW_CAP)
  const sign = direction === 'desc' ? -1 : 1
  const value = (row: ReportRow) => row[key]
  return [...rows].sort((a, b) => {
    const left = value(a), right = value(b)
    if (left === right) return 0
    if (left === null || left === undefined) return 1
    if (right === null || right === undefined) return -1
    const numeric = Number(left) - Number(right)
    return sign * (Number.isFinite(numeric) && typeof left !== 'string' ? numeric : String(left).localeCompare(String(right), 'sv'))
  }).slice(0, REPORT_ROW_CAP)
}

export async function getReportRows(companyId: string, report: string, month: string): Promise<Array<Record<string, unknown>>> {
  const safeMonth = monthStart(month)
  const rows = (table: string, build?: (query: any) => any) => safeAllRows<ReportRow>(table, '*', companyId, build)
  if (report === 'customer_monthly_metrics') {
    return orderedReport(await rows('customer_monthly_metrics', (query) => query.eq('month', safeMonth)), 'actual_kwh', 'desc')
  }
  if (report === 'bidding_zone_metrics') {
    return orderedReport(await rows('bidding_zone_monthly_metrics', (query) => query.eq('month', safeMonth)), 'bidding_zone_code')
  }
  if (report === 'grid_owner_metrics') {
    return orderedReport(await rows('grid_owner_monthly_metrics', (query) => query.eq('month', safeMonth)), 'actual_kwh', 'desc')
  }
  if (report === 'metering_points_by_grid_owner') {
    return orderedReport(await rows('grid_owner_monthly_metrics', (query) => query.eq('month', safeMonth)), 'metering_points_count', 'desc')
  }
  if (report === 'forecast_run_items') {
    return orderedReport(await rows('forecast_run_items', (query) => query.gte('period_start', safeMonth).lt('period_start', addMonths(safeMonth, 1))))
  }
  if (report === 'missing_metering_values') {
    return orderedReport(await rows('gridex_actionable_data_quality_issues_v', (query) => query.eq('issue_type', 'missing_metering_values')))
  }
  if (report === 'data_quality_issues') {
    return orderedReport(await rows('data_quality_issues'))
  }
  return orderedReport(await rows('company_monthly_metrics', (query) => query.eq('month', safeMonth)))
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
    countMissingMeteringPoints(companyId, safeMonth, customerId),
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
  { key: 'metering_points_by_grid_owner', label: 'Mätpunkter per nätägare', description: 'Mätpunktsvolym per nätägare för vald period.' },
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
    failed_ediel_message: 'Misslyckade Ediel-meddelanden',
    slow_grid_owner_response: 'Långsam nätägarsvarstid',
    incomplete_customer_onboarding: 'Ofullständig kunddata',
    high_consumption_deviation: 'Hög förbrukningsavvikelse',
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
