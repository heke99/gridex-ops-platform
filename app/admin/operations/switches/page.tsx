import AdminActionsMenu from "@/components/admin/ui/AdminActionsMenu"
import CustomerName from '@/components/admin/CustomerName'
//app/admin/operations/switches/page.tsx
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { listMeteringPointsBySiteIds } from '@/lib/masterdata/db'
import {
 listAllSupplierSwitchRequests,
 listPowersOfAttorneyByCustomerIds,
 listSupplierSwitchEventsByRequestIds,
} from '@/lib/operations/db'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import { listOutboundRequests } from '@/lib/cis/db'
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

type SwitchesPageProps = {
 searchParams: Promise<{
 status?: string
 requestType?: string
 stage?: string
 q?: string
 }>
}

type SwitchRow = {
 request: Awaited<ReturnType<typeof listAllSupplierSwitchRequests>>[number]
 readiness: ReturnType<typeof evaluateSiteSwitchReadiness> | null
 outbound: Awaited<ReturnType<typeof listOutboundRequests>>[number] | null
 lifecycle: ReturnType<typeof getSwitchLifecycle>
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
 if (!latest) return 'Inga events ännu'
 return latest.message ?? `${latest.event_type} — ${latest.event_status}`
}

function buildSwitchesHref(params: {
 status?: string
 requestType?: string
 stage?: string
 q?: string
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
 const supabase = await createSupabaseServerClient()

 const status = (resolvedSearchParams.status ?? 'all').trim()
 const requestType = (resolvedSearchParams.requestType ?? 'all').trim()
 const stage = (resolvedSearchParams.stage ?? 'all').trim()
 const query = (resolvedSearchParams.q ?? '').trim()

 const requests = await listAllSupplierSwitchRequests(supabase, {
 status,
 requestType,
 query,
 companyId,
 })

 const requestIds = requests.map((request) => request.id)
 const siteIds = Array.from(new Set(requests.map((request) => request.site_id)))

 const sitesPromise: Promise<CustomerSiteRow[]> = siteIds.length > 0
 ? (async () => {
 let sitesQueryBuilder = supabase
 .from('customer_sites')
 .select('*')
 .in('id', siteIds)

 if (companyId) {
 sitesQueryBuilder = sitesQueryBuilder.eq('company_id', companyId)
 }

 const sitesQuery = await sitesQueryBuilder
 if (sitesQuery.error) throw sitesQuery.error
 return (sitesQuery.data ?? []) as CustomerSiteRow[]
 })()
 : Promise.resolve([] as CustomerSiteRow[])

 const [sites, events, outboundRequests, meteringPoints] = await Promise.all([
 sitesPromise,
 listSupplierSwitchEventsByRequestIds(supabase, requestIds),
 listOutboundRequests({
 status: 'all',
 requestType: 'supplier_switch',
 channelType: 'all',
 query: '',
 companyId,
 }),
 listMeteringPointsBySiteIds(supabase, siteIds, { companyId }),
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
 const readiness = readinessMap.get(request.site_id) ?? null
 const outbound =
 outboundRequests.find(
 (row) =>
 row.source_type === 'supplier_switch_request' &&
 row.source_id === request.id
 ) ?? null

 const lifecycle = getSwitchLifecycle({
 request,
 readiness,
 outboundRequest: outbound,
 })

 return {
 request,
 readiness,
 outbound,
 lifecycle,
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

 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Switchar"
 subtitle="Hantera leverantörsbyten, validering, outboundkoppling och intern slutföring av switchar."
 userEmail={context.email}
 />

 <div className="space-y-4 p-4 lg:p-6">
 <section className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-7">
 <KpiCard
 label="Blockerade"
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
 label="Saknar utskick"
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
 label="Väntar kvittens"
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
 label="Redo att slutföra"
 value={readyToExecuteCount}
 href="/admin/operations/ready-to-execute"
 active={stage === 'ready_to_execute'}
 />
 <KpiCard
 label="Kräver åtgärd"
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
 label="Slutförda"
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
 Filter och arbetsläge
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Filtrera på status, ärendetyp och handläggningsläge. Ärenden som är redo att slutföras visas i den dedikerade slutföringskön.
 </p>
 </div>

 <div className="flex flex-wrap gap-3">
 <Link
 href="/admin/operations/ready-to-execute"
 className="rounded-2xl border border-emerald-300 px-4 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 "
 >
 Öppna slutföringskö
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
 placeholder="Sök på kund, site, mätpunkt, leverantör eller referens"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm outline-none focus:border-emerald-700 "
 />

 <select
 name="status"
 aria-label="Status"
 defaultValue={status}
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 >
 <option value="all">Alla statusar</option>
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
 <option value="switch">Switch</option>
 <option value="move_in">Move in</option>
 <option value="move_out_takeover">Move out takeover</option>
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
 <option value="ready_to_execute">Redo att slutföra</option>
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
 Switchlista
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 {filteredRows.length} träffar.
 </p>
 </div>

 {stage === 'ready_to_execute' ? (
 <Link
 href="/admin/operations/ready-to-execute"
 className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
 >
 Gå till slutföringskön
 </Link>
 ) : null}
 </div>
 </div>

 <div className="space-y-4 p-6">
 {filteredRows.length === 0 ? (
 <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-700 ">
 Inga switchärenden matchade filtret.
 </div>
 ) : (
 filteredRows.map((row) => {
 const { request, readiness, outbound, lifecycle } = row

 return (
 <article key={request.id} className="min-w-0 rounded-2xl border border-slate-200 p-4">
   <div className="flex flex-wrap items-start justify-between gap-3">
     <div className="min-w-0 flex-1 break-words">
       <h3 className="font-semibold text-slate-950"><Link href={`/admin/operations/switches/${request.id}`} className="hover:underline"><CustomerName id={request.customer_id} /></Link></h3>
       <p className="mt-1 text-sm text-slate-700">{request.request_type} · Startdatum {request.requested_start_date ?? '—'} · {request.incoming_supplier_name}</p>
     </div>
     <div className="flex flex-wrap items-center gap-2">
       <Link href={`/admin/operations/switches/${request.id}`} className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800">Öppna ärende</Link>
       <AdminActionsMenu ariaLabel={`Fler åtgärder för switchärende ${request.id}`}>
         <Link href={`/admin/customers/${request.customer_id}`}>Öppna kundkort</Link>
         <form action={validateSupplierSwitchBeforeProcessingAction}>
           <input type="hidden" name="request_id" value={request.id} />
           <button>{request.status === 'draft' ? 'Validera & markera redo' : 'Kör validering'}</button>
         </form>
         {['queued', 'submitted', 'accepted'].includes(request.status) && !outbound ? (
           <form action={queueSupplierSwitchOutboundAction}><input type="hidden" name="request_id" value={request.id} /><button>Köa utskick manuellt</button></form>
         ) : null}
         {lifecycle.stage === 'ready_to_execute' ? <Link href="/admin/operations/ready-to-execute">Öppna slutföringskö</Link> : null}
       </AdminActionsMenu>
     </div>
   </div>
   <div className="mt-3 flex flex-wrap items-center gap-2">
     <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(request.status)}`}>{formatStatusLabel(request.status)}</span>
     <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(lifecycle.stage)}`}>{lifecycle.label}</span>
     {outbound ? <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(outbound.status)}`}>Utskick: {formatStatusLabel(outbound.status)}</span> : <span className="text-xs font-medium text-slate-600">Inget utskick ännu</span>}
     {['queued', 'submitted', 'accepted'].includes(request.status) && outbound ? <span className="text-xs font-medium text-emerald-700">Utskick finns redan</span> : null}
   </div>
   <div className="mt-2 space-y-1 break-words text-sm text-slate-700">
     <p>{lifecycle.reason}</p>
     {request.failure_reason ? <p className="font-medium text-red-700">Felorsak: {request.failure_reason}</p> : null}
     {readiness && !readiness.isReady ? <p className="font-medium text-red-700">Blockeringar: {summarizeReadinessIssues(readiness)}</p> : null}
   </div>
   {lifecycle.stage === 'ready_to_execute' ? (
     <form action={finalizeSupplierSwitchExecutionAction} className="mt-3"><input type="hidden" name="request_id" value={request.id} /><button className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">Slutför switch</button></form>
   ) : null}
   <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-2">
     <details className="min-w-0 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
       <summary className="cursor-pointer font-semibold">Ärendedetaljer</summary>
       <dl className="mt-3 space-y-2 break-words [&_dt]:text-xs [&_dt]:font-medium [&_dt]:text-slate-600">
         <div><dt>Switchärende</dt><dd>{request.id}</dd></div>
         <div><dt>Anläggning</dt><dd>{request.site_id}</dd></div>
         <div><dt>Mätpunkt</dt><dd>{request.metering_point_id}</dd></div>
         <div><dt>Nuvarande leverantör</dt><dd>{request.current_supplier_name ?? '—'}</dd></div>
         <div><dt>Extern referens</dt><dd>{request.external_reference ?? '—'}</dd></div>
         <div><dt>Senaste händelse</dt><dd>{latestEventText(request.id, events)}</dd></div>
       </dl>
     </details>
     <details className="min-w-0 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
       <summary className="cursor-pointer font-semibold">Uppdatera switchstatus</summary>
       <form action={updateSupplierSwitchStatusFromAdminAction} className="mt-3 grid min-w-0 grid-cols-1 gap-3">
         <input type="hidden" name="request_id" value={request.id} />
         <label className="grid min-w-0 grid-cols-1 gap-1 font-medium">Status
           <select name="status" aria-label={`Status för switchärende ${request.id}`} defaultValue={request.status} className="min-h-10 min-w-0 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-normal">
             <option value="draft">Utkast</option><option value="queued">Köad</option><option value="submitted">Skickad</option><option value="accepted">Accepterad</option><option value="rejected">Avvisad</option><option value="completed">Slutförd</option><option value="failed">Kräver åtgärd</option>
           </select>
         </label>
         <label className="grid min-w-0 grid-cols-1 gap-1 font-medium">Extern referens<input name="external_reference" defaultValue={request.external_reference ?? ''} className="min-h-10 min-w-0 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-normal" /></label>
         <label className="grid min-w-0 grid-cols-1 gap-1 font-medium">Felorsak<textarea name="failure_reason" defaultValue={request.failure_reason ?? ''} rows={3} className="min-w-0 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-normal" /></label>
         <button className="justify-self-start rounded-xl bg-emerald-700 px-4 py-2.5 font-semibold text-white hover:bg-emerald-800">Spara status</button>
       </form>
     </details>
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
