import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { createCustomerAction } from './actions'
import { initialIntakeActionState } from './actionState'
import {
  listCustomersPage,
  type CustomerListRow,
  type CustomerStatusFilter,
} from '@/lib/customers/getCustomers'
import { supabaseService } from '@/lib/supabase/service'
import { getSwitchLifecycle } from '@/lib/operations/controlTower'
import {
  listLatestCustomerContractsByCustomerIds,
  type LatestCustomerContractSummary,
} from '@/lib/customer-contracts/db'
import type { CustomerSiteRow } from '@/lib/masterdata/types'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'
import type { OutboundRequestRow } from '@/lib/cis/types'
import type { CustomerContractRow } from '@/lib/customer-contracts/types'

export const dynamic = 'force-dynamic'

type CustomersPageProps = {
  searchParams: Promise<{
    q?: string
    ops?: string
    status?: string
    contract?: string
    page?: string
  }>
}

type CustomerOperationsSummary = {
  blocked: number
  queuedForOutbound: number
  awaitingDispatch: number
  awaitingResponse: number
  readyToExecute: number
  failed: number
  completed: number
  activeOpen: number
  primaryLabel: string
  primaryHref: string
  primaryTone: string
  primaryDescription: string
  priorityRank: number
  priorityLabel: string
}

type CustomerWithOperations = CustomerListRow & {
  operations: CustomerOperationsSummary
}

type OperationsFilterKey =
  | 'all'
  | 'blocked'
  | 'ready_to_execute'
  | 'awaiting_response'
  | 'awaiting_dispatch'
  | 'queued_for_outbound'
  | 'failed'
  | 'active_open'
  | 'no_signal'

type ContractFilterKey =
  | 'all'
  | 'none'
  | 'pending_signature'
  | 'signed'
  | 'active'
  | 'closed'

const PAGE_SIZE = 100

