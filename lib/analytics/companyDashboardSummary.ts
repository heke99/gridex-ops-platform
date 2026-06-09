import { supabaseService } from '@/lib/supabase/service'

export type CompanyDashboardMetrics = {
  customers: number
  activeCustomers: number
  customerSites: number
  meteringPoints: number
  activeContracts: number
  normalizedMeteringValues: number
  billingUnderlaysReady: number
  billingUnderlaysNeedsReview: number
  edielFailedMessages: number
  edielPendingMessages: number
}

async function safeCount(table: string, companyId: string, filters: Array<{ column: string; operator: 'eq' | 'in'; value: unknown }> = []): Promise<number> {
  let query = supabaseService.from(table).select('id', { count: 'exact', head: true }).eq('company_id', companyId)
  for (const filter of filters) {
    if (filter.operator === 'eq') query = query.eq(filter.column, filter.value as string)
    if (filter.operator === 'in') query = query.in(filter.column, filter.value as string[])
  }
  const { count, error } = await query
  if (error && ['42P01', '42703', 'PGRST205'].includes(error.code ?? '')) return 0
  if (error) throw error
  return count ?? 0
}

export async function buildCompanyDashboardMetrics(companyId: string, billingMonth?: string | null): Promise<CompanyDashboardMetrics> {
  const [yearRaw, monthRaw] = (billingMonth ?? '').split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const underlayMonthFilters = Number.isFinite(year) && Number.isFinite(month)
    ? [{ column: 'underlay_year', operator: 'eq' as const, value: year }, { column: 'underlay_month', operator: 'eq' as const, value: month }]
    : []

  const [
    customers,
    activeCustomers,
    customerSites,
    meteringPoints,
    activeContracts,
    normalizedMeteringValues,
    billingUnderlaysReady,
    billingUnderlaysNeedsReview,
    edielFailedMessages,
    edielPendingMessages,
  ] = await Promise.all([
    safeCount('customers', companyId),
    safeCount('customers', companyId, [{ column: 'status', operator: 'eq', value: 'active' }]),
    safeCount('customer_sites', companyId),
    safeCount('metering_points', companyId),
    safeCount('customer_contracts', companyId, [{ column: 'status', operator: 'in', value: ['active', 'signed'] }]),
    safeCount('normalized_metering_values', companyId),
    safeCount('billing_underlays', companyId, [...underlayMonthFilters, { column: 'readiness_status', operator: 'eq', value: 'ready' }]),
    safeCount('billing_underlays', companyId, [...underlayMonthFilters, { column: 'readiness_status', operator: 'eq', value: 'blocked' }]),
    safeCount('ediel_messages', companyId, [{ column: 'status', operator: 'eq', value: 'failed' }]),
    safeCount('ediel_messages', companyId, [{ column: 'status', operator: 'in', value: ['draft', 'queued', 'prepared', 'parsed', 'awaiting_contrl', 'awaiting_aperak'] }]),
  ])

  return {
    customers,
    activeCustomers,
    customerSites,
    meteringPoints,
    activeContracts,
    normalizedMeteringValues,
    billingUnderlaysReady,
    billingUnderlaysNeedsReview,
    edielFailedMessages,
    edielPendingMessages,
  }
}

export async function refreshCompanyDashboardSnapshot(input: { companyId: string; billingMonth?: string | null; actorUserId?: string | null }) {
  const metrics = await buildCompanyDashboardMetrics(input.companyId, input.billingMonth)
  const { data, error } = await supabaseService
    .from('company_dashboard_snapshots')
    .upsert({
      company_id: input.companyId,
      period_month: input.billingMonth ?? null,
      snapshot_date: new Date().toISOString().slice(0, 10),
      scope: 'company',
      metrics,
      generated_at: new Date().toISOString(),
      generated_by: input.actorUserId ?? null,
    }, { onConflict: 'company_id,period_month,snapshot_date,scope' })
    .select('*')
    .single()

  if (error && error.code !== '42P01' && error.code !== 'PGRST205') throw error
  return { metrics, row: data ?? null }
}
