import type { SupabaseClient } from '@supabase/supabase-js'
import { getVerifiedPlatformDashboardSummary } from '@/lib/performance/platformDashboardSummary'

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

export type CompanyDashboardSummary = {
  companyId: string
  companyName: string | null
  customersTotal: number
  contractsTotal: number
  sitesTotal: number
  meteringPointsTotal: number
  openTasks: number
  openGridOwnerRequests: number
  openSwitches: number
  outboundRequestsTotal: number
  meteringValuesTotal: number
  billingUnderlaysTotal: number
  ongoingSupplierSwitches: number
  waitingForGridOwner: number
  negativeAcknowledgements: number
  missingMeteringValues: number
  customersActionRequired: number
  latestMeteringValues: number
  upcomingTerminations: number
  pendingCustomerApplications: number
  billingBlockedOrFailed: number
  routeMissingOrNotReady: number
  apiErrors: number
  webhookFailures: number
  customersBlockedOrDataIssues: number
  companiesTotal?: number
  gridOwnersTotal?: number
  electricitySuppliersTotal?: number
}

export type CustomerIntakeQueueRow = {
  intakeId: string
  companyId: string
  customerId: string | null
  customerNumber: string | null
  customerName: string
  customerEmail: string | null
  customerPhone: string | null
  status: string
  missingFields: string[]
  blockingReasons: string[]
  suggestedGridOwnerName: string | null
  suggestedGridAreaCode: string | null
  priceAreaCode: string | null
  confidence: number | null
  nextAction: string
  createdAt: string
  updatedAt: string
}

export type CustomerListSummaryRow = {
  customerId: string
  companyId: string
  customerNumber: string | null
  customerName: string
  email: string | null
  phone: string | null
  status: string | null
  customerType: string | null
  sitesCount: number
  meteringPointsCount: number
  activeContractStatus: string | null
  latestActivityAt: string | null
  blockingReasonCount: number
}

type RawRow = Record<string, unknown>

function firstRpcRow(data: unknown): RawRow | null {
  if (Array.isArray(data)) return (data[0] as RawRow | undefined) ?? null
  if (data && typeof data === 'object') return data as RawRow
  return null
}

function rpcRows(data: unknown): RawRow[] {
  if (!Array.isArray(data)) return []
  return data.filter((item): item is RawRow => Boolean(item) && typeof item === 'object')
}

