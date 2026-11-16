import { supabaseService } from '@/lib/supabase/service'
import { monthEndExclusive, monthStart } from '@/lib/analytics/utils'
import { actualKwhForPeriod, calculateMeteringPointForecast } from '@/lib/forecasting/meteringPointForecast'
import { buildCompanyMonthlyMetrics, hasCustomerAnalyticsData } from '@/lib/analytics/monthlyMetricsBuilder'

type SourceCustomer = { company_id: string; source: string | null }
type ForecastPoint = {
  id: string
  customer_id: string | null
  site_id: string | null
  grid_owner_id: string | null
  bidding_zone_code: string | null
  source_customer: SourceCustomer | SourceCustomer[] | null
}

/** A single SQL statement supplies both the bounded JSON snapshot and its
 * complete count. Refuse incomplete evidence before producing any items. */
async function forecastPointInventory(companyId: string): Promise<ForecastPoint[]> {
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as (
    name: 'gridex_forecast_point_inventory_v1', args: { p_company_id: string },
  ) => PromiseLike<{ data: unknown; error: unknown }>
  const { data, error } = await rpc('gridex_forecast_point_inventory_v1', { p_company_id: companyId })
  if (error) throw error
  const invalid = () => new Error('forecast_point_inventory_result_invalid')
  const row = Array.isArray(data) && data.length === 1 ? data[0] : null
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalid()
  const { points, total_count: countValue } = row as Record<string, unknown>
  if (typeof countValue !== 'number' && !(typeof countValue === 'string' && /^\d+$/.test(countValue))) throw invalid()
  const count = Number(countValue)
  if (!Number.isSafeInteger(count) || count < 0 || count > 10000 || !Array.isArray(points) || points.length !== count) throw invalid()
  const nullableString = (value: unknown) => value === null || typeof value === 'string'
  const validCustomer = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const customer = value as Record<string, unknown>
    return customer.company_id === companyId && nullableString(customer.source)
  }
  let previousId: string | null = null
  for (const value of points) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
    const point = value as Record<string, unknown>
    if (typeof point.id !== 'string' || !point.id || previousId !== null && point.id <= previousId
      || !['customer_id', 'site_id', 'grid_owner_id', 'bidding_zone_code'].every(key => nullableString(point[key]))
      || !(point.source_customer === null || (Array.isArray(point.source_customer)
        ? point.source_customer.every(validCustomer) : validCustomer(point.source_customer)))) throw invalid()
    previousId = point.id
  }
  return points as ForecastPoint[]
}

export class ForecastRunSkippedError extends Error {
  readonly reason = 'no_customer_data' as const

  constructor() {
    super('Prognosen hoppades över eftersom bolaget saknar verklig kunddata.')
    this.name = 'ForecastRunSkippedError'
  }
}

export async function createForecastRun(input: {
  companyId: string
  periodStart: string
  periodEnd?: string
  forecastType?: 'consumption' | 'purchase' | 'revenue'
  createdBy?: string | null
}): Promise<string> {
  const periodStart = monthStart(input.periodStart)
  const periodEnd = input.periodEnd ?? monthEndExclusive(periodStart)
  const { data, error } = await supabaseService
    .from('forecast_runs')
    .insert({
      company_id: input.companyId,
      forecast_type: input.forecastType ?? 'consumption',
      period_start: periodStart,
      period_end: periodEnd,
      status: 'running',
      method: 'hybrid',
      created_by: input.createdBy ?? null,
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

export async function generateForecastRunItems(input: {
  companyId: string
  forecastRunId: string
  periodStart: string
  periodEnd?: string
}): Promise<{ items: number; missing: number }> {
  const periodStart = monthStart(input.periodStart)
  const periodEnd = input.periodEnd ?? monthEndExclusive(periodStart)
  const meteringPoints = await forecastPointInventory(input.companyId)

  let items = 0
  let missing = 0
  for (const mp of meteringPoints ?? []) {
    // Use the same explicit portal source exclusion as SQL quality eligibility.
    // The named composite FK prevents a parent from another company matching.
    // A retained production point without a parent still needs its diagnosis.
    const sourceCustomers = Array.isArray(mp.source_customer) ? mp.source_customer : [mp.source_customer]
    if (sourceCustomers.some(customer => customer?.company_id === input.companyId && customer.source === 'ediel_portal_test')) continue
    const forecast = await calculateMeteringPointForecast({
      companyId: input.companyId,
      meteringPointId: mp.id,
      periodStart,
      periodEnd,
    })
    if (forecast.method === 'missing_basis') missing += 1

    const actualKwh = await actualKwhForPeriod(input.companyId, mp.id, periodStart, periodEnd)
    const diffKwh = forecast.forecastKwh === null ? null : actualKwh - forecast.forecastKwh
    const diffPercent = forecast.forecastKwh ? ((actualKwh - forecast.forecastKwh) / forecast.forecastKwh) * 100 : null

    const { error: itemError } = await supabaseService
      .from('forecast_run_items')
      .insert({
        company_id: input.companyId,
        forecast_run_id: input.forecastRunId,
        customer_id: mp.customer_id,
        site_id: mp.site_id,
        metering_point_id: mp.id,
        grid_owner_id: mp.grid_owner_id,
        bidding_zone_code: mp.bidding_zone_code,
        period_start: periodStart,
        period_end: periodEnd,
        forecast_kwh: forecast.forecastKwh,
        actual_kwh: actualKwh,
        diff_kwh: diffKwh,
        diff_percent: diffPercent,
        confidence_score: forecast.confidenceScore,
        method: forecast.method,
        notes: forecast.issues.join(', '),
      })

    if (itemError) throw itemError
    items += 1
  }

  const { error: completionError } = await supabaseService
    .from('forecast_runs')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', input.forecastRunId)
    .eq('company_id', input.companyId)

  if (completionError) throw completionError
  await buildCompanyMonthlyMetrics(input.companyId, periodStart)
  return { items, missing }
}

export async function runCompanyForecast(input: {
  companyId: string
  periodStart: string
  periodEnd?: string
  createdBy?: string | null
}): Promise<{ forecastRunId: string; items: number; missing: number }> {
  if (!(await hasCustomerAnalyticsData(input.companyId))) throw new ForecastRunSkippedError()
  const forecastRunId = await createForecastRun(input)
  const result = await generateForecastRunItems({
    companyId: input.companyId,
    forecastRunId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
  })
  return { forecastRunId, ...result }
}
