import { getAdminPageRequirement } from '@/lib/admin/accessModel'
import { canPresentAdminAction, canPresentAdminLink, canPresentOperationalAction } from '@/lib/admin/actionPresentation'
import AdminActionsMenu from "@/components/admin/ui/AdminActionsMenu"
import AdminDisclosurePanel from "@/components/admin/ui/AdminDisclosurePanel"
import CustomerName from '@/components/admin/CustomerName'
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import {
 listAllBillingUnderlays,
 listAllPartnerExports,
 listOutboundDispatchEventsByRequestIds,
 listOutboundRequests,
} from '@/lib/cis/db'
import { updateOutboundRequestStatusAction } from '@/app/admin/cis/actions'
import {
 bulkQueueReadyBillingExportsAction,
 runOperationsAutomationSweepAction,
} from '@/app/admin/operations/control-actions'
import { getBillingExportReadiness } from '@/lib/operations/controlTower'
import { listAllSupplierSwitchRequests } from '@/lib/operations/db'
import { formatStatusLabel } from '@/lib/ui/format'

export const dynamic = 'force-dynamic'

type PageProps = {
 searchParams: Promise<{
 status?: string
 requestType?: string
 channelType?: string
 q?: string
 }>
}

type LinkedEdielMessageRow = {
 id: string
 outbound_request_id: string | null
 direction: string
 message_family: string
 message_code: string
 status: string
 created_at: string
}

function tone(status: string): string {
 if (['acknowledged'].includes(status)) {
 return 'bg-emerald-100 text-emerald-700 '
 }
 if (['failed', 'cancelled'].includes(status)) {
 return 'bg-red-100 text-red-700 '
 }
 if (['sent'].includes(status)) {
 return 'bg-emerald-100 text-emerald-700 '
 }
 return 'bg-amber-100 text-amber-700 '
}

function latestEventText(
 requestId: string,
 events: Array<{
 outbound_request_id: string
 message: string | null
 event_type: string
 event_status: string
 }>
): string {
 const latest = events.find((event) => event.outbound_request_id === requestId)
 if (!latest) return 'Inga dispatch-events ännu'
 return latest.message ?? `${latest.event_type} — ${latest.event_status}`
}

function TriageCard({
 title,
 description,
 href,
}: {
 title: string
 description: string
 href: string
}) {
 return (
 <Link
 href={href}
 className="block rounded-2xl border border-slate-200 p-4 transition hover:bg-slate-50 "
 >
 <div className="font-semibold text-slate-900 ">{title}</div>
 <div className="mt-1 text-sm text-slate-700 ">
 {description}
 </div>
 </Link>
 )
}

function buildPrimaryDetailLink(
 request: {
 id: string
 request_type: string
 source_type: string | null
 source_id: string | null
 },
 latestEdielMessageByOutboundId: Map<string, LinkedEdielMessageRow>
): { href: string; label: string } | null {
 const linkedMessage = latestEdielMessageByOutboundId.get(request.id)

 if (linkedMessage) {
 return {
 href: `/admin/messages/${linkedMessage.id}`,
 label: 'Öppna meddelande',
 }
 }

 if (request.source_type === 'grid_owner_data_request' && request.source_id) {
 return {
 href: `/admin/operations/grid-owner-requests/${request.source_id}`,
 label: 'Öppna request-detail',
 }
 }

 if (request.source_type === 'supplier_switch_request' && request.source_id) {
 return {
 href: `/admin/operations/switches/${request.source_id}`,
 label: "Visa leverantörsbyte",
 }
 }

 if (request.request_type === 'billing_underlay') {
 return {
 href: '/admin/billing',
 label: 'Öppna billing',
 }
 }

 if (request.request_type === 'meter_values') {
 return {
 href: '/admin/metering',
 label: 'Öppna metering',
 }
 }

 return null
}

async function runAutomationSweepFormAction(): Promise<void> {
 'use server'
 await runOperationsAutomationSweepAction()
}

async function queueReadyBillingExportsFormAction(
 formData: FormData
): Promise<void> {
 'use server'
 await bulkQueueReadyBillingExportsAction(formData)
}