export async function getCompanyDashboardSummary(
  supabase: SupabaseClient,
  companyId: string | null | undefined
): Promise<CompanyDashboardSummary | null> {
  if (!companyId) {
    const platform = await getVerifiedPlatformDashboardSummary(supabase)
    if (!platform) return null

    return {
      companyId: '__platform__',
      companyName: null,
      customersTotal: platform.customersTotal,
      contractsTotal: platform.contractsTotal,
      sitesTotal: platform.sitesTotal,
      meteringPointsTotal: platform.meteringPointsTotal,
      openTasks: platform.openTasks,
      openGridOwnerRequests: platform.openGridOwnerRequests,
      openSwitches: platform.openSwitches,
      outboundRequestsTotal: platform.outboundRequestsTotal,
      meteringValuesTotal: platform.meteringValuesTotal,
      billingUnderlaysTotal: platform.billingUnderlaysTotal,
      ongoingSupplierSwitches: platform.ongoingSupplierSwitches,
      waitingForGridOwner: platform.waitingForGridOwner,
      negativeAcknowledgements: platform.negativeAcknowledgements,
      missingMeteringValues: platform.missingMeteringValues,
      customersActionRequired: platform.customersActionRequired,
      latestMeteringValues: platform.latestMeteringValues,
      upcomingTerminations: platform.upcomingTerminations,
      pendingCustomerApplications: platform.pendingCustomerApplications,
      billingBlockedOrFailed: 0,
      routeMissingOrNotReady: 0,
      apiErrors: 0,
      webhookFailures: 0,
      customersBlockedOrDataIssues: 0,
      companiesTotal: platform.companiesTotal,
      gridOwnersTotal: platform.gridOwnersTotal,
      electricitySuppliersTotal: platform.electricitySuppliersTotal,
    }
  }

  try {
    const rpcResult = await supabase.rpc('gridex_admin_dashboard_summary', { p_company_id: companyId })
    let row = firstRpcRow(rpcResult.data)

    if (rpcResult.error || !row) {
      const { data, error } = await supabase
        .from('company_dashboard_summary_v')
        .select('*')
        .eq('company_id', companyId)
        .maybeSingle()

      if (error || !data) return null
      row = data as RawRow
    }

    return {
      companyId,
      companyName: typeof row.company_name === 'string' ? row.company_name : null,
      customersTotal: toNumber(row.customers_total),
      contractsTotal: toNumber(row.contracts_total),
      sitesTotal: toNumber(row.sites_total),
      meteringPointsTotal: toNumber(row.metering_points_total),
      openTasks: toNumber(row.open_tasks),
      openGridOwnerRequests: toNumber(row.open_grid_owner_requests),
      openSwitches: toNumber(row.open_switches),
      outboundRequestsTotal: toNumber(row.outbound_requests_total),
      meteringValuesTotal: toNumber(row.metering_values_total),
      billingUnderlaysTotal: toNumber(row.billing_underlays_total),
      ongoingSupplierSwitches: toNumber(row.ongoing_supplier_switches),
      waitingForGridOwner: toNumber(row.waiting_for_grid_owner),
      negativeAcknowledgements: toNumber(row.negative_acknowledgements),
      missingMeteringValues: toNumber(row.missing_metering_values),
      customersActionRequired: toNumber(row.customers_action_required),
      latestMeteringValues: toNumber(row.latest_metering_values),
      upcomingTerminations: toNumber(row.upcoming_terminations),
      pendingCustomerApplications: toNumber(row.pending_customer_applications),
      billingBlockedOrFailed: toNumber(row.billing_blocked_or_failed),
      routeMissingOrNotReady: toNumber(row.route_missing_or_not_ready),
      apiErrors: toNumber(row.api_errors),
      webhookFailures: toNumber(row.webhook_failures),
      customersBlockedOrDataIssues: toNumber(row.customers_blocked_or_data_issues),
    }
  } catch {
    return null
  }
}

export async function listCompanyCustomerIntakeQueue(
  supabase: SupabaseClient,
  companyId: string | null | undefined,
  options: { limit?: number } = {}
): Promise<CustomerIntakeQueueRow[]> {
  if (!companyId) return []

  try {
    const limit = options.limit ?? 50
    const rpcResult = await supabase.rpc('gridex_customer_intake_queue', { p_company_id: companyId, p_limit: limit })
    let rows = rpcRows(rpcResult.data)

    if (rpcResult.error || rows.length === 0) {
      const { data, error } = await supabase
        .from('company_customer_intake_queue_v')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) return []
      rows = ((data ?? []) as RawRow[])
    }

    return rows.map((row) => ({
      intakeId: String(row.intake_id),
      companyId: String(row.company_id),
      customerId: typeof row.customer_id === 'string' ? row.customer_id : null,
      customerNumber: typeof row.customer_number === 'string' ? row.customer_number : null,
      customerName: typeof row.customer_name === 'string' ? row.customer_name : 'Namnlös kundansökan',
      customerEmail: typeof row.customer_email === 'string' ? row.customer_email : null,
      customerPhone: typeof row.customer_phone === 'string' ? row.customer_phone : null,
      status: typeof row.status === 'string' ? row.status : 'received',
      missingFields: toStringArray(row.missing_fields),
      blockingReasons: toStringArray(row.blocking_reasons),
      suggestedGridOwnerName: typeof row.suggested_grid_owner_name === 'string' ? row.suggested_grid_owner_name : null,
      suggestedGridAreaCode: typeof row.suggested_grid_area_code === 'string' ? row.suggested_grid_area_code : null,
      priceAreaCode: typeof row.price_area_code === 'string' ? row.price_area_code : null,
      confidence: row.confidence === null || row.confidence === undefined ? null : toNumber(row.confidence),
      nextAction: typeof row.next_action === 'string' ? row.next_action : 'Granska ärendet',
      createdAt: typeof row.created_at === 'string' ? row.created_at : new Date(0).toISOString(),
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : new Date(0).toISOString(),
    }))
  } catch {
    return []
  }
}

