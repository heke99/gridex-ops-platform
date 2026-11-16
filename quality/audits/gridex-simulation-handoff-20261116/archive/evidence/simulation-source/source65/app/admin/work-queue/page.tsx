import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { listCompanyWorkQueue } from '@/lib/performance/companySummaries'
import { InvalidReadModelResponseError, readResult, type ReadResult } from '@/lib/read-models/readResult'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatStatusLabel } from '@/lib/ui/format'
import { readEdielProcessNextActions, type EdielProcessNextAction } from '@/lib/ediel/operations/processNextAction'
import { infoRequestProcessQueueState } from '@/lib/customer-operations/infoRequestProcessQueue'
import {
  OPERATION_NON_TERMINAL_STATUS_FILTER,
  isOperationActionRequired,
  operationActionStatusLabel,
  operationTypeLabel,
} from '@/lib/operations/actionableStatus'

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

function customerRows(data: unknown, companyId: string | null, requestedIds?: readonly string[]): ActiveCustomer[] {
  if (!Array.isArray(data)) throw new InvalidReadModelResponseError()
  const requested = requestedIds ? new Set(requestedIds) : null
  for (const row of data) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || typeof row.id !== 'string' || !row.id.trim()
      || typeof row.company_id !== 'string' || !row.company_id.trim()
      || (companyId !== null && row.company_id !== companyId)
      || (requested && !requested.has(row.id))) {
      throw new InvalidReadModelResponseError()
    }
  }
  return data as ActiveCustomer[]
}

function operationRows<T>(data: unknown, requestedCustomerIds?: readonly string[]): T[] {
  if (!Array.isArray(data)) throw new InvalidReadModelResponseError()
  const requested = requestedCustomerIds ? new Set(requestedCustomerIds) : null
  for (const row of data) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || typeof row.id !== 'string' || !row.id.trim()
      || typeof row.customer_id !== 'string' || !row.customer_id.trim()
      || (requested && !requested.has(row.customer_id))) {
      throw new InvalidReadModelResponseError()
    }
  }
  return data as T[]
}

type QueueItem = {
  id: string
  operationId?: string | null
  actionRequired?: boolean | null
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
  op?: 'eq' | 'in' | 'is' | 'or'
}

const HIDDEN_CUSTOMER_STATUSES = ['archived', 'deleted', 'deleted_test_only', 'pending_deletion']

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
  action_required: boolean
  severity: string
  action_url: string | null
  occurred_at: string | null
}

async function loadOperationEventActions(supabase: SupabaseClient, companyId: string | null): Promise<OperationEventActionRow[]> {
  let query = supabase
    .from('customer_operation_events')
    .select('id, customer_id, operation_id, title, message, status, action_required, severity, action_url, occurred_at')
    .eq('action_required', true)
    .order('occurred_at', { ascending: false })
    .limit(100)
  if (companyId) query = query.eq('company_id', companyId)
  const { data, error } = await query
  if (error) throw error
  return operationRows<OperationEventActionRow>(data)
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
  let query = supabase
    .from('customer_operation_jobs')
    .select('id, customer_id, operation_id, job_type, status, last_error, created_at')
    .or(OPERATION_NON_TERMINAL_STATUS_FILTER)
    .order('created_at', { ascending: false })
    .limit(100)
  if (companyId) query = query.eq('company_id', companyId)
  const { data, error } = await query
  if (error) throw error
  return operationRows<OperationJobActionRow>(data)
}

async function loadCustomersByIds(supabase: SupabaseClient, companyId: string | null, customerIds: string[]): Promise<ActiveCustomer[]> {
  if (customerIds.length === 0) return []
  const requestedIds = customerIds.slice(0, 100)
  let query = supabase
    .from('customers')
    .select('id, company_id, customer_number, full_name, first_name, last_name, company_name, email, status, source, created_at')
    .in('id', requestedIds)
  if (companyId) query = query.eq('company_id', companyId)
  const { data, error } = await query
  if (error) throw error
  return customerRows(data, companyId, requestedIds)
}

