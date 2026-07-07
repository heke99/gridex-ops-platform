import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { isPlatformAdminContext, requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope, isMissingRelationError } from '@/lib/tenant/scope'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { listCompanyWorkQueue } from '@/lib/performance/companySummaries'
import type { SupabaseClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

type ActiveCustomer = {
  id: string
  company_id: string | null
  customer_number: string | null
  full_name: string | null
  first_name: string | null
  last_name: string | null
  company_name: string | null
  email: string | null
  status: string | null
  source: string | null
  created_at: string | null
}

type QueueItem = {
  id: string
  operationId?: string | null
  source: string
  customerId: string
  customerLabel: string
  title: string
  description: string
  status: string
  priority: 'low' | 'normal' | 'high' | 'critical'
  createdAt: string | null
  href: string
  actionLabel: string
}

type CountFilter = {
  column: string
  value: string | string[] | null
  op?: 'eq' | 'in' | 'is'
}

const HIDDEN_CUSTOMER_STATUSES = ['archived', 'deleted', 'deleted_test_only', 'pending_deletion']
const ACTIVE_TASK_STATUSES = ['open', 'new', 'pending_review', 'action_required', 'missing_authorization', 'blocked', 'route_missing', 'manual_review_required', 'failed']
const ACTION_REQUIRED_STATUSES = new Set(ACTIVE_TASK_STATUSES)

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  } catch {
    return '—'
  }
}

function customerLabel(customer: ActiveCustomer): string {
  const name =
    customer.company_name?.trim() ||
    customer.full_name?.trim() ||
    [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim() ||
    customer.email?.trim() ||
    customer.customer_number?.trim()

  return name || 'Kund utan namn'
}

function normalizePriority(value: unknown): QueueItem['priority'] {
  const normalized = String(value ?? '').toLowerCase()
  if (normalized === 'critical' || normalized === 'high' || normalized === 'low') return normalized
  return 'normal'
}

function priorityTone(priority: QueueItem['priority']) {
  if (priority === 'critical') return 'border-red-200 bg-red-50 text-red-800'
  if (priority === 'high') return 'border-amber-200 bg-amber-50 text-amber-900'
  if (priority === 'low') return 'border-slate-200 bg-slate-50 text-slate-700'
  return 'border-emerald-200 bg-emerald-50 text-emerald-800'
}

function requiresAction(item: Pick<QueueItem, 'status'>): boolean {
  return ACTION_REQUIRED_STATUSES.has(String(item.status).toLowerCase())
}

function rankPriority(priority: QueueItem['priority']) {
  return { critical: 4, high: 3, normal: 2, low: 1 }[priority]
}

type OperationEventActionRow = {
  id: string
  customer_id: string
  operation_id: string | null
  title: string
  message: string
  status: string
  severity: string
  action_url: string | null
  occurred_at: string | null
}

async function loadOperationEventActions(supabase: SupabaseClient, companyId: string | null): Promise<OperationEventActionRow[]> {
  try {
    let query = supabase
      .from('customer_operation_events')
      .select('id, customer_id, operation_id, title, message, status, severity, action_url, occurred_at')
      .eq('action_required', true)
      .order('occurred_at', { ascending: false })
      .limit(100)
    if (companyId) query = query.eq('company_id', companyId)
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as OperationEventActionRow[]
  } catch (error) {
    if (isSafeDbError(error)) return []
    throw error
  }
}

type OperationJobActionRow = {
  id: string
  customer_id: string
  operation_id: string | null
  job_type: string
  status: string
  last_error: string | null
  created_at: string | null
}

async function loadOperationJobActions(supabase: SupabaseClient, companyId: string | null): Promise<OperationJobActionRow[]> {
  try {
    let query = supabase
      .from('customer_operation_jobs')
      .select('id, customer_id, operation_id, job_type, status, last_error, created_at')
      .in('status', ['needs_review', 'failed'])
      .order('created_at', { ascending: false })
      .limit(100)
    if (companyId) query = query.eq('company_id', companyId)
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as OperationJobActionRow[]
  } catch (error) {
    if (isSafeDbError(error)) return []
    throw error
  }
}

async function loadCustomersByIds(supabase: SupabaseClient, companyId: string | null, customerIds: string[]): Promise<ActiveCustomer[]> {
  if (customerIds.length === 0) return []
  try {
    let query = supabase
      .from('customers')
      .select('id, company_id, customer_number, full_name, first_name, last_name, company_name, email, status, source, created_at')
      .in('id', customerIds.slice(0, 100))
    if (companyId) query = query.eq('company_id', companyId)
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as ActiveCustomer[]
  } catch (error) {
    if (isSafeDbError(error)) return []
    throw error
  }
}

function consolidateActionItems(items: QueueItem[]): QueueItem[] {
  const byOperation = new Map<string, QueueItem>()
  for (const item of items.filter(requiresAction)) {
    // Resources with the same operation id are one business chain. Legacy rows
    // without a correlation id stay visible rather than hiding another action.
    const key = item.operationId ? `operation:${item.operationId}` : `${item.source}:${item.id}`
    const current = byOperation.get(key)
    if (!current || rankPriority(item.priority) > rankPriority(current.priority) || new Date(item.createdAt ?? 0).getTime() > new Date(current.createdAt ?? 0).getTime()) {
      byOperation.set(key, item)
    }
  }
  return [...byOperation.values()]
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    open: 'Öppen',
    new: 'Ny',
    pending: 'Väntar',
    pending_review: 'Kräver granskning',
    action_required: 'Kräver åtgärd',
    missing_authorization: 'Saknar fullmakt',
    blocked: 'Blockerad',
    route_missing: 'Saknar route',
    manual_review_required: 'Manuell kontroll',
    failed: 'Misslyckad',
    sent: 'Skickad',
    waiting_for_z02: 'Väntar på nätägare',
    waiting_response: 'Väntar på svar',
    draft: 'Utkast',
    ready_to_send: 'Redo att skickas',
    dispatch_failed: 'Utskick misslyckades',
    waiting_grid_owner_response: 'Väntar på nätägare',
    ready: 'Redo',
    queued: 'Köad',
    submitted: 'Skickad',
    accepted: 'Accepterad',
  }
  return labels[status] ?? status
}