function StatusBadge({ status }: { status: string | null }) {
  const styles: Record<string, string> = {
    active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    draft: 'border-amber-200 bg-amber-50 text-amber-700',
    pending_verification: 'border-blue-200 bg-blue-50 text-blue-700',
    inactive: 'border-slate-200 bg-slate-50 text-slate-700',
    moved: 'border-purple-200 bg-purple-50 text-purple-700',
    terminated: 'border-rose-200 bg-rose-50 text-rose-700',
    blocked: 'border-rose-200 bg-rose-50 text-rose-700',
  }

  const safeStatus = status ?? 'unknown'

  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${
        styles[safeStatus] ?? 'border-slate-200 bg-slate-50 text-slate-700'
      }`}
    >
      {status ?? 'okänd'}
    </span>
  )
}

function lifecycleTone(stage: string): string {
  if (['ready_to_execute', 'completed'].includes(stage)) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }

  if (['blocked', 'failed'].includes(stage)) {
    return 'border-rose-200 bg-rose-50 text-rose-700'
  }

  if (['awaiting_response'].includes(stage)) {
    return 'border-blue-200 bg-blue-50 text-blue-700'
  }

  return 'border-amber-200 bg-amber-50 text-amber-700'
}

function priorityTone(rank: number): string {
  if (rank === 1) return 'border-rose-200 bg-rose-50 text-rose-700'
  if (rank === 2) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (rank === 3) return 'border-blue-200 bg-blue-50 text-blue-700'
  if (rank <= 5) return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function requestSortTime(request: SupplierSwitchRequestRow): number {
  return new Date(
    request.completed_at ??
      request.failed_at ??
      request.submitted_at ??
      request.created_at
  ).getTime()
}

function outboundSortTime(outbound: OutboundRequestRow): number {
  return new Date(
    outbound.acknowledged_at ??
      outbound.failed_at ??
      outbound.sent_at ??
      outbound.prepared_at ??
      outbound.queued_at ??
      outbound.created_at
  ).getTime()
}

function getLatestOutboundForRequest(
  requestId: string,
  outboundRequests: OutboundRequestRow[]
): OutboundRequestRow | null {
  const rows = outboundRequests
    .filter(
      (row) =>
        row.request_type === 'supplier_switch' &&
        row.source_type === 'supplier_switch_request' &&
        row.source_id === requestId
    )
    .sort((a, b) => outboundSortTime(b) - outboundSortTime(a))

  return rows[0] ?? null
}

function buildCustomerOperationsSummary(params: {
  customerId: string
  sites: CustomerSiteRow[]
  switchRequests: SupplierSwitchRequestRow[]
  outboundRequests: OutboundRequestRow[]
}): CustomerOperationsSummary {
  const { customerId, sites, switchRequests, outboundRequests } = params

  const latestRequestsBySite = sites
    .filter((site) => site.customer_id === customerId)
    .map((site) => {
      const requestsForSite = switchRequests
        .filter((request) => request.site_id === site.id)
        .sort((a, b) => requestSortTime(b) - requestSortTime(a))

      return requestsForSite[0] ?? null
    })
    .filter((request): request is SupplierSwitchRequestRow => Boolean(request))

  let blocked = 0
  let queuedForOutbound = 0
  let awaitingDispatch = 0
  let awaitingResponse = 0
  let readyToExecute = 0
  let failed = 0
  let completed = 0

  for (const request of latestRequestsBySite) {
    const outbound = getLatestOutboundForRequest(request.id, outboundRequests)

    const lifecycle = getSwitchLifecycle({
      request,
      readiness: null,
      outboundRequest: outbound,
    })

    switch (lifecycle.stage) {
      case 'blocked':
        blocked += 1
        break
      case 'queued_for_outbound':
        queuedForOutbound += 1
        break
      case 'awaiting_dispatch':
        awaitingDispatch += 1
        break
      case 'awaiting_response':
        awaitingResponse += 1
        break
      case 'ready_to_execute':
        readyToExecute += 1
        break
      case 'failed':
        failed += 1
        break
      case 'completed':
        completed += 1
        break
      default:
        break
    }
  }

  const activeOpen =
    blocked +
    queuedForOutbound +
    awaitingDispatch +
    awaitingResponse +
    readyToExecute +
    failed

  if (blocked > 0) {
    return {
      blocked,
      queuedForOutbound,
      awaitingDispatch,
      awaitingResponse,
      readyToExecute,
      failed,
      completed,
      activeOpen,
      primaryLabel: 'Blockerad',
      primaryHref: `/admin/customers/${customerId}#switch-operations`,
      primaryTone: lifecycleTone('blocked'),
      primaryDescription:
        'Minst en site har blockerare och bör öppnas från kundkortet först.',
      priorityRank: 1,
      priorityLabel: 'Högst prioritet',
    }
  }

  if (readyToExecute > 0) {
    return {
      blocked,
      queuedForOutbound,
      awaitingDispatch,
      awaitingResponse,
      readyToExecute,
      failed,
      completed,
      activeOpen,
      primaryLabel: 'Redo att slutföra',
      primaryHref: '/admin/operations/ready-to-execute',
      primaryTone: lifecycleTone('ready_to_execute'),
      primaryDescription:
        'Det finns acknowledged switchar som kan finaliseras nu.',
      priorityRank: 2,
      priorityLabel: 'Slutför nu',
    }
  }

  if (awaitingResponse > 0) {
    return {
      blocked,
      queuedForOutbound,
      awaitingDispatch,
      awaitingResponse,
      readyToExecute,
      failed,
      completed,
      activeOpen,
      primaryLabel: 'Väntar kvittens',
      primaryHref: '/admin/operations/switches?stage=awaiting_response',
      primaryTone: lifecycleTone('awaiting_response'),
      primaryDescription:
        'Minst en switch väntar på extern återkoppling.',
      priorityRank: 3,
      priorityLabel: 'Följ upp svar',
    }
  }

  if (awaitingDispatch > 0) {
    return {
      blocked,
      queuedForOutbound,
      awaitingDispatch,
      awaitingResponse,
      readyToExecute,
      failed,
      completed,
      activeOpen,
      primaryLabel: 'Väntar dispatch',
      primaryHref: '/admin/operations/switches?stage=awaiting_dispatch',
      primaryTone: lifecycleTone('awaiting_dispatch'),
      primaryDescription:
        'Outbound finns men dispatchkedjan är inte färdig.',
      priorityRank: 4,
      priorityLabel: 'Dispatch pågår',
    }
  }

  if (queuedForOutbound > 0) {
    return {
      blocked,
      queuedForOutbound,
      awaitingDispatch,
      awaitingResponse,
      readyToExecute,
      failed,
      completed,
      activeOpen,
      primaryLabel: 'Saknar outbound',
      primaryHref: '/admin/operations/switches?stage=queued_for_outbound',
      primaryTone: lifecycleTone('queued_for_outbound'),
      primaryDescription:
        'Minst en switch saknar dispatchpost och behöver köas eller felsökas.',
      priorityRank: 5,
      priorityLabel: 'Köa outbound',
    }
  }

  if (failed > 0) {
    return {
      blocked,
      queuedForOutbound,
      awaitingDispatch,
      awaitingResponse,
      readyToExecute,
      failed,
      completed,
      activeOpen,
      primaryLabel: 'Failed / rejected',
      primaryHref: '/admin/operations/switches?stage=failed',
      primaryTone: lifecycleTone('failed'),
      primaryDescription:
        'Det finns ärenden som brutit flödet och kräver manuell bedömning.',
      priorityRank: 6,
      priorityLabel: 'Kräver beslut',
    }
  }

  return {
    blocked,
    queuedForOutbound,
    awaitingDispatch,
    awaitingResponse,
    readyToExecute,
    failed,
    completed,
    activeOpen,
    primaryLabel: completed > 0 ? 'Historik finns' : 'Ingen aktiv switchsignal',
    primaryHref:
      completed > 0
        ? `/admin/customers/${customerId}#switch-operations`
        : `/admin/customers/${customerId}`,
    primaryTone: lifecycleTone(completed > 0 ? 'completed' : 'queued_for_outbound'),
    primaryDescription:
      completed > 0
        ? 'Kunden har switchhistorik men inget som sticker ut operativt just nu.'
        : 'Ingen tydlig aktiv switchkedja hittades för kunden ännu.',
    priorityRank: completed > 0 ? 7 : 8,
    priorityLabel: completed > 0 ? 'Låg prioritet' : 'Ingen signal',
  }
}

