import { supabaseService } from '@/lib/supabase/service'
import { monthEndExclusive, monthStart } from '@/lib/analytics/utils'
import { calculateMeteringPointForecast } from '@/lib/forecasting/meteringPointForecast'
import { buildCompanyMonthlyMetrics } from '@/lib/analytics/monthlyMetricsBuilder'

const ACTIVE_STATUSES = ['active', 'live', 'ongoing']

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
  const { data: meteringPoints, error } = await supabaseService
    .from('metering_points')
    .select('id, customer_id, site_id, grid_owner_id, bidding_zone_code')
    .eq('company_id', input.companyId)
    .in('status', ACTIVE_STATUSES)
    .limit(10000)

  if (error) throw error

  let items = 0
  let missing = 0
  for (const mp of meteringPoints ?? []) {
    const forecast = await calculateMeteringPointForecast({
      companyId: input.companyId,
      meteringPointId: mp.id,
      periodStart,
      periodEnd,
    })
    if (forecast.method === 'missing_basis') missing += 1

    const { data: actualRows } = await supabaseService
      .from('metering_values')
      .select('quantity_kwh, value_kwh')
      .eq('company_id', input.companyId)
      .eq('metering_point_id', mp.id)
      .gte('period_start', `${periodStart}T00:00:00.000Z`)
      .lt('period_start', `${periodEnd}T00:00:00.000Z`)

    const actualKwh = (actualRows ?? []).reduce((sum, row) => sum + Number(row.quantity_kwh ?? row.value_kwh ?? 0), 0)
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

  await supabaseService
    .from('forecast_runs')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', input.forecastRunId)
    .eq('company_id', input.companyId)

  await buildCompanyMonthlyMetrics(input.companyId, periodStart)
  return { items, missing }
}

export async function runCompanyForecast(input: {
  companyId: string
  periodStart: string
  periodEnd?: string
  createdBy?: string | null
}): Promise<{ forecastRunId: string; items: number; missing: number }> {
  const forecastRunId = await createForecastRun(input)
  const result = await generateForecastRunItems({
    companyId: input.companyId,
    forecastRunId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
  })
  return { forecastRunId, ...result }
}
