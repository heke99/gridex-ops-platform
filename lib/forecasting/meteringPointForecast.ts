import { supabaseService } from '@/lib/supabase/service'
import { asNumber, monthEndExclusive, monthStart } from '@/lib/analytics/utils'
import { getMonthlyWeightPercent } from '@/lib/forecasting/consumptionProfiles'

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

async function createMissingBasisIssue(companyId: string, meteringPointId: string): Promise<void> {
  await supabaseService.from('data_quality_issues').upsert({
    company_id: companyId,
    entity_type: 'metering_point',
    entity_id: meteringPointId,
    issue_type: 'forecast_basis_missing',
    severity: 'warning',
    message: 'Prognosunderlag saknas för mätpunkten.',
    status: 'open',
  }, { onConflict: 'company_id,entity_type,entity_id,issue_type,status' })
}

async function actualKwhForPeriod(companyId: string, meteringPointId: string, start: string, end: string): Promise<number> {
  const { data, error } = await supabaseService
    .from('metering_values')
    .select('quantity_kwh, value_kwh')
    .eq('company_id', companyId)
    .eq('metering_point_id', meteringPointId)
    .gte('period_start', `${start}T00:00:00.000Z`)
    .lt('period_start', `${end}T00:00:00.000Z`)

  if (error) {
    if (/does not exist|schema cache|Could not find/i.test(error.message)) return 0
    throw error
  }

  return (data ?? []).reduce((sum, row) => sum + asNumber(row.quantity_kwh ?? row.value_kwh), 0)
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
    return { forecastKwh: sameMonthPreviousYear, confidenceScore: 95, method: 'history', issues: [] }
  }

  const lastTwelveStart = new Date(`${periodStart}T00:00:00.000Z`)
  lastTwelveStart.setUTCMonth(lastTwelveStart.getUTCMonth() - 12)
  const lastTwelveKwh = await actualKwhForPeriod(input.companyId, input.meteringPointId, lastTwelveStart.toISOString().slice(0, 10), periodStart)
  if (lastTwelveKwh > 0) {
    return { forecastKwh: lastTwelveKwh / 12, confidenceScore: 85, method: 'history', issues: ['average_last_12_months'] }
  }

  const lastThreeStart = new Date(`${periodStart}T00:00:00.000Z`)
  lastThreeStart.setUTCMonth(lastThreeStart.getUTCMonth() - 3)
  const lastThreeKwh = await actualKwhForPeriod(input.companyId, input.meteringPointId, lastThreeStart.toISOString().slice(0, 10), periodStart)
  if (lastThreeKwh > 0) {
    return { forecastKwh: lastThreeKwh / 3, confidenceScore: 85, method: 'hybrid', issues: ['partial_history'] }
  }

  const site = Array.isArray(mp.customer_sites) ? mp.customer_sites[0] : mp.customer_sites
  const annualEstimate = asNumber(mp.estimated_annual_consumption_kwh ?? site?.annual_consumption_kwh)
  if (annualEstimate > 0) {
    const monthNumber = Number(periodStart.slice(5, 7))
    const weight = await getMonthlyWeightPercent(input.companyId, mp.consumption_profile_id, monthNumber)
    const factor = activeDaysFactor(periodStart, periodEnd, mp.start_date, mp.end_date)
    return {
      forecastKwh: annualEstimate * (weight / 100) * factor,
      confidenceScore: 70,
      method: 'annual_estimate',
      issues: factor < 1 ? ['partial_active_period'] : [],
    }
  }

  await createMissingBasisIssue(input.companyId, input.meteringPointId)
  return { forecastKwh: null, confidenceScore: 0, method: 'missing_basis', issues: ['forecast_basis_missing'] }
}
