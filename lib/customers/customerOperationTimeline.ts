import type { SupabaseClient } from '@supabase/supabase-js'

export type CustomerOperationTimelineStatus =
  | 'queued'
  | 'in_progress'
  | 'waiting_response'
  | 'response_received'
  | 'completed'
  | 'needs_review'
  | 'failed'
  | 'blocked'
  | 'skipped'
  | 'cancelled'

export type CustomerOperationTimelineRow = {
  id: string
  companyId: string
  customerId: string
  customerSiteId: string | null
  meteringPointId: string | null
  customerOperationJobId: string | null
  operationId: string | null
  eventCode: string
  title: string
  message: string
  status: CustomerOperationTimelineStatus
  severity: 'info' | 'warning' | 'error' | 'critical'
  actionRequired: boolean
  actionUrl: string | null
  source: string
  occurredAt: string
  customerName: string
  customerNumber: string | null
  customerEmail: string | null
  siteName: string | null
  siteAddress: string | null
  facilityId: string | null
  meteringPointReference: string | null
  gridOwnerName: string | null
  jobType: string | null
  jobStatus: string | null
  payload: Record<string, unknown>
}

export type CustomerOperationTimelineFilters = {
  search?: string | null
  status?: string | null
  eventGroup?: string | null
  actionRequired?: boolean | null
  dateFrom?: string | null
  dateTo?: string | null
  cursor?: string | null
  cursorId?: string | null
  limit?: number
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function missingSchema(error: unknown): boolean {
  const row = error as { code?: string; message?: string } | null
  return ['42P01', '42703', 'PGRST202', 'PGRST205'].includes(row?.code ?? '')
    || /does not exist|schema cache|could not find the function/i.test(row?.message ?? '')
}

export async function listCustomerOperationTimeline(
  supabase: SupabaseClient,
  companyId: string,
  filters: CustomerOperationTimelineFilters = {},
): Promise<CustomerOperationTimelineRow[]> {
  const { data, error } = await supabase.rpc('gridex_list_customer_operation_events', {
    p_company_id: companyId,
    p_search: text(filters.search),
    p_status: text(filters.status),
    p_event_group: text(filters.eventGroup),
    p_action_required: typeof filters.actionRequired === 'boolean' ? filters.actionRequired : null,
    p_date_from: text(filters.dateFrom),
    p_date_to: text(filters.dateTo),
    p_cursor: text(filters.cursor),
    p_cursor_id: text(filters.cursorId),
    p_limit: Math.min(Math.max(filters.limit ?? 50, 1), 100),
  })

  if (error) {
    if (missingSchema(error)) return []
    throw error
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    companyId: String(row.company_id),
    customerId: String(row.customer_id),
    customerSiteId: text(row.customer_site_id),
    meteringPointId: text(row.metering_point_id),
    customerOperationJobId: text(row.customer_operation_job_id),
    operationId: text(row.operation_id),
    eventCode: String(row.event_code),
    title: String(row.title),
    message: String(row.message),
    status: String(row.status) as CustomerOperationTimelineStatus,
    severity: String(row.severity) as CustomerOperationTimelineRow['severity'],
    actionRequired: Boolean(row.action_required),
    actionUrl: text(row.action_url),
    source: String(row.source),
    occurredAt: String(row.occurred_at),
    customerName: text(row.customer_name) ?? 'Kund utan namn',
    customerNumber: text(row.customer_number),
    customerEmail: text(row.customer_email),
    siteName: text(row.site_name),
    siteAddress: text(row.site_address),
    facilityId: text(row.facility_id),
    meteringPointReference: text(row.metering_point_reference),
    gridOwnerName: text(row.grid_owner_name),
    jobType: text(row.job_type),
    jobStatus: text(row.job_status),
    payload: record(row.payload),
  }))
}
