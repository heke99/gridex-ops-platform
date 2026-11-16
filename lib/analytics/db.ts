import { supabaseService } from '@/lib/supabase/service'
import { addMonths, asNumber, monthEndExclusive, monthStart, nullableNumber } from '@/lib/analytics/utils'
import type { AnalyticsFilters, DeviationRow, ForecastSummaryRow, MonthlyMetricRow, ReportDefinition, SimpleChartRow } from '@/lib/analytics/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

function isMissingRelationError(error: { message?: string } | null): boolean {
  return Boolean(error?.message && /does not exist|schema cache|Could not find|relation .* does not exist|column .* does not exist/i.test(error.message))
}

async function safeCount(table: string, companyId: string, build?: (query: any) => any): Promise<number> {
  let query = supabaseService.from(table).select('id', { count: 'exact', head: true }).eq('company_id', companyId)
  if (build) query = build(query)
  const { count, error } = await query
  if (error) {
    if (isMissingRelationError(error)) throw new Error('Analysunderlaget är inte tillgängligt.')
    throw error
  }
  if (count === null) throw new Error('Antalet kunde inte läsas för analysen.')
  return count
}

async function readAllQuery<T>(build: () => any): Promise<T[]> {
  const rows: T[] = []
  while (rows.length < 10000) {
    const from = rows.length
    const { data, error, count } = await (from === 0 ? build().limit(1000) : build().range(from, from + 999))
    if (error) throw error
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw new Error('Analysunderlagets omfattning kunde inte bekräftas. Försök igen.')
    if (count > 10000) throw new Error('Urvalet är för stort för en fullständig analys. Begränsa urvalet.')
    rows.push(...(data ?? []))
    if (rows.length >= count) return rows
    if (!(data ?? []).length) throw new Error('Analysunderlaget är ofullständigt. Försök igen.')
  }
  throw new Error('Urvalet är för stort för en fullständig analys. Begränsa urvalet.')
}

/** Complete reads only. Use topRows for intentional bounded summaries/options. */
async function safeRows<T>(table: string, select: string, companyId: string, build?: (query: any) => any): Promise<T[]> {
  return readAllQuery<T>(() => {
    let query = supabaseService.from(table).select(select, { count: 'exact' }).eq('company_id', companyId)
    if (build) query = build(query)
    return query.order('id', { ascending: true })
  })
}

/** Intentional top lists have a separate bounded contract; never expand their scope. */
async function topRows<T>(table: string, select: string, companyId: string, limit: number, build?: (query: any) => any): Promise<T[]> {
  const rows: T[] = []
  while (rows.length < limit) {
    let query = supabaseService.from(table).select(select, { count: 'exact' }).eq('company_id', companyId)
    if (build) query = build(query)
    query = query.order('id', { ascending: true })
    const { data, error, count } = await (rows.length === 0 ? query.limit(Math.min(1000, limit)) : query.range(rows.length, Math.min(limit - 1, rows.length + 999)))
    if (error) throw error
    rows.push(...((data ?? []) as unknown as T[]))
    if (typeof count === 'number' ? rows.length >= Math.min(limit, count) : (data ?? []).length < Math.min(1000, limit)) return rows
    if (!(data ?? []).length) throw new Error('Analysunderlaget är ofullständigt. Försök igen.')
  }
  return rows
}

async function readIds<T>(table: string, columns: string, companyId: string, values: string[]): Promise<T[]> {
  const ids = [...new Set(values.filter(Boolean))]
  const rows: T[] = []
  for (let from = 0; from < ids.length; from += 200) {
    rows.push(...await safeRows<T>(table, columns, companyId, query => query.in('id', ids.slice(from, from + 200))))
  }
  return rows
}