function consolidateActionItems(items: QueueItem[]): QueueItem[] {
  const byOperation = new Map<string, QueueItem>()
  for (const item of items.filter(isOperationActionRequired)) {
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


function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function dateValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function taskTypeLabel(value: unknown): string {
  return operationTypeLabel(value)
}

async function loadActiveCustomers(supabase: SupabaseClient, companyId: string | null, isPlatformAdmin: boolean): Promise<ActiveCustomer[]> {
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
  return customerRows(data, companyId)
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
    } else if (filter.op === 'or' && typeof filter.value === 'string') {
      query = query.or(filter.value)
    } else if (filter.op === 'is') {
      query = query.is(filter.column, filter.value)
    } else {
      query = query.eq(filter.column, filter.value)
    }
  }

  const { data, error } = await query
  if (error) throw error
  return operationRows<T>(data, customerIds)
}

export default async function AdminWorkQueuePage() {
  const context = await requireAdminPageKeyAccess('operations.tasks')
  const companyScope = await resolveAdminTenantReadScope(context)
  const { companyId, isPlatformAdmin } = companyScope
  const supabase = await createSupabaseServerClient()
  const readFailures: Array<Extract<ReadResult<unknown>, { kind: 'unavailable' }>> = []
  async function readRows<T>(load: () => Promise<T[]>, errorCode: string): Promise<T[]> {
    const result = await readResult(async () => {
      const rows = await load()
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
        throw new InvalidReadModelResponseError()
      }
      return rows
    }, { definitionVersion: 'work_queue_sources_v1', errorCode })
    if (result.kind === 'unavailable') {
      readFailures.push(result)
      return []
    }
    return result.data
  }
  const [dbQueueRows, operationEventRows, operationJobRows] = await Promise.all([
    readRows(() => listCompanyWorkQueue(supabase, companyId, { limit: 250 }), 'WORK_QUEUE_SUMMARY_UNAVAILABLE'),
    readRows(() => loadOperationEventActions(supabase, companyId), 'WORK_QUEUE_EVENTS_UNAVAILABLE'),
    readRows(() => loadOperationJobActions(supabase, companyId), 'WORK_QUEUE_JOBS_UNAVAILABLE'),
  ])
  const operationEventCustomers = await readRows(() => loadCustomersByIds(supabase, companyId, [...new Set([
    ...operationEventRows.map((row) => row.customer_id),
    ...operationJobRows.map((row) => row.customer_id),
  ])]), 'WORK_QUEUE_ACTION_CUSTOMERS_UNAVAILABLE')
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
      actionRequired: event.action_required,
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

  activeCustomers = await readRows(() => loadActiveCustomers(supabase, companyId, isPlatformAdmin), 'WORK_QUEUE_CUSTOMERS_UNAVAILABLE')
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
      'id, customer_id, operation_id, request_type, target_party_type, target_party_name, status, blocker_reason, notes, ediel_message_id, created_at',
      [{ column: 'status', op: 'or', value: OPERATION_NON_TERMINAL_STATUS_FILTER }],
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
      [{ column: 'status', op: 'or', value: OPERATION_NON_TERMINAL_STATUS_FILTER }],
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
  ].map(promise => readRows(() => promise, 'WORK_QUEUE_DETAILS_UNAVAILABLE')))


  for (const row of blockers) {
    const customer = customersById.get(String(row.customer_id ?? ''))
    if (!customer) continue
    items.push({
      id: String(row.id),
      source: 'Saknas',
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

  // OPS-02: waiting rows follow the native process decision of their Ediel
  // source message. An unreadable decision leaves the map empty (rows held).
  const processDecisions = new Map<string, EdielProcessNextAction>()
  const processSourceIds = infoRequests.flatMap((row) => textValue(row.ediel_message_id) ? [String(row.ediel_message_id)] : [])
  if (companyId && context.permissions.includes('communication.read') && processSourceIds.length) {
    try {
      for (let offset = 0; offset < processSourceIds.length; offset += 100) {
        for (const environment of ['test', 'production'] as const) {
          const decisions = await readEdielProcessNextActions({ companyId, actorUserId: context.userId, environment, messageIds: processSourceIds.slice(offset, offset + 100),
            evaluatedAt: new Date().toISOString(), access: { canRead: true, canReview: context.permissions.includes('cases.write'), canPrepare: false } })
          for (const [sourceId, decision] of decisions) processDecisions.set(sourceId, decision)
        }
      }
    } catch {
      processDecisions.clear()
    }
  }

  for (const row of infoRequests) {
    const customer = customersById.get(String(row.customer_id ?? ''))
    if (!customer) continue
    const target = row.target_party_type === 'current_supplier' ? 'nuvarande leverantör' : row.target_party_type === 'grid_owner' ? 'nätägare' : 'kund'
    const processState = infoRequestProcessQueueState({ status: textValue(row.status), edielMessageId: textValue(row.ediel_message_id), processDecisions })
    const status = processState?.status ?? String(row.status ?? '')
    items.push({
      id: String(row.id),
      operationId: textValue(row.operation_id),
      source: 'Uppgiftsbegäran',
      customerId: customer.id,
      customerLabel: customerLabel(customer),
      title: processState?.title ?? (isOperationActionRequired({ status }) ? 'Uppgiftsbegäran behöver åtgärd' : `Väntar på ${target}`),
      description: processState?.description ?? textValue(row.blocker_reason) ?? textValue(row.notes) ?? taskTypeLabel(row.request_type),
      status,
      priority: processState?.priority ?? (['missing_authorization', 'blocked', 'negative_aperak', 'route_missing'].includes(String(row.status)) ? 'high' : 'normal'),
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
    const status = String(row.status ?? '')
    const dispatchStatus = String(row.dispatch_status ?? '')
    const failed = status === 'failed' || dispatchStatus === 'failed'
    const reviewRequired = isOperationActionRequired({ status }) && !['draft', 'ready_to_send'].includes(status)
    const waiting = status === 'waiting_response' || dispatchStatus === 'queued' || dispatchStatus === 'sent' || Boolean(row.outbound_request_id || row.ediel_message_id)
    items.push({
      id: String(row.id),
      operationId: textValue(row.operation_id),
      source: 'Nätägaruppgifter',
      customerId: customer.id,
      customerLabel: customerLabel(customer),
      title: failed || reviewRequired ? 'Nätägarbegäran behöver granskning' : waiting ? 'Väntar på anläggningssvar' : 'Nätägarbegäran redo att skickas',
      description: textValue(row.dispatch_error_message) ?? (waiting ? 'Begäran är skickad eller köad via Ediel och svar inväntas.' : 'Begäran kan skickas via godkänd Ediel-route eller behöver manuell granskning.'),
      status: failed ? 'failed' : reviewRequired ? status : waiting ? 'waiting_response' : status,
      priority: failed || reviewRequired ? 'high' : status === 'ready_to_send' ? 'normal' : 'low',
      createdAt: dateValue(row.updated_at) ?? dateValue(row.created_at),
      href: `/admin/customers/${customer.id}?tab=data-requests`,
      actionLabel: failed ? 'Se vad som saknas' : 'Öppna kundkort',
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
  const queueRead: ReadResult<QueueItem[]> = readFailures.length === 0
    ? {
      kind: 'ready', data: sortedItems, coverage: 'complete',
      meta: { definitionVersion: 'work_queue_sources_v1', asOf: new Date().toISOString(), sourceVersion: null, buildVersion: null, freshness: 'unknown' },
    }
    : sortedItems.length > 0
      ? {
        kind: 'partial', data: sortedItems, coverage: 'partial', reasonCodes: [...new Set(readFailures.map(failure => failure.errorCode))],
        meta: { definitionVersion: 'work_queue_sources_v1', asOf: new Date().toISOString(), sourceVersion: null, buildVersion: null, freshness: 'unknown' },
      }
      : readFailures[0]
  const countsKnown = queueRead.kind === 'ready'
  const staleHint = dbQueueRows.length > 0
    ? `Arbetskön visar endast åtgärder som behöver en handläggare. Pågående och klara steg finns under Händelser.`
    : visibleCustomerCount === 0
      ? 'Arbetskön visar bara manuella åtgärder. Pågående automation och mottagna svar visas under Händelser.'
      : `${visibleCustomerCount} synliga kunder används som grund för manuella åtgärder.`

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Arbetskö"
        subtitle="Det som behöver din åtgärd. Allt som sker automatiskt syns under Händelser."
        userEmail={context.email}
        workspaceName={isPlatformAdmin ? 'Gridex Platform' : companyScope.companyName}
        workspaceMode={isPlatformAdmin ? 'platform' : 'tenant'}
      />

      <main className="space-y-4 p-4 lg:p-6">
        {countsKnown ? (
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-950 shadow-sm">
            {staleHint}
          </section>
        ) : (
          <section role="status" aria-live="polite" className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 shadow-sm">
            <h2 className="font-bold">{queueRead.kind === 'partial' ? 'Arbetskön är ofullständig' : 'Arbetskön kunde inte läsas'}</h2>
            <p>{queueRead.kind === 'partial'
              ? 'Tillgängliga ärenden visas nedan. Vi kan inte bekräfta hela arbetskön eller dess antal just nu.'
              : 'Vi kan inte bekräfta vilka ärenden som behöver åtgärdas just nu. Försök läsa arbetskön igen.'}</p>
            <p className="text-xs">Referens: {readFailures[0].traceId}</p>
            <form action="/admin/work-queue" method="get">
              <button type="submit" className="rounded-xl border border-amber-300 bg-white px-3 py-2 font-semibold">Försök igen</button>
            </form>
          </section>
        )}

        <section className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          <StatCard label="Synliga kunder" value={countsKnown ? visibleCustomerCount : null} />
          <StatCard label="Ärenden i kö" value={countsKnown ? sortedItems.length : null} />
          <StatCard label="Hög prioritet" value={countsKnown ? sortedItems.filter((item) => item.priority === 'high' || item.priority === 'critical').length : null} />
          <StatCard label="Saknar fullmakt" value={countsKnown ? sortedItems.filter((item) => item.status === 'missing_authorization' || item.title.toLowerCase().includes('fullmakt')).length : null} />
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-bold text-slate-950">Nästa åtgärder</h2>
            <p className="mt-1 text-sm text-slate-600">Visar endast nästa manuella åtgärd per pågående automatisk kedja. Historik och svar finns under Händelser.</p>
          </div>

          {sortedItems.length === 0 && !countsKnown ? (
            <div className="px-6 py-12 text-center text-slate-600">Underlaget är inte tillgängligt. Läs arbetskön igen för att kontrollera nästa åtgärder.</div>
          ) : sortedItems.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <h3 className="text-lg font-bold text-slate-950">Inga aktiva driftuppgifter hittades</h3>
              <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Det betyder att det inte finns något som behöver åtgärdas, inga uppgiftsbegäran eller leverantörsbyten kopplade till synliga kunder.
                Äldre testuppgifter och poster utan kundkoppling visas inte här.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Link href="/admin/customers" className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50">Öppna kundregister</Link>
                <Link href="/admin/customers/intake" className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800">Skapa kund</Link>
              </div>
            </div>
          ) : (
            <div className="min-w-0">
              <table className="w-full table-fixed divide-y divide-slate-200 text-sm [&_td]:min-w-0 [&_td]:break-words max-lg:[&_tbody_tr]:grid max-lg:[&_tbody_tr]:grid-cols-1 max-lg:[&_td]:px-4 max-lg:[&_td]:py-2 max-lg:[&_tbody_tr]:p-2">
                <thead className="sr-only bg-slate-50 text-left text-xs font-bold uppercase tracking-[0.14em] text-slate-600 lg:not-sr-only lg:table-header-group">
                  <tr>
                    <th className="px-4 py-3">Kund</th>
                    <th className="px-4 py-3">Ärende</th>
                    <th className="px-4 py-3">Status och prioritet</th>
                    <th className="px-4 py-3">Åtgärd</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {sortedItems.map((item) => (
                    <tr key={`${item.source}-${item.id}`} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-950">{item.customerLabel}</div>
                        <p className="mt-1 text-xs text-slate-600">{formatDate(item.createdAt)}</p>
                        <details className="mt-1 text-xs text-slate-600"><summary className="cursor-pointer">Kund-id</summary><p className="mt-1 break-all">{item.customerId}</p></details>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-800">{item.source}</div>
                        <div className="mt-1 font-semibold text-slate-900">{item.title}</div>
                        <div className="mt-1 max-w-xl text-xs leading-5 text-slate-600">{item.description}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <p>{operationActionStatusLabel(item.status)}</p>
                        <span className={`mt-2 inline-flex rounded-full border px-3 py-1 text-xs font-bold ${priorityTone(item.priority)}`}>{formatStatusLabel(item.priority)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={item.href} className="inline-flex max-w-full items-center rounded-2xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50">
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

function StatCard({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="min-w-0 break-words text-sm font-medium text-slate-700">{label}</div>
      <div aria-label={value === null ? 'Antal kan inte bekräftas' : undefined} className="text-2xl font-semibold text-slate-950">{value ?? '—'}</div>
    </div>
  )
}
