import { supabaseService } from '@/lib/supabase/service'
import { addMonths, asNumber, monthEndExclusive, monthStart } from '@/lib/analytics/utils'

/* eslint-disable @typescript-eslint/no-explicit-any */

const ACTIVE_STATUSES = ['active', 'live', 'ongoing']
const FAILED_STATUSES = ['failed', 'error', 'rejected', 'blocked']
const SUCCESS_STATUSES = ['completed', 'received', 'success', 'succeeded', 'done']

async function countRows(table: string, companyId: string, build?: (query: any) => any): Promise<number> {
  let query = supabaseService.from(table).select('id', { count: 'exact', head: true }).eq('company_id', companyId)
  if (build) query = build(query)
  const { count, error } = await query
  if (error) {
    if (/does not exist|schema cache|Could not find/i.test(error.message)) return 0
    throw error
  }
  return count ?? 0
}

async function sumRows(table: string, column: string, companyId: string, build?: (query: any) => any): Promise<number> {
  let query = supabaseService.from(table).select(column).eq('company_id', companyId)
  if (build) query = build(query)
  const { data, error } = await query
  if (error) {
    if (/does not exist|schema cache|Could not find/i.test(error.message)) return 0
    throw error
  }
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).reduce((sum, row) => sum + asNumber(row[column]), 0)
}