function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function dateValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function taskTypeLabel(value: unknown): string {
  const labels: Record<string, string> = {
    missing_power_of_attorney: 'Saknar fullmakt',
    missing_metering_point_id: 'Saknar mätpunkt',
    missing_facility_id: 'Saknar anläggnings-ID',
    missing_grid_owner: 'Saknar nätägare',
    possible_duplicate: 'Möjlig dubblett',
    customer_data_request: 'Uppgiftsbegäran',
    grid_owner_request: 'Begäran till nätägare',
    supplier_switch: 'Leverantörsbyte',
  }
  const key = String(value ?? '').trim()
  return labels[key] ?? (key.replaceAll('_', ' ') || 'Åtgärd')
}

function isSafeDbError(error: unknown): boolean {
  const code = String((error as { code?: string } | null)?.code ?? '')
  return isMissingRelationError(error) || ['42703', '42P01', 'PGRST204', 'PGRST205'].includes(code)
}

async function loadActiveCustomers(supabase: SupabaseClient, companyId: string | null, isPlatformAdmin: boolean): Promise<ActiveCustomer[]> {
  try {
    let query = supabase
      .from('customers')
      .select('id, company_id, customer_number, full_name, first_name, last_name, company_name, email, status, source, created_at')
      .not('company_id', 'is', null)
      .or('source.is.null,source.neq.ediel_portal_test')
      .or(`status.is.null,status.not.in.(${HIDDEN_CUSTOMER_STATUSES.join(',')})`)
      .order('created_at', { ascending: false })
      .limit(isPlatformAdmin ? 1000 : 500)

    if (companyId && !isPlatformAdmin) query = query.eq('company_id', companyId)

    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as ActiveCustomer[]
  } catch (error) {
    if (isSafeDbError(error)) return []
    throw error
  }
}

