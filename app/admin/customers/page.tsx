import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope, isMissingRelationError } from '@/lib/tenant/scope'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import {
 listCustomersPage,
 type CustomerListRow,
 type CustomerStatusFilter,
 type CustomerTypeFilter,
 type CustomerFlagFilter,
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
 customerType?: string
 flag?: string
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

type QueryLikeResult = {
 data: unknown[] | null
 error: unknown
}

function isNonBlockingRuntimeDbError(error: unknown): boolean {
 const code = String((error as { code?: string } | null)?.code ?? '')
 return isMissingRelationError(error) || ['42703', '42P01', 'PGRST204', 'PGRST205'].includes(code)
}

async function safeQueryRows<T>(queryFactory: () => PromiseLike<QueryLikeResult>): Promise<T[]> {
 try {
 const { data, error } = await queryFactory()
 if (error) throw error
 return (data ?? []) as T[]
 } catch (error) {
 if (isNonBlockingRuntimeDbError(error)) return []
 throw error
 }
}

async function safeLatestContractsByCustomerIds(
 customerIds: string[],
 companyId: string | null
): Promise<Map<string, LatestCustomerContractSummary>> {
 try {
 return await listLatestCustomerContractsByCustomerIds(customerIds, { companyId })
 } catch (error) {
 if (isNonBlockingRuntimeDbError(error)) {
 return new Map<string, LatestCustomerContractSummary>()
 }
 throw error
 }
}


function StatusBadge({ status }: { status: string | null }) {
 const styles: Record<string, string> = {
 active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
 draft: 'border-amber-200 bg-amber-50 text-amber-700',
 pending_verification: 'border-emerald-200 bg-emerald-50 text-emerald-700',
 inactive: 'border-slate-200 bg-slate-50 text-slate-700',
 moved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
 terminated: 'border-red-200 bg-red-50 text-red-700',
 blocked: 'border-red-200 bg-red-50 text-red-700',
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
 return 'border-red-200 bg-red-50 text-red-700'
 }

 if (['awaiting_response'].includes(stage)) {
 return 'border-emerald-200 bg-emerald-50 text-emerald-700'
 }

 return 'border-amber-200 bg-amber-50 text-amber-700'
}

function priorityTone(rank: number): string {
 if (rank === 1) return 'border-red-200 bg-red-50 text-red-700'
 if (rank === 2) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
 if (rank === 3) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
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
 primaryLabel: 'Väntar utskick',
 primaryHref: '/admin/operations/switches?stage=awaiting_dispatch',
 primaryTone: lifecycleTone('awaiting_dispatch'),
 primaryDescription:
 'Utskicket finns men skickflödet är inte färdigt.',
 priorityRank: 4,
 priorityLabel: 'Utskick pågår',
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
 primaryLabel: 'Saknar utskick',
 primaryHref: '/admin/operations/switches?stage=queued_for_outbound',
 primaryTone: lifecycleTone('queued_for_outbound'),
 primaryDescription:
 'Minst en switch saknar utskick och behöver förberedas eller kontrolleras.',
 priorityRank: 5,
 priorityLabel: 'Förbered utskick',
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
 primaryLabel: 'Kräver åtgärd',
 primaryHref: '/admin/operations/switches?stage=failed',
 primaryTone: lifecycleTone('failed'),
 primaryDescription:
 'Det finns driftuppgifter som brutit flödet och kräver manuell bedömning.',
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

function normalizeCustomerTypeFilter(value: string | undefined): CustomerTypeFilter {
 switch (value) {
 case 'private':
 case 'business':
 case 'association':
 return value
 default:
 return 'all'
 }
}

function normalizeCustomerFlagFilter(value: string | undefined): CustomerFlagFilter {
 switch (value) {
 case 'possible_duplicate':
 case 'multi_site':
 case 'multi_contract':
 case 'consolidated_invoice':
 case 'missing_authorization':
 case 'missing_grid_owner':
 case 'ready_for_switch':
 case 'cancelled':
 case 'rejected':
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
 customerType: CustomerTypeFilter
 flag: CustomerFlagFilter
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

 if (params.customerType !== 'all') {
 searchParams.set('customerType', params.customerType)
 }

 if (params.flag !== 'all') {
 searchParams.set('flag', params.flag)
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
 ? 'border-red-200 bg-red-50 text-red-700'
 : tone === 'success'
 ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
 : tone === 'info'
 ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
 : tone === 'warning'
 ? 'border-amber-200 bg-amber-50 text-amber-700'
 : 'border-slate-200 bg-slate-50 text-slate-700'

 const activeClass = active
 ? 'ring-2 ring-emerald-200 '
 : ''

 return (
 <Link
 href={href}
 className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition hover:opacity-90 ${toneClass} ${activeClass}`}
 >
 <span>{label}</span>
 <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs ">
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
 key?: string | number
}) {
 if (disabled) {
 return (
 <span className="inline-flex items-center rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 ">
 {label}
 </span>
 )
 }

 return (
 <Link
 href={href}
 className={`inline-flex items-center rounded-xl border px-3 py-2 text-sm font-medium ${
 active
 ? 'border-emerald-700 bg-emerald-700 text-white '
 : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 '
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
 return 'kunder som väntar på utskick'
 case 'queued_for_outbound':
 return 'kunder som saknar utskick'
 case 'failed':
 return 'kunder med driftuppgifter som kräver åtgärd'
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

function customerTypeFilterLabel(value: CustomerTypeFilter): string {
 if (value === 'business') return 'företag'
 if (value === 'association') return 'föreningar'
 if (value === 'private') return 'privatkunder'
 return 'alla kundtyper'
}

function customerFlagFilterLabel(value: CustomerFlagFilter): string {
 switch (value) {
 case 'possible_duplicate':
 return 'möjliga dubbletter'
 case 'multi_site':
 return 'flera anläggningar'
 case 'multi_contract':
 return 'flera avtal'
 case 'consolidated_invoice':
 return 'samlingsfaktura'
 case 'missing_authorization':
 return 'saknar fullmakt'
 case 'missing_grid_owner':
 return 'saknar nätägare'
 case 'ready_for_switch':
 return 'redo för leverantörsbyte'
 case 'billing_ready':
 return 'faktureringsklara'
 case 'test_customers':
 return 'testkunder'
 case 'archived':
 return 'arkiverade kunder'
 case 'cancelled':
 return 'ångrade kunder'
 case 'rejected':
 return 'nekade kunder'
 case 'all':
 default:
 return 'alla kundflaggor'
 }
}

function customerStatusLabel(value: string | null): string {
 switch (value) {
 case 'draft':
 return 'Förbereds'
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
 case 'cancelled':
 return 'Ångrad'
 case 'rejected':
 return 'Nekad'
 case 'archived':
 return 'Arkiverad'
 default:
 return value ?? 'Okänd'
 }
}

function contractStatusLabel(value: CustomerContractRow['status']): string {
 switch (value) {
 case 'draft':
 return 'Förbereds'
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
 return 'border-emerald-200 bg-emerald-50 text-emerald-700'
 case 'pending_signature':
 return 'border-amber-200 bg-amber-50 text-amber-700'
 case 'terminated':
 case 'cancelled':
 case 'expired':
 return 'border-red-200 bg-red-50 text-red-700'
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

export default async function AdminCustomersPage({
 searchParams,
}: CustomersPageProps) {
 const context = await requireAdminPageKeyAccess('customers.list')

 const resolvedSearchParams = await searchParams
 const query = (resolvedSearchParams.q ?? '').trim()
 const opsFilter = normalizeOperationsFilter(resolvedSearchParams.ops)
 const statusFilter = normalizeStatusFilter(resolvedSearchParams.status)
 const contractFilter = normalizeContractFilter(resolvedSearchParams.contract)
 const customerTypeFilter = normalizeCustomerTypeFilter(resolvedSearchParams.customerType)
 const flagFilter = normalizeCustomerFlagFilter(resolvedSearchParams.flag)
 const page = normalizePage(resolvedSearchParams.page)

 const companyScope = await getOperationalCompanyScope(context.userId)
 const tenantScope = await resolveAdminTenantReadScope(context)
 const scopedCompanyId = tenantScope.companyId

 if (!tenantScope.isPlatformAdmin && !scopedCompanyId) {
 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Kundregister"
 subtitle="Kundregistret kräver en aktiv bolagskoppling för tenant-användare."
 userEmail={context.email}
 workspaceName={tenantScope.isPlatformAdmin ? 'Gridex Platform' : companyScope.companyName}
 workspaceMode={tenantScope.isPlatformAdmin ? 'platform' : 'tenant'}
 />
 <div className="p-8">
 <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-950 shadow-sm">
 <h2 className="text-lg font-semibold">Bolagskoppling saknas</h2>
 <p className="mt-2 text-sm leading-6">
 Kontot har kundbehörighet men saknar aktiv koppling till ett elhandelsbolag. Koppla användaren till rätt bolag innan kundregistret visas.
 </p>
 <Link href="/admin/company-settings" className="mt-4 inline-flex rounded-2xl bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-800">
 Öppna bolagsinställningar
 </Link>
 </section>
 </div>
 </div>
 )
 }

 const pageResult = await listCustomersPage({
 query,
 page,
 pageSize: PAGE_SIZE,
 status: statusFilter,
 contractFilter,
 customerType: customerTypeFilter,
 flag: flagFilter,
 companyId: scopedCompanyId,
 })

 const customers = pageResult.rows

 const supabase = await createSupabaseServerClient()
 const {
 data: { user },
 } = await supabase.auth.getUser()

 const customerIds = customers.map((customer) => customer.id)

 const [sites, switchRequests, outboundRequests, latestContractsByCustomerId] =
 customerIds.length > 0
 ? await Promise.all([
 safeQueryRows<CustomerSiteRow>(() => {
 let query = supabaseService
 .from('customer_sites')
 .select('id, company_id, customer_id, site_name, facility_id, status, grid_owner_id, grid_area_code, price_area_code, created_at, updated_at')
 .in('customer_id', customerIds)
 if (scopedCompanyId) query = query.eq('company_id', scopedCompanyId)
 return query.order('created_at', { ascending: false }).limit(150)
 }),
 safeQueryRows<SupplierSwitchRequestRow>(() => {
 let query = supabaseService
 .from('supplier_switch_requests')
 .select('id, company_id, customer_id, site_id, metering_point_id, request_type, status, external_reference, failure_reason, submitted_at, completed_at, failed_at, lifecycle_blocked, lifecycle_block_source, lifecycle_block_id, created_at, updated_at')
 .in('customer_id', customerIds)
 if (scopedCompanyId) query = query.eq('company_id', scopedCompanyId)
 return query.order('created_at', { ascending: false }).limit(150)
 }),
 safeQueryRows<OutboundRequestRow>(() => {
 let query = supabaseService
 .from('outbound_requests')
 .select('id, company_id, customer_id, site_id, metering_point_id, request_type, source_type, source_id, status, channel_type, external_reference, failure_reason, queued_at, prepared_at, sent_at, acknowledged_at, failed_at, created_at, updated_at')
 .eq('request_type', 'supplier_switch')
 .in('customer_id', customerIds)
 if (scopedCompanyId) query = query.eq('company_id', scopedCompanyId)
 return query.order('created_at', { ascending: false }).limit(150)
 }),
 safeLatestContractsByCustomerIds(customerIds, scopedCompanyId),
 ])
 : [
 [] as CustomerSiteRow[],
 [] as SupplierSwitchRequestRow[],
 [] as OutboundRequestRow[],
 new Map<string, LatestCustomerContractSummary>(),
 ]

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

 const latestContracts = Array.from(latestContractsByCustomerId.values()) as LatestCustomerContractSummary[]
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
 title="Kundregister"
 subtitle="Kunder, anläggningar, mätpunkter, avtal och operationsläge för det operativa elhandelsbolaget."
 userEmail={user?.email ?? null}
 />

 <div className="space-y-6 p-8">
 <div className="flex flex-wrap gap-3">
 <Link
 href="/admin/customers/intake"
 className="inline-flex items-center rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 "
 >
 Kundintag / bulkimport
 </Link>

 <Link
 href="/admin/contracts"
 className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 "
 >
 Avtalskatalog
 </Link>
 </div>

 <section className="grid gap-4 xl:grid-cols-5">
 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">
 Matchande kunder
 </div>
 <div className="mt-2 text-3xl font-semibold text-slate-950 ">
 {pageResult.total}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
Sida {pageResult.page} av {pageResult.totalPages}. Visar {showingFrom}-{showingTo}.
 </div>
 </div>

 <div className="rounded-3xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">
 Aktiva kunder
 </div>
 <div className="mt-2 text-3xl font-semibold text-slate-950 ">
 {pageResult.counts.active}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Aktiva kundrelationer
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">
 Inaktiva kunder
 </div>
 <div className="mt-2 text-3xl font-semibold text-slate-950 ">
 {pageResult.counts.inactive}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Inaktiva kundrelationer
 </div>
 </div>

 <div className="rounded-3xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">
 Aktivt avtal på sidan
 </div>
 <div className="mt-2 text-3xl font-semibold text-slate-950 ">
 {activeContractsOnPage}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Signerade: {signedContractsOnPage} · Väntar signering: {pendingSignatureContractsOnPage}
 </div>
 </div>

 <div className="rounded-3xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">
 Aktiv operationsuppföljning på sidan
 </div>
 <div className="mt-2 text-3xl font-semibold text-slate-950 ">
 {activeOperationsCustomers}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Väntar svar: {awaitingResponseCustomers} · Väntar utskick: {awaitingDispatchCustomers}
 </div>
 </div>
 </section>

 <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
 <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm ">
 <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 ">
 Operativt bolag
 </p>
 <h2 className="mt-2 text-xl font-semibold text-slate-950 ">
 {companyScope.companyName ?? 'Bolagskoppling saknas'}
 </h2>
 <p className="mt-3 text-sm leading-6 text-slate-700 ">
 Kundregistret visar kunder för ditt aktiva elhandelsbolag. Ny kund, anläggning, mätpunkt och avtal registreras via kundintaget så all data sparas i rätt bolag.
 </p>
 {companyScope.message ? (
 <p className="mt-3 text-sm font-semibold text-amber-700 ">{companyScope.message}</p>
 ) : null}
 <Link
 href="/admin/customers/intake"
 className="mt-5 inline-flex w-full justify-center rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 "
 >
 Starta kundintag
 </Link>
 <Link
 href="/admin/contracts"
 className="mt-3 inline-flex w-full justify-center rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 "
 >
 Hantera avtal och kampanjer
 </Link>
 </section>

 <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ">
 <div className="border-b border-slate-200 px-6 py-5 ">
 <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
 <div>
 <h2 className="text-lg font-semibold text-slate-950 ">
 Kundregister
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Totalt {pageResult.total} kunder
 {query ? ` för sökning "${query}"` : ''}
 {statusFilter !== 'all' ? ` med kundstatus "${customerStatusLabel(statusFilter)}"` : ''}
 {contractFilter !== 'all' ? ` i avtalsfiltret "${contractFilterLabel(contractFilter)}"` : ''}
 {customerTypeFilter !== 'all' ? ` med kundtyp "${customerTypeFilterLabel(customerTypeFilter)}"` : ''}
 {flagFilter !== 'all' ? ` med flaggan "${customerFlagFilterLabel(flagFilter)}"` : ''}
 {opsFilter !== 'all' ? ` i operationsfiltret "${filterLabel(opsFilter)}"` : ''}.
 </p>
 <p className="mt-2 text-xs text-slate-700 ">
 Sorteras automatiskt efter operationsprioritet på sidan: blockerad → redo att slutföra → väntar svar → väntar utskick → saknar utskick → kräver åtgärd → övriga.
 </p>
 <p className="mt-2 text-xs text-slate-700 ">
 Sökningen stöder kundnummer, personnummer, namn, e-post, telefon, anläggnings-id och mätpunkts-id.
 </p>
 </div>

 <form method="get" className="flex w-full flex-wrap gap-3 lg:max-w-4xl">
 <input type="hidden" name="ops" value={opsFilter === 'all' ? '' : opsFilter} />
 <input type="hidden" name="flag" value={flagFilter === 'all' ? '' : flagFilter} />
 <input
 name="q"
 defaultValue={query}
 placeholder="Sök på kundnummer, personnummer, namn, e-post, anläggning eller mätpunkts-id"
 className="h-11 min-w-[240px] flex-1 rounded-2xl border border-slate-300 px-4 text-sm outline-none transition focus:border-emerald-700 "
 />
 <select
 name="status"
 defaultValue={statusFilter}
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 >
 <option value="all">Alla kundstatusar</option>
 <option value="draft">Förbereds</option>
 <option value="pending_verification">Väntar verifiering</option>
 <option value="active">Aktiv</option>
 <option value="inactive">Inaktiv</option>
 <option value="moved">Flyttad</option>
 <option value="terminated">Avslutad</option>
 <option value="blocked">Blockerad</option>
 <option value="cancelled">Ångrad</option>
 <option value="rejected">Nekad</option>
 <option value="archived">Arkiverad</option>
 </select>
 <select
 name="customerType"
 defaultValue={customerTypeFilter}
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 >
 <option value="all">Alla kundtyper</option>
 <option value="private">Privatperson</option>
 <option value="business">Företag</option>
 <option value="association">Förening</option>
 </select>
 <select
 name="contract"
 defaultValue={contractFilter}
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 >
 <option value="all">Alla avtalslägen</option>
 <option value="none">Utan avtal</option>
 <option value="pending_signature">Väntar signering</option>
 <option value="signed">Signerat</option>
 <option value="active">Aktivt avtal</option>
 <option value="closed">Avslutat avtal</option>
 </select>
 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 ">
 Sök
 </button>
 {query || opsFilter !== 'all' || statusFilter !== 'all' || contractFilter !== 'all' || customerTypeFilter !== 'all' || flagFilter !== 'all' ? (
 <Link
 href="/admin/customers"
 className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 "
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
 href={buildCustomersHref({ q: query, ops: opsFilter, status: 'all', contract: contractFilter, customerType: customerTypeFilter, flag: flagFilter, page: 1 })}
 active={statusFilter === 'all'}
 />
 <FilterChip
 label="Förbereds"
 count={pageResult.counts.draft}
 href={buildCustomersHref({ q: query, ops: opsFilter, status: 'draft', contract: contractFilter, customerType: customerTypeFilter, flag: flagFilter, page: 1 })}
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
 customerType: customerTypeFilter,
 flag: flagFilter,
 page: 1,
 })}
 active={statusFilter === 'pending_verification'}
 tone="info"
 />
 <FilterChip
 label="Aktiva"
 count={pageResult.counts.active}
 href={buildCustomersHref({ q: query, ops: opsFilter, status: 'active', contract: contractFilter, customerType: customerTypeFilter, flag: flagFilter, page: 1 })}
 active={statusFilter === 'active'}
 tone="success"
 />
 <FilterChip
 label="Inaktiva"
 count={pageResult.counts.inactive}
 href={buildCustomersHref({ q: query, ops: opsFilter, status: 'inactive', contract: contractFilter, customerType: customerTypeFilter, flag: flagFilter, page: 1 })}
 active={statusFilter === 'inactive'}
 />
 <FilterChip
 label="Flyttade"
 count={pageResult.counts.moved}
 href={buildCustomersHref({ q: query, ops: opsFilter, status: 'moved', contract: contractFilter, customerType: customerTypeFilter, flag: flagFilter, page: 1 })}
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
 customerType: customerTypeFilter,
 flag: flagFilter,
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
 customerType: customerTypeFilter,
 flag: flagFilter,
 page: 1,
 })}
 active={statusFilter === 'blocked'}
 tone="danger"
 />
 <FilterChip
 label="Ångrade"
 count={pageResult.counts.cancelled}
 href={buildCustomersHref({ q: query, ops: opsFilter, status: 'cancelled', contract: contractFilter, customerType: customerTypeFilter, flag: flagFilter, page: 1 })}
 active={statusFilter === 'cancelled'}
 tone="danger"
 />
 <FilterChip
 label="Nekade"
 count={pageResult.counts.rejected}
 href={buildCustomersHref({ q: query, ops: opsFilter, status: 'rejected', contract: contractFilter, customerType: customerTypeFilter, flag: flagFilter, page: 1 })}
 active={statusFilter === 'rejected'}
 tone="warning"
 />
 <FilterChip
 label="Arkiverade"
 count={pageResult.counts.archived}
 href={buildCustomersHref({ q: query, ops: opsFilter, status: 'archived', contract: contractFilter, customerType: customerTypeFilter, flag: flagFilter, page: 1 })}
 active={statusFilter === 'archived'}
 />
 </div>

 <div className="mt-5 flex flex-wrap gap-3">
 <FilterChip
 label="Alla kundtyper"
 count={pageResult.total}
 href={buildCustomersHref({
 q: query,
 ops: opsFilter,
 status: statusFilter,
 contract: contractFilter,
 customerType: 'all',
 flag: flagFilter,
 page: 1,
 })}
 active={customerTypeFilter === 'all'}
 />
 <FilterChip
 label="Privatpersoner"
 count={filteredCustomers.filter((customer) => customer.customer_type === 'private' || !customer.customer_type).length}
 href={buildCustomersHref({
 q: query,
 ops: opsFilter,
 status: statusFilter,
 contract: contractFilter,
 customerType: 'private',
 flag: flagFilter,
 page: 1,
 })}
 active={customerTypeFilter === 'private'}
 />
 <FilterChip
 label="Företag"
 count={filteredCustomers.filter((customer) => customer.customer_type === 'business').length}
 href={buildCustomersHref({
 q: query,
 ops: opsFilter,
 status: statusFilter,
 contract: contractFilter,
 customerType: 'business',
 flag: flagFilter,
 page: 1,
 })}
 active={customerTypeFilter === 'business'}
 />
 <FilterChip
 label="Föreningar"
 count={filteredCustomers.filter((customer) => customer.customer_type === 'association').length}
 href={buildCustomersHref({
 q: query,
 ops: opsFilter,
 status: statusFilter,
 contract: contractFilter,
 customerType: 'association',
 flag: flagFilter,
 page: 1,
 })}
 active={customerTypeFilter === 'association'}
 />
 </div>

 <div className="mt-5 flex flex-wrap gap-3">
 <FilterChip
 label="Alla flaggor"
 count={sortedCustomers.length}
 href={buildCustomersHref({
 q: query,
 ops: opsFilter,
 status: statusFilter,
 contract: contractFilter,
 customerType: customerTypeFilter,
 flag: 'all',
 page: 1,
 })}
 active={flagFilter === 'all'}
 />
 <FilterChip
 label="Möjliga dubbletter"
 count={sortedCustomers.filter((customer) => Boolean(customer.possible_duplicate)).length}
 href={buildCustomersHref({
 q: query,
 ops: opsFilter,
 status: statusFilter,
 contract: contractFilter,
 customerType: customerTypeFilter,
 flag: 'possible_duplicate',
 page: 1,
 })}
 active={flagFilter === 'possible_duplicate'}
 tone="warning"
 />
 <FilterChip
 label="Flera anläggningar"
 count={sortedCustomers.filter((customer) => customer.site_count > 1).length}
 href={buildCustomersHref({
 q: query,
 ops: opsFilter,
 status: statusFilter,
 contract: contractFilter,
 customerType: customerTypeFilter,
 flag: 'multi_site',
 page: 1,
 })}
 active={flagFilter === 'multi_site'}
 />
 <FilterChip
 label="Flera avtal"
 count={sortedCustomers.filter((customer) => customer.contract_count > 1).length}
 href={buildCustomersHref({
 q: query,
 ops: opsFilter,
 status: statusFilter,
 contract: contractFilter,
 customerType: customerTypeFilter,
 flag: 'multi_contract',
 page: 1,
 })}
 active={flagFilter === 'multi_contract'}
 />
 <FilterChip
 label="Samlingsfaktura"
 count={sortedCustomers.filter((customer) => Boolean(customer.consolidated_invoice)).length}
 href={buildCustomersHref({
 q: query,
 ops: opsFilter,
 status: statusFilter,
 contract: contractFilter,
 customerType: customerTypeFilter,
 flag: 'consolidated_invoice',
 page: 1,
 })}
 active={flagFilter === 'consolidated_invoice'}
 tone="info"
 />
 <FilterChip
 label="Saknar fullmakt"
 count={sortedCustomers.filter((customer) => !customer.has_signed_power_of_attorney).length}
 href={buildCustomersHref({ q: query, ops: opsFilter, status: statusFilter, contract: contractFilter, customerType: customerTypeFilter, flag: 'missing_authorization', page: 1 })}
 active={flagFilter === 'missing_authorization'}
 tone="warning"
 />
 <FilterChip
 label="Saknar nätägare"
 count={sortedCustomers.filter((customer) => Boolean(customer.has_missing_grid_owner)).length}
 href={buildCustomersHref({ q: query, ops: opsFilter, status: statusFilter, contract: contractFilter, customerType: customerTypeFilter, flag: 'missing_grid_owner', page: 1 })}
 active={flagFilter === 'missing_grid_owner'}
 tone="warning"
 />
 <FilterChip
 label="Redo för byte"
 count={sortedCustomers.filter((customer) => customer.site_count > 0 && customer.metering_point_count > 0 && Boolean(customer.has_signed_power_of_attorney) && !customer.has_missing_grid_owner).length}
 href={buildCustomersHref({ q: query, ops: opsFilter, status: statusFilter, contract: contractFilter, customerType: customerTypeFilter, flag: 'ready_for_switch', page: 1 })}
 active={flagFilter === 'ready_for_switch'}
 tone="success"
 />
 <FilterChip
 label="Faktureringsklara"
 count={sortedCustomers.filter((customer) => customer.site_count > 0 && customer.metering_point_count > 0 && customer.contract_count > 0 && !customer.has_missing_grid_owner).length}
 href={buildCustomersHref({ q: query, ops: opsFilter, status: statusFilter, contract: contractFilter, customerType: customerTypeFilter, flag: 'billing_ready', page: 1 })}
 active={flagFilter === 'billing_ready'}
 tone="success"
 />
 <FilterChip
 label="Testkunder"
 count={sortedCustomers.filter((customer) => customer.is_test_data === true || String(customer.source ?? '').toLowerCase().includes('test')).length}
 href={buildCustomersHref({ q: query, ops: opsFilter, status: statusFilter, contract: contractFilter, customerType: customerTypeFilter, flag: 'test_customers', page: 1 })}
 active={flagFilter === 'test_customers'}
 tone="warning"
 />
 <FilterChip
 label="Arkiverade"
 count={sortedCustomers.filter((customer) => customer.status === 'archived').length}
 href={buildCustomersHref({ q: query, ops: opsFilter, status: statusFilter, contract: contractFilter, customerType: customerTypeFilter, flag: 'archived', page: 1 })}
 active={flagFilter === 'archived'}
 />
 <FilterChip
 label="Ångrade"
 count={sortedCustomers.filter((customer) => customer.status === 'cancelled').length}
 href={buildCustomersHref({ q: query, ops: opsFilter, status: statusFilter, contract: contractFilter, customerType: customerTypeFilter, flag: 'cancelled', page: 1 })}
 active={flagFilter === 'cancelled'}
 tone="danger"
 />
 <FilterChip
 label="Nekade"
 count={sortedCustomers.filter((customer) => customer.status === 'rejected').length}
 href={buildCustomersHref({ q: query, ops: opsFilter, status: statusFilter, contract: contractFilter, customerType: customerTypeFilter, flag: 'rejected', page: 1 })}
 active={flagFilter === 'rejected'}
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
 customerType: customerTypeFilter,
 flag: flagFilter,
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
 customerType: customerTypeFilter,
 flag: flagFilter,
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
 customerType: customerTypeFilter,
 flag: flagFilter,
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
 customerType: customerTypeFilter,
 flag: flagFilter,
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
 customerType: customerTypeFilter,
 flag: flagFilter,
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
 customerType: customerTypeFilter,
 flag: flagFilter,
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
 customerType: customerTypeFilter,
 flag: flagFilter,
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
 customerType: customerTypeFilter,
 flag: flagFilter,
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
 customerType: customerTypeFilter,
 flag: flagFilter,
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
 customerType: customerTypeFilter,
 flag: flagFilter,
 page: pageResult.page,
 })}
 active={opsFilter === 'awaiting_response'}
 tone="info"
 />
 <FilterChip
 label="Väntar utskick"
 count={awaitingDispatchCustomers}
 href={buildCustomersHref({
 q: query,
 ops: 'awaiting_dispatch',
 status: statusFilter,
 contract: contractFilter,
 customerType: customerTypeFilter,
 flag: flagFilter,
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
 customerType: customerTypeFilter,
 flag: flagFilter,
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
 customerType: customerTypeFilter,
 flag: flagFilter,
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
 customerType: customerTypeFilter,
 flag: flagFilter,
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
 customerType: customerTypeFilter,
 flag: flagFilter,
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
 customerType: customerTypeFilter,
 flag: flagFilter,
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
 customerType: customerTypeFilter,
 flag: flagFilter,
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
 customerType: customerTypeFilter,
 flag: flagFilter,
 page: Math.min(pageResult.totalPages, pageResult.page + 1),
 })}
 disabled={pageResult.page >= pageResult.totalPages}
 />
 </div>
 </div>

 <div className="overflow-x-auto">
 <table className="min-w-full text-sm">
 <thead className="bg-slate-50 ">
 <tr className="border-b border-slate-200 ">
 <th className="px-6 py-4 text-left font-semibold text-slate-700 ">
 Kund
 </th>
 <th className="px-6 py-4 text-left font-semibold text-slate-700 ">
 Kundnummer
 </th>
 <th className="px-6 py-4 text-left font-semibold text-slate-700 ">
 Personnummer
 </th>
 <th className="px-6 py-4 text-left font-semibold text-slate-700 ">
 Typ
 </th>
 <th className="px-6 py-4 text-left font-semibold text-slate-700 ">
 Status
 </th>
 <th className="px-6 py-4 text-left font-semibold text-slate-700 ">
 Kontakt
 </th>
 <th className="px-6 py-4 text-left font-semibold text-slate-700 ">
 Anläggningar
 </th>
 <th className="px-6 py-4 text-left font-semibold text-slate-700 ">
 Aktiva anl.
 </th>
 <th className="px-6 py-4 text-left font-semibold text-slate-700 ">
 Mätpunkter
 </th>
 <th className="px-6 py-4 text-left font-semibold text-slate-700 ">
 Aktiva mätpkt
 </th>
 <th className="px-6 py-4 text-left font-semibold text-slate-700 ">
 Senaste avtal
 </th>
 <th className="px-6 py-4 text-left font-semibold text-slate-700 ">
 Operations
 </th>
 <th className="px-6 py-4 text-left font-semibold text-slate-700 ">
 Åtgärd
 </th>
 </tr>
 </thead>

 <tbody>
 {filteredCustomers.length === 0 ? (
 <tr>
 <td
 colSpan={13}
 className="px-6 py-12 text-center text-sm text-slate-700 "
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
 className="border-b border-slate-100 hover:bg-slate-50 "
 >
 <td className="px-6 py-4">
 <div>
 <p className="font-medium text-slate-900 ">
 {customerDisplayName(customer)}
 </p>
 <p className="mt-1 text-xs text-slate-700 ">
 {customer.id}
 </p>
 {customer.possible_duplicate ? (
 <span className="mt-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
 Möjlig dubblett · {customer.duplicate_review_status ?? 'granskning krävs'}
 </span>
 ) : null}
 {customer.consolidated_invoice ? (
 <span className="mt-2 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
 Samlingsfaktura
 </span>
 ) : null}
 </div>
 </td>

 <td className="px-6 py-4 text-slate-700 ">
 {customer.customer_number ?? '-'}
 </td>

 <td className="px-6 py-4 text-slate-700 ">
 {customer.personal_number ?? '-'}
 </td>

 <td className="px-6 py-4 text-slate-700 ">
 {customerTypeLabel(customer.customer_type)}
 </td>

 <td className="px-6 py-4">
 <div className="flex flex-col gap-2">
 <StatusBadge status={customer.status} />
 <span className="text-xs text-slate-700 ">
 {customerStatusLabel(customer.status)}
 </span>
 </div>
 </td>

 <td className="px-6 py-4 text-slate-700 ">
 <div>{customer.email || '-'}</div>
 <div className="text-xs text-slate-700 ">
 {customer.phone || '-'}
 </div>
 </td>

 <td className="px-6 py-4">
 <span className="inline-flex min-w-10 justify-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ">
 {customer.site_count}
 </span>
 </td>

 <td className="px-6 py-4">
 <span className="inline-flex min-w-10 justify-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ">
 {customer.active_site_count}
 </span>
 </td>

 <td className="px-6 py-4">
 <span className="inline-flex min-w-10 justify-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ">
 {customer.metering_point_count}
 </span>
 </td>

 <td className="px-6 py-4">
 <span className="inline-flex min-w-10 justify-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ">
 {customer.active_metering_point_count}
 </span>
 </td>

 <td className="px-6 py-4">
 {latestContract ? (
 <div className="min-w-[240px] space-y-2">
 <div className="font-medium text-slate-900 ">
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

 <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 ">
 {contractTypeLabel(latestContract.contract_type)}
 </span>
 </div>

 <p className="text-xs text-slate-700 ">
 Start: {formatDate(latestContract.starts_at)} · Månadsavgift:{' '}
 {formatCurrency(latestContract.monthly_fee_sek)}
 </p>
 </div>
 ) : (
 <span className="text-sm text-slate-700 ">
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
 <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 ">
 öppna: {operations.activeOpen}
 </span>
 ) : null}
 </div>

 <div className="mt-2 flex flex-wrap gap-2">
 {operations.blocked > 0 ? (
 <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700">
 blocked {operations.blocked}
 </span>
 ) : null}

 {operations.queuedForOutbound > 0 ? (
 <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
 saknar utskick {operations.queuedForOutbound}
 </span>
 ) : null}

 {operations.awaitingDispatch > 0 ? (
 <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
 dispatch {operations.awaitingDispatch}
 </span>
 ) : null}

 {operations.awaitingResponse > 0 ? (
 <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
 väntar svar {operations.awaitingResponse}
 </span>
 ) : null}

 {operations.readyToExecute > 0 ? (
 <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
 ready {operations.readyToExecute}
 </span>
 ) : null}

 {operations.failed > 0 ? (
 <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700">
 failed {operations.failed}
 </span>
 ) : null}
 </div>

 <p className="mt-2 text-xs leading-5 text-slate-700 ">
 {operations.primaryDescription}
 </p>
 </div>
 </td>

 <td className="px-6 py-4">
 <div className="flex min-w-[220px] flex-wrap gap-2">
 <Link
 href={`/admin/customers/${customer.id}`}
 className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-50 "
 >
 Öppna kundkort
 </Link>

 <Link
 href={`/admin/customers/${customer.id}#contracts`}
 className="inline-flex rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 font-medium text-emerald-700 hover:bg-emerald-100 "
 >
 Avtal
 </Link>

 <Link
 href={operations.primaryHref}
 className="inline-flex rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 font-medium text-emerald-700 hover:bg-emerald-100 "
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

 <div className="border-t border-slate-200 px-6 py-4 ">
 <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
 <p className="text-sm text-slate-700 ">
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
 customerType: customerTypeFilter,
 flag: flagFilter,
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
 customerType: customerTypeFilter,
 flag: flagFilter,
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