export async function listCompanyCustomerListSummary(
  supabase: SupabaseClient,
  companyId: string | null | undefined,
  options: { limit?: number } = {}
): Promise<CustomerListSummaryRow[]> {
  if (!companyId) return []

  try {
    const limit = options.limit ?? 100
    const rpcResult = await supabase.rpc('gridex_customer_list_summary', { p_company_id: companyId, p_limit: limit })
    let rows = rpcRows(rpcResult.data)

    if (rpcResult.error || rows.length === 0) {
      const { data, error } = await supabase
        .from('company_customer_list_summary_v')
        .select('*')
        .eq('company_id', companyId)
        .order('latest_activity_at', { ascending: false, nullsFirst: false })
        .limit(limit)

      if (error) return []
      rows = ((data ?? []) as RawRow[])
    }

    return rows.map((row) => ({
      customerId: String(row.customer_id),
      companyId: String(row.company_id),
      customerNumber: typeof row.customer_number === 'string' ? row.customer_number : null,
      customerName: typeof row.customer_name === 'string' ? row.customer_name : 'Namnlös kund',
      email: typeof row.email === 'string' ? row.email : null,
      phone: typeof row.phone === 'string' ? row.phone : null,
      status: typeof row.status === 'string' ? row.status : null,
      customerType: typeof row.customer_type === 'string' ? row.customer_type : null,
      sitesCount: toNumber(row.sites_count),
      meteringPointsCount: toNumber(row.metering_points_count),
      activeContractStatus: typeof row.active_contract_status === 'string' ? row.active_contract_status : null,
      latestActivityAt: typeof row.latest_activity_at === 'string' ? row.latest_activity_at : null,
      blockingReasonCount: toNumber(row.blocking_reason_count),
    }))
  } catch {
    return []
  }
}

export type CompanyWorkQueueRow = {
  id: string
  companyId: string
  customerId: string
  source: string
  customerNumber: string | null
  customerLabel: string
  title: string
  description: string
  status: string
  priority: 'low' | 'normal' | 'high' | 'critical'
  createdAt: string | null
  href: string
  actionLabel: string
}

function normalizeWorkQueuePriority(value: unknown): CompanyWorkQueueRow['priority'] {
  const normalized = String(value ?? '').toLowerCase()
  if (normalized === 'critical' || normalized === 'high' || normalized === 'low') return normalized
  return 'normal'
}

export async function listCompanyWorkQueue(
  supabase: SupabaseClient,
  companyId: string | null | undefined,
  options: { limit?: number } = {}
): Promise<CompanyWorkQueueRow[]> {
  try {
    const limit = options.limit ?? 200
    const rpcResult = await supabase.rpc('gridex_get_work_queue', { p_company_id: companyId ?? null, p_limit: limit })
    const rows = rpcRows(rpcResult.data)
    if (rpcResult.error) return []

    return rows.map((row) => ({
      id: String(row.id),
      companyId: String(row.company_id),
      customerId: String(row.customer_id),
      source: typeof row.source === 'string' ? row.source : 'Ärende',
      customerNumber: typeof row.customer_number === 'string' ? row.customer_number : null,
      customerLabel: typeof row.customer_label === 'string' ? row.customer_label : 'Kund utan namn',
      title: typeof row.title === 'string' ? row.title : 'Åtgärd krävs',
      description: typeof row.description === 'string' ? row.description : '',
      status: typeof row.status === 'string' ? row.status : 'open',
      priority: normalizeWorkQueuePriority(row.priority),
      createdAt: typeof row.created_at === 'string' ? row.created_at : null,
      href: typeof row.href === 'string' ? row.href : `/admin/customers/${String(row.customer_id)}`,
      actionLabel: typeof row.action_label === 'string' ? row.action_label : 'Öppna',
    }))
  } catch {
    return []
  }
}
