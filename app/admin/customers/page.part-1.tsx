// Extracted from page.tsx; keep public imports on the facade module.
import Link from 'next/link'



import { isMissingRelationError } from '@/lib/tenant/scope'

import { type CustomerListRow, type CustomerStatusFilter, type CustomerTypeFilter, type CustomerFlagFilter } from '@/lib/customers/getCustomers'

import { getSwitchLifecycle } from '@/lib/operations/controlTower'
import { listLatestCustomerContractsByCustomerIds, type LatestCustomerContractSummary } from '@/lib/customer-contracts/db'
import type { CustomerSiteRow } from '@/lib/masterdata/types'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'
import type { OutboundRequestRow } from '@/lib/cis/types'
import type { CustomerContractRow } from '@/lib/customer-contracts/types'

export const dynamic = 'force-dynamic'

export type CustomersPageProps = {
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

export type CustomerOperationsSummary = {
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

export type CustomerWithOperations = CustomerListRow & {
 operations: CustomerOperationsSummary
}

export type OperationsFilterKey =
 | 'all'
 | 'blocked'
 | 'ready_to_execute'
 | 'awaiting_response'
 | 'awaiting_dispatch'
 | 'queued_for_outbound'
 | 'failed'
 | 'active_open'
 | 'no_signal'

export type ContractFilterKey =
 | 'all'
 | 'none'
 | 'pending_signature'
 | 'signed'
 | 'active'
 | 'closed'

export const PAGE_SIZE = 100

export type QueryLikeResult = {
 data: unknown[] | null
 error: unknown
}

export function isNonBlockingRuntimeDbError(error: unknown): boolean {
 const code = String((error as { code?: string } | null)?.code ?? '')
 return isMissingRelationError(error) || ['42703', '42P01', 'PGRST204', 'PGRST205'].includes(code)
}

export async function safeQueryRows<T>(queryFactory: () => PromiseLike<QueryLikeResult>): Promise<T[]> {
 try {
 const { data, error } = await queryFactory()
 if (error) throw error
 return (data ?? []) as T[]
 } catch (error) {
 if (isNonBlockingRuntimeDbError(error)) return []
 throw error
 }
}

export async function safeLatestContractsByCustomerIds(
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

export function StatusBadge({ status }: { status: string | null }) {
 const styles: Record<string, string> = {
 archived: 'border-slate-300 bg-slate-100 text-slate-700',
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

export function lifecycleTone(stage: string): string {
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

export function priorityTone(rank: number): string {
 if (rank === 1) return 'border-red-200 bg-red-50 text-red-700'
 if (rank === 2) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
 if (rank === 3) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
 if (rank <= 5) return 'border-amber-200 bg-amber-50 text-amber-700'
 return 'border-slate-200 bg-slate-50 text-slate-700'
}

export function requestSortTime(request: SupplierSwitchRequestRow): number {
 return new Date(
 request.completed_at ??
 request.failed_at ??
 request.submitted_at ??
 request.created_at
 ).getTime()
}

export function outboundSortTime(outbound: OutboundRequestRow): number {
 return new Date(
 outbound.acknowledged_at ??
 outbound.failed_at ??
 outbound.sent_at ??
 outbound.prepared_at ??
 outbound.queued_at ??
 outbound.created_at
 ).getTime()
}

export function getLatestOutboundForRequest(
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

export function buildCustomerOperationsSummary(params: {
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

export function sortCustomersByOperations(customers: CustomerWithOperations[]): CustomerWithOperations[] {
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

export function normalizeOperationsFilter(value: string | undefined): OperationsFilterKey {
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

export function normalizeStatusFilter(value: string | undefined): CustomerStatusFilter {
 switch (value) {
 case 'draft':
 case 'pending_verification':
 case 'active':
 case 'inactive':
 case 'moved':
 case 'terminated':
 case 'blocked':
 case 'archived':
 return value
 default:
 return 'all'
 }
}

export function normalizeContractFilter(value: string | undefined): ContractFilterKey {
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

export function normalizeCustomerTypeFilter(value: string | undefined): CustomerTypeFilter {
 switch (value) {
 case 'private':
 case 'business':
 case 'association':
 return value
 default:
 return 'all'
 }
}

export function normalizeCustomerFlagFilter(value: string | undefined): CustomerFlagFilter {
 switch (value) {
 case 'possible_duplicate':
 case 'multi_site':
 case 'multi_contract':
 case 'consolidated_invoice':
 case 'missing_authorization':
 case 'missing_grid_owner':
 case 'ready_for_switch':
 case 'billing_ready':
 case 'test_customers':
 return value
 default:
 return 'all'
 }
}

export function normalizePage(value: string | undefined): number {
 const parsed = Number.parseInt(value ?? '1', 10)
 return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

export function matchesOperationsFilter(
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

export function matchesContractFilter(
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

export function buildCustomersHref(params: {
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

export function FilterChip({
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

export function PaginationLink({
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

export function filterLabel(filter: OperationsFilterKey): string {
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

export function contractFilterLabel(filter: ContractFilterKey): string {
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

export function customerDisplayName(customer: CustomerWithOperations): string {
 const combinedName = [customer.first_name, customer.last_name]
 .filter(Boolean)
 .join(' ')
 .trim()

 return customer.full_name ?? customer.company_name ?? (combinedName || 'Namnlös kund')
}

export function customerTypeLabel(value: string | null): string {
 if (value === 'business') return 'Företag'
 if (value === 'association') return 'Förening'
 return 'Privat'
}

export function customerTypeFilterLabel(value: CustomerTypeFilter): string {
 if (value === 'business') return 'företag'
 if (value === 'association') return 'föreningar'
 if (value === 'private') return 'privatkunder'
 return 'alla kundtyper'
}

export function customerFlagFilterLabel(value: CustomerFlagFilter): string {
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
 case 'all':
 default:
 return 'alla kundflaggor'
 }
}

export function customerStatusLabel(value: string | null): string {
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
 case 'archived':
 return 'Arkiverad'
 default:
 return value ?? 'Okänd'
 }
}

export function contractStatusLabel(value: CustomerContractRow['status']): string {
 switch (value) {
 case 'draft':
 return 'Förbereds'
 case 'pending_signature':
 return 'Väntar signering'
 case 'signature_failed':
 return 'Signering misslyckades'
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

export function contractTypeLabel(value: CustomerContractRow['contract_type']): string {
 switch (value) {
 case 'fixed':
 return 'Fast'
 case 'variable_monthly':
 return 'Rörlig månad'
 case 'variable_hourly':
 return 'Rörlig tim'
 case 'variable_quarterly':
 return 'Rörlig kvart'
 case 'portfolio':
 return 'Portfölj'
 default:
 return value
 }
}

export function contractStatusTone(value: CustomerContractRow['status']): string {
 switch (value) {
 case 'active':
 return 'border-emerald-200 bg-emerald-50 text-emerald-700'
 case 'signed':
 return 'border-emerald-200 bg-emerald-50 text-emerald-700'
 case 'pending_signature':
 case 'signature_failed':
 return 'border-amber-200 bg-amber-50 text-amber-700'
 case 'terminated':
 case 'cancelled':
 case 'expired':
 return 'border-red-200 bg-red-50 text-red-700'
 default:
 return 'border-slate-200 bg-slate-50 text-slate-700'
 }
}

export function formatDate(value: string | null | undefined): string {
 if (!value) return '—'

 return new Intl.DateTimeFormat('sv-SE', {
 dateStyle: 'medium',
 }).format(new Date(value))
}

export function formatCurrency(value: number | null | undefined): string {
 if (value === null || value === undefined) return '—'

 return new Intl.NumberFormat('sv-SE', {
 style: 'currency',
 currency: 'SEK',
 maximumFractionDigits: 0,
 }).format(value)
}
