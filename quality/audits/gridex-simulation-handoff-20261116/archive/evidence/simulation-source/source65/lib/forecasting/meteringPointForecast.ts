import { supabaseService } from '@/lib/supabase/service'
import { asNumber, monthEndExclusive, monthStart } from '@/lib/analytics/utils'
import { getMonthlyWeightPercent } from '@/lib/forecasting/consumptionProfiles'
import { resolveManagedDataQualityIssue, upsertManagedDataQualityIssue } from '@/lib/analytics/dataQuality'

export type MeteringPointForecastResult = {
  forecastKwh: number | null
  confidenceScore: number
  method: 'history' | 'annual_estimate' | 'hybrid' | 'missing_basis'
  issues: string[]
}

type MeteringPointRow = {
  id: string
  customer_id: string | null
  site_id: string | null
  grid_owner_id: string | null
  bidding_zone_code: string | null
  estimated_annual_consumption_kwh: number | null
  annual_consumption_kwh?: number | null
  consumption_profile_id: string | null
  start_date: string | null
  end_date: string | null
}

function daysBetween(start: Date, end: Date): number {
  return Math.max(0, Math.ceil((end.getTime() - start.getTime()) / 86400000))
}

function activeDaysFactor(periodStart: string, periodEnd: string, startDate?: string | null, endDate?: string | null): number {
  const start = new Date(`${periodStart}T00:00:00.000Z`)
  const end = new Date(`${periodEnd}T00:00:00.000Z`)
  const activeStart = startDate ? new Date(`${startDate}T00:00:00.000Z`) : start
  const activeEnd = endDate ? new Date(`${endDate}T00:00:00.000Z`) : end
  const clippedStart = activeStart > start ? activeStart : start
  const clippedEnd = activeEnd < end ? activeEnd : end
  const totalDays = daysBetween(start, end) || 1
  return Math.min(1, Math.max(0, daysBetween(clippedStart, clippedEnd) / totalDays))
}

async function createMissingBasisIssue(companyId: string, meteringPointId: string, periodMonth: string): Promise<void> {
  await upsertManagedDataQualityIssue({
    companyId,
    entityId: meteringPointId,
    issueType: 'forecast_basis_missing',
    periodMonth,
    message: 'Prognosunderlag saknas för mätpunkten.',
  })
}

async function resolveMissingBasisIssue(companyId: string, meteringPointId: string, periodMonth: string): Promise<void> {
  await resolveManagedDataQualityIssue({ companyId, entityId: meteringPointId, issueType: 'forecast_basis_missing', periodMonth })
}

/** One aggregate row covers the complete existing raw selection in one SQL
 * statement. Never fall back to a capped raw list when its evidence fails. */
export async function actualKwhForPeriod(companyId: string, meteringPointId: string, start: string, end: string): Promise<number> {
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as (
    name: 'gridex_forecast_metering_period_totals_v1',
    args: { p_company_id: string; p_metering_point_id: string; p_period_start: string; p_period_end: string },
  ) => PromiseLike<{ data: unknown; error: unknown }>
  const { data, error } = await rpc('gridex_forecast_metering_period_totals_v1', {
    p_company_id: companyId,
    p_metering_point_id: meteringPointId,
    p_period_start: `${start}T00:00:00.000Z`,
    p_period_end: `${end}T00:00:00.000Z`,
  })
  if (error) throw error
  const row = Array.isArray(data) && data.length === 1 ? data[0] : null
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('forecast_metering_period_totals_result_invalid')
  const { total_kwh: totalValue, value_count: countValue } = row as Record<string, unknown>
  const numeric = (value: unknown): value is number | string => typeof value === 'number'
    || typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
  if (!numeric(totalValue) || !numeric(countValue)) throw new Error('forecast_metering_period_totals_result_invalid')
  const total = Number(totalValue)
  const count = Number(countValue)
  if (!Number.isFinite(total) || !Number.isSafeInteger(count) || count < 0 || count === 0 && total !== 0) {
    throw new Error('forecast_metering_period_totals_result_invalid')
  }
  return total
}

