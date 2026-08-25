// Extracted from page.tsx; keep public imports on the facade module.
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { listCustomersPage } from '@/lib/customers/getCustomers'
import { supabaseService } from '@/lib/supabase/service'

import { type LatestCustomerContractSummary } from '@/lib/customer-contracts/db'
import type { CustomerSiteRow } from '@/lib/masterdata/types'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'
import type { OutboundRequestRow } from '@/lib/cis/types'

import type { CustomerWithOperations, CustomersPageProps } from './page.part-1'
import { FilterChip, PAGE_SIZE, PaginationLink, StatusBadge, buildCustomerOperationsSummary, buildCustomersHref, contractFilterLabel, contractStatusLabel, contractStatusTone, contractTypeLabel, customerDisplayName, customerFlagFilterLabel, customerStatusLabel, customerTypeFilterLabel, customerTypeLabel, filterLabel, formatCurrency, formatDate, matchesContractFilter, matchesOperationsFilter, normalizeContractFilter, normalizeCustomerFlagFilter, normalizeCustomerTypeFilter, normalizeOperationsFilter, normalizePage, normalizeStatusFilter, priorityTone, safeLatestContractsByCustomerIds, safeQueryRows, sortCustomersByOperations } from './page.part-1'

export async function AdminCustomersPage({
 searchParams,
}: CustomersPageProps) {
 const context = await requireAdminPageKeyAccess('customers.list')

 const [resolvedSearchParams, companyScope, tenantScope] = await Promise.all([
 searchParams,
 getOperationalCompanyScope(context.userId),
 resolveAdminTenantReadScope(context),
 ])
 const query = (resolvedSearchParams.q ?? '').trim()
 const opsFilter = normalizeOperationsFilter(resolvedSearchParams.ops)
 const statusFilter = normalizeStatusFilter(resolvedSearchParams.status)
 const contractFilter = normalizeContractFilter(resolvedSearchParams.contract)
 const customerTypeFilter = normalizeCustomerTypeFilter(resolvedSearchParams.customerType)
 const flagFilter = normalizeCustomerFlagFilter(resolvedSearchParams.flag)
 const page = normalizePage(resolvedSearchParams.page)

 const scopedCompanyId = tenantScope.companyId
 const canReadContracts =
   tenantScope.isPlatformAdmin ||
   context.permissions.includes('contracts.read') ||
   context.permissions.includes('contracts.write')

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
    // Tenants never see test/dirty rows in the normal registry; platform
    // admins see everything (and can filter with flag=test_customers).
    excludeTestData: !tenantScope.isPlatformAdmin,
  })

 const customers = pageResult.rows
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
 userEmail={context.email}
 />

 <div className="space-y-6 p-8">
 <div className="flex flex-wrap gap-3">
 <Link
 href="/admin/customers/intake"
 className="inline-flex items-center rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 "
 >
 Kundintag / bulkimport
 </Link>

 {canReadContracts ? (
 <Link
 href="/admin/contracts"
 className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 "
 >
 {tenantScope.isPlatformAdmin ? 'Avtalskatalog' : 'Tecknade avtal'}
 </Link>
 ) : null}
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
 {canReadContracts ? (
 <Link
 href="/admin/contracts"
 className="mt-3 inline-flex w-full justify-center rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 "
 >
 {tenantScope.isPlatformAdmin ? 'Hantera avtalsmallar och kampanjer' : 'Öppna tecknade avtal'}
 </Link>
 ) : null}
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
 label="Arkiverade"
 count={pageResult.counts.archived}
 href={buildCustomersHref({
 q: query,
 ops: opsFilter,
 status: 'archived',
 contract: contractFilter,
 customerType: customerTypeFilter,
 flag: flagFilter,
 page: 1,
 })}
 active={statusFilter === 'archived'}
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
 {formatCurrency(latestContract.monthly_fee_sek)} · Fakturaavgift:{' '}
 {formatCurrency(latestContract.invoice_fee_sek)}
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

 {canReadContracts ? (
 <Link
 href={`/admin/customers/${customer.id}?tab=contracts#contracts`}
 className="inline-flex rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 font-medium text-emerald-700 hover:bg-emerald-100 "
 >
 Avtal
 </Link>
 ) : null}

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