async function safeRows<T>(
  supabase: SupabaseClient,
  table: string,
  companyId: string | null,
  select: string,
  filters: CountFilter[],
  customerIds: string[],
  limit = 50,
): Promise<T[]> {
  if (customerIds.length === 0) return []

  try {
    let query = supabase
      .from(table)
      .select(select)
      .in('customer_id', customerIds)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (companyId) query = query.eq('company_id', companyId)
    for (const filter of filters) {
      if (filter.op === 'in') {
        query = query.in(filter.column, Array.isArray(filter.value) ? filter.value : [])
      } else if (filter.op === 'is') {
        query = query.is(filter.column, filter.value)
      } else {
        query = query.eq(filter.column, filter.value)
      }
    }

    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as T[]
  } catch (error) {
    if (isSafeDbError(error)) return []
    throw error
  }
}

export default async function AdminWorkQueuePage() {
  const context = await requireAdminPageKeyAccess('operations.tasks')
  const companyScope = await getOperationalCompanyScope(context.userId)
  const isPlatformAdmin = isPlatformAdminContext(context)
  const supabase = await createSupabaseServerClient()
  const companyId = isPlatformAdmin ? null : companyScope.companyId
  const [dbQueueRows, operationEventRows, operationJobRows] = await Promise.all([
    listCompanyWorkQueue(supabase, companyId, { limit: 250 }),
    loadOperationEventActions(supabase, companyId),
    loadOperationJobActions(supabase, companyId),
  ])
  const operationEventCustomers = await loadCustomersByIds(supabase, companyId, [...new Set([
    ...operationEventRows.map((row) => row.customer_id),
    ...operationJobRows.map((row) => row.customer_id),
  ])])
  const operationCustomersById = new Map(operationEventCustomers.map((customer) => [customer.id, customer]))
  let activeCustomers: ActiveCustomer[] = []
  const items: QueueItem[] = dbQueueRows.map((row) => ({
    id: row.id,
    source: row.source,
    customerId: row.customerId,
    customerLabel: row.customerLabel,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    createdAt: row.createdAt,
    href: row.href,
    actionLabel: row.actionLabel,
  }))

  for (const event of operationEventRows) {
    const customer = operationCustomersById.get(event.customer_id)
    if (!customer) continue
    items.push({
      id: event.id,
      operationId: event.operation_id,
      source: 'Automation',
      customerId: customer.id,
      customerLabel: customerLabel(customer),
      title: event.title,
      description: event.message,
      status: event.status,
      priority: event.severity === 'critical' ? 'critical' : event.severity === 'error' || event.severity === 'warning' ? 'high' : 'normal',
      createdAt: event.occurred_at,
      href: event.action_url ?? `/admin/customers/${customer.id}`,
      actionLabel: 'Öppna kundkort',
    })
  }

  const operationIdsWithEvent = new Set(operationEventRows.map((event) => event.operation_id).filter((value): value is string => Boolean(value)))
  for (const job of operationJobRows) {
    if (job.operation_id && operationIdsWithEvent.has(job.operation_id)) continue
    const customer = operationCustomersById.get(job.customer_id)
    if (!customer) continue
    items.push({
      id: job.id,
      operationId: job.operation_id,
      source: 'Automation',
      customerId: customer.id,
      customerLabel: customerLabel(customer),
      title: taskTypeLabel(job.job_type),
      description: job.last_error ?? 'Automationssteget behöver granskas innan kedjan kan fortsätta.',
      status: job.status,
      priority: job.status === 'failed' ? 'high' : 'normal',
      createdAt: job.created_at,
      href: `/admin/customers/${customer.id}`,
      actionLabel: 'Öppna kundkort',
    })
  }

  activeCustomers = await loadActiveCustomers(supabase, companyId, isPlatformAdmin)
    const customerIds = activeCustomers.map((customer) => customer.id)
    const customersById = new Map(activeCustomers.map((customer) => [customer.id, customer]))

    const [blockers, infoRequests, gridOwnerRequests, facilityRequests, operationTasks, switchRequests] = await Promise.all([
    safeRows<Record<string, unknown>>(
      supabase,
      'customer_blockers',
      companyId,
      'id, customer_id, blocker_type, severity, status, title, description, created_at',
      [{ column: 'status', op: 'in', value: ['open', 'pending_review', 'action_required'] }],
      customerIds,
      80,
    ),
    safeRows<Record<string, unknown>>(
      supabase,
      'customer_info_requests',
      companyId,
      'id, customer_id, operation_id, request_type, target_party_type, target_party_name, status, blocker_reason, notes, created_at',
      [{ column: 'status', op: 'in', value: ACTIVE_TASK_STATUSES }],
      customerIds,
      80,
    ),
    safeRows<Record<string, unknown>>(
      supabase,
      'grid_owner_data_requests',
      companyId,
      'id, customer_id, operation_id, request_scope, status, failure_reason, notes, created_at',
      [{ column: 'status', op: 'in', value: ['pending', 'sent', 'failed'] }],
      customerIds,
      50,
    ),
    safeRows<Record<string, unknown>>(
      supabase,
      'grid_owner_information_requests',
      companyId,
      'id, customer_id, customer_site_id, operation_id, request_type, status, dispatch_status, dispatch_error_code, dispatch_error_message, channel, outbound_request_id, ediel_message_id, created_at, updated_at',
      [{ column: 'status', op: 'in', value: [
        'draft', 'ready_to_send', 'needs_review', 'failed', 'waiting_response',
        // Manual e-mail pipeline lifecycle + persisted configuration blockers
        // must appear in the work queue, not only the Ediel statuses.
        'ready_to_send_manual_email', 'manual_email_queued', 'manual_email_sent', 'waiting_manual_response',
        'blocked_missing_poa', 'blocked_missing_grid_owner_contact', 'blocked_missing_manual_mailbox',
      ] }],
      customerIds,
      80,
    ),
    safeRows<Record<string, unknown>>(
      supabase,
      'customer_operation_tasks',
      companyId,
      'id, customer_id, task_type, status, priority, title, description, created_at',
      [{ column: 'status', op: 'in', value: ['open', 'new', 'pending', 'action_required'] }],
      customerIds,
      80,
    ),
    safeRows<Record<string, unknown>>(
      supabase,
      'supplier_switch_requests',
      companyId,
      'id, customer_id, operation_id, status, request_type, created_at',
      [{ column: 'status', op: 'in', value: ['draft', 'ready', 'queued', 'submitted', 'accepted', 'pending', 'open'] }],
      customerIds,
      50,
    ),
  ])


  for (const row of blockers) {
    const customer = customersById.get(String(row.customer_id ?? ''))
    if (!customer) continue
    items.push({
      id: String(row.id),
      source: 'Blockerare',
      customerId: customer.id,
      customerLabel: customerLabel(customer),
      title: textValue(row.title) ?? taskTypeLabel(row.blocker_type),
      description: textValue(row.description) ?? taskTypeLabel(row.blocker_type),
      status: String(row.status ?? 'open'),
      priority: normalizePriority(row.severity === 'critical' ? 'critical' : row.severity === 'warning' ? 'high' : 'normal'),
      createdAt: dateValue(row.created_at),
      href: `/admin/customers/${customer.id}`,
      actionLabel: 'Öppna kundkort',
    })
  }

  for (const row of infoRequests) {
    const customer = customersById.get(String(row.customer_id ?? ''))
    if (!customer) continue
    const target = row.target_party_type === 'current_supplier' ? 'nuvarande leverantör' : row.target_party_type === 'grid_owner' ? 'nätägare' : 'kund'
    items.push({
      id: String(row.id),
      operationId: textValue(row.operation_id),
      source: 'Uppgiftsbegäran',
      customerId: customer.id,
      customerLabel: customerLabel(customer),
      title: `Väntar på ${target}`,
      description: textValue(row.blocker_reason) ?? textValue(row.notes) ?? taskTypeLabel(row.request_type),
      status: String(row.status ?? 'pending'),
      priority: ['missing_authorization', 'blocked', 'negative_aperak', 'route_missing'].includes(String(row.status)) ? 'high' : 'normal',
      createdAt: dateValue(row.created_at),
      href: `/admin/customers/${customer.id}?tab=data-requests`,
      actionLabel: 'Öppna uppgiftsbegäran',
    })
  }

  for (const row of gridOwnerRequests) {
    const customer = customersById.get(String(row.customer_id ?? ''))
    if (!customer) continue
    items.push({
      id: String(row.id),
      operationId: textValue(row.operation_id),
      source: 'Nätägare',
      customerId: customer.id,
      customerLabel: customerLabel(customer),
      title: 'Begäran till nätägare',
      description: textValue(row.failure_reason) ?? textValue(row.notes) ?? taskTypeLabel(row.request_scope),
      status: String(row.status ?? 'pending'),
      priority: row.status === 'failed' ? 'high' : 'normal',
      createdAt: dateValue(row.created_at),
      href: `/admin/customers/${customer.id}?tab=data-requests`,
      actionLabel: 'Öppna kundkort',
    })
  }

  for (const row of facilityRequests) {
    const customer = customersById.get(String(row.customer_id ?? ''))
    if (!customer) continue
    const status = String(row.status ?? 'pending')
    const dispatchStatus = String(row.dispatch_status ?? '')
    const failed = status === 'failed' || status === 'needs_review' || dispatchStatus === 'failed'
    const waiting = status === 'waiting_response' || dispatchStatus === 'queued' || dispatchStatus === 'sent' || Boolean(row.outbound_request_id || row.ediel_message_id)
    items.push({
      id: String(row.id),
      operationId: textValue(row.operation_id),
      source: 'Nätägaruppgifter',
      customerId: customer.id,
      customerLabel: customerLabel(customer),
      title: failed ? 'Nätägarbegäran behöver granskning' : waiting ? 'Väntar på anläggningssvar' : 'Nätägarbegäran redo att skickas',
      description: textValue(row.dispatch_error_message) ?? (waiting ? 'Begäran är skickad eller köad via Ediel och svar inväntas.' : 'Begäran kan skickas via godkänd Ediel-route eller behöver manuell granskning.'),
      status: failed ? 'failed' : waiting ? 'waiting_response' : status,
      priority: failed ? 'high' : status === 'ready_to_send' ? 'normal' : 'low',
      createdAt: dateValue(row.updated_at) ?? dateValue(row.created_at),
      href: `/admin/customers/${customer.id}?tab=data-requests`,
      actionLabel: failed ? 'Granska blockerare' : 'Öppna kundkort',
    })
  }

  for (const row of operationTasks) {
    const customer = customersById.get(String(row.customer_id ?? ''))
    if (!customer) continue
    items.push({
      id: String(row.id),
      source: 'Ärende',
      customerId: customer.id,
      customerLabel: customerLabel(customer),
      title: textValue(row.title) ?? taskTypeLabel(row.task_type),
      description: textValue(row.description) ?? taskTypeLabel(row.task_type),
      status: String(row.status ?? 'open'),
      priority: normalizePriority(row.priority),
      createdAt: dateValue(row.created_at),
      href: `/admin/customers/${customer.id}`,
      actionLabel: 'Öppna kundkort',
    })
  }

  for (const row of switchRequests) {
    const customer = customersById.get(String(row.customer_id ?? ''))
    if (!customer) continue
    items.push({
      id: String(row.id),
      operationId: textValue(row.operation_id),
      source: 'Leverantörsbyte',
      customerId: customer.id,
      customerLabel: customerLabel(customer),
      title: 'Leverantörsbyte behöver uppföljning',
      description: taskTypeLabel(row.request_type),
      status: String(row.status ?? 'pending'),
      priority: ['accepted', 'ready'].includes(String(row.status)) ? 'high' : 'normal',
      createdAt: dateValue(row.created_at),
      href: `/admin/customers/${customer.id}?tab=supplier-switch`,
      actionLabel: 'Öppna leverantörsbyte',
    })
  }

  const actionItems = consolidateActionItems(items)
  const sortedItems = actionItems.sort((a, b) => {
    const byPriority = rankPriority(b.priority) - rankPriority(a.priority)
    if (byPriority !== 0) return byPriority
    return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
  })

  const visibleCustomerCount = new Set([
    ...dbQueueRows.map((row) => row.customerId),
    ...operationEventRows.map((row) => row.customer_id),
    ...operationJobRows.map((row) => row.customer_id),
    ...activeCustomers.map((customer) => customer.id),
  ].filter(Boolean)).size
  const staleHint = dbQueueRows.length > 0
    ? `Arbetskön visar endast åtgärder som behöver en handläggare. Pågående och klara steg finns under Händelser.`
    : visibleCustomerCount === 0
      ? 'Arbetskön visar bara manuella åtgärder. Pågående automation och mottagna svar visas under Händelser.'
      : `${visibleCustomerCount} synliga kunder används som grund för manuella åtgärder.`

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Arbetskö"
        subtitle="Endast blockerare och manuella uppgifter. Följ automatiska och klara steg under Händelser."
        userEmail={context.email}
        workspaceName={isPlatformAdmin ? 'Gridex Platform' : companyScope.companyName}
        workspaceMode={isPlatformAdmin ? 'platform' : 'tenant'}
      />

      <main className="space-y-6 p-6 lg:p-8">
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-sm font-semibold text-emerald-950 shadow-sm">
          {staleHint}
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          <StatCard label="Synliga kunder" value={visibleCustomerCount} />
          <StatCard label="Ärenden i kö" value={sortedItems.length} />
          <StatCard label="Hög prioritet" value={sortedItems.filter((item) => item.priority === 'high' || item.priority === 'critical').length} />
          <StatCard label="Saknar fullmakt" value={sortedItems.filter((item) => item.status === 'missing_authorization' || item.title.toLowerCase().includes('fullmakt')).length} />
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-bold text-slate-950">Nästa åtgärder</h2>
            <p className="mt-1 text-sm text-slate-600">Visar endast nästa manuella åtgärd per pågående automatisk kedja. Historik och svar finns under Händelser.</p>
          </div>

          {sortedItems.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <h3 className="text-lg font-bold text-slate-950">Inga aktiva driftuppgifter hittades</h3>
              <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Det betyder att det inte finns öppna blockerare, uppgiftsbegäran eller leverantörsbyten kopplade till synliga kunder.
                Gamla testdata och orphans visas inte här.
              </p>
              <div className="mt-6 flex justify-center gap-3">
                <Link href="/admin/customers" className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50">Öppna kundregister</Link>
                <Link href="/admin/customers/intake" className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800">Skapa kund</Link>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                  <tr>
                    <th className="px-6 py-4">Kund</th>
                    <th className="px-6 py-4">Ärende</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Prioritet</th>
                    <th className="px-6 py-4">Skapad</th>
                    <th className="px-6 py-4">Åtgärd</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {sortedItems.map((item) => (
                    <tr key={`${item.source}-${item.id}`} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-950">{item.customerLabel}</div>
                        <div className="mt-1 text-xs text-slate-500">{item.customerId}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-800">{item.source}</div>
                        <div className="mt-1 font-semibold text-slate-900">{item.title}</div>
                        <div className="mt-1 max-w-xl text-xs leading-5 text-slate-600">{item.description}</div>
                      </td>
                      <td className="px-6 py-4 text-slate-700">{statusLabel(item.status)}</td>
                      <td className="px-6 py-4">
                        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${priorityTone(item.priority)}`}>{item.priority}</span>
                      </td>
                      <td className="px-6 py-4 text-slate-700">{formatDate(item.createdAt)}</td>
                      <td className="px-6 py-4">
                        <Link href={item.href} className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50">
                          {item.actionLabel}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-bold text-slate-700">{label}</div>
      <div className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</div>
    </div>
  )
}