export default async function OutboundPage({ searchParams }: PageProps) {
 const context = await requireAdminPageKeyAccess('outbound.queue')
 const tenantScope = await resolveAdminTenantReadScope(context)
 const companyId = tenantScope.companyId
 const operationalCompanyId = tenantScope.isPlatformAdmin ? context.companyId : companyId
 const [canUpdate, canSweep, canQueueBilling] = await Promise.all([
   canPresentAdminAction(['switching.write', 'metering.write', 'billing_underlay.write']),
   canPresentOperationalAction(['switching.write', 'metering.write', 'billing_underlay.write', 'partner_exports.write'], operationalCompanyId),
   canPresentOperationalAction(['billing_underlay.write', 'partner_exports.write'], operationalCompanyId),
 ])

 const params = await searchParams
 const status = (params.status ?? 'all').trim()
 const requestType = (params.requestType ?? 'all').trim()
 const channelType = (params.channelType ?? 'all').trim()
 const query = (params.q ?? '').trim()

 const supabase = await createSupabaseServerClient()

 const [requests, underlays, partnerExports, switchRequests] = await Promise.all([
 listOutboundRequests({
 status,
 requestType,
 channelType,
 query,
 companyId,
 }),
 listAllBillingUnderlays({ status: 'all', query: '', companyId }),
 listAllPartnerExports({ status: 'all', exportKind: 'all', query: '', companyId }),
 listAllSupplierSwitchRequests(supabase, {
 status: 'all',
 requestType: 'all',
 query: '',
 companyId,
 }),
 ])

 const rowCompanies = [...new Set(requests.map(row => row.company_id ?? companyId).filter((id): id is string => Boolean(id)))]
 const writableCompanies = new Map(await Promise.all(canUpdate ? rowCompanies.map(async id => [id, await canPresentOperationalAction(['switching.write', 'metering.write', 'billing_underlay.write'], id)] as const) : []))

 // Ordinary company staff get the customer task and actual transport state.
 // Manual diagnostic editing stays in the platform workspace below.
 if (!tenantScope.isPlatformAdmin) {
   const canReadCustomers = canPresentAdminLink(context, { anyOf: ['customers.read', 'masterdata.read'] })
   const statusLabels: Record<string, string> = { queued: 'Köad', prepared: 'Förberedd', sent: 'Skickad', acknowledged: 'Kvitterad', failed: 'Kräver åtgärd', cancelled: 'Avbruten' }
   const typeLabels: Record<string, string> = { supplier_switch: 'Leverantörsbyte', customer_masterdata: 'Kund- och anläggningsuppgifter', meter_values: 'Mätvärden', billing_underlay: 'Faktureringsunderlag', billing_export: 'Fakturaexport' }
   const label = (labels: Record<string, string>, value: string, fallback: string) => Object.hasOwn(labels, value) ? labels[value] : fallback
   const details = (request: typeof requests[number]) => {
     if (request.source_type === 'supplier_switch_request' && request.source_id && canPresentAdminLink(context, getAdminPageRequirement('operations.switches'))) return { href: `/admin/operations/switches/${request.source_id}`, text: 'Öppna leverantörsbyte' }
     if (request.source_type === 'grid_owner_data_request' && request.source_id && canPresentAdminLink(context, getAdminPageRequirement('operations.grid_owner_request_detail'))) return { href: `/admin/operations/grid-owner-requests/${request.source_id}`, text: 'Öppna uppgiftsbegäran' }
     return null
   }
   return <div className="min-h-screen">
     <AdminHeader title="Utskick" subtitle="Följ kundärendenas utskick, bekräftelser och behov av uppföljning." userEmail={context.email} />
     <main className="min-w-0 space-y-4 p-4 lg:p-6">
       <form className="grid min-w-0 gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
         <input name="q" aria-label="Sök utskick" defaultValue={query} placeholder="Sök på referens bland inlästa utskick" className="min-h-11 min-w-0 rounded-xl border border-slate-300 px-3 text-sm" />
         <select name="status" aria-label="Utskickets status" defaultValue={status} className="min-h-11 min-w-0 rounded-xl border border-slate-300 px-3 text-sm"><option value="all">Alla statusar</option>{Object.entries(statusLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>
         <select name="requestType" aria-label="Typ av utskick" defaultValue={requestType} className="min-h-11 min-w-0 rounded-xl border border-slate-300 px-3 text-sm"><option value="all">Alla typer</option>{Object.entries(typeLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>
         <div className="flex flex-wrap gap-3"><button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Filtrera</button><Link href="/admin/outbound" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold">Rensa</Link></div>
         {channelType !== 'all' ? <input type="hidden" name="channelType" value={channelType} /> : null}
       </form>
       <div className="flex flex-wrap gap-3">
         {canSweep ? <form action={runAutomationSweepFormAction}><button className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold">Kör automatisk kontroll</button></form> : null}
         {canQueueBilling ? <form action={queueReadyBillingExportsFormAction}><button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Förbered fakturaexporter</button></form> : null}
       </div>
       <p className="text-sm text-slate-600">{requests.length} utskick i det inlästa urvalet. Meddelandets status gäller utskicket. Följ kundärendet för dess fortsatta handläggning.</p>
       {requests.length ? <div role="region" aria-label="Kundernas utskick" tabIndex={0} className="max-h-[68vh] min-w-0 space-y-3 overflow-y-auto rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">
         {requests.map(request => {
           const detail = details(request)
           const canHandle = canUpdate && writableCompanies.get(request.company_id ?? companyId ?? '')
           const nextStep = request.status === 'cancelled' ? 'Utskicket är avbrutet.' : request.status === 'acknowledged' ? 'Meddelandet är kvitterat. Kontrollera kundärendet för nästa steg.' : request.status === 'failed' ? 'Utskicket behöver granskas. Kontrollera ärendet innan ett nytt försök.' : request.channel_type === 'unresolved' ? 'Mottagarens kontaktväg behöver kontrolleras innan utskick.' : request.status === 'sent' ? 'Utskicket är markerat som skickat. Följ ärendet för mottagarens bekräftelse och svar.' : 'Inväntar utskick. Följ ärendet för nästa steg.'
           const quickAction = (nextStatus: string, step: string, text: string) => <form action={updateOutboundRequestStatusAction}>
             <input type="hidden" name="outbound_request_id" value={request.id} /><input type="hidden" name="customer_id" value={request.customer_id} /><input type="hidden" name="status" value={nextStatus} /><input type="hidden" name="dispatch_step" value={step} />
             {step === 'fail' ? <input type="hidden" name="failure_reason" value="Utskicket markerades som misslyckat av handläggare." /> : null}
             <button className="min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold">{text}</button>
           </form>
           return <article key={request.id} className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
             <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="min-w-0 break-words font-semibold">{canReadCustomers ? <CustomerName id={request.customer_id} /> : 'Kunduppgifter kräver kundläsbehörighet'}</h2><span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(request.status)}`}>{label(statusLabels, request.status, 'Status behöver kontrolleras')}</span></div>
             <p className="text-sm font-medium">{label(typeLabels, request.request_type, 'Kundärende')}</p>
             {request.period_start || request.period_end ? <p className="break-words text-sm">Period: {request.period_start ?? '—'} – {request.period_end ?? '—'}</p> : null}
             {request.external_reference ? <p className="break-all text-sm">Referens: {request.external_reference}</p> : null}
             <p className="text-sm text-slate-700">{nextStep}</p>
             <div className="flex flex-wrap gap-3">{detail ? <Link href={detail.href} className="text-sm font-semibold underline">{detail.text}</Link> : null}{canReadCustomers ? <Link href={`/admin/customers/${request.customer_id}`} className="text-sm font-semibold underline">Öppna kundkort</Link> : null}</div>
             {canHandle && ['queued', 'prepared', 'sent'].includes(request.status) ? <details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold">Hantera utskick</summary><div className="mt-3 flex flex-wrap gap-3">{request.status === 'queued' ? quickAction('prepared', 'prepare', 'Förbered utskick') : null}{['queued', 'prepared'].includes(request.status) ? quickAction('sent', 'send', 'Markera som skickat') : null}{request.status === 'sent' ? quickAction('acknowledged', 'ack', 'Markera som kvitterat') : null}{quickAction('failed', 'fail', 'Markera som misslyckat')}</div></details> : null}
           </article>
         })}
       </div> : <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">Inga utskick matchar urvalet.</p>}
     </main>
   </div>
 }

 const [events, linkedEdielMessagesQuery] = await Promise.all([
 listOutboundDispatchEventsByRequestIds(requests.map((row) => row.id)),
 requests.length === 0
 ? Promise.resolve({ data: [], error: null })
 : (() => {
 const linkedQuery = supabase
 .from('ediel_messages')
 .select(
 'id,outbound_request_id,direction,message_family,message_code,status,created_at'
 )
 .in('outbound_request_id', requests.map((row) => row.id))
 .order('created_at', { ascending: false })

 return companyId ? linkedQuery.eq('company_id', companyId) : linkedQuery
 })(),
 ])

 if (linkedEdielMessagesQuery.error) throw linkedEdielMessagesQuery.error

 const linkedEdielMessages =
 (linkedEdielMessagesQuery.data as LinkedEdielMessageRow[] | null) ?? []

 const latestEdielMessageByOutboundId = new Map<string, LinkedEdielMessageRow>()
 for (const message of linkedEdielMessages) {
 if (!message.outbound_request_id) continue
 if (!latestEdielMessageByOutboundId.has(message.outbound_request_id)) {
 latestEdielMessageByOutboundId.set(message.outbound_request_id, message)
 }
 }

 const unresolvedRequests = requests.filter(
 (request) => request.channel_type === 'unresolved'
 )
 const waitingResponseRequests = requests.filter(
 (request) => request.status === 'sent'
 )
 const failedRequests = requests.filter((request) => request.status === 'failed')
 const queuedRequests = requests.filter((request) =>
 ['queued', 'prepared'].includes(request.status)
 )
 const automationReadyRequests = requests.filter(
 (request) =>
 ['queued', 'prepared', 'failed'].includes(request.status) &&
 request.channel_type !== 'unresolved'
 )
 const autoAckCandidates = requests.filter(
 (request) =>
 request.status === 'sent' &&
 ['email_manual', 'file_export'].includes(request.channel_type)
 )
 const retryableMisslyckadRequests = failedRequests.filter(
 (request) => request.attempts_count < 3
 )
 const switchOutboundRequests = requests.filter(
 (request) => request.request_type === 'supplier_switch'
 )
 const switchRequestsMissingOutbound = switchRequests.filter(
 (switchRequest) =>
 ['queued', 'submitted', 'accepted'].includes(switchRequest.status) &&
 !switchOutboundRequests.some(
 (outbound) =>
 outbound.source_type === 'supplier_switch_request' &&
 outbound.source_id === switchRequest.id &&
 ['queued', 'prepared', 'sent', 'acknowledged'].includes(outbound.status)
 )
 )
 const switchRequestsWaitingAck = switchOutboundRequests.filter(
 (request) => request.status === 'sent'
 )
 const switchRequestsMisslyckad = switchOutboundRequests.filter(
 (request) => request.status === 'failed'
 )

 const exportMap = new Map(
 partnerExports
 .filter((row) => row.billing_underlay_id)
 .map((row) => [row.billing_underlay_id as string, row])
 )

 const readyBillingExports = underlays.filter((underlay) =>
 getBillingExportReadiness({
 underlay,
 existingExport: exportMap.get(underlay.id) ?? null,
 }).isReady
 )

 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Outbound queue"
 subtitle="Extern orkestrering för switch, mätvärden, billing-underlag och partner-handoff. Automation sweep kan nu lösa route, återköa efter cooldown, auto-förbereda, auto-skicka och auto-kvittera interna kanaler."
 userEmail={context.email}
 />

 <div className="min-w-0 space-y-4 p-4 lg:p-6 [&_input:not([type=hidden])]:min-w-0 [&_input:not([type=hidden])]:w-full [&_select]:min-w-0 [&_select]:w-full [&_textarea]:min-w-0 [&_textarea]:w-full">
 <section className="grid grid-cols-2 gap-2 xl:grid-cols-4">
 <div className="rounded-2xl border border-slate-200 bg-white p-4 ">
 <div className="text-sm font-medium text-slate-700 ">
 Saknar route routes
 </div>
 <div className="mt-1 text-2xl font-semibold text-slate-950 ">
 {unresolvedRequests.length}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Requests utan fungerande route eller kanalupplösning.
 </div>
 </div>

 <div className="rounded-2xl border border-slate-200 bg-white p-4 ">
 <div className="text-sm font-medium text-slate-700 ">
 Väntar på svar
 </div>
 <div className="mt-1 text-2xl font-semibold text-slate-950 ">
 {waitingResponseRequests.length}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Skickade requests som inte kvitterats ännu.
 </div>
 </div>

 <div className="rounded-2xl border border-slate-200 bg-white p-4 ">
 <div className="text-sm font-medium text-slate-700 ">
 Dispatch-fel
 </div>
 <div className="mt-1 text-2xl font-semibold text-slate-950 ">
 {failedRequests.length}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Requests som behöver ny åtgärd eller route-fix.
 </div>
 </div>

 <div className="rounded-2xl border border-slate-200 bg-white p-4 ">
 <div className="text-sm font-medium text-slate-700 ">
 Redo billing-exporter
 </div>
 <div className="mt-1 text-2xl font-semibold text-slate-950 ">
 {readyBillingExports.length}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Underlag som kan handoffas till partner nu.
 </div>
 </div>
 </section>

 <section className="grid grid-cols-2 gap-2 xl:grid-cols-4">
 <div className="rounded-2xl border border-slate-200 bg-white p-4 ">
 <div className="text-sm font-medium text-slate-700 ">
 Automation-klara
 </div>
 <div className="mt-1 text-2xl font-semibold text-slate-950 ">
 {automationReadyRequests.length}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Köade/förberedda/failade requests som sweepen kan försöka driva vidare.
 </div>
 </div>

 <div className="rounded-2xl border border-slate-200 bg-white p-4 ">
 <div className="text-sm font-medium text-slate-700 ">
 Auto-ack kandidater
 </div>
 <div className="mt-1 text-2xl font-semibold text-slate-950 ">
 {autoAckCandidates.length}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Skickad-requests på interna/manuella kanaler som sweepen kan kvittera.
 </div>
 </div>

 <div className="rounded-2xl border border-slate-200 bg-white p-4 ">
 <div className="text-sm font-medium text-slate-700 ">
 Retrybara dispatch-fel
 </div>
 <div className="mt-1 text-2xl font-semibold text-slate-950 ">
 {retryableMisslyckadRequests.length}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Misslyckad requests som fortfarande ligger under retry-taket.
 </div>
 </div>

 <div className="rounded-2xl border border-slate-200 bg-white p-4 ">
 <div className="text-sm font-medium text-slate-700 ">
 Switch utan outbound
 </div>
 <div className="mt-1 text-2xl font-semibold text-slate-950 ">
 {switchRequestsMissingOutbound.length}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Supplier-switch requests som borde ha köats men ännu saknar outbound.
 </div>
 </div>
 </section>

 <section className="grid grid-cols-2 gap-2 xl:grid-cols-4">
 <div className="rounded-2xl border border-slate-200 bg-white p-4 ">
 <div className="text-sm font-medium text-slate-700 ">
 Leverantörsbyte väntar på ack
 </div>
 <div className="mt-1 text-2xl font-semibold text-slate-950 ">
 {switchRequestsWaitingAck.length}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Switch-outbounds som är skickade men ännu inte kvitterade.
 </div>
 </div>

 <div className="rounded-2xl border border-slate-200 bg-white p-4 ">
 <div className="text-sm font-medium text-slate-700 ">
 Leverantörsbyte dispatch-fel
 </div>
 <div className="mt-1 text-2xl font-semibold text-slate-950 ">
 {switchRequestsMisslyckad.length}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Switch-outbounds som stoppats och kräver manuell åtgärd.
 </div>
 </div>
 </section>

 <section className="grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
 <div className="rounded-2xl border border-slate-200 bg-white p-4 ">
 <div className="mb-3"><AdminActionsMenu label="Fler arbetsvyer">
 <Link
 href="/admin/outbound/missing-meter-values"
 className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 "
 >
 Bulk: saknade mätvärden
 </Link>
 <Link
 href="/admin/outbound/ready-switches"
 className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 "
 >
 Bulk: redo för byte
 </Link>
</AdminActionsMenu></div>

 <div className="space-y-3">
 <form className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
 <input
 name="q" aria-label="Sök utskick"
 defaultValue={query}
 placeholder="Sök på kund, anläggning, mätpunkt, körning eller referens"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />

 <select
 name="status" aria-label="Status"
 defaultValue={status}
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 >
 <option value="all">Alla statusar</option>
 <option value="queued">Köad</option>
 <option value="prepared">Förberedd</option>
 <option value="sent">Skickad</option>
 <option value="acknowledged">Kvitterad</option>
 <option value="failed">Misslyckad</option>
 <option value="cancelled">Avbruten</option>
 </select>

 <select
 name="requestType" aria-label="Begärans typ"
 defaultValue={requestType}
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 >
 <option value="all">Alla begärantyper</option>
 <option value="supplier_switch">Leverantörsbyte</option>
 <option value="customer_masterdata">Kund- och anläggningskontroll / Z01</option>
 <option value="meter_values">Mätvärden</option>
 <option value="billing_underlay">Faktureringsunderlag</option>
 </select>

 <select
 name="channelType" aria-label="Kanal"
 defaultValue={channelType}
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 >
 <option value="all">Alla kanaler</option>
 <option value="partner_api">Partner API</option>
 <option value="ediel_partner">Ediel partner</option>
 <option value="file_export">Filexport</option>
 <option value="email_manual">Manuell e-post</option>
 <option value="unresolved">Saknar route</option>
 </select>

 <div className="flex gap-3">
 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white ">
 Filtrera
 </button>
 <Link
 href="/admin/outbound"
 className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 "
 >
 Rensa
 </Link>
 </div>
 </form>

 <div className="flex flex-wrap items-start gap-3 xl:justify-end">
 {!operationalCompanyId ? <p className="text-sm text-slate-600">Välj ett bolag innan du startar kontroll eller förbereder fakturaexport.</p> : null}
 {canSweep ? <form action={runAutomationSweepFormAction}>
 <button className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 ">
 Kör automatisk kontroll
 </button>
 </form> : null}

 {canQueueBilling ? <form action={queueReadyBillingExportsFormAction}>
 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white ">
 Förbered fakturaexporter
 </button>
 </form> : null}
 </div>
 </div>

 <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
 <TriageCard
 title="Saknar route outbound"
 description="Begäran utan aktiv route eller kanal."
 href="/admin/outbound/unresolved"
 />
 <TriageCard
 title="Saknade mätvärden"
 description="Förbered nätägarförfrågningar för saknade mätvärden."
 href="/admin/outbound/missing-meter-values"
 />
 <TriageCard
 title="Saknade faktureringsunderlag"
 description="Förbered nätägarförfrågningar för saknade faktureringsunderlag."
 href="/admin/outbound/missing-billing-underlays"
 />
 </div>

 <div className="mt-6 space-y-4">
 {requests.length === 0 ? (
 <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-700 ">
 Inga outbound requests matchade filtret.
 </div>
 ) : (
 requests.map((request) => {
 const primaryDetailLink = buildPrimaryDetailLink(
 request,
 latestEdielMessageByOutboundId
 )
 const linkedMessage =
 latestEdielMessageByOutboundId.get(request.id) ?? null

 return (
 <article
 key={request.id}
 className="rounded-2xl border border-slate-200 p-5 "
 >
 <div className="min-w-0 space-y-3">
 <div className="min-w-0">
 <div className="flex flex-wrap items-center gap-2">
 <span
 className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${tone(
 request.status
 )}`}
 >
 {formatStatusLabel(request.status)}
 </span>
 <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ">
 {request.request_type}
 </span>
 <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ">
 {request.channel_type}
 </span>
 </div>

 <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
 <h3 className="text-base font-semibold text-slate-950 ">
 <CustomerName id={request.customer_id} />
 </h3>

 <div className="flex flex-wrap items-center gap-2">
 {primaryDetailLink ? (
 <Link
 href={primaryDetailLink.href}
 className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 "
 >
 {primaryDetailLink.label}
 </Link>
 ) : null}

 <Link
 href={`/admin/customers/${request.customer_id}`}
 className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 "
 >
 Kundkort
 </Link>
 </div>
 </div>

 {request.period_start || request.period_end ? <p className="mt-2 break-words text-sm text-slate-700">Period: {request.period_start ?? '—'} → {request.period_end ?? '—'}</p> : null}
 <details className="mt-3 text-sm text-slate-700"><summary className="cursor-pointer font-semibold">Referenser och anläggning</summary><div className="mt-2 grid min-w-0 grid-cols-1 gap-2 break-words sm:grid-cols-2 lg:grid-cols-3">
 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Kund</div>
 <div className="mt-1 font-medium text-slate-900 ">
 <CustomerName id={request.customer_id} />
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Site</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {request.site_id ?? '—'}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Mätpunkt</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {request.metering_point_id ?? '—'}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Källa</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {request.source_type && request.source_id
 ? `${request.source_type} · ${request.source_id}`
 : request.source_type ?? '—'}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Meddelande</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {linkedMessage ? (
 <Link
 href={`/admin/messages/${linkedMessage.id}`}
 className="text-emerald-700 underline-offset-2 hover:underline "
 >
 {linkedMessage.message_family} {linkedMessage.message_code} ·{' '}
 {formatStatusLabel(linkedMessage.status)}
 </Link>
 ) : (
 '—'
 )}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Grid owner</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {request.grid_owner_id ?? '—'}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Route</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {request.communication_route_id ?? '—'}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Period</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {request.period_start ?? '—'} → {request.period_end ?? '—'}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Extern referens</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {request.external_reference ?? '—'}
 </div>
 </div>
 </div>

 <div className="mt-3 grid min-w-0 grid-cols-1 gap-1 break-words text-sm text-slate-700 ">
 <div>
 Körningsnyckel:{' '}
 <span className="font-medium">
 {request.dispatch_batch_key ?? '—'}
 </span>
 </div>
 <div>
 Senaste dispatch-event:{' '}
 <span className="font-medium">
 {latestEventText(request.id, events)}
 </span>
 </div>
 <div>
 Försök:{' '}
 <span className="font-medium">{request.attempts_count}</span>
 </div>
 </div>

 </details>
 {linkedMessage ? <p className="mt-2 text-sm text-slate-700">Meddelandestatus: {formatStatusLabel(linkedMessage.status)} · {linkedMessage.message_family} {linkedMessage.message_code}</p> : null}
 {request.channel_type === 'unresolved' ? (
 <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ">
 Den här requesten saknar aktiv route. Den automatiska omkörningen försöker igen om en route finns nu, annars ligger den kvar för manuell route-fix.
 </div>
 ) : null}

 {request.status === 'sent' ? (
 <div className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 ">
 {['email_manual', 'file_export'].includes(request.channel_type)
 ? 'Den här requesten kan auto-kvitteras av sweepen eftersom kanalen är intern/manuell.'
 : 'Den här requesten väntar på extern återkoppling.'}
 </div>
 ) : null}

 {request.status === 'failed' ? (
 <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ">
 {request.failure_reason ??
 'Dispatch misslyckades och kräver ny åtgärd.'}{' '}
 {request.attempts_count < 3
 ? 'Den automatiska omkörningen kan köa den igen efter en väntetid.'
 : 'Retry-taket är uppnått och kräver manuell insats.'}
 </div>
 ) : null}
 </div>

 {canUpdate && writableCompanies.get(request.company_id ?? companyId ?? '') ? <div className="space-y-4">
 <div className="grid gap-2 sm:grid-cols-2">
 {request.status === 'queued' ? (
 <form action={updateOutboundRequestStatusAction}>
 <input type="hidden" name="outbound_request_id" value={request.id} />
 <input type="hidden" name="customer_id" value={request.customer_id} />
 <input type="hidden" name="status" value="prepared" />
 <input type="hidden" name="dispatch_step" value="prepare" />
 <button className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 ">
 Förbered
 </button>
 </form>
 ) : null}

 {['queued', 'prepared'].includes(request.status) ? (
 <form action={updateOutboundRequestStatusAction}>
 <input type="hidden" name="outbound_request_id" value={request.id} />
 <input type="hidden" name="customer_id" value={request.customer_id} />
 <input type="hidden" name="status" value="sent" />
 <input type="hidden" name="dispatch_step" value="send" />
 <button className="w-full rounded-2xl border border-emerald-300 px-4 py-2.5 text-sm font-semibold text-emerald-700 ">
 Markera som skickad
 </button>
 </form>
 ) : null}

 {request.status === 'sent' ? (
 <form action={updateOutboundRequestStatusAction}>
 <input type="hidden" name="outbound_request_id" value={request.id} />
 <input type="hidden" name="customer_id" value={request.customer_id} />
 <input type="hidden" name="status" value="acknowledged" />
 <input type="hidden" name="dispatch_step" value="ack" />
 <button className="w-full rounded-2xl border border-emerald-300 px-4 py-2.5 text-sm font-semibold text-emerald-700 ">
 Markera som kvitterad
 </button>
 </form>
 ) : null}

 {['queued', 'prepared', 'sent'].includes(request.status) ? (
 <form action={updateOutboundRequestStatusAction}>
 <input type="hidden" name="outbound_request_id" value={request.id} />
 <input type="hidden" name="customer_id" value={request.customer_id} />
 <input type="hidden" name="status" value="failed" />
 <input
 type="hidden"
 name="failure_reason"
 value="Dispatch markerad som failed från snabbåtgärd."
 />
 <input type="hidden" name="dispatch_step" value="fail" />
 <button className="w-full rounded-2xl border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-700 ">
 Markera som failed
 </button>
 </form>
 ) : null}
 </div>

 <AdminDisclosurePanel id={`outbound-status-${request.id}`} title="Uppdatera dispatch-status" className="rounded-xl border border-slate-200 p-3"> <form
 action={updateOutboundRequestStatusAction}
 className="rounded-2xl border border-slate-200 p-4 "
 >
 <input
 type="hidden"
 name="outbound_request_id"
 value={request.id}
 />
 <input
 type="hidden"
 name="customer_id"
 value={request.customer_id}
 />

 <div className="mt-4 grid gap-3">
 <select
 name="status" aria-label="Status"
 defaultValue={request.status}
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 >
 <option value="queued">Köad</option>
 <option value="prepared">Förberedd</option>
 <option value="sent">Skickad</option>
 <option value="acknowledged">Kvitterad</option>
 <option value="failed">Misslyckad</option>
 <option value="cancelled">Avbruten</option>
 </select>

 <input
 name="external_reference" aria-label="Extern referens"
 defaultValue={request.external_reference ?? ''}
 placeholder="Extern referens"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />

 <input
 name="response_payload_note" aria-label="Svar eller intern notering"
 placeholder="Svar / intern notering"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />

 <textarea
 name="failure_reason" aria-label="Felorsak"
 defaultValue={request.failure_reason ?? ''}
 placeholder="Felorsak"
 rows={4}
 className="rounded-2xl border border-slate-300 px-4 py-3 text-sm "
 />

 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white ">
 Spara status
 </button>
 </div>
 </form></AdminDisclosurePanel>
 </div> : null}
 </div>
 </article>
 )
 })
 )}
 </div>
 </div>

 <div className="space-y-6">
 <div className="rounded-2xl border border-slate-200 bg-white shadow-sm ">
 <div className="border-b border-slate-200 px-6 py-5 ">
 <h2 className="text-lg font-semibold text-slate-950 ">
 Ready to export
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Billing-underlag som saknar aktiv partnerexport.
 </p>
 </div>

 <div className="space-y-3 p-6">
 {readyBillingExports.length === 0 ? (
 <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-700 ">
 Inga billing-underlag redo för export just nu.
 </div>
 ) : (
 readyBillingExports.slice(0, 8).map((underlay) => (
 <div
 key={underlay.id}
 className="rounded-2xl border border-slate-200 p-4 "
 >
 <div className="flex flex-wrap items-center gap-2">
 <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700 ">
 redo
 </span>
 <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ">
 {underlay.underlay_year ?? '—'}-
 {String(underlay.underlay_month ?? '').padStart(2, '0')}
 </span>
 </div>

 <div className="mt-3 text-sm text-slate-700 ">
 Kund <CustomerName id={underlay.customer_id} /> · Site {underlay.site_id ?? '—'} ·
 Mätpunkt {underlay.metering_point_id ?? '—'}
 </div>

 <div className="mt-3 flex flex-wrap gap-2">
 {underlay.source_request_id ? (
 <Link
 href={`/admin/operations/grid-owner-requests/${underlay.source_request_id}`}
 className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 "
 >
 Visa ursprunglig begäran
 </Link>
 ) : null}

 <Link
 href="/admin/billing"
 className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 "
 >
 Öppna billing
 </Link>
 </div>
 </div>
 ))
 )}
 </div>
 </div>

 <div className="rounded-2xl border border-slate-200 bg-white shadow-sm ">
 <div className="border-b border-slate-200 px-6 py-5 ">
 <h2 className="text-lg font-semibold text-slate-950 ">
 Köläge
 </h2>
 </div>

 <div className="space-y-3 p-6">
 <div className="rounded-2xl border border-slate-200 p-4 ">
 <div className="text-sm font-semibold text-slate-900 ">
 Köad / Förberedd
 </div>
 <div className="mt-1 text-sm text-slate-700 ">
 {queuedRequests.length} requests väntar på att dispatchas eller auto-förberedas.
 </div>
 </div>

 <div className="rounded-2xl border border-slate-200 p-4 ">
 <div className="text-sm font-semibold text-slate-900 ">
 Skickad
 </div>
 <div className="mt-1 text-sm text-slate-700 ">
 {waitingResponseRequests.length} requests väntar på extern återkoppling eller auto-ack.
 </div>
 </div>

 <div className="rounded-2xl border border-slate-200 p-4 ">
 <div className="text-sm font-semibold text-slate-900 ">
 Misslyckad
 </div>
 <div className="mt-1 text-sm text-slate-700 ">
 {failedRequests.length} requests kräver ny route, ny dispatch eller manuell åtgärd.
 </div>
 </div>

 <div className="rounded-2xl border border-slate-200 p-4 ">
 <div className="text-sm font-semibold text-slate-900 ">
 Kvitterad
 </div>
 <div className="mt-1 text-sm text-slate-700 ">
 {requests.filter((request) => request.status === 'acknowledged').length} requests är klara.
 </div>
 </div>
 </div>
 </div>
 </div>
 </section>
 </div>
 </div>
 )
}
