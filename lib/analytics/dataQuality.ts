import { supabaseService } from '@/lib/supabase/service'
import { createDashboardAlert, refreshDashboardAlerts } from '@/lib/analytics/alerts'
import { monthEndExclusive, monthStart } from '@/lib/analytics/utils'

type IssueInput = {
  companyId: string
  entityType: string
  entityId?: string | null
  issueType: string
  severity?: 'warning' | 'critical'
  message: string
}

const ACTIVE_STATUSES = ['active', 'live', 'ongoing']

function isMissingRelation(error: { message?: string } | null): boolean {
  return Boolean(error?.message && /does not exist|schema cache|Could not find|column .* does not exist/i.test(error.message))
}

async function upsertIssue(issue: IssueInput): Promise<void> {
  const { error } = await supabaseService
    .from('data_quality_issues')
    .upsert({
      company_id: issue.companyId,
      entity_type: issue.entityType,
      entity_id: issue.entityId ?? null,
      issue_type: issue.issueType,
      severity: issue.severity ?? 'warning',
      message: issue.message,
      status: 'open',
      resolved_at: null,
      detected_at: new Date().toISOString(),
    }, { onConflict: 'company_id,entity_type,entity_id,issue_type,status' })

  if (error && !isMissingRelation(error)) throw error
}

export async function resolveDataQualityIssue(issueId: string, companyId?: string): Promise<void> {
  let query = supabaseService
    .from('data_quality_issues')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('id', issueId)

  if (companyId) query = query.eq('company_id', companyId)
  const { error } = await query
  if (error) throw error
}

export async function scanMeteringPointDataQuality(companyId: string, meteringPointId: string): Promise<number> {
  const { data: mp, error } = await supabaseService
    .from('metering_points')
    .select('id, customer_id, site_id, status, bidding_zone_code, grid_owner_id, estimated_annual_consumption_kwh, start_date, customer:customers(id,status)')
    .eq('company_id', companyId)
    .eq('id', meteringPointId)
    .maybeSingle()

  if (error) {
    if (isMissingRelation(error)) return 0
    throw error
  }
  if (!mp) return 0

  let count = 0
  const active = ACTIVE_STATUSES.includes(String(mp.status ?? '').toLowerCase())
  if (!active) return 0

  if (!mp.bidding_zone_code) {
    count += 1
    await upsertIssue({
      companyId,
      entityType: 'metering_point',
      entityId: mp.id,
      issueType: 'missing_bidding_zone',
      message: 'Mätpunkt saknar SE-område.',
    })
  }
  if (!mp.grid_owner_id) {
    count += 1
    await upsertIssue({
      companyId,
      entityType: 'metering_point',
      entityId: mp.id,
      issueType: 'missing_grid_owner',
      message: 'Mätpunkt saknar nätägare.',
    })
  }

  if (!mp.start_date) {
    count += 1
    await upsertIssue({
      companyId,
      entityType: 'metering_point',
      entityId: mp.id,
      issueType: 'missing_start_date',
      message: 'Mätpunkt saknar startdatum.',
    })
  }

  const { count: valueCount, error: valueError } = await supabaseService
    .from('metering_values')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('metering_point_id', meteringPointId)

  if (valueError && !isMissingRelation(valueError)) throw valueError
  if (!mp.estimated_annual_consumption_kwh && !(valueCount ?? 0)) {
    count += 1
    await upsertIssue({
      companyId,
      entityType: 'metering_point',
      entityId: mp.id,
      issueType: 'missing_estimated_annual_consumption',
      message: 'Mätpunkt saknar både uppskattad årsförbrukning och historiska mätvärden.',
    })
  }

  const customer = Array.isArray(mp.customer) ? mp.customer[0] : mp.customer
  if (customer?.status && !ACTIVE_STATUSES.includes(String(customer.status).toLowerCase())) {
    count += 1
    await upsertIssue({
      companyId,
      entityType: 'metering_point',
      entityId: mp.id,
      issueType: 'active_metering_point_without_active_customer',
      message: 'Mätpunkt är aktiv men kunden är inte aktiv.',
    })
  }

  return count
}