export async function calculateMeteringPointForecast(input: {
  companyId: string
  meteringPointId: string
  periodStart: string
  periodEnd: string
}): Promise<MeteringPointForecastResult> {
  const periodStart = monthStart(input.periodStart)
  const periodEnd = input.periodEnd || monthEndExclusive(periodStart)
  const { data, error } = await supabaseService
    .from('metering_points')
    .select('id, customer_id, site_id, grid_owner_id, bidding_zone_code, estimated_annual_consumption_kwh, consumption_profile_id, start_date, end_date, customer_sites(annual_consumption_kwh)')
    .eq('company_id', input.companyId)
    .eq('id', input.meteringPointId)
    .maybeSingle()

  if (error) throw error
  if (!data) return { forecastKwh: null, confidenceScore: 0, method: 'missing_basis', issues: ['metering_point_missing'] }

  const mp = data as unknown as MeteringPointRow & { customer_sites?: { annual_consumption_kwh?: number | null } | Array<{ annual_consumption_kwh?: number | null }> }
  const lastYearStart = `${Number(periodStart.slice(0, 4)) - 1}${periodStart.slice(4)}`
  const lastYearEnd = `${Number(periodEnd.slice(0, 4)) - 1}${periodEnd.slice(4)}`
  const sameMonthPreviousYear = await actualKwhForPeriod(input.companyId, input.meteringPointId, lastYearStart, lastYearEnd)
  if (sameMonthPreviousYear > 0) {
    await resolveMissingBasisIssue(input.companyId, input.meteringPointId, periodStart)
    return { forecastKwh: sameMonthPreviousYear, confidenceScore: 95, method: 'history', issues: [] }
  }

  const lastTwelveStart = new Date(`${periodStart}T00:00:00.000Z`)
  lastTwelveStart.setUTCMonth(lastTwelveStart.getUTCMonth() - 12)
  const lastTwelveKwh = await actualKwhForPeriod(input.companyId, input.meteringPointId, lastTwelveStart.toISOString().slice(0, 10), periodStart)
  if (lastTwelveKwh > 0) {
    await resolveMissingBasisIssue(input.companyId, input.meteringPointId, periodStart)
    return { forecastKwh: lastTwelveKwh / 12, confidenceScore: 85, method: 'history', issues: ['average_last_12_months'] }
  }

  const lastThreeStart = new Date(`${periodStart}T00:00:00.000Z`)
  lastThreeStart.setUTCMonth(lastThreeStart.getUTCMonth() - 3)
  const lastThreeKwh = await actualKwhForPeriod(input.companyId, input.meteringPointId, lastThreeStart.toISOString().slice(0, 10), periodStart)
  if (lastThreeKwh > 0) {
    await resolveMissingBasisIssue(input.companyId, input.meteringPointId, periodStart)
    return { forecastKwh: lastThreeKwh / 3, confidenceScore: 85, method: 'hybrid', issues: ['partial_history'] }
  }

  const site = Array.isArray(mp.customer_sites) ? mp.customer_sites[0] : mp.customer_sites
  const annualEstimate = asNumber(mp.estimated_annual_consumption_kwh ?? site?.annual_consumption_kwh)
  if (annualEstimate > 0) {
    const monthNumber = Number(periodStart.slice(5, 7))
    const weight = await getMonthlyWeightPercent(input.companyId, mp.consumption_profile_id, monthNumber)
    const factor = activeDaysFactor(periodStart, periodEnd, mp.start_date, mp.end_date)
    await resolveMissingBasisIssue(input.companyId, input.meteringPointId, periodStart)
    return {
      forecastKwh: annualEstimate * (weight / 100) * factor,
      confidenceScore: 70,
      method: 'annual_estimate',
      issues: factor < 1 ? ['partial_active_period'] : [],
    }
  }

  await createMissingBasisIssue(input.companyId, input.meteringPointId, periodStart)
  return { forecastKwh: null, confidenceScore: 0, method: 'missing_basis', issues: ['forecast_basis_missing'] }
}
