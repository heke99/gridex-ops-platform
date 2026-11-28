import { InvalidReadModelResponseError, readResult } from '@/lib/read-models/readResult'
import { formatSupplierSwitchDate, getSupplierSwitchBusinessState, supplierSwitchRequestTypeLabel } from '@/components/admin/customers/SupplierSwitchBusinessView'
import { readConfirmedMarketStarts } from '@/lib/operations/readyBulkCandidates'
import { getVerifiedSupplierSwitchActivationReadiness, type SupplierSwitchActivationReadiness } from '@/lib/operations/supplierSwitchActivation'
import { canPresentAdminAction, canPresentAdminLink } from '@/lib/admin/actionPresentation'
import AdminActionsMenu from "@/components/admin/ui/AdminActionsMenu"
import { formatCustomerName } from '@/components/admin/CustomerName'
//app/admin/operations/switches/page.tsx
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { listMeteringPointsBySiteIds } from '@/lib/masterdata/db'
import {
 listAllSupplierSwitchRequests,
 listSupplierSwitchCandidatePage,
 listPowersOfAttorneyByCustomerIds,
 listSupplierSwitchEventsByRequestIds,
} from '@/lib/operations/db'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import type { OutboundRequestRow } from '@/lib/cis/types'
import {
 getSwitchLifecycle,
 summarizeReadinessIssues,
} from '@/lib/operations/controlTower'
import {
 finalizeSupplierSwitchExecutionAction,
 updateSupplierSwitchStatusFromAdminAction,
 validateSupplierSwitchBeforeProcessingAction,
} from '@/app/admin/operations/actions'
import { queueSupplierSwitchOutboundAction } from '@/app/admin/cis/actions'
import type { CustomerSiteRow } from '@/lib/masterdata/types'
import { formatStatusLabel } from '@/lib/ui/format'
import { readWritableSwitchCompanyIds } from '@/lib/operations/switchCompanyWriteScope'
import { readSwitchActivationCompanyIds } from '@/lib/operations/switchActivationAuthority'
import { canEditManualSwitchStatus, manualSwitchStatusOptions } from '@/lib/operations/manualSwitchStatus'

type SwitchesPageProps = {
 searchParams: Promise<{
 status?: string
 requestType?: string
 stage?: string
 q?: string
 cursor?: string
 }>
}

type SwitchRow = {
 request: Awaited<ReturnType<typeof listAllSupplierSwitchRequests>>[number]
 readiness: ReturnType<typeof evaluateSiteSwitchReadiness> | null
 outbound: OutboundRequestRow | null
 lifecycle: ReturnType<typeof getSwitchLifecycle>
 activation: SupplierSwitchActivationReadiness | null
}

export const dynamic = 'force-dynamic'

function statusStyle(status: string): string {
 if (
 ['completed', 'accepted', 'done', 'acknowledged', 'ready_to_execute'].includes(
 status
 )
 ) {
 return 'bg-emerald-100 text-emerald-700 '
 }

 if (['failed', 'rejected', 'blocked', 'cancelled'].includes(status)) {
 return 'bg-red-100 text-red-700 '
 }

 if (['sent', 'submitted', 'awaiting_response'].includes(status)) {
 return 'bg-emerald-100 text-emerald-700 '
 }

 return 'bg-amber-100 text-amber-700 '
}

function latestEventText(
 requestId: string,
 events: Array<{
 switch_request_id: string
 message: string | null
 event_type: string
 event_status: string
 }>
): string {
 const latest = events.find((event) => event.switch_request_id === requestId)
 if (!latest) return 'Ingen registrerad händelse ännu'
 return latest.message ?? `${latest.event_type} — ${latest.event_status}`
}

function buildSwitchesHref(params: {
 status?: string
 requestType?: string
 stage?: string
 q?: string
 cursor?: string
}): string {
 const searchParams = new URLSearchParams()

 if (params.status && params.status !== 'all') {
 searchParams.set('status', params.status)
 }

 if (params.requestType && params.requestType !== 'all') {
 searchParams.set('requestType', params.requestType)
 }

 if (params.stage && params.stage !== 'all') {
 searchParams.set('stage', params.stage)
 }

 if (params.cursor) searchParams.set('cursor', params.cursor)

 if (params.q && params.q.trim()) {
 searchParams.set('q', params.q.trim())
 }

 const queryString = searchParams.toString()
 return queryString
 ? `/admin/operations/switches?${queryString}`
 : '/admin/operations/switches'
}