export async function scanCompanyDataQuality(companyId: string, month = monthStart()): Promise<{ issues: number }> {
  let issues = 0
  const { data: meteringPoints, error: mpError } = await supabaseService
    .from('metering_points')
    .select('id')
    .eq('company_id', companyId)
    .in('status', ACTIVE_STATUSES)
    .limit(5000)

  if (mpError) {
    if (isMissingRelation(mpError)) return { issues: 0 }
    throw mpError
  }

  for (const mp of meteringPoints ?? []) {
    issues += await scanMeteringPointDataQuality(companyId, mp.id)
  }

  const start = `${monthStart(month)}T00:00:00.000Z`
  const end = `${monthEndExclusive(month)}T00:00:00.000Z`
  for (const mp of meteringPoints ?? []) {
    const { count, error } = await supabaseService
      .from('metering_values')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('metering_point_id', mp.id)
      .gte('period_start', start)
      .lt('period_start', end)

    if (error && !isMissingRelation(error)) throw error
    if (!(count ?? 0)) {
      issues += 1
      await upsertIssue({
        companyId,
        entityType: 'metering_point',
        entityId: mp.id,
        issueType: 'missing_metering_values',
        severity: 'critical',
        message: 'Mätvärden saknas för perioden.',
      })
    }
  }

  const { data: invalidValues, error: invalidError } = await supabaseService
    .from('metering_values')
    .select('id')
    .eq('company_id', companyId)
    .lt('quantity_kwh', 0)
    .limit(1000)

  if (invalidError && !isMissingRelation(invalidError)) throw invalidError
  for (const value of invalidValues ?? []) {
    issues += 1
    await upsertIssue({
      companyId,
      entityType: 'metering_value',
      entityId: value.id,
      issueType: 'invalid_metering_value',
      severity: 'critical',
      message: 'Mätvärde är negativt och behöver kontrolleras.',
    })
  }

  const { data: customers, error: customerError } = await supabaseService
    .from('customers')
    .select('id')
    .eq('company_id', companyId)
    .in('status', ACTIVE_STATUSES)
    .limit(5000)

  if (customerError && !isMissingRelation(customerError)) throw customerError
  for (const customer of customers ?? []) {
    const { count, error } = await supabaseService
      .from('metering_points')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('customer_id', customer.id)
      .in('status', ACTIVE_STATUSES)

    if (error && !isMissingRelation(error)) throw error
    if (!(count ?? 0)) {
      issues += 1
      await upsertIssue({
        companyId,
        entityType: 'customer',
        entityId: customer.id,
        issueType: 'missing_customer_contract',
        message: 'Aktiv kund saknar aktiv mätpunkt.',
      })
    }
  }

  const { data: incompleteCustomers, error: incompleteError } = await supabaseService
    .from('customers')
    .select('id, email, status, onboarding_status')
    .eq('company_id', companyId)
    .limit(5000)

  if (incompleteError && !isMissingRelation(incompleteError)) throw incompleteError
  for (const customer of incompleteCustomers ?? []) {
    const status = String(customer.status ?? '').toLowerCase()
    const onboarding = String(customer.onboarding_status ?? '').toLowerCase()
    if (ACTIVE_STATUSES.includes(status) && (!customer.email || ['draft', 'incomplete', 'pending'].includes(onboarding))) {
      issues += 1
      await upsertIssue({
        companyId,
        entityType: 'customer',
        entityId: customer.id,
        issueType: 'incomplete_customer_onboarding',
        message: 'Kunddata är ofullständig för aktiv kund.',
      })
    }
  }

  const { data: failedEdiel, error: edielError } = await supabaseService
    .from('ediel_messages')
    .select('id, message_family, status, failure_reason')
    .eq('company_id', companyId)
    .in('status', ['failed', 'error', 'rejected', 'blocked'])
    .limit(500)

  if (edielError && !isMissingRelation(edielError)) throw edielError
  for (const message of failedEdiel ?? []) {
    issues += 1
    await upsertIssue({
      companyId,
      entityType: 'ediel_message',
      entityId: message.id,
      issueType: 'failed_ediel_message',
      severity: 'critical',
      message: `${message.message_family ?? 'Ediel'}-meddelande misslyckades${message.failure_reason ? `: ${message.failure_reason}` : '.'}`,
    })
  }

  const slowThreshold = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
  const { data: slowRequests, error: slowError } = await supabaseService
    .from('grid_owner_data_requests')
    .select('id, grid_owner_id, status, created_at')
    .eq('company_id', companyId)
    .in('status', ['pending', 'queued', 'sent', 'waiting_response'])
    .lt('created_at', slowThreshold)
    .limit(500)

  if (slowError && !isMissingRelation(slowError)) throw slowError
  for (const request of slowRequests ?? []) {
    issues += 1
    await upsertIssue({
      companyId,
      entityType: 'grid_owner_data_request',
      entityId: request.id,
      issueType: 'slow_grid_owner_response',
      message: 'Nätägarsvar har inte kommit inom 72 timmar.',
    })
  }

  const { data: forecastDeviations, error: deviationError } = await supabaseService
    .from('forecast_run_items')
    .select('id, metering_point_id, diff_percent')
    .eq('company_id', companyId)
    .not('diff_percent', 'is', null)
    .or('diff_percent.gt.10,diff_percent.lt.-10')
    .limit(500)

  if (deviationError && !isMissingRelation(deviationError)) throw deviationError
  for (const item of forecastDeviations ?? []) {
    issues += 1
    await upsertIssue({
      companyId,
      entityType: 'metering_point',
      entityId: item.metering_point_id ?? item.id,
      issueType: 'forecast_deviation',
      message: `Prognosen avviker med ${Math.round(Number(item.diff_percent ?? 0))} % mot faktiskt utfall.`,
    })
  }

  await refreshDashboardAlerts(companyId)
  if (issues > 0) {
    await createDashboardAlert({
      companyId,
      alertType: 'data_quality',
      severity: 'warning',
      title: `${issues} datakvalitetsfrågor kräver uppföljning`,
      message: 'Öppna avvikelser för detaljer och åtgärder.',
    })
  }

  return { issues }
}
