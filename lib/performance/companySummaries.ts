import type { SupabaseClient } from '@supabase/supabase-js'

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

export async function getCompanyDashboardSummary(
  supabase: SupabaseClient,
  companyId: string | null | undefined
): Promise<CompanyDashboardSummary | null> {
  if (!companyId) return null

  try {
    const { data, error } = await supabase
      .from('company_dashboard_summary_v')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle()

    if (error || !data) return null
    const row = data as RawRow

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
    const { data, error } = await supabase
      .from('company_customer_intake_queue_v')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(options.limit ?? 50)

    if (error) return []

    return ((data ?? []) as RawRow[]).map((row) => ({
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
    const { data, error } = await supabase
      .from('company_customer_list_summary_v')
      .select('*')
      .eq('company_id', companyId)
      .order('latest_activity_at', { ascending: false, nullsFirst: false })
      .limit(options.limit ?? 100)

    if (error) return []

    return ((data ?? []) as RawRow[]).map((row) => ({
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