export async function buildCompanyMonthlyMetrics(companyId: string, month: string): Promise<void> {
  const safeMonth = monthStart(month)
  const start = `${safeMonth}T00:00:00.000Z`
  const end = `${monthEndExclusive(safeMonth)}T00:00:00.000Z`

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
    requestedMeteringValues,
    successfulMeteringRequests,
    failedMeteringRequests,
    forecastKwh,
    actualKwh,
    missingMeteringValues,
  ] = await Promise.all([
    countRows('customers', companyId),
    countRows('customers', companyId, (query) => query.in('status', ACTIVE_STATUSES)),
    countRows('customers', companyId, (query) => query.gte('created_at', start).lt('created_at', end)),
    countRows('customers', companyId, (query) => query.gte('ended_at', start).lt('ended_at', end)),
    countRows('customer_sites', companyId),
    countRows('customer_sites', companyId, (query) => query.in('status', ACTIVE_STATUSES)),
    countRows('metering_points', companyId),
    countRows('metering_points', companyId, (query) => query.in('status', ACTIVE_STATUSES)),
    countRows('metering_values', companyId, (query) => query.gte('period_start', start).lt('period_start', end)),
    countRows('grid_owner_data_requests', companyId, (query) => query.gte('created_at', start).lt('created_at', end)),
    countRows('grid_owner_data_requests', companyId, (query) => query.gte('created_at', start).lt('created_at', end).in('status', SUCCESS_STATUSES)),
    countRows('grid_owner_data_requests', companyId, (query) => query.gte('created_at', start).lt('created_at', end).in('status', FAILED_STATUSES)),
    sumRows('forecast_run_items', 'forecast_kwh', companyId, (query) => query.gte('period_start', safeMonth).lt('period_start', addMonths(safeMonth, 1))),
    sumRows('metering_values', 'quantity_kwh', companyId, (query) => query.gte('period_start', start).lt('period_start', end)),
    countRows('data_quality_issues', companyId, (query) => query.eq('status', 'open').eq('issue_type', 'missing_metering_values')),
  ])

  const diffKwh = actualKwh - forecastKwh
  const diffPercent = forecastKwh ? (diffKwh / forecastKwh) * 100 : null

  const { error } = await supabaseService
    .from('company_monthly_metrics')
    .upsert({
      company_id: companyId,
      month: safeMonth,
      total_customers: totalCustomers,
      active_customers: activeCustomers,
      new_customers: newCustomers,
      ended_customers: endedCustomers,
      total_sites: totalSites,
      active_sites: activeSites,
      total_metering_points: totalMeteringPoints,
      active_metering_points: activeMeteringPoints,
      metering_values_received: meteringValuesReceived,
      metering_values_missing: missingMeteringValues,
      requested_metering_values: requestedMeteringValues,
      successful_metering_requests: successfulMeteringRequests,
      failed_metering_requests: failedMeteringRequests,
      forecast_kwh: forecastKwh,
      actual_kwh: actualKwh,
      diff_kwh: diffKwh,
      diff_percent: diffPercent,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id,month' })

  if (error) throw error

  await Promise.all([
    buildCustomerMonthlyMetrics(companyId, safeMonth),
    buildBiddingZoneMonthlyMetrics(companyId, safeMonth),
    buildGridOwnerMonthlyMetrics(companyId, safeMonth),
  ])
}

async function buildCustomerMonthlyMetrics(companyId: string, month: string): Promise<void> {
  const { data: customers, error } = await supabaseService
    .from('customers')
    .select('id, status')
    .eq('company_id', companyId)
    .limit(5000)

  if (error) {
    if (/does not exist|schema cache|Could not find/i.test(error.message)) return
    throw error
  }

  const start = `${month}T00:00:00.000Z`
  const end = `${monthEndExclusive(month)}T00:00:00.000Z`
  for (const customer of customers ?? []) {
    const [sites, meteringPoints, forecastKwh, actualKwh] = await Promise.all([
      countRows('customer_sites', companyId, (query) => query.eq('customer_id', customer.id)),
      countRows('metering_points', companyId, (query) => query.eq('customer_id', customer.id)),
      sumRows('forecast_run_items', 'forecast_kwh', companyId, (query) => query.eq('customer_id', customer.id).gte('period_start', month).lt('period_start', addMonths(month, 1))),
      sumRows('metering_values', 'quantity_kwh', companyId, (query) => query.eq('customer_id', customer.id).gte('period_start', start).lt('period_start', end)),
    ])
    const diffKwh = actualKwh - forecastKwh
    await supabaseService.from('customer_monthly_metrics').upsert({
      company_id: companyId,
      customer_id: customer.id,
      month,
      sites_count: sites,
      metering_points_count: meteringPoints,
      forecast_kwh: forecastKwh,
      actual_kwh: actualKwh,
      diff_kwh: diffKwh,
      diff_percent: forecastKwh ? (diffKwh / forecastKwh) * 100 : null,
      status: customer.status ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id,customer_id,month' })
  }
}

async function buildBiddingZoneMonthlyMetrics(companyId: string, month: string): Promise<void> {
  const zones = ['SE1', 'SE2', 'SE3', 'SE4']
  const start = `${month}T00:00:00.000Z`
  const end = `${monthEndExclusive(month)}T00:00:00.000Z`
  for (const zone of zones) {
    const [sites, meteringPoints, forecastKwh, actualKwh] = await Promise.all([
      countRows('customer_sites', companyId, (query) => query.eq('bidding_zone_code', zone)),
      countRows('metering_points', companyId, (query) => query.eq('bidding_zone_code', zone)),
      sumRows('forecast_run_items', 'forecast_kwh', companyId, (query) => query.eq('bidding_zone_code', zone).gte('period_start', month).lt('period_start', addMonths(month, 1))),
      sumRows('metering_values', 'quantity_kwh', companyId, (query) => query.eq('bidding_zone_code', zone).gte('period_start', start).lt('period_start', end)),
    ])
    const diffKwh = actualKwh - forecastKwh
    await supabaseService.from('bidding_zone_monthly_metrics').upsert({
      company_id: companyId,
      bidding_zone_code: zone,
      month,
      customers_count: 0,
      sites_count: sites,
      metering_points_count: meteringPoints,
      forecast_kwh: forecastKwh,
      actual_kwh: actualKwh,
      diff_kwh: diffKwh,
      diff_percent: forecastKwh ? (diffKwh / forecastKwh) * 100 : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id,bidding_zone_code,month' })
  }
}

async function buildGridOwnerMonthlyMetrics(companyId: string, month: string): Promise<void> {
  const { data: owners, error } = await supabaseService
    .from('grid_owners')
    .select('id')
    .eq('company_id', companyId)
    .limit(1000)

  if (error) {
    if (/does not exist|schema cache|Could not find/i.test(error.message)) return
    throw error
  }

  const start = `${month}T00:00:00.000Z`
  const end = `${monthEndExclusive(month)}T00:00:00.000Z`
  for (const owner of owners ?? []) {
    const [sites, meteringPoints, received, missing, failed, forecastKwh, actualKwh] = await Promise.all([
      countRows('customer_sites', companyId, (query) => query.eq('grid_owner_id', owner.id)),
      countRows('metering_points', companyId, (query) => query.eq('grid_owner_id', owner.id)),
      countRows('metering_values', companyId, (query) => query.eq('grid_owner_id', owner.id).gte('period_start', start).lt('period_start', end)),
      countRows('data_quality_issues', companyId, (query) => query.eq('status', 'open').eq('issue_type', 'missing_metering_values')),
      countRows('grid_owner_data_requests', companyId, (query) => query.eq('grid_owner_id', owner.id).gte('created_at', start).lt('created_at', end).in('status', FAILED_STATUSES)),
      sumRows('forecast_run_items', 'forecast_kwh', companyId, (query) => query.eq('grid_owner_id', owner.id).gte('period_start', month).lt('period_start', addMonths(month, 1))),
      sumRows('metering_values', 'quantity_kwh', companyId, (query) => query.eq('grid_owner_id', owner.id).gte('period_start', start).lt('period_start', end)),
    ])

    const payload = {
      company_id: companyId,
      grid_owner_id: owner.id,
      month,
      sites_count: sites,
      metering_points_count: meteringPoints,
      metering_values_received: received,
      metering_values_missing: missing,
      failed_requests_count: failed,
      forecast_kwh: forecastKwh,
      actual_kwh: actualKwh,
      updated_at: new Date().toISOString(),
    }

    const { data: existing } = await supabaseService
      .from('grid_owner_monthly_metrics')
      .select('id')
      .eq('company_id', companyId)
      .eq('grid_owner_id', owner.id)
      .eq('month', month)
      .maybeSingle()

    if (existing?.id) {
      await supabaseService.from('grid_owner_monthly_metrics').update(payload).eq('id', existing.id)
    } else {
      await supabaseService.from('grid_owner_monthly_metrics').insert(payload)
    }
  }
}