function sortCustomersByOperations(customers: CustomerWithOperations[]): CustomerWithOperations[] {
  return [...customers].sort((a, b) => {
    if (a.operations.priorityRank !== b.operations.priorityRank) {
      return a.operations.priorityRank - b.operations.priorityRank
    }

    if (a.operations.activeOpen !== b.operations.activeOpen) {
      return b.operations.activeOpen - a.operations.activeOpen
    }

    if (a.site_count !== b.site_count) {
      return b.site_count - a.site_count
    }

    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

function normalizeOperationsFilter(value: string | undefined): OperationsFilterKey {
  switch (value) {
    case 'blocked':
    case 'ready_to_execute':
    case 'awaiting_response':
    case 'awaiting_dispatch':
    case 'queued_for_outbound':
    case 'failed':
    case 'active_open':
    case 'no_signal':
      return value
    default:
      return 'all'
  }
}

function normalizeStatusFilter(value: string | undefined): CustomerStatusFilter {
  switch (value) {
    case 'draft':
    case 'pending_verification':
    case 'active':
    case 'inactive':
    case 'moved':
    case 'terminated':
    case 'blocked':
      return value
    default:
      return 'all'
  }
}

function normalizeContractFilter(value: string | undefined): ContractFilterKey {
  switch (value) {
    case 'none':
    case 'pending_signature':
    case 'signed':
    case 'active':
    case 'closed':
      return value
    default:
      return 'all'
  }
}

function normalizePage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '1', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function matchesOperationsFilter(
  operations: CustomerOperationsSummary,
  filter: OperationsFilterKey
): boolean {
  switch (filter) {
    case 'blocked':
      return operations.blocked > 0
    case 'ready_to_execute':
      return operations.readyToExecute > 0
    case 'awaiting_response':
      return operations.awaitingResponse > 0
    case 'awaiting_dispatch':
      return operations.awaitingDispatch > 0
    case 'queued_for_outbound':
      return operations.queuedForOutbound > 0
    case 'failed':
      return operations.failed > 0
    case 'active_open':
      return operations.activeOpen > 0
    case 'no_signal':
      return operations.activeOpen === 0
    case 'all':
    default:
      return true
  }
}

function matchesContractFilter(
  latestContract: LatestCustomerContractSummary,
  filter: ContractFilterKey
): boolean {
  if (filter === 'all') return true
  if (filter === 'none') return latestContract === null

  if (!latestContract) return false

  if (filter === 'pending_signature') {
    return latestContract.status === 'pending_signature'
  }

  if (filter === 'signed') {
    return latestContract.status === 'signed'
  }

  if (filter === 'active') {
    return latestContract.status === 'active'
  }

  if (filter === 'closed') {
    return ['terminated', 'cancelled', 'expired'].includes(latestContract.status)
  }

  return true
}

function buildCustomersHref(params: {
  q: string
  ops: OperationsFilterKey
  status: CustomerStatusFilter
  contract: ContractFilterKey
  page: number
}): string {
  const searchParams = new URLSearchParams()

  if (params.q.trim()) {
    searchParams.set('q', params.q.trim())
  }

  if (params.ops !== 'all') {
    searchParams.set('ops', params.ops)
  }

  if (params.status !== 'all') {
    searchParams.set('status', params.status)
  }

  if (params.contract !== 'all') {
    searchParams.set('contract', params.contract)
  }

  if (params.page > 1) {
    searchParams.set('page', String(params.page))
  }

  const queryString = searchParams.toString()
  return queryString ? `/admin/customers?${queryString}` : '/admin/customers'
}

function FilterChip({
  label,
  count,
  href,
  active,
  tone = 'default',
}: {
  label: string
  count: number
  href: string
  active: boolean
  tone?: 'default' | 'danger' | 'success' | 'info' | 'warning'
}) {
  const toneClass =
    tone === 'danger'
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : tone === 'success'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : tone === 'info'
          ? 'border-blue-200 bg-blue-50 text-blue-700'
          : tone === 'warning'
            ? 'border-amber-200 bg-amber-50 text-amber-700'
            : 'border-slate-200 bg-slate-50 text-slate-700'

  const activeClass = active
    ? 'ring-2 ring-slate-300 dark:ring-slate-600'
    : ''

  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition hover:opacity-90 ${toneClass} ${activeClass}`}
    >
      <span>{label}</span>
      <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs dark:bg-slate-900/40">
        {count}
      </span>
    </Link>
  )
}

function PaginationLink({
  label,
  href,
  disabled = false,
  active = false,
}: {
  label: string
  href: string
  disabled?: boolean
  active?: boolean
}) {
  if (disabled) {
    return (
      <span className="inline-flex items-center rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-400 dark:border-slate-700">
        {label}
      </span>
    )
  }

  return (
    <Link
      href={href}
      className={`inline-flex items-center rounded-xl border px-3 py-2 text-sm font-medium ${
        active
          ? 'border-slate-950 bg-slate-950 text-white dark:border-white dark:bg-white dark:text-slate-950'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
      }`}
    >
      {label}
    </Link>
  )
}

function filterLabel(filter: OperationsFilterKey): string {
  switch (filter) {
    case 'blocked':
      return 'blockerade kunder'
    case 'ready_to_execute':
      return 'redo-att-slutföra-kunder'
    case 'awaiting_response':
      return 'kunder som väntar på svar'
    case 'awaiting_dispatch':
      return 'kunder som väntar på dispatch'
    case 'queued_for_outbound':
      return 'kunder som saknar outbound'
    case 'failed':
      return 'kunder med failed/rejected'
    case 'active_open':
      return 'kunder med aktiv operationssignal'
    case 'no_signal':
      return 'kunder utan aktiv signal'
    case 'all':
    default:
      return 'alla kunder'
  }
}

function contractFilterLabel(filter: ContractFilterKey): string {
  switch (filter) {
    case 'none':
      return 'utan avtal'
    case 'pending_signature':
      return 'väntar signering'
    case 'signed':
      return 'signerat'
    case 'active':
      return 'aktivt avtal'
    case 'closed':
      return 'avslutat avtal'
    case 'all':
    default:
      return 'alla avtal'
  }
}

function customerDisplayName(customer: CustomerWithOperations): string {
  const combinedName = [customer.first_name, customer.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()

  return customer.full_name ?? customer.company_name ?? (combinedName || 'Namnlös kund')
}

function customerTypeLabel(value: string | null): string {
  if (value === 'business') return 'Företag'
  if (value === 'association') return 'Förening'
  return 'Privat'
}

function customerStatusLabel(value: string | null): string {
  switch (value) {
    case 'draft':
      return 'Draft'
    case 'pending_verification':
      return 'Väntar verifiering'
    case 'active':
      return 'Aktiv'
    case 'inactive':
      return 'Inaktiv'
    case 'moved':
      return 'Flyttad'
    case 'terminated':
      return 'Avslutad'
    case 'blocked':
      return 'Blockerad'
    default:
      return value ?? 'Okänd'
  }
}

function contractStatusLabel(value: CustomerContractRow['status']): string {
  switch (value) {
    case 'draft':
      return 'Draft'
    case 'pending_signature':
      return 'Väntar signering'
    case 'signed':
      return 'Signerat'
    case 'active':
      return 'Aktivt'
    case 'terminated':
      return 'Avslutat'
    case 'cancelled':
      return 'Avbrutet'
    case 'expired':
      return 'Utgånget'
    default:
      return value
  }
}

function contractTypeLabel(value: CustomerContractRow['contract_type']): string {
  switch (value) {
    case 'fixed':
      return 'Fast'
    case 'variable_monthly':
      return 'Rörlig månad'
    case 'variable_hourly':
      return 'Rörlig tim'
    case 'portfolio':
      return 'Portfölj'
    default:
      return value
  }
}

function contractStatusTone(value: CustomerContractRow['status']): string {
  switch (value) {
    case 'active':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700'
    case 'signed':
      return 'border-blue-200 bg-blue-50 text-blue-700'
    case 'pending_signature':
      return 'border-amber-200 bg-amber-50 text-amber-700'
    case 'terminated':
    case 'cancelled':
    case 'expired':
      return 'border-rose-200 bg-rose-50 text-rose-700'
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700'
  }
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'

  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
  }).format(new Date(value))
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'

  return new Intl.NumberFormat('sv-SE', {
    style: 'currency',
    currency: 'SEK',
    maximumFractionDigits: 0,
  }).format(value)
}

async function createCustomerFromCustomersPage(formData: FormData) {
  'use server'
  await createCustomerAction(initialIntakeActionState, formData)
}

export default async function AdminCustomersPage({
  searchParams,
}: CustomersPageProps) {
  await requirePermissionServer('masterdata.read')

  const resolvedSearchParams = await searchParams
  const query = (resolvedSearchParams.q ?? '').trim()
  const opsFilter = normalizeOperationsFilter(resolvedSearchParams.ops)
  const statusFilter = normalizeStatusFilter(resolvedSearchParams.status)
  const contractFilter = normalizeContractFilter(resolvedSearchParams.contract)
  const page = normalizePage(resolvedSearchParams.page)

  const pageResult = await listCustomersPage({
    query,
    page,
    pageSize: PAGE_SIZE,
    status: statusFilter,
  })

  const customers = pageResult.rows

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const customerIds = customers.map((customer) => customer.id)

  const [sitesQuery, switchRequestsQuery, outboundRequestsQuery, latestContractsByCustomerId] =
    customerIds.length > 0
      ? await Promise.all([
          supabaseService
            .from('customer_sites')
            .select('*')
            .in('customer_id', customerIds),
          supabaseService
            .from('supplier_switch_requests')
            .select('*')
            .in('customer_id', customerIds),
          supabaseService
            .from('outbound_requests')
            .select('*')
            .eq('request_type', 'supplier_switch')
            .in('customer_id', customerIds),
          listLatestCustomerContractsByCustomerIds(customerIds),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
          new Map<string, LatestCustomerContractSummary>(),
        ]

  if (sitesQuery.error) throw sitesQuery.error
  if (switchRequestsQuery.error) throw switchRequestsQuery.error
  if (outboundRequestsQuery.error) throw outboundRequestsQuery.error

  const sites = (sitesQuery.data ?? []) as CustomerSiteRow[]
  const switchRequests =
    (switchRequestsQuery.data ?? []) as SupplierSwitchRequestRow[]
  const outboundRequests =
    (outboundRequestsQuery.data ?? []) as OutboundRequestRow[]

  const customersWithOperations: CustomerWithOperations[] = customers.map(
    (customer) => ({
      ...customer,
      operations: buildCustomerOperationsSummary({
        customerId: customer.id,
        sites,
        switchRequests,
        outboundRequests,
      }),
    })
  )

  const sortedCustomers = sortCustomersByOperations(customersWithOperations)

  const customersMatchingOps = sortedCustomers.filter((customer) =>
    matchesOperationsFilter(customer.operations, opsFilter)
  )

  const filteredCustomers = customersMatchingOps.filter((customer) =>
    matchesContractFilter(latestContractsByCustomerId.get(customer.id) ?? null, contractFilter)
  )

  const blockedCustomers = sortedCustomers.filter(
    (customer) => customer.operations.blocked > 0
  ).length

  const readyToExecuteCustomers = sortedCustomers.filter(
    (customer) => customer.operations.readyToExecute > 0
  ).length

  const awaitingResponseCustomers = sortedCustomers.filter(
    (customer) => customer.operations.awaitingResponse > 0
  ).length

  const awaitingDispatchCustomers = sortedCustomers.filter(
    (customer) => customer.operations.awaitingDispatch > 0
  ).length

  const queuedForOutboundCustomers = sortedCustomers.filter(
    (customer) => customer.operations.queuedForOutbound > 0
  ).length

  const failedCustomers = sortedCustomers.filter(
    (customer) => customer.operations.failed > 0
  ).length

  const activeOperationsCustomers = sortedCustomers.filter(
    (customer) => customer.operations.activeOpen > 0
  ).length

  const noSignalCustomers = sortedCustomers.filter(
    (customer) => customer.operations.activeOpen === 0
  ).length

  const latestContracts = Array.from(latestContractsByCustomerId.values())
  const noContractCustomers = customersMatchingOps.filter(
    (customer) => !latestContractsByCustomerId.get(customer.id)
  ).length
  const pendingSignatureContractsOnPage = latestContracts.filter(
    (row) => row?.status === 'pending_signature'
  ).length
  const signedContractsOnPage = latestContracts.filter((row) => row?.status === 'signed').length
  const activeContractsOnPage = latestContracts.filter((row) => row?.status === 'active').length
  const closedContractsOnPage = latestContracts.filter((row) =>
    row ? ['terminated', 'cancelled', 'expired'].includes(row.status) : false
  ).length

  const showingFrom =
    pageResult.total === 0 ? 0 : (pageResult.page - 1) * pageResult.pageSize + 1
  const showingTo = Math.min(pageResult.page * pageResult.pageSize, pageResult.total)

  const pageNumbers: number[] = []
  const startPage = Math.max(1, pageResult.page - 2)
  const endPage = Math.min(pageResult.totalPages, pageResult.page + 2)

  for (let current = startPage; current <= endPage; current += 1) {
    pageNumbers.push(current)
  }

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Kunder"
        subtitle="Grundregister för privat- och företagskunder, nu med operationsfilter, kundstatusfilter, avtalsfilter, avtalssnabbvy och pagination."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/customers/intake"
            className="inline-flex items-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950"
          >
            Kundintag / bulkimport
          </Link>

          <Link
            href="/admin/contracts"
            className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Avtalskatalog
          </Link>
        </div>

        <section className="grid gap-4 xl:grid-cols-5">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Matchande kunder
            </div>
            <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
              {pageResult.total}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Sida {pageResult.page} av {pageResult.totalPages}. Visar {showingFrom}-{showingTo}.
            </div>
          </div>

          <div className="rounded-3xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-sm dark:border-emerald-900/50 dark:bg-emerald-950/10">
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Aktiva kunder
            </div>
            <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
              {pageResult.counts.active}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Kundstatus = active
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Inaktiva kunder
            </div>
            <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
              {pageResult.counts.inactive}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Kundstatus = inactive
            </div>
          </div>

          <div className="rounded-3xl border border-blue-200 bg-blue-50/60 p-6 shadow-sm dark:border-blue-900/50 dark:bg-blue-950/10">
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Aktivt avtal på sidan
            </div>
            <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
              {activeContractsOnPage}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Signerade: {signedContractsOnPage} · Väntar signering: {pendingSignatureContractsOnPage}
            </div>
          </div>

          <div className="rounded-3xl border border-blue-200 bg-blue-50/60 p-6 shadow-sm dark:border-blue-900/50 dark:bg-blue-950/10">
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Aktiv operationsuppföljning på sidan
            </div>
            <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
              {activeOperationsCustomers}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Väntar svar: {awaitingResponseCustomers} · Väntar dispatch: {awaitingDispatchCustomers}
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
              Ny kund
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Skapa kundpost innan avtal, fullmakt och anläggning kopplas. För full kundregistrering med avtal, nätägare och bulkimport använder du Kundintag.
            </p>

            <form action={createCustomerFromCustomersPage} className="mt-6 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Kundtyp
                </label>
                <select
                  name="customerType"
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  defaultValue="private"
                >
                  <option value="private">Privat</option>
                  <option value="business">Företag</option>
                </select>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                    Förnamn
                  </label>
                  <input
                    name="firstName"
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                    Efternamn
                  </label>
                  <input
                    name="lastName"
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Företagsnamn
                </label>
                <input
                  name="companyName"
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                    Personnummer
                  </label>
                  <input
                    name="personalNumber"
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                    Org.nr
                  </label>
                  <input
                    name="orgNumber"
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  E-post
                </label>
                <input
                  name="email"
                  type="email"
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Telefon
                </label>
                <input
                  name="phone"
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>

              <button className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
                Skapa kund
              </button>
            </form>
          </section>

          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                    Kundregister
                  </h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Totalt {pageResult.total} kunder
                    {query ? ` för sökning "${query}"` : ''}
                    {statusFilter !== 'all' ? ` med kundstatus "${customerStatusLabel(statusFilter)}"` : ''}
                    {contractFilter !== 'all' ? ` i avtalsfiltret "${contractFilterLabel(contractFilter)}"` : ''}
                    {opsFilter !== 'all' ? ` i operationsfiltret "${filterLabel(opsFilter)}"` : ''}.
                  </p>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Sorteras automatiskt efter operationsprioritet på sidan: blockerad → redo att slutföra → väntar svar → väntar dispatch → saknar outbound → failed → övriga.
                  </p>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Sökningen stöder kundnummer, personnummer, namn, efternamn, e-post, telefon, anläggning och mätpunkts-id.
                  </p>
                </div>

                <form method="get" className="flex w-full flex-wrap gap-3 lg:max-w-4xl">
                  <input type="hidden" name="ops" value={opsFilter === 'all' ? '' : opsFilter} />
                  <input
                    name="q"
                    defaultValue={query}
                    placeholder="Sök på kundnummer, personnummer, namn, e-post, anläggning eller mätpunkts-id"
                    className="h-11 min-w-[240px] flex-1 rounded-2xl border border-slate-300 px-4 text-sm outline-none transition focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                  <select
                    name="status"
                    defaultValue={statusFilter}
                    className="h-11 rounded-2xl border border-slate-300 px-4 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="all">Alla kundstatusar</option>
                    <option value="draft">Draft</option>
                    <option value="pending_verification">Väntar verifiering</option>
                    <option value="active">Aktiv</option>
                    <option value="inactive">Inaktiv</option>
                    <option value="moved">Flyttad</option>
                    <option value="terminated">Avslutad</option>
                    <option value="blocked">Blockerad</option>
                  </select>
                  <select
                    name="contract"
                    defaultValue={contractFilter}
                    className="h-11 rounded-2xl border border-slate-300 px-4 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="all">Alla avtalslägen</option>
                    <option value="none">Utan avtal</option>
                    <option value="pending_signature">Väntar signering</option>
                    <option value="signed">Signerat</option>
                    <option value="active">Aktivt avtal</option>
                    <option value="closed">Avslutat avtal</option>
                  </select>
                  <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
                    Sök
                  </button>
                  {query || opsFilter !== 'all' || statusFilter !== 'all' || contractFilter !== 'all' ? (
                    <Link
                      href="/admin/customers"
                      className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Rensa
                    </Link>
                  ) : null}
                </form>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <FilterChip
                  label="Alla kunder"
                  count={pageResult.counts.all}
                  href={buildCustomersHref({ q: query, ops: opsFilter, status: 'all', contract: contractFilter, page: 1 })}
                  active={statusFilter === 'all'}
                />
                <FilterChip
                  label="Draft"
                  count={pageResult.counts.draft}
                  href={buildCustomersHref({ q: query, ops: opsFilter, status: 'draft', contract: contractFilter, page: 1 })}
                  active={statusFilter === 'draft'}
                  tone="warning"
                />
                <FilterChip
                  label="Väntar verifiering"
                  count={pageResult.counts.pending_verification}
                  href={buildCustomersHref({
                    q: query,
                    ops: opsFilter,
                    status: 'pending_verification',
                    contract: contractFilter,
                    page: 1,
                  })}
                  active={statusFilter === 'pending_verification'}
                  tone="info"
                />
                <FilterChip
                  label="Aktiva"
                  count={pageResult.counts.active}
                  href={buildCustomersHref({ q: query, ops: opsFilter, status: 'active', contract: contractFilter, page: 1 })}
                  active={statusFilter === 'active'}
                  tone="success"
                />
                <FilterChip
                  label="Inaktiva"
                  count={pageResult.counts.inactive}
                  href={buildCustomersHref({ q: query, ops: opsFilter, status: 'inactive', contract: contractFilter, page: 1 })}
                  active={statusFilter === 'inactive'}
                />
                <FilterChip
                  label="Flyttade"
                  count={pageResult.counts.moved}
                  href={buildCustomersHref({ q: query, ops: opsFilter, status: 'moved', contract: contractFilter, page: 1 })}
                  active={statusFilter === 'moved'}
                />
                <FilterChip
                  label="Avslutade"
                  count={pageResult.counts.terminated}
                  href={buildCustomersHref({
                    q: query,
                    ops: opsFilter,
                    status: 'terminated',
                    contract: contractFilter,
                    page: 1,
                  })}
                  active={statusFilter === 'terminated'}
                  tone="danger"
                />
                <FilterChip
                  label="Blockerade"
                  count={pageResult.counts.blocked}
                  href={buildCustomersHref({
                    q: query,
                    ops: opsFilter,
                    status: 'blocked',
                    contract: contractFilter,
                    page: 1,
                  })}
                  active={statusFilter === 'blocked'}
                  tone="danger"
                />
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <FilterChip
                  label="Alla avtal"
                  count={customersMatchingOps.length}
                  href={buildCustomersHref({
                    q: query,
                    ops: opsFilter,
                    status: statusFilter,
                    contract: 'all',
                    page: pageResult.page,
                  })}
                  active={contractFilter === 'all'}
                />
                <FilterChip
                  label="Utan avtal"
                  count={noContractCustomers}
                  href={buildCustomersHref({
                    q: query,
                    ops: opsFilter,
                    status: statusFilter,
                    contract: 'none',
                    page: pageResult.page,
                  })}
                  active={contractFilter === 'none'}
                />
                <FilterChip
                  label="Väntar signering"
                  count={pendingSignatureContractsOnPage}
                  href={buildCustomersHref({
                    q: query,
                    ops: opsFilter,
                    status: statusFilter,
                    contract: 'pending_signature',
                    page: pageResult.page,
                  })}
                  active={contractFilter === 'pending_signature'}
                  tone="warning"
                />
                <FilterChip
                  label="Signerat"
                  count={signedContractsOnPage}
                  href={buildCustomersHref({
                    q: query,
                    ops: opsFilter,
                    status: statusFilter,
                    contract: 'signed',
                    page: pageResult.page,
                  })}
                  active={contractFilter === 'signed'}
                  tone="info"
                />
                <FilterChip
                  label="Aktivt avtal"
                  count={activeContractsOnPage}
                  href={buildCustomersHref({
                    q: query,
                    ops: opsFilter,
                    status: statusFilter,
                    contract: 'active',
                    page: pageResult.page,
                  })}
                  active={contractFilter === 'active'}
                  tone="success"
                />
                <FilterChip
                  label="Avslutat avtal"
                  count={closedContractsOnPage}
                  href={buildCustomersHref({
                    q: query,
                    ops: opsFilter,
                    status: statusFilter,
                    contract: 'closed',
                    page: pageResult.page,
                  })}
                  active={contractFilter === 'closed'}
                  tone="danger"
                />
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <FilterChip
                  label="Alla operations"
                  count={sortedCustomers.length}
                  href={buildCustomersHref({
                    q: query,
                    ops: 'all',
                    status: statusFilter,
                    contract: contractFilter,
                    page: pageResult.page,
                  })}
                  active={opsFilter === 'all'}
                />
                <FilterChip
                  label="Blockerade"
                  count={blockedCustomers}
                  href={buildCustomersHref({
                    q: query,
                    ops: 'blocked',
                    status: statusFilter,
                    contract: contractFilter,
                    page: pageResult.page,
                  })}
                  active={opsFilter === 'blocked'}
                  tone="danger"
                />
                <FilterChip
                  label="Redo att slutföra"
                  count={readyToExecuteCustomers}
                  href={buildCustomersHref({
                    q: query,
                    ops: 'ready_to_execute',
                    status: statusFilter,
                    contract: contractFilter,
                    page: pageResult.page,
                  })}
                  active={opsFilter === 'ready_to_execute'}
                  tone="success"
                />
                <FilterChip
                  label="Väntar svar"
                  count={awaitingResponseCustomers}
                  href={buildCustomersHref({
                    q: query,
                    ops: 'awaiting_response',
                    status: statusFilter,
                    contract: contractFilter,
                    page: pageResult.page,
                  })}
                  active={opsFilter === 'awaiting_response'}
                  tone="info"
                />
                <FilterChip
                  label="Väntar dispatch"
                  count={awaitingDispatchCustomers}
                  href={buildCustomersHref({
                    q: query,
                    ops: 'awaiting_dispatch',
                    status: statusFilter,
                    contract: contractFilter,
                    page: pageResult.page,
                  })}
                  active={opsFilter === 'awaiting_dispatch'}
                  tone="warning"
                />
                <FilterChip
                  label="Saknar outbound"
                  count={queuedForOutboundCustomers}
                  href={buildCustomersHref({
                    q: query,
                    ops: 'queued_for_outbound',
                    status: statusFilter,
                    contract: contractFilter,
                    page: pageResult.page,
                  })}
                  active={opsFilter === 'queued_for_outbound'}
                  tone="warning"
                />
                <FilterChip
                  label="Failed"
                  count={failedCustomers}
                  href={buildCustomersHref({
                    q: query,
                    ops: 'failed',
                    status: statusFilter,
                    contract: contractFilter,
                    page: pageResult.page,
                  })}
                  active={opsFilter === 'failed'}
                  tone="danger"
                />
                <FilterChip
                  label="Aktiva signaler"
                  count={activeOperationsCustomers}
                  href={buildCustomersHref({
                    q: query,
                    ops: 'active_open',
                    status: statusFilter,
                    contract: contractFilter,
                    page: pageResult.page,
                  })}
                  active={opsFilter === 'active_open'}
                  tone="info"
                />
                <FilterChip
                  label="Ingen signal"
                  count={noSignalCustomers}
                  href={buildCustomersHref({
                    q: query,
                    ops: 'no_signal',
                    status: statusFilter,
                    contract: contractFilter,
                    page: pageResult.page,
                  })}
                  active={opsFilter === 'no_signal'}
                />
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <PaginationLink
                  label="Föregående"
                  href={buildCustomersHref({
                    q: query,
                    ops: opsFilter,
                    status: statusFilter,
                    contract: contractFilter,
                    page: Math.max(1, pageResult.page - 1),
                  })}
                  disabled={pageResult.page <= 1}
                />

                {pageNumbers.map((pageNumber) => (
                  <PaginationLink
                    key={pageNumber}
                    label={String(pageNumber)}
                    href={buildCustomersHref({
                      q: query,
                      ops: opsFilter,
                      status: statusFilter,
                      contract: contractFilter,
                      page: pageNumber,
                    })}
                    active={pageNumber === pageResult.page}
                  />
                ))}

                <PaginationLink
                  label="Nästa"
                  href={buildCustomersHref({
                    q: query,
                    ops: opsFilter,
                    status: statusFilter,
                    contract: contractFilter,
                    page: Math.min(pageResult.totalPages, pageResult.page + 1),
                  })}
                  disabled={pageResult.page >= pageResult.totalPages}
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-950/50">
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">
                      Kund
                    </th>
                    <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">
                      Kundnummer
                    </th>
                    <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">
                      Personnummer
                    </th>
                    <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">
                      Typ
                    </th>
                    <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">
                      Status
                    </th>
                    <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">
                      Kontakt
                    </th>
                    <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">
                      Anläggningar
                    </th>
                    <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">
                      Aktiva anl.
                    </th>
                    <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">
                      Mätpunkter
                    </th>
                    <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">
                      Aktiva mätpkt
                    </th>
                    <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">
                      Senaste avtal
                    </th>
                    <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">
                      Operations
                    </th>
                    <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">
                      Åtgärd
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {filteredCustomers.length === 0 ? (
                    <tr>
                      <td
                        colSpan={13}
                        className="px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400"
                      >
                        Inga kunder matchade sökningen eller filtren på denna sida.
                      </td>
                    </tr>
                  ) : (
                    filteredCustomers.map((customer) => {
                      const operations = customer.operations
                      const latestContract =
                        latestContractsByCustomerId.get(customer.id) ?? null

                      return (
                        <tr
                          key={customer.id}
                          className="border-b border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950/50"
                        >
                          <td className="px-6 py-4">
                            <div>
                              <p className="font-medium text-slate-900 dark:text-white">
                                {customerDisplayName(customer)}
                              </p>
                              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                {customer.id}
                              </p>
                            </div>
                          </td>

                          <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                            {customer.customer_number ?? '-'}
                          </td>

                          <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                            {customer.personal_number ?? '-'}
                          </td>

                          <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                            {customerTypeLabel(customer.customer_type)}
                          </td>

                          <td className="px-6 py-4">
                            <div className="flex flex-col gap-2">
                              <StatusBadge status={customer.status} />
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                {customerStatusLabel(customer.status)}
                              </span>
                            </div>
                          </td>

                          <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                            <div>{customer.email || '-'}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {customer.phone || '-'}
                            </div>
                          </td>

                          <td className="px-6 py-4">
                            <span className="inline-flex min-w-10 justify-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              {customer.site_count}
                            </span>
                          </td>

                          <td className="px-6 py-4">
                            <span className="inline-flex min-w-10 justify-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                              {customer.active_site_count}
                            </span>
                          </td>

                          <td className="px-6 py-4">
                            <span className="inline-flex min-w-10 justify-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              {customer.metering_point_count}
                            </span>
                          </td>

                          <td className="px-6 py-4">
                            <span className="inline-flex min-w-10 justify-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                              {customer.active_metering_point_count}
                            </span>
                          </td>

                          <td className="px-6 py-4">
                            {latestContract ? (
                              <div className="min-w-[240px] space-y-2">
                                <div className="font-medium text-slate-900 dark:text-white">
                                  {latestContract.contract_name}
                                </div>

                                <div className="flex flex-wrap gap-2">
                                  <span
                                    className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${contractStatusTone(
                                      latestContract.status
                                    )}`}
                                  >
                                    {contractStatusLabel(latestContract.status)}
                                  </span>

                                  <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                    {contractTypeLabel(latestContract.contract_type)}
                                  </span>
                                </div>

                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                  Start: {formatDate(latestContract.starts_at)} · Månadsavgift:{' '}
                                  {formatCurrency(latestContract.monthly_fee_sek)}
                                </p>
                              </div>
                            ) : (
                              <span className="text-sm text-slate-500 dark:text-slate-400">
                                Inget avtal ännu
                              </span>
                            )}
                          </td>

                          <td className="px-6 py-4">
                            <div className="min-w-[280px]">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${priorityTone(
                                    operations.priorityRank
                                  )}`}
                                >
                                  {operations.priorityLabel}
                                </span>

                                <span
                                  className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${operations.primaryTone}`}
                                >
                                  {operations.primaryLabel}
                                </span>

                                {operations.activeOpen > 0 ? (
                                  <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                    öppna: {operations.activeOpen}
                                  </span>
                                ) : null}
                              </div>

                              <div className="mt-2 flex flex-wrap gap-2">
                                {operations.blocked > 0 ? (
                                  <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700">
                                    blocked {operations.blocked}
                                  </span>
                                ) : null}

                                {operations.queuedForOutbound > 0 ? (
                                  <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                                    saknar outbound {operations.queuedForOutbound}
                                  </span>
                                ) : null}

                                {operations.awaitingDispatch > 0 ? (
                                  <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                                    dispatch {operations.awaitingDispatch}
                                  </span>
                                ) : null}

                                {operations.awaitingResponse > 0 ? (
                                  <span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
                                    väntar svar {operations.awaitingResponse}
                                  </span>
                                ) : null}

                                {operations.readyToExecute > 0 ? (
                                  <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                                    ready {operations.readyToExecute}
                                  </span>
                                ) : null}

                                {operations.failed > 0 ? (
                                  <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700">
                                    failed {operations.failed}
                                  </span>
                                ) : null}
                              </div>

                              <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                                {operations.primaryDescription}
                              </p>
                            </div>
                          </td>

                          <td className="px-6 py-4">
                            <div className="flex min-w-[220px] flex-wrap gap-2">
                              <Link
                                href={`/admin/customers/${customer.id}`}
                                className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                              >
                                Öppna kundkort
                              </Link>

                              <Link
                                href={`/admin/customers/${customer.id}#contracts`}
                                className="inline-flex rounded-xl border border-blue-300 bg-blue-50 px-4 py-2 font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-300 dark:hover:bg-blue-950/30"
                              >
                                Avtal
                              </Link>

                              <Link
                                href={operations.primaryHref}
                                className="inline-flex rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
                              >
                                Rätt arbetsyta
                              </Link>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="border-t border-slate-200 px-6 py-4 dark:border-slate-800">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Visar {showingFrom}-{showingTo} av {pageResult.total} kunder. Max {PAGE_SIZE} per sida.
                </p>

                <div className="flex flex-wrap gap-2">
                  <PaginationLink
                    label="Föregående"
                    href={buildCustomersHref({
                      q: query,
                      ops: opsFilter,
                      status: statusFilter,
                      contract: contractFilter,
                      page: Math.max(1, pageResult.page - 1),
                    })}
                    disabled={pageResult.page <= 1}
                  />

                  <PaginationLink
                    label="Nästa"
                    href={buildCustomersHref({
                      q: query,
                      ops: opsFilter,
                      status: statusFilter,
                      contract: contractFilter,
                      page: Math.min(pageResult.totalPages, pageResult.page + 1),
                    })}
                    disabled={pageResult.page >= pageResult.totalPages}
                  />
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}