function matchesStageFilter(row: SwitchRow, stage: string): boolean {
 if (stage === 'all') return true
 return row.lifecycle.stage === stage
}

function KpiCard({
 label,
 value,
 href,
 active = false,
}: {
 label: string
 value: number
 href: string
 active?: boolean
}) {
 return (
 <Link
 href={href}
 className={[
 'rounded-2xl border p-3 transition hover:border-emerald-500',
 active
 ? 'border-emerald-300 bg-emerald-50/70 '
 : 'border-slate-200 bg-white ',
 ].join(' ')}
 >
 <div className="text-sm font-medium text-slate-700 ">
 {label}
 </div>
 <div className="mt-1 text-2xl font-semibold text-slate-950 ">
 {value}
 </div>

 </Link>
 )
}

export default async function AdminOperationsSwitchesPage({
 searchParams,
}: SwitchesPageProps) {
 const context = await requireAdminPageKeyAccess('operations.switches')
 const [tenantScope, resolvedSearchParams] = await Promise.all([
 resolveAdminTenantReadScope(context),
 searchParams,
 ])
 const companyId = tenantScope.companyId
 const [canManage, canQueue] = await Promise.all([canPresentAdminAction(['masterdata.write']), canPresentAdminAction(['switching.write'])])
 const canReadCustomer = canPresentAdminLink(context, { anyOf: ['customers.read', 'masterdata.read'] })
   && canPresentAdminLink(context, { anyOf: ['customers.read', 'contracts.read', 'contracts.write'] })
 const isPlatform = tenantScope.isPlatformAdmin
 const supabase = await createSupabaseServerClient()

 const status = (resolvedSearchParams.status ?? 'all').trim()
 const requestType = (resolvedSearchParams.requestType ?? 'all').trim()
 const stage = (resolvedSearchParams.stage ?? 'all').trim()
 const query = (resolvedSearchParams.q ?? '').trim()

 const selection = await readResult(() => listSupplierSwitchCandidatePage(supabase, {
 status, requestType, query, stage, companyId, cursor: resolvedSearchParams.cursor,
 }), { definitionVersion: 'supplier_switch_business_list_v1', errorCode: 'SWITCH_LIST_UNAVAILABLE' })
 if (selection.kind === 'unavailable') return <main className="p-6" role="alert"><h1>Leveransärendena kunde inte läsas</h1><p>Inga uppgifter om urvalets storlek kan visas just nu.</p><Link href="/admin/operations/switches">Läs listan igen</Link></main>
 const { items: requests, page } = selection.data
 const writableCompanies = canManage || canQueue
   ? await readWritableSwitchCompanyIds(supabase, requests.map(request => request.company_id))
   : new Set<string>()

 const requestIds = requests.map((request) => request.id)
 const siteIds = Array.from(new Set(requests.map((request) => request.site_id)))

 const sitesPromise: Promise<CustomerSiteRow[]> = siteIds.length > 0
 ? (async () => {
 let sitesQueryBuilder = supabase
 .from('customer_sites')
 .select('*', { count: 'exact' })
 .in('id', siteIds).limit(siteIds.length)

 if (companyId) {
 sitesQueryBuilder = sitesQueryBuilder.eq('company_id', companyId)
 }

 const sitesQuery = await sitesQueryBuilder
 if (sitesQuery.error) throw sitesQuery.error
 if (!Array.isArray(sitesQuery.data) || sitesQuery.count !== sitesQuery.data.length) throw new InvalidReadModelResponseError()
 for (const site of sitesQuery.data) if (!requests.some(request => request.site_id === site.id && request.company_id === site.company_id)) throw new InvalidReadModelResponseError()
 return (sitesQuery.data ?? []) as CustomerSiteRow[]
 })()
 : Promise.resolve([] as CustomerSiteRow[])

 const now = new Date()
 const [sites, events, outboundRequests, meteringPoints, marketStarts] = await Promise.all([
 sitesPromise,
 isPlatform ? listSupplierSwitchEventsByRequestIds(supabase, requestIds) : Promise.resolve([]),
 (async (): Promise<OutboundRequestRow[]> => {
 if (!requestIds.length) return []
 let outboundQuery = supabase.from('outbound_requests').select('*', { count: 'exact' })
 .eq('request_type', 'supplier_switch').eq('source_type', 'supplier_switch_request').in('source_id', requestIds)
 .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1000)
 if (companyId) outboundQuery = outboundQuery.eq('company_id', companyId)
 const result = await outboundQuery
 if (result.error) throw result.error
 if (!Array.isArray(result.data) || result.count !== result.data.length) throw new InvalidReadModelResponseError()
 for (const outbound of result.data) if (!requests.some(request => request.id === outbound.source_id && request.company_id === outbound.company_id)
 || outbound.source_type !== 'supplier_switch_request' || outbound.request_type !== 'supplier_switch') throw new InvalidReadModelResponseError()
 return result.data as OutboundRequestRow[]
 })(),
 listMeteringPointsBySiteIds(supabase, siteIds, { companyId }),
 readResult(
 () => readConfirmedMarketStarts(supabase, requests.filter(request => request.status === 'accepted')),
 { definitionVersion: 'supplier_switch_confirmed_market_start_v1', errorCode: 'SWITCH_MARKET_START_UNAVAILABLE' },
 ),
 ])

 const readinessMap = new Map<
 string,
 ReturnType<typeof evaluateSiteSwitchReadiness>
 >()
 const customerIds = Array.from(new Set(sites.map((site) => site.customer_id).filter(Boolean)))
 const powersOfAttorney = await listPowersOfAttorneyByCustomerIds(supabase, customerIds, {
 companyId,
 limit: Math.max(customerIds.length * 5, 100),
 })
 const powersOfAttorneyByCustomerId = new Map<string, typeof powersOfAttorney>()

 for (const powerOfAttorney of powersOfAttorney) {
 const current = powersOfAttorneyByCustomerId.get(powerOfAttorney.customer_id) ?? []
 current.push(powerOfAttorney)
 powersOfAttorneyByCustomerId.set(powerOfAttorney.customer_id, current)
 }

 for (const site of sites) {
 const readiness = evaluateSiteSwitchReadiness({
 site,
 meteringPoints: meteringPoints.filter((point) => point.site_id === site.id),
 powersOfAttorney: powersOfAttorneyByCustomerId.get(site.customer_id) ?? [],
 })

 readinessMap.set(site.id, readiness)
 }

 const allRows: SwitchRow[] = requests.map((request) => {
 const site = sites.find(site => site.id === request.site_id && site.company_id === request.company_id && site.customer_id === request.customer_id)
 const readiness = site ? readinessMap.get(site.id) ?? null : null
 const outbound =
 outboundRequests.find(
 (row) =>
 row.source_type === 'supplier_switch_request' &&
 row.source_id === request.id && row.company_id === request.company_id &&
 row.customer_id === request.customer_id && row.site_id === request.site_id
 ) ?? null

 const activation = request.status === 'accepted' ? getVerifiedSupplierSwitchActivationReadiness(
 request, marketStarts.kind === 'unavailable' ? undefined : marketStarts.data.get(request.id.toLowerCase()) ?? null, now,
 ) : null
 const lifecycle = getSwitchLifecycle({
 request,
 readiness,
 activation,
 outboundRequest: outbound,
 })

 return {
 request,
 readiness,
 outbound,
 lifecycle,
 activation,
 }
 })

 const blockedCount = allRows.filter(
 (row) => row.lifecycle.stage === 'blocked'
 ).length
 const queuedForOutboundCount = allRows.filter(
 (row) => row.lifecycle.stage === 'queued_for_outbound'
 ).length
 const awaitingDispatchCount = allRows.filter(
 (row) => row.lifecycle.stage === 'awaiting_dispatch'
 ).length
 const awaitingResponseCount = allRows.filter(
 (row) => row.lifecycle.stage === 'awaiting_response'
 ).length
 const readyToExecuteCount = allRows.filter(
 (row) => row.lifecycle.stage === 'ready_to_execute'
 ).length
 const failedCount = allRows.filter(
 (row) => row.lifecycle.stage === 'failed'
 ).length
 const completedCount = allRows.filter(
 (row) => row.lifecycle.stage === 'completed'
 ).length

 const filteredRows = allRows.filter((row) => matchesStageFilter(row, stage))

 const activationCompanies = canManage
   ? await readSwitchActivationCompanyIds(supabase, context.userId, filteredRows
       .filter(row => row.lifecycle.stage === 'ready_to_execute').map(row => row.request.company_id))
   : new Set<string>()

 const visibleCustomerIds = [...new Set(filteredRows.map(({ request }) => request.customer_id))]
 const visibleCustomers = new Set(filteredRows.map(({ request }) => `${request.company_id}/${request.customer_id}`))
 const customerNames = await readResult(async () => {
   const labels = new Map<string, string>()
   if (visibleCustomerIds.length === 0) return labels
   let customersQuery = supabase.from('customers')
     .select('id,company_id,full_name,first_name,last_name,company_name,customer_number', { count: 'exact' })
     .in('id', visibleCustomerIds).limit(visibleCustomerIds.length)
   if (companyId) customersQuery = customersQuery.eq('company_id', companyId)
   const result = await customersQuery
   if (result.error) throw result.error
   if (!Array.isArray(result.data) || result.count !== result.data.length) throw new InvalidReadModelResponseError()
   for (const customer of result.data) {
     if (!customer) throw new InvalidReadModelResponseError()
     const key = `${customer.company_id}/${customer.id}`
     if (!visibleCustomers.has(key) || labels.has(key)) throw new InvalidReadModelResponseError()
     labels.set(key, formatCustomerName(customer))
   }
   return labels
 }, { definitionVersion: 'supplier_switch_list_customer_names_v1', errorCode: 'SWITCH_CUSTOMER_NAMES_UNAVAILABLE' })
 const siteById = new Map(sites.map(site => [site.id, site]))

 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Leverantörsbyten och flyttar"
 subtitle="Sök leveransärenden och följ bekräftelse, startdatum och nästa steg."
 userEmail={context.email}
 />

 <div className="space-y-4 p-4 lg:p-6">
 <section className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-7">
 <KpiCard
 label="Stoppade eller ofullständiga"
 value={blockedCount}
 href={buildSwitchesHref({
 status,
 requestType,
 stage: 'blocked',
 q: query,
 })}
 active={stage === 'blocked'}
 />
 <KpiCard
 label="Utskick behöver förberedas"
 value={queuedForOutboundCount}
 href={buildSwitchesHref({
 status,
 requestType,
 stage: 'queued_for_outbound',
 q: query,
 })}
 active={stage === 'queued_for_outbound'}
 />
 <KpiCard
 label="Väntar på utskick"
 value={awaitingDispatchCount}
 href={buildSwitchesHref({
 status,
 requestType,
 stage: 'awaiting_dispatch',
 q: query,
 })}
 active={stage === 'awaiting_dispatch'}
 />
 <KpiCard
 label="Väntar på svar"
 value={awaitingResponseCount}
 href={buildSwitchesHref({
 status,
 requestType,
 stage: 'awaiting_response',
 q: query,
 })}
 active={stage === 'awaiting_response'}
 />
 <KpiCard
 label="Redo för leveransstart"
 value={readyToExecuteCount}
 href="/admin/operations/ready-to-execute"
 active={stage === 'ready_to_execute'}
 />
 <KpiCard
 label="Behöver granskas"
 value={failedCount}
 href={buildSwitchesHref({
 status,
 requestType,
 stage: 'failed',
 q: query,
 })}
 active={stage === 'failed'}
 />
 <KpiCard
 label="Klart"
 value={completedCount}
 href={buildSwitchesHref({
 status,
 requestType,
 stage: 'completed',
 q: query,
 })}
 active={stage === 'completed'}
 />
 </section>

 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="flex flex-wrap items-start justify-between gap-4">
 <div>
 <h2 className="text-lg font-semibold text-slate-950 ">
 Sök och filtrera
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Välj ett handläggningsläge för att se vad som återstår inför leveransstart.
 </p>
 </div>

 <div className="flex flex-wrap gap-3">
 <Link
 href="/admin/operations/ready-to-execute"
 className="rounded-2xl border border-emerald-300 px-4 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 "
 >
 Öppna aktiveringskön
 </Link>

 <Link
 href="/admin/outbound"
 className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 "
 >
 Öppna utskick
 </Link>
 </div>
 </div>

 <form className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto] [&_input]:min-w-0 [&_input]:w-full [&_select]:min-w-0 [&_select]:w-full">
 <input
 name="q"
 aria-label="Sök leverantörsbyten"
 defaultValue={query}
 placeholder="Kundnamn, kundnummer, anläggning, mätpunkt eller referens"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm outline-none focus:border-emerald-700 "
 />

 <select
 name="status"
 aria-label="Registrerad status"
 defaultValue={status}
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 >
 <option value="all">Alla registrerade statusar</option>
 <option value="draft">Utkast</option>
 <option value="queued">Köad</option>
 <option value="submitted">Skickad</option>
 <option value="accepted">Accepterad</option>
 <option value="rejected">Avvisad</option>
 <option value="completed">Slutförd</option>
 <option value="failed">Kräver åtgärd</option>
 </select>

 <select
 name="requestType"
 aria-label="Ärendetyp"
 defaultValue={requestType}
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 >
 <option value="all">Alla typer</option>
 <option value="switch">Leverantörsbyte</option>
 <option value="move_in">Inflytt</option>
 <option value="move_out_takeover">Övertagande vid utflytt</option>
 </select>

 <select
 name="stage"
 aria-label="Handläggningsläge"
 defaultValue={stage}
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 >
 <option value="all">Alla handläggningslägen</option>
 <option value="blocked">Blockerad</option>
 <option value="queued_for_outbound">Saknar utskick</option>
 <option value="awaiting_dispatch">Väntar på utskick</option>
 <option value="awaiting_response">Väntar på svar</option>
 <option value="awaiting_market_confirmation">Väntar på nätägarens bekräftelse</option>
 <option value="awaiting_effective_date">Väntar på leveransstart</option>
 <option value="ready_to_execute">Redo för leveransstart</option>
 <option value="completed">Slutförd</option>
 <option value="failed">Kräver åtgärd</option>
 </select>

 <div className="flex gap-3">
 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 ">
 Filtrera
 </button>
 <Link
 href="/admin/operations/switches"
 className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 "
 >
 Rensa
 </Link>
 </div>
 </form>
 </section>

 <section className="rounded-2xl border border-slate-200 bg-white shadow-sm ">
 <div className="border-b border-slate-200 px-6 py-5 ">
 <div className="flex flex-wrap items-start justify-between gap-4">
 <div>
 <h2 className="text-lg font-semibold text-slate-950 ">
 Leveranser
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 {filteredRows.length} ärenden på sidan.
 </p>
 </div>

 {stage === 'ready_to_execute' ? (
 <Link
 href="/admin/operations/ready-to-execute"
 className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
 >
 Gå till aktiveringskön
 </Link>
 ) : null}
 </div>
 </div>

 <div className="space-y-4 p-6">
 <p className="text-sm text-slate-600">Antal och handläggningsläge gäller den här sidans ärenden. {page.hasMore ? 'Fler ärenden finns på nästa sida.' : 'Detta är sista sidan i urvalet.'} {page.coverage === 'partial' ? 'Urvalet är delvis genomsökt. Fortsätt även om inget matchar här.' : null}</p>
 {page.hasMore && page.nextCursor ? <Link className="inline-block font-semibold underline" href={buildSwitchesHref({ status, requestType, q: query, stage, cursor: page.nextCursor })}>Nästa sida med äldre ärenden</Link> : null}
 {filteredRows.length === 0 ? (
 <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-700 ">
 Inga leveransärenden på den här sidan matchade filtret.
 </div>
 ) : (
 filteredRows.map((row) => {
 const { request, readiness, outbound, lifecycle, activation } = row
 const { closed, cancellation, paused, progress, showMissingReadiness } = getSupplierSwitchBusinessState(request, readiness, lifecycle.stage, activation)
 const companyWritable = writableCompanies.has(request.company_id ?? '')
 const site = siteById.get(request.site_id)
 const ownSite = site && site.company_id === request.company_id && site.customer_id === request.customer_id ? site : undefined
 const canValidate = canManage && companyWritable && !closed && !cancellation
 const canPrepare = canQueue && companyWritable && !closed && !cancellation && !paused && ownSite && readiness?.isReady
   && lifecycle.stage === 'queued_for_outbound' && ['queued', 'submitted', 'accepted'].includes(request.status) && !outbound
 // The market confirmation and date decide activation. Pre-send checks can no longer be relevant.
 const queueLink = !closed && !cancellation && !paused && ownSite && lifecycle.stage === 'ready_to_execute'
 const facility = [ownSite?.site_name, ownSite?.facility_id].filter(Boolean).join(' · ') || 'Saknas'
 const requestTypeLabel = supplierSwitchRequestTypeLabel(request.request_type)
 const customerName = customerNames.kind === 'unavailable'
   ? 'Kunduppgift kunde inte läsas'
   : customerNames.data.get(`${request.company_id}/${request.customer_id}`) ?? 'Okänd kund'
 const progressTitle = showMissingReadiness ? 'Uppgifterna behöver kontrolleras' : progress.label
 const progressDescription = showMissingReadiness
   ? 'Anläggningen saknas eller kunde inte läsas. Komplettera uppgifterna innan bytet går vidare.'
   : progress.description

 return (
 <article key={request.id} className="min-w-0 rounded-2xl border border-slate-200 p-4">
   <div className="flex flex-wrap items-start justify-between gap-3">
     <div className="min-w-0 flex-1 break-words">
       <h3 className="font-semibold text-slate-950">{customerName}</h3>
       <p className="mt-1 text-sm text-slate-700">{requestTypeLabel}</p>
     </div>
     <div className="flex flex-wrap items-center gap-2">
       <Link href={`/admin/operations/switches/${request.id}`} className="inline-flex min-h-11 items-center rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800">Öppna ärende</Link>
       {(canReadCustomer && ownSite) || canValidate || canPrepare || queueLink ? <AdminActionsMenu ariaLabel={`Fler åtgärder för ${requestTypeLabel.toLocaleLowerCase('sv-SE')} · ${customerName}`}>
         {canReadCustomer && ownSite ? <Link href={`/admin/customers/${request.customer_id}`}>Öppna kundkort</Link> : null}
         {canValidate ? <form action={validateSupplierSwitchBeforeProcessingAction}>
           <input type="hidden" name="request_id" value={request.id} />
           <button>Kontrollera uppgifter</button>
         </form> : null}
         {canPrepare ? <form action={queueSupplierSwitchOutboundAction}>
           <input type="hidden" name="request_id" value={request.id} />
           <button>Förbered utskick</button>
         </form> : null}
         {queueLink ? <Link href="/admin/operations/ready-to-execute">Öppna aktiveringskön</Link> : null}
       </AdminActionsMenu> : null}
     </div>
   </div>
   <dl className="mt-4 grid grid-cols-1 gap-3 break-words text-sm sm:grid-cols-2 xl:grid-cols-4 [&_dt]:text-slate-600 [&_dd]:font-medium [&_dd]:text-slate-950">
     <div><dt>Anläggning</dt><dd>{facility}</dd></div>
     <div><dt>Önskad leveransstart</dt><dd>{formatSupplierSwitchDate(request.requested_start_date)}</dd></div>
     <div><dt>Bekräftad leveransstart</dt><dd>{formatSupplierSwitchDate(request.confirmed_start_date)}</dd></div>
     <div><dt>Ny elleverantör</dt><dd>{request.incoming_supplier_name ?? 'Saknas'}</dd></div>
   </dl>
   <div className="mt-4 break-words text-sm text-slate-700">
     <h4 className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(lifecycle.stage)}`}>{progressTitle}</h4>
     {closed ? null : <p className="mt-2 font-medium">Nästa steg</p>}
     <p className={closed ? 'mt-2' : undefined}>{progressDescription}</p>
   </div>
   {!companyWritable && (canManage || canQueue) ? <p className="mt-2 text-sm text-slate-700">Ändringar är blockerade för bolaget.</p> : null}
   {queueLink && activationCompanies.has(request.company_id ?? '') ? (
     <form action={finalizeSupplierSwitchExecutionAction} className="mt-3"><input type="hidden" name="request_id" value={request.id} /><button className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">Aktivera leverans</button></form>
   ) : null}
   <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-2">
     {request.current_supplier_name || request.external_reference ? <details className="min-w-0 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
       <summary className="cursor-pointer font-semibold">Leveransuppgifter</summary>
       <dl className="mt-3 space-y-2 break-words [&_dt]:text-xs [&_dt]:font-medium [&_dt]:text-slate-600">
         {request.current_supplier_name ? <div><dt>Nuvarande elleverantör</dt><dd>{request.current_supplier_name}</dd></div> : null}
         {request.external_reference ? <div><dt>Extern referens</dt><dd>{request.external_reference}</dd></div> : null}
       </dl>
     </details> : null}
     {isPlatform ? <details className="min-w-0 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
       <summary className="cursor-pointer font-semibold">Teknisk diagnostik</summary>
       <dl className="mt-3 space-y-2 break-words [&_dt]:text-xs [&_dt]:font-medium [&_dt]:text-slate-600">
         <div><dt>Ärendereferens</dt><dd>{request.id}</dd></div>
         <div><dt>Mätpunkt</dt><dd>{request.metering_point_id}</dd></div>
         <div><dt>Registrerad status</dt><dd>{formatStatusLabel(request.status, 'Status saknas', 'Behöver granskning')}</dd></div>
         <div><dt>Utskick</dt><dd>{outbound ? formatStatusLabel(outbound.status) : 'Inget utskick ännu'}</dd></div>
         <div><dt>Tekniskt läge</dt><dd>{lifecycle.label}</dd></div>
         <div><dt>Teknisk förklaring</dt><dd>{lifecycle.reason}</dd></div>
         <div><dt>Senaste händelse</dt><dd>{latestEventText(request.id, events)}</dd></div>
         {request.failure_reason ? <div><dt>Felorsak</dt><dd>{request.failure_reason}</dd></div> : null}
         {readiness && !readiness.isReady ? <div><dt>Blockeringar</dt><dd>{summarizeReadinessIssues(readiness)}</dd></div> : null}
       </dl>
       {canManage && companyWritable && canEditManualSwitchStatus(request.status) ? (
       <form action={updateSupplierSwitchStatusFromAdminAction} className="mt-4 border-t border-slate-200 pt-3">
         <fieldset className="grid min-w-0 grid-cols-1 gap-3">
         <legend className="mb-3 font-semibold">Uppdatera ärendestatus</legend>
         <input type="hidden" name="request_id" value={request.id} />
         <input type="hidden" name="expected_status" value={request.status} />
         <input type="hidden" name="expected_updated_at" value={request.updated_at} />
         <label className="grid min-w-0 grid-cols-1 gap-1 font-medium">Status
           <select name="status" aria-label={`Status för ${requestTypeLabel.toLocaleLowerCase('sv-SE')} · ${customerName}`} defaultValue={request.status} className="min-h-10 min-w-0 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-normal">
             {manualSwitchStatusOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
           </select>
         </label>
         <label className="grid min-w-0 grid-cols-1 gap-1 font-medium">Extern referens<input name="external_reference" defaultValue={request.external_reference ?? ''} className="min-h-10 min-w-0 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-normal" /></label>
         <label className="grid min-w-0 grid-cols-1 gap-1 font-medium">Felorsak<textarea name="failure_reason" defaultValue={request.failure_reason ?? ''} rows={3} className="min-w-0 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-normal" /></label>
         <button className="justify-self-start rounded-xl bg-emerald-700 px-4 py-2.5 font-semibold text-white hover:bg-emerald-800">Spara status</button>
         </fieldset>
       </form>
       ) : null}
     </details> : null}
   </div>
 </article>
 )
 })
 )}
 </div>
 </section>
 </div>
 </div>
 )
}
