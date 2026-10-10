// Extracted from page.tsx; keep public imports on the facade module.
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import CustomerActionsMenu from '@/components/admin/customers/CustomerActionsMenu'
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
import { PAGE_SIZE, PaginationLink, buildCustomerOperationsSummary, buildCustomersHref, contractStatusLabel, contractStatusTone, contractTypeLabel, customerDisplayName, customerStatusLabel, customerTypeLabel, formatCurrency, formatDate, matchesContractFilter, matchesOperationsFilter, normalizeContractFilter, normalizeCustomerFlagFilter, normalizeCustomerTypeFilter, normalizeOperationsFilter, normalizePage, normalizeStatusFilter, safeLatestContractsByCustomerIds, safeQueryRows, sortCustomersByOperations } from './page.part-1'

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
 subtitle="Ditt konto är inte kopplat till något bolag. Kontakta din administratör."
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

 const hasFilters = opsFilter !== 'all' || statusFilter !== 'all' || contractFilter !== 'all' || customerTypeFilter !== 'all' || flagFilter !== 'all'
 const filterClass = 'min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700'
 const paginationHref = (target: number) => buildCustomersHref({ q: query, ops: opsFilter, status: statusFilter, contract: contractFilter, customerType: customerTypeFilter, flag: flagFilter, page: target })

 return (
 <div className="min-h-screen">
 <AdminHeader title="Kundregister" subtitle="Hitta en kund och följ nästa steg." userEmail={context.email} />
 <div className="space-y-4 p-4 sm:p-6">
   <div className="flex flex-wrap items-center justify-between gap-3">
     <div className="min-w-0 text-sm text-slate-600">
       <span className="font-semibold text-slate-900">{companyScope.companyName ?? 'Bolagskoppling saknas'}</span>
       <span className="ml-2">{pageResult.total} matchande kunder</span>
       {companyScope.message ? <p className="mt-1 font-medium text-amber-800">{companyScope.message}</p> : null}
     </div>
     <div className="flex items-center gap-2">
       <Link href="/admin/customers/intake" className="inline-flex min-h-10 items-center rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">Ny kund</Link>
       {canReadContracts ? <CustomerActionsMenu ariaLabel="Fler kundvyer"><Link href="/admin/contracts">{tenantScope.isPlatformAdmin ? 'Avtalskatalog' : 'Tecknade avtal'}</Link></CustomerActionsMenu> : null}
     </div>
   </div>

   <dl className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm md:grid-cols-5">
     {[
       ['Matchande kunder', pageResult.total],
       ['Kundposter med aktiv status', pageResult.counts.active],
       ['Inaktiva kunder', pageResult.counts.inactive],
       ['Aktiva avtal på sidan', activeContractsOnPage],
       ['Operationsuppföljning på sidan', activeOperationsCustomers],
     ].map(([label, count]) => <div key={label}><dt className="text-xs text-slate-600">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-slate-950">{count}</dd></div>)}
   </dl>

   <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
     <div className="border-b border-slate-200 p-4">
       <form method="get" className="space-y-3">
         <div className="flex flex-wrap items-end gap-2">
           <label className="grid min-w-0 flex-1 gap-1 text-sm font-medium text-slate-700">
             <span>Sök kund</span>
             <input name="q" type="search" defaultValue={query} placeholder="Namn, kundnummer, e-post eller anläggning…" className={filterClass} />
           </label>
           <button className="min-h-11 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">Sök</button>
           {query || hasFilters ? <Link href="/admin/customers" className="rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Rensa</Link> : null}
         </div>
         <details open={hasFilters} className="rounded-xl border border-slate-200">
           <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Filter{hasFilters ? ' · aktiva' : ''}</summary>
           <div className="grid gap-3 px-3 pb-3 sm:grid-cols-2 lg:grid-cols-5">
             <label className="grid gap-1 text-xs font-medium text-slate-600">Kundstatus
               <select aria-label="Kundstatus" name="status" defaultValue={statusFilter} className={filterClass}>
                 <option value="all">Alla kundstatusar ({pageResult.counts.all})</option>
                 {(['draft', 'pending_verification', 'active', 'inactive', 'moved', 'terminated', 'blocked', 'archived'] as const).map((value) => <option key={value} value={value}>{customerStatusLabel(value)} ({pageResult.counts[value]})</option>)}
               </select>
             </label>
             <label className="grid gap-1 text-xs font-medium text-slate-600">Kundtyp
               <select aria-label="Kundtyp" name="customerType" defaultValue={customerTypeFilter} className={filterClass}>
                 <option value="all">Alla kundtyper</option><option value="private">Privatperson</option><option value="business">Företag</option><option value="association">Förening</option>
               </select>
             </label>
             <label className="grid gap-1 text-xs font-medium text-slate-600">Avtal
               <select aria-label="Avtal" name="contract" defaultValue={contractFilter} className={filterClass}>
                 <option value="all">Alla avtalslägen</option><option value="none">Utan avtal ({noContractCustomers})</option><option value="pending_signature">Väntar signering ({pendingSignatureContractsOnPage})</option><option value="signed">Signerat ({signedContractsOnPage})</option><option value="active">Aktivt ({activeContractsOnPage})</option><option value="closed">Avslutat ({closedContractsOnPage})</option>
               </select>
             </label>
             <label className="grid gap-1 text-xs font-medium text-slate-600">Operations på sidan
               <select aria-label="Operations på sidan" name="ops" defaultValue={opsFilter} className={filterClass}>
                 <option value="all">Alla operations</option><option value="blocked">Blockerade ({blockedCustomers})</option><option value="ready_to_execute">Redo att slutföra ({readyToExecuteCustomers})</option><option value="awaiting_response">Väntar svar ({awaitingResponseCustomers})</option><option value="awaiting_dispatch">Väntar utskick ({awaitingDispatchCustomers})</option><option value="queued_for_outbound">Saknar utskick ({queuedForOutboundCustomers})</option><option value="failed">Kräver åtgärd ({failedCustomers})</option><option value="active_open">Aktiva signaler ({activeOperationsCustomers})</option><option value="no_signal">Ingen signal ({noSignalCustomers})</option>
               </select>
             </label>
             <label className="grid gap-1 text-xs font-medium text-slate-600">Kundflagga
               <select aria-label="Kundflagga" name="flag" defaultValue={flagFilter} className={filterClass}>
                 <option value="all">Alla kundflaggor</option><option value="possible_duplicate">Möjlig dubblett</option><option value="multi_site">Flera anläggningar</option><option value="multi_contract">Flera avtal</option><option value="consolidated_invoice">Samlingsfaktura</option><option value="missing_authorization">Saknar fullmakt</option><option value="missing_grid_owner">Saknar nätägare</option><option value="ready_for_switch">Redo för leverantörsbyte</option><option value="billing_ready">Faktureringsklar</option>{tenantScope.isPlatformAdmin ? <option value="test_customers">Testkunder</option> : null}
               </select>
             </label>
           </div>
           <p className="px-3 pb-3 text-xs text-slate-600">Välj filter och tryck Sök. Operations filtreras och prioriteras på den aktuella sidan.</p>
         </details>
       </form>
       <p className="mt-3 text-xs text-slate-600">Visar {filteredCustomers.length} kunder på sida {pageResult.page} av {pageResult.totalPages}{query ? ` för “${query}”` : ''}. Prioriterade ärenden visas först.</p>
     </div>

     <table className="w-full table-fixed text-sm">
       <caption className="sr-only">Kunder med anläggningar, senaste avtal och operationsläge</caption>
       <thead className="sr-only bg-slate-50 text-left text-xs text-slate-600 md:not-sr-only md:table-header-group"><tr>{['Kund', 'Anläggningar', 'Senaste avtal', 'Operations', 'Åtgärder'].map((label) => <th key={label} scope="col" className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead>
       <tbody className="block md:table-row-group">
         {filteredCustomers.length === 0 ? <tr className="block md:table-row"><td colSpan={5} className="block px-4 py-10 text-center text-slate-600 md:table-cell">Inga kunder matchade sökningen eller filtren på denna sida.</td></tr> : filteredCustomers.map((customer) => {
           const operations = customer.operations
           const latestContract = latestContractsByCustomerId.get(customer.id) ?? null
           return (
             <tr key={customer.id} className="grid grid-cols-2 gap-y-1 border-t border-slate-100 p-2 hover:bg-slate-50/50 md:table-row md:p-0">
               <td className="col-span-2 min-w-0 px-2 py-2 align-top md:w-[28%] md:px-4 md:py-4">
                 <div className="flex flex-wrap items-center gap-2">
                   <Link href={`/admin/customers/${customer.id}`} className="break-words font-semibold text-slate-950 hover:text-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">{customerDisplayName(customer)}</Link>
                   <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${customer.status === 'blocked' ? 'bg-red-50 text-red-800' : customer.status === 'active' ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{customerStatusLabel(customer.status)}</span>
                 </div>
                 <p className="mt-1 text-xs text-slate-600">{customer.customer_number ?? 'Kundnummer saknas'} · {customerTypeLabel(customer.customer_type)}</p>
                 {customer.possible_duplicate ? <p className="mt-1 text-xs font-medium text-amber-800">Möjlig dubblett · {customer.duplicate_review_status ?? 'granskning krävs'}</p> : null}
                 {customer.consolidated_invoice ? <p className="mt-1 text-xs text-emerald-800">Samlingsfaktura</p> : null}
                 <details className="mt-2 text-xs text-slate-600">
                   <summary className="cursor-pointer font-medium hover:text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Kontakt och identitet</summary>
                   <dl className="mt-2 space-y-1 break-words"><div><dt className="inline font-medium">E-post: </dt><dd className="inline">{customer.email || '—'}</dd></div><div><dt className="inline font-medium">Telefon: </dt><dd className="inline">{customer.phone || '—'}</dd></div><div><dt className="inline font-medium">Personnummer: </dt><dd className="inline">{customer.personal_number || '—'}</dd></div><div><dt className="inline font-medium">Kund-ID: </dt><dd className="inline break-all">{customer.id}</dd></div></dl>
                 </details>
               </td>
               <td className="min-w-0 px-2 py-2 align-top text-xs text-slate-600 md:px-4 md:py-4">
                 <p className="mb-1 font-medium text-slate-500 md:hidden">Anläggningar</p>
                 <p><span className="font-semibold tabular-nums text-slate-900">{customer.site_count}</span> totalt · {customer.active_site_count} aktiva</p>
                 <p className="mt-1">{customer.metering_point_count} mätpunkter · {customer.active_metering_point_count} aktiva</p>
               </td>
               <td className="min-w-0 break-words px-2 py-2 align-top text-xs text-slate-600 md:w-[23%] md:px-4 md:py-4">
                 <p className="mb-1 font-medium text-slate-500 md:hidden">Senaste avtal</p>
                 {latestContract ? <><p className="font-medium text-slate-900">{latestContract.contract_name}</p><span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 font-semibold ${contractStatusTone(latestContract.status)}`}>{contractStatusLabel(latestContract.status)}</span><details className="mt-2"><summary className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Avtalsuppgifter</summary><p className="mt-1">{contractTypeLabel(latestContract.contract_type)} · Start {formatDate(latestContract.starts_at)}</p><p>Månadsavgift {formatCurrency(latestContract.monthly_fee_sek)} · Fakturaavgift {formatCurrency(latestContract.invoice_fee_sek)}</p></details></> : 'Inget avtal ännu'}
               </td>
               <td className="col-span-2 min-w-0 px-2 py-2 align-top md:w-[24%] md:px-4 md:py-4">
                 <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${operations.primaryTone}`}>{operations.primaryLabel}</span>
                 {operations.activeOpen > 0 ? <span className="ml-2 text-xs text-slate-600">{operations.activeOpen} öppna</span> : null}
                 <p className="mt-1 text-xs leading-5 text-slate-600">{operations.primaryDescription}</p>
                 <details className="mt-1 text-xs text-slate-600"><summary className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Operationsdetaljer</summary><p className="mt-1">{operations.priorityLabel} · Blockerade {operations.blocked} · Redo {operations.readyToExecute} · Väntar svar {operations.awaitingResponse} · Väntar utskick {operations.awaitingDispatch} · Saknar utskick {operations.queuedForOutbound} · Kräver åtgärd {operations.failed}</p></details>
               </td>
               <td className="col-span-2 px-2 py-2 text-right align-top md:px-4 md:py-4">
                 <CustomerActionsMenu ariaLabel={`Åtgärder för ${customerDisplayName(customer)}`}>
                   <Link href={`/admin/customers/${customer.id}`}>Öppna kundkort</Link>
                   {canReadContracts ? <Link href={`/admin/customers/${customer.id}?tab=contracts#contracts`}>Avtal</Link> : null}
                   <Link href={operations.primaryHref}>Rätt arbetsyta</Link>
                 </CustomerActionsMenu>
               </td>
             </tr>
           )
         })}
       </tbody>
     </table>
     <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4">
       <p className="text-xs text-slate-600">Register {showingFrom}–{showingTo} av {pageResult.total} · Max {PAGE_SIZE} per sida</p>
       <nav aria-label="Kundregistrets sidor" className="flex flex-wrap gap-1">
         <PaginationLink label="Föregående" href={paginationHref(Math.max(1, pageResult.page - 1))} disabled={pageResult.page <= 1} />
         {pageNumbers.map((pageNumber) => <PaginationLink key={pageNumber} label={String(pageNumber)} href={paginationHref(pageNumber)} active={pageNumber === pageResult.page} />)}
         <PaginationLink label="Nästa" href={paginationHref(Math.min(pageResult.totalPages, pageResult.page + 1))} disabled={pageResult.page >= pageResult.totalPages} />
       </nav>
     </div>
   </section>
 </div>
 </div>
 )
}