export async function listAnalyticsFilterOptions(companyId: string) {
  const [meteringRows, gridOwners] = await Promise.all([
    topRows<{ bidding_zone_code: string | null; metering_method: string | null; status: string | null }>('metering_points', 'bidding_zone_code, metering_method, status', companyId, 2000),
    topRows<{ id: string; name: string }>('grid_owners', 'id, name', companyId, 500, query => query.order('name', { ascending: true })),
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
    if (isMissingRelationError(error)) throw new Error('Analysunderlaget är inte tillgängligt.')
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
    if (isMissingRelationError(error)) throw new Error('Analysunderlaget är inte tillgängligt.')
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

export async function buildLiveMonthlyFallback(companyId: string, month: string): Promise<MonthlyMetricRow> {
  // No monthly snapshot means unknown history, not today's stock relabelled as history.
  void companyId
  return {
    month: monthStart(month), total_customers: null, active_customers: null,
    new_customers: null, ended_customers: null, total_sites: null, active_sites: null,
    total_metering_points: null, active_metering_points: null,
    metering_values_received: null, metering_values_missing: null,
    requested_metering_values: null, successful_metering_requests: null, failed_metering_requests: null,
    forecast_kwh: null, actual_kwh: null, diff_kwh: null, diff_percent: null,
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
    if (isMissingRelationError(error)) throw new Error('Analysunderlaget är inte tillgängligt.')
    throw error
  }

  return (data ?? []).map((row: any) => ({
    biddingZoneCode: row.bidding_zone_code ?? 'Saknas',
    forecastKwh: asNumber(row.forecast_kwh),
    forecastMwh: asNumber(row.forecast_kwh) / 1000,
    actualKwh: asNumber(row.actual_kwh),
    diffKwh: asNumber(row.diff_kwh),
    diffPercent: row.diff_percent === null || row.diff_percent === undefined ? null : asNumber(row.diff_percent),
    confidenceScore: null,
    forecastAvailable: nullableNumber(row.forecast_kwh) !== null,
    actualAvailable: nullableNumber(row.actual_kwh) !== null,
    missingDataAvailable: false,
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
  const biddingZones: SimpleChartRow[] = zoneMetrics.map((row) => ({
    key: row.bidding_zone_code ?? 'saknas',
    label: row.bidding_zone_code ?? 'Saknas',
    value: nullableNumber(row.metering_points_count),
    hint: 'Antal mätpunkter för vald månad',
  }))


  const ownerMetrics = await topRows<any>('grid_owner_monthly_metrics', 'grid_owner_id, metering_values_missing', companyId, 6, (query) =>
    query.eq('month', safeMonth).gt('metering_values_missing', 0).order('metering_values_missing', { ascending: false })
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
    .select('id,created_at')
    .eq('company_id', companyId)
    .eq('forecast_type', 'consumption')
    .eq('status', 'completed')
    .lte('period_start', month)
    .gt('period_end', month)
    .order('created_at', { ascending: false })
    .limit(1)
}

export async function getFilteredForecastItems(companyId: string, filters: AnalyticsFilters): Promise<Array<Record<string, any>> | null> {
  const targetMonth = monthStart(filters.month)
  const { data: runs, error } = await latestCompletedConsumptionRunQuery(companyId, targetMonth)
  if (error) throw error
  const runId = runs?.[0]?.id
  if (!runId) return null
  let rows = await safeRows<Record<string, any>>('forecast_run_items', '*', companyId, query => {
    query = query.eq('forecast_run_id', runId).gte('period_start', targetMonth).lt('period_start', monthEndExclusive(targetMonth))
    if (filters.biddingZoneCode) query = query.eq('bidding_zone_code', filters.biddingZoneCode)
    if (filters.gridOwnerId) query = query.eq('grid_owner_id', filters.gridOwnerId)
    return query
  })
  if (filters.status || filters.meteringMethod) {
    const points = await safeRows<{id: string}>('metering_points', 'id', companyId, query => {
      if (filters.status) query = query.eq('status', filters.status)
      if (filters.meteringMethod) query = query.eq('metering_method', filters.meteringMethod)
      return query
    })
    const allowed = new Set(points.map(row => row.id))
    rows = rows.filter(row => allowed.has(row.metering_point_id))
  }
  if (filters.customerType) {
    const customers = await safeRows<{id: string}>('customers', 'id', companyId, query => query.eq('customer_type', filters.customerType))
    const allowed = new Set(customers.map(row => row.id))
    rows = rows.filter(row => allowed.has(row.customer_id))
  }
  return rows.map(row => ({ ...row, analytics_source_created_at: runs?.[0]?.created_at ?? null }))
}

function forecastGroups(rows: Array<Record<string, any>>, key: string): ForecastSummaryRow[] {
  const groups = new Map<string, Array<Record<string, any>>>()
  for (const row of rows) {
    const name = row[key] ?? 'Saknas'
    const group = groups.get(name) ?? []
    group.push(row)
    groups.set(name, group)
  }
  return [...groups].map(([name, items]) => {
    const sum = (field: string) => items.reduce((total, row) => total + (nullableNumber(row[field]) ?? 0), 0)
    const known = (field: string) => items.every(row => nullableNumber(row[field]) !== null)
    const forecast = sum('forecast_kwh')
    return {
      biddingZoneCode: name, gridOwnerId: key === 'grid_owner_id' && name !== 'Saknas' ? name : null,
      sourceCreatedAt: typeof items[0]?.analytics_source_created_at === 'string' ? items[0].analytics_source_created_at : null,
      forecastKwh: forecast, forecastMwh: forecast / 1000,
      actualKwh: sum('actual_kwh'), diffKwh: sum('diff_kwh'),
      diffPercent: known('diff_kwh') && known('forecast_kwh') && forecast !== 0 ? sum('diff_kwh') / forecast * 100 : null,
      confidenceScore: known('confidence_score') ? Math.round(sum('confidence_score') / items.length) : null,
      forecastAvailable: known('forecast_kwh'), actualAvailable: known('actual_kwh'),
      missingDataAvailable: items.every(row => typeof row.method === 'string' && row.method.trim().length > 0),
      missingDataCount: items.filter(row => row.method === 'missing_basis').length,
    }
  })
}

export async function getLatestForecastByBiddingZone(companyId: string, filters: AnalyticsFilters): Promise<ForecastSummaryRow[]> {
  const rows = await getFilteredForecastItems(companyId, filters)
  if (rows === null) {
    // Area-level historical aggregates cannot answer customer/meter/owner filters.
    if (filters.gridOwnerId || filters.customerType || filters.meteringMethod || filters.status) return []
    const fallback = await getBiddingZoneMetrics(companyId, filters.month)
    return fallback.filter(row => !filters.biddingZoneCode || row.biddingZoneCode === filters.biddingZoneCode)
  }
  return forecastGroups(rows, 'bidding_zone_code').sort((a, b) => a.biddingZoneCode.localeCompare(b.biddingZoneCode, 'sv'))
}

export async function getLatestForecastByGridOwner(companyId: string, filters: AnalyticsFilters): Promise<ForecastSummaryRow[]> {
  const rows = await getFilteredForecastItems(companyId, filters)
  if (!rows) return []
  const grouped = forecastGroups(rows, 'grid_owner_id')
  const owners = await readIds<{id: string; name: string}>('grid_owners', 'id,name', companyId, grouped.flatMap(row => row.gridOwnerId ? [row.gridOwnerId] : []))
  return grouped.map(row => ({ ...row, biddingZoneCode: 'Alla', gridOwnerName: owners.find(owner => owner.id === row.gridOwnerId)?.name ?? 'Saknad nätägare' }))
    .sort((a, b) => b.forecastKwh - a.forecastKwh)
}

export async function getDeviationRows(companyId: string): Promise<DeviationRow[]> {
  const issues = await safeRows<any>('gridex_actionable_data_quality_issues_v', 'id, entity_type, entity_id, issue_type, severity, message, status', companyId, (query) =>
    query.eq('status', 'open').order('detected_at', { ascending: false })
  )

  const siteIds = issues.filter(issue => issue.entity_type === 'site').map(issue => issue.entity_id)
  const meterIds = issues.filter(issue => issue.entity_type === 'metering_point').map(issue => issue.entity_id)
  const meters = await readIds<{id: string; site_id: string; customer_id: string | null}>('metering_points', 'id,site_id,customer_id', companyId, meterIds)
  const allSiteIds = [...new Set([...siteIds, ...meters.map(meter => meter.site_id)].filter(Boolean))]
  const sites = await readIds<{id: string; customer_id: string}>('customer_sites', 'id,customer_id', companyId, allSiteIds)
  const customerIds = [...new Set(sites.map(site => site.customer_id).filter(Boolean))]
  const customers = await readIds<{id: string}>('customers', 'id', companyId, customerIds)
  const meterById = new Map(meters.map(meter => [meter.id, meter]))
  const siteById = new Map(sites.map(site => [site.id, site]))
  const allowedCustomers = new Set(customers.map(customer => customer.id))
  const customerForIssue = (issue: any) => {
    const meter = issue.entity_type === 'metering_point' ? meterById.get(issue.entity_id) : null
    const site = siteById.get(issue.entity_type === 'site' ? issue.entity_id : meter?.site_id ?? '')
    if (!site || (meter?.customer_id && meter.customer_id !== site.customer_id)) return undefined
    return allowedCustomers.has(site.customer_id) ? site.customer_id : undefined
  }
  return issues.map((issue) => ({
    id: issue.id,
    type: labelIssueType(issue.issue_type),
    affects: labelAffects(issue.entity_type, issue.entity_id),
    severity: issue.severity ?? 'warning',
    status: issue.status ?? 'open',
    actionHref: customerForIssue(issue) ? `/admin/customers/${encodeURIComponent(customerForIssue(issue)!)}?tab=sites` : entityHref(issue.entity_type, issue.entity_id),
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

export async function getReportRows(companyId: string, report: string, month: string, filters?: AnalyticsFilters): Promise<Array<Record<string, unknown>>> {
  const safeMonth = monthStart(month)
  if (report === 'customer_monthly_metrics') {
    return safeRows<Record<string, unknown>>('customer_monthly_metrics', '*', companyId, (query) => query.eq('month', safeMonth).order('actual_kwh', { ascending: false }))
  }
  if (report === 'bidding_zone_metrics') {
    return safeRows<Record<string, unknown>>('bidding_zone_monthly_metrics', '*', companyId, (query) => query.eq('month', safeMonth).order('bidding_zone_code', { ascending: true }))
  }
  if (report === 'grid_owner_metrics') {
    return safeRows<Record<string, unknown>>('grid_owner_monthly_metrics', '*', companyId, (query) => query.eq('month', safeMonth).order('actual_kwh', { ascending: false }))
  }
  if (report === 'metering_points_by_grid_owner') {
    return safeRows<Record<string, unknown>>('grid_owner_monthly_metrics', '*', companyId, (query) => query.eq('month', safeMonth).order('metering_points_count', { ascending: false }))
  }
  if (report === 'forecast_run_items') {
    return (await getFilteredForecastItems(companyId, { ...filters, month })) ?? []
  }
  if (report === 'missing_metering_values') {
    return safeRows<Record<string, unknown>>('gridex_actionable_data_quality_issues_v', '*', companyId, (query) =>
      query.eq('issue_type', 'missing_metering_values')
    )
  }
  if (report === 'data_quality_issues') {
    return safeRows<Record<string, unknown>>('data_quality_issues', '*', companyId)
  }
  return safeRows<Record<string, unknown>>('company_monthly_metrics', '*', companyId, (query) => query.eq('month', safeMonth))
}

export async function getCustomerAnalytics(companyId: string, customerId: string, month: string) {
  const safeMonth = monthStart(month)
  const current = await topRows<any>('customer_monthly_metrics', '*', companyId, 1, (query) =>
    query.eq('customer_id', customerId).eq('month', safeMonth)
  )
  const next = await topRows<any>('customer_monthly_metrics', '*', companyId, 1, (query) =>
    query.eq('customer_id', customerId).eq('month', addMonths(safeMonth, 1))
  )
  const [sites, meteringPoints, missingIssues] = await Promise.all([
    safeCount('customer_sites', companyId, (query) => query.eq('customer_id', customerId)),
    safeCount('metering_points', companyId, (query) => query.eq('customer_id', customerId)),
    countMissingMeteringPoints(companyId, safeMonth, customerId),
  ])
  const pointRows = await topRows<{ bidding_zone_code: string | null; grid_owner_id: string | null }>('metering_points', 'bidding_zone_code, grid_owner_id', companyId, 500, (query) =>
    query.eq('customer_id', customerId)
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
