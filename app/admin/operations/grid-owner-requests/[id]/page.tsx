import { formatE66ImportProgress, readE66ImportProgress } from '@/lib/ediel/operations/e66ImportProgress'
import CustomerName from '@/components/admin/CustomerName'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import AdminHeader from '@/components/admin/AdminHeader'
import { loadGridOwnerRequestForAdmin } from '@/lib/ediel/loadGridOwnerRequestForAdmin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { listGridOwners, listMeteringPointsBySiteIds } from '@/lib/masterdata/db'
import {
 listOutboundDispatchEventsByRequestIds,
 listOutboundRequestsByCustomerId,
} from '@/lib/cis/db'
import {
 updateGridOwnerDataRequestStatusAction,
 updateOutboundRequestStatusAction,
} from '@/app/admin/cis/actions'
import {
 prepareUtiltsE66Action,
 prepareUtiltsE73Action,
 sendEdielMessageAction,
} from '@/app/admin/ediel/actions'
import { ManualOutboundDeliveryForm } from '@/components/admin/outbound/ManualOutboundDeliveryForm'
import type {
 GridOwnerDataRequestRow,
 OutboundDispatchEventRow,
 OutboundRequestRow,
} from '@/lib/cis/types'
import type {
 CustomerSiteRow,
 GridOwnerRow,
 MeteringPointRow,
} from '@/lib/masterdata/types'
import type { CustomerAuthorizationDocumentRow } from '@/lib/operations/types'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { formatStatusLabel } from '@/lib/ui/format'

export const dynamic = 'force-dynamic'

type PageProps = {
 params: Promise<{ id: string }>
}

type TimelineEntry = {
 id: string
 occurredAt: string
 source: 'request' | 'outbound' | 'dispatch' | 'ediel_message'
 title: string
 description: string
 status: string
 href?: string
}

function formatDateTime(value: string | null | undefined): string {
 if (!value) return '—'
 return new Intl.DateTimeFormat('sv-SE', {
 dateStyle: 'medium',
 timeStyle: 'short',
 }).format(new Date(value))
}

function tone(status: string): string {
 if (['received', 'acknowledged', 'validated', 'completed'].includes(status)) {
 return 'bg-emerald-100 text-emerald-700 '
 }

 if (['failed', 'cancelled', 'rejected'].includes(status)) {
 return 'bg-red-100 text-red-700 '
 }

 if (['sent'].includes(status)) {
 return 'bg-emerald-100 text-emerald-700 '
 }

 return 'bg-amber-100 text-amber-700 '
}

function siteName(site: CustomerSiteRow | null): string {
 return site?.site_name ?? site?.id ?? '—'
}

function meteringPointName(point: MeteringPointRow | null): string {
 return point?.meter_point_id ?? point?.id ?? '—'
}

function gridOwnerName(owner: GridOwnerRow | null): string {
 return owner?.name ?? owner?.id ?? '—'
}

function getRecordValue(value: unknown, key: string): unknown {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
 return (value as Record<string, unknown>)[key]
}

function getString(value: unknown, key: string): string | null {
 const raw = getRecordValue(value, key)
 return typeof raw === 'string' ? raw : null
}

const coverageDate = new Intl.DateTimeFormat('sv-SE', {
 timeZone: 'Europe/Stockholm',
 dateStyle: 'short',
 timeStyle: 'long',
})

const coverageDuration = new Intl.NumberFormat('sv-SE', {
 maximumFractionDigits: 3,
})

function formatCoverageDate(instant: string): string {
 return coverageDate.format(new Date(instant))
}

function formatCoverageDuration(seconds: number): string {
 return `${coverageDuration.format(seconds / 3600)} h`
}

function isMeteringReceipt(request: GridOwnerDataRequestRow): boolean {
 return request.status === 'received' && (request.request_scope === 'meter_values' || request.request_scope === 'billing_underlay')
}

async function readMeteringImportSummary(
 supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
 request: GridOwnerDataRequestRow,
 companyId: string | null,
): Promise<string | null> {
 if (!isMeteringReceipt(request)) return null

 const unverified = 'Det finns ingen verifierad importstatus för svaret.'
 const receipt = request.response_payload
 const inboundEmailMessageId = getString(receipt, 'inboundEmailMessageId')
 const parseResultId = getString(receipt, 'parseResultId')
 if (!companyId || !inboundEmailMessageId || !parseResultId || getString(receipt, 'inboundFamily') !== 'UTILTS' || getString(receipt, 'inboundCode') !== 'E66') return unverified

 const saved = await supabase.from('gridex_operator_meter_request_links_v1').select('id')
  .eq('source', 'meter_value').eq('company_id', companyId).eq('customer_id', request.customer_id)
  .eq('request_id', request.id).eq('receipt_value_saved', true).limit(1)
 if (saved.error) return 'Importstatusen kunde inte läsas. Försök igen.'
 if (saved.data?.length) return 'Mätvärden har sparats från detta svar. Kontrollera periodens täckning i Mätvärden.'

 // The inbound worker records outbound provenance on the failed import task.
 // Correlate both the retained email and the exact parse result for this reply.
 const { data, error } = await supabase.from('customer_operation_tasks').select('id')
  .eq('company_id', companyId)
  .eq('customer_id', request.customer_id)
  .eq('task_type', 'ediel_utilts_meter_value_review')
  .in('status', ['open', 'in_progress', 'blocked'])
  .contains('metadata', { inboundEmailMessageId, parseResultId, outbound: { source_type: 'grid_owner_data_request', source_id: request.id } })
  .limit(1)

 if (error) return 'Importstatusen kunde inte läsas. Försök igen.'
 if (data?.length) return 'Ett öppet importärende behöver granskas. Mätvärdena kunde inte sparas vid ett importförsök.'
 return unverified
}

function summarizeResponse(
 request: GridOwnerDataRequestRow,
 outbounds: OutboundRequestRow[]
): string {
 const latestOutbound =
 [...outbounds].sort((a, b) => {
 const aTime = new Date(
 a.acknowledged_at ??
 a.failed_at ??
 a.sent_at ??
 a.prepared_at ??
 a.queued_at ??
 a.created_at
 ).getTime()
 const bTime = new Date(
 b.acknowledged_at ??
 b.failed_at ??
 b.sent_at ??
 b.prepared_at ??
 b.queued_at ??
 b.created_at
 ).getTime()
 return bTime - aTime
 })[0] ?? null

 if (isMeteringReceipt(request)) return 'Svar mottaget från nätägare'
 if (request.status === 'received') return 'Underlag mottaget från nätägare'
 if (latestOutbound?.status === 'acknowledged') return "Utskick bekräftat"
 if (latestOutbound?.status === 'sent') return 'Skickad, inväntar svar'
 if (latestOutbound?.status === 'failed') return "Utskicket misslyckades"
 if (latestOutbound?.status === 'cancelled') return "Utskicket stoppades"
 if (request.status === 'cancelled') return "Begäran stoppades"
 if (request.status === 'failed') return "Begäran misslyckades"
 return 'Ingen slutrespons ännu'
}

function edielOccurredAt(message: EdielMessageRow): string {
 return (
 message.message_received_at ??
 message.message_sent_at ??
 message.acknowledged_at ??
 message.failed_at ??
 message.created_at
 )
}

function buildTimeline(params: {
 request: GridOwnerDataRequestRow
 outboundRequests: OutboundRequestRow[]
 dispatchEvents: OutboundDispatchEventRow[]
 edielMessages: EdielMessageRow[]
}): TimelineEntry[] {
 const rows: TimelineEntry[] = [
 {
 id: `request:${params.request.id}`,
 occurredAt:
 params.request.received_at ??
 params.request.failed_at ??
 params.request.sent_at ??
 params.request.requested_at ??
 params.request.created_at,
 source: 'request',
 title: "Begäran till nätägare",
 description: `${params.request.request_scope} · ${params.request.status}`,
 status: params.request.status,
 },
 ]

 for (const outbound of params.outboundRequests) {
 rows.push({
 id: `outbound:${outbound.id}`,
 occurredAt:
 outbound.acknowledged_at ??
 outbound.failed_at ??
 outbound.sent_at ??
 outbound.prepared_at ??
 outbound.queued_at ??
 outbound.created_at,
 source: 'outbound',
 title: "Utskick",
 description: `${outbound.request_type} · ${outbound.status} · ${outbound.channel_type}`,
 status: outbound.status,
 href:
 outbound.channel_type === 'unresolved'
 ? '/admin/outbound/unresolved'
 : '/admin/outbound',
 })
 }

 for (const message of params.edielMessages) {
 rows.push({
 id: `ediel:${message.id}`,
 occurredAt: edielOccurredAt(message),
 source: 'ediel_message',
 title: 'Ediel message',
 description: `${message.direction} · ${message.message_family} ${message.message_code} · ${message.status}`,
 status: message.status,
 href: `/admin/ediel/messages/${message.id}`,
 })
 }

 for (const event of params.dispatchEvents) {
 rows.push({
 id: `dispatch:${event.id}`,
 occurredAt: event.created_at,
 source: 'dispatch',
 title: 'Dispatch event',
 description: event.message ?? `${event.event_type} · ${event.event_status}`,
 status: event.event_status,
 })
 }

 return rows.sort(
 (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
 )
}

export default async function GridOwnerRequestDetailPage({ params }: PageProps) {
 const { id } = await params
 const detail = await loadGridOwnerRequestForAdmin(id)
 if (!detail) notFound()
 const { access, tenantScope, user, supabase, request, requestCompanyId, readRequestMessages, readRequestMeteringHistory, readRequestCorrelationReviews } = detail

 const [
 siteQuery,
 documentQuery,
 gridOwners,
 outboundByCustomer,
 edielMessages,
 meteringHistory,
 ] = await Promise.all([
 request.site_id
 ? supabase.from('customer_sites').select('*').eq('id', request.site_id).maybeSingle()
 : Promise.resolve({ data: null, error: null }),
 request.authorization_document_id
 ? supabase
 .from('customer_authorization_documents')
 .select('*')
 .eq('id', request.authorization_document_id)
 .maybeSingle()
 : Promise.resolve({ data: null, error: null }),
 listGridOwners(supabase),
 listOutboundRequestsByCustomerId(request.customer_id),
 readRequestMessages(),
 readRequestMeteringHistory(),
 ])

 if (siteQuery.error) throw siteQuery.error
 if (documentQuery.error) throw documentQuery.error

 const site = (siteQuery.data as CustomerSiteRow | null) ?? null
 const document = (documentQuery.data as CustomerAuthorizationDocumentRow | null) ?? null

 const meteringPoints = await listMeteringPointsBySiteIds(supabase, site ? [site.id] : [])
 const meteringPoint =
 meteringPoints.find((row) => row.id === request.metering_point_id) ?? null
 const gridOwner = gridOwners.find((row) => row.id === request.grid_owner_id) ?? null

 const relatedOutbounds = outboundByCustomer.filter((row) => {
 const directSource =
 row.source_type === 'grid_owner_data_request' && row.source_id === request.id
 const payloadMatch = getString(row.payload, 'gridOwnerDataRequestId') === request.id
 const responseMatch =
 getString(row.response_payload, 'gridOwnerDataRequestId') === request.id

 return directSource || payloadMatch || responseMatch
 })

 const dispatchEvents = await listOutboundDispatchEventsByRequestIds(
 relatedOutbounds.map((row) => row.id)
 )

 const timeline = buildTimeline({
 request,
 outboundRequests: relatedOutbounds,
 dispatchEvents,
 edielMessages,
 })

 const meteringRequest = request.request_scope === 'meter_values' || request.request_scope === 'billing_underlay'
 const coverage = meteringHistory?.coverage
 const hasVerifiedCoverage = isMeteringReceipt(request) && coverage?.remainingSeconds === 0
 const responseSummary = isMeteringReceipt(request) && meteringHistory
  ? hasVerifiedCoverage ? 'Mätperioden har verifierad täckning' : 'Begäran är markerad som mottagen'
  : summarizeResponse(request, relatedOutbounds)
 const importSummary = hasVerifiedCoverage
  ? 'Aktuella mätvärden har sparats för hela den begärda perioden.'
  : await readMeteringImportSummary(supabase, request, requestCompanyId)
 const importProgress = meteringRequest && requestCompanyId && ['pending', 'sent', 'received'].includes(request.status)
  ? await readE66ImportProgress(supabase, requestCompanyId, request.id)
    .then(rows => rows.filter(row => row.customer_id === request.customer_id).map(formatE66ImportProgress))
    .catch(() => [])
  : []
 const e66RequestReviews = await readRequestCorrelationReviews()
 const meteringCoverage = meteringRequest ? (
  <section className="rounded-2xl border border-slate-200 bg-white p-4">
   <h2 className="text-lg font-semibold text-slate-950">Täckning av begärd mätperiod</h2>
   {meteringHistory ? <p className="mt-2 text-sm text-slate-700">
    Källbundna E66-svar {meteringHistory.responseCount}. Första verifierade mottagning{' '}
    {meteringHistory.firstObservedAt ? formatCoverageDate(meteringHistory.firstObservedAt) : 'okänd'}.
    {' '}Senaste verifierade mottagning{' '}
    {meteringHistory.latestObservedAt ? formatCoverageDate(meteringHistory.latestObservedAt) : 'okänd'}.
   </p> : null}
   {meteringHistory?.requestReference ? <p className="mt-2 break-words text-sm text-slate-700">Begärans referens {meteringHistory.requestReference}</p> : null}
   {meteringHistory?.responses?.length ? <ul className="mt-2 list-disc pl-5 text-sm text-slate-700" aria-label="E66-svar per källa">
    {meteringHistory.responses.map(response => <li key={response.sourceId} className="break-words">
     {response.reference || 'Svar utan referens'} · Verifierad mottagning{' '}
     {response.observedAt ? <time dateTime={response.observedAt}>{formatCoverageDate(response.observedAt)}</time> : 'okänd'}.
     {' '}{response.historicalOnly ? 'Endast historik' :
       <>Aktuella värden {response.currentValueCount} av {response.storedValueCount}.</>}
    </li>)}
   </ul> : null}
   {e66RequestReviews.length>0 ? <div className="mt-4 border-t border-slate-200 pt-3">
    <h3 className="font-semibold text-slate-950">E66-svar att utreda</h3>
    <p className="mt-1 text-sm text-slate-700">Jämför med nätägarens underlag för att avgöra vilken begäran svaret gäller.</p>
    <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-slate-700">
     {e66RequestReviews.map(review=><li key={review.sourceId}>
      <p>{review.responseReference || review.sourceId} · {review.environment==='test'?'Test':'Produktion'} · {review.description}</p>
      {review.receivedAt ? <p>Mottaget <time dateTime={review.receivedAt}>{formatCoverageDate(review.receivedAt)}</time></p> : null}
      {review.periodFrom && review.periodUntil ? <p>Angiven leveransperiod {formatCoverageDate(review.periodFrom)} till {formatCoverageDate(review.periodUntil)}</p> : null}
      {review.requestReference ? <p>Angiven begäran {review.requestReference}</p> : null}
      {review.pointReference ? <p>Angiven mätpunkt {review.pointReference}</p> : null}
     </li>)}
    </ul>
   </div> : null}
   {coverage ? <>
    <p className="mt-2 text-sm text-slate-700">Utsänd period {formatCoverageDate(coverage.requestedFrom)} till {formatCoverageDate(coverage.requestedUntil)}.</p>
    <p className="mt-2 text-sm text-slate-700">Täckt tid {formatCoverageDuration(coverage.coveredSeconds)}. Återstående tid{' '}
     {formatCoverageDuration(coverage.remainingSeconds)}. Glapp {coverage.gaps.length}.</p>
    {coverage.gaps.length > 0 ? <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
     {coverage.gaps.map(gap => <li key={gap.from}>{formatCoverageDate(gap.from)} till {formatCoverageDate(gap.until)}</li>)}
    </ul> : null}
   </> : <p className="mt-2 text-sm text-slate-700">Verifierad periodtäckning saknas.</p>}
  </section>
 ) : null

 const adminNote = getString(request.response_payload, 'admin_note') ?? ''

 // Company operators receive business data only. The diagnostic page below
 // is rendered exclusively for a server-verified platform administrator.
 if (!tenantScope.isPlatformAdmin) {
   const canUpdateRequest = access.permissions.includes('metering.write') || access.permissions.includes('billing_underlay.write')
   return (
     <div className="min-h-screen">
       <AdminHeader title="Begäran till nätägare" subtitle="Anläggningsuppgifter, svar och nästa steg." userEmail={user?.email ?? null} />
       <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
         <Link href={`/admin/customers/${request.customer_id}`} className="text-sm font-semibold text-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">← Kundkort</Link>
         <section className="rounded-2xl border border-slate-200 bg-white p-4">
           <div className="flex flex-wrap items-center justify-between gap-2">
             <h1 className="text-xl font-semibold text-slate-950">Begäran till nätägare</h1>
             <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(request.status)}`}>{formatStatusLabel(request.status)}</span>
           </div>
           <p className="mt-2 text-sm text-slate-700">Kund <CustomerName id={request.customer_id} /></p>
           <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
             {[
               ['Nätägare', gridOwner?.name ?? 'Saknas'],
               ['Anläggning', site?.facility_id ?? site?.site_name ?? 'Saknas'],
               ['Adress', site?.street ?? 'Saknas'],
               ['Begärd', formatDateTime(request.requested_at)],
               ['Skickad', formatDateTime(request.sent_at)],
               ['Svar mottaget', formatDateTime(request.received_at)],
             ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-slate-500">{label}</dt><dd className="mt-1 break-words font-medium text-slate-950">{value}</dd></div>)}
           </dl>
           <p className="mt-4 text-sm font-medium text-slate-800">{responseSummary}</p>
           {importProgress.length ? (
   <ul aria-label="Pågående E66-import" className="mt-2 space-y-1 text-sm text-amber-900">
    {importProgress.map(status => <li key={status}>{status}</li>)}
   </ul>
  ) : importSummary ? <p role="status" className="mt-2 text-sm text-slate-700">{importSummary}</p> : null}
           {request.status === 'failed' ? <p role="status" className="mt-2 text-sm text-red-800">Begäran misslyckades. Kontrollera anläggningens uppgifter och utskickets status innan du försöker igen.</p> : null}
           {request.notes ? <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{request.notes}</p> : null}
           {request.requested_period_start || request.requested_period_end ? <p className="mt-2 text-sm text-slate-600">Period: {request.requested_period_start ?? '—'} – {request.requested_period_end ?? '—'}</p> : null}
           {document ? <div className="mt-2 text-sm text-slate-600"><p>Fullmakt: {document.title ?? document.file_name ?? 'Dokument registrerat'}</p><a href={`/api/admin/customer-documents/${document.id}?mode=open`} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-11 items-center font-semibold text-emerald-800 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Öppna dokument</a></div> : null}
         </section>
         {meteringCoverage}
         <details className="rounded-2xl border border-slate-200 bg-white p-4">
           <summary className="cursor-pointer text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Utskick och svar ({relatedOutbounds.length})</summary>
           <ul className="mt-3 max-h-80 space-y-2 overflow-auto text-sm">
             {relatedOutbounds.map((outbound) => <li key={outbound.id} className="flex flex-wrap justify-between gap-2 border-b border-slate-100 py-2"><span>{formatStatusLabel(outbound.status)}</span><span className="text-slate-600">{formatDateTime(outbound.sent_at ?? outbound.created_at)}</span></li>)}
           </ul>
           {relatedOutbounds.length === 0 ? <p className="mt-3 text-sm text-slate-600">Inga utskick ännu.</p> : null}
         </details>
         {canUpdateRequest ? <details className="rounded-2xl border border-slate-200 bg-white p-4">
           <summary className="cursor-pointer text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Uppdatera status</summary>
           <form action={updateGridOwnerDataRequestStatusAction} className="mt-3 grid gap-3 sm:grid-cols-2">
             <input type="hidden" name="request_id" value={request.id} />
             <input type="hidden" name="customer_id" value={request.customer_id} />
             <input type="hidden" name="original_status" value={request.status} />
             <input type="hidden" name="original_external_reference" value={request.external_reference ?? ''} />
             <input type="hidden" name="original_notes" value={request.notes ?? ''} />
             <input type="hidden" name="original_response_payload_note" value={adminNote} />
             <label className="grid gap-1 text-sm">Status
               <select name="status" defaultValue={request.status} className="min-h-11 rounded-xl border border-slate-300 px-3 py-2">
                 <option value="pending">Väntar</option><option value="sent">Skickad</option><option value="received">Mottagen</option><option value="failed">Misslyckad</option><option value="cancelled">Avbruten</option>
               </select>
             </label>
             <label className="grid gap-1 text-sm">Anteckning<input name="notes" defaultValue={request.notes ?? ''} className="min-h-11 rounded-xl border border-slate-300 px-3 py-2" /></label>
             <label className="grid gap-1 text-sm">Referens<input name="external_reference" defaultValue={request.external_reference ?? ''} className="min-h-11 rounded-xl border border-slate-300 px-3 py-2" /></label>
             <label className="grid gap-1 text-sm">Ny orsak vid misslyckad begäran<input name="failure_reason" placeholder="Lämna tomt för att behålla sparad orsak" className="min-h-11 rounded-xl border border-slate-300 px-3 py-2" /></label>
             <label className="grid gap-1 text-sm">Svar eller intern notering<input name="response_payload_note" defaultValue={adminNote} className="min-h-11 rounded-xl border border-slate-300 px-3 py-2" /></label>
             <button className="min-h-11 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Spara status</button>
           </form>
         </details> : null}
       </main>
     </div>
   )
 }

 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Begäran till nätägare"
 subtitle="Följ begäran till nätägaren, dokument, svar och historik."
 userEmail={user?.email ?? null}
 />

 <div className="space-y-6 p-8">
 {meteringCoverage}
 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="flex flex-wrap items-start justify-between gap-4">
 <div>
 <div className="flex flex-wrap items-center gap-2">
 <span
 className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(request.status)}`}
 >
 {formatStatusLabel(request.status)}
 </span>
 <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ">
 {request.request_scope}
 </span>
 </div>

 <h1 className="mt-3 text-2xl font-semibold text-slate-950 ">
 Begäran till nätägare {request.id}
 </h1>

 <p className="mt-2 text-sm text-slate-700 ">
 Kund <CustomerName id={request.customer_id} /> · Anläggning {siteName(site)} · Mätpunkt{' '}
 {meteringPointName(meteringPoint)}
 </p>
 </div>

 <div className="flex flex-wrap gap-3">
 <Link
 href="/admin/operations"
 className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 "
 >
 Till operations
 </Link>
 <Link
 href={`/admin/customers/${request.customer_id}`}
 className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 "
 >
 Öppna kundkort
 </Link>
 </div>
 </div>
 </section>

 <section className="grid gap-4 xl:grid-cols-4">
 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Status</div>
 <div className="mt-2 text-lg font-semibold text-slate-950 ">
 {formatStatusLabel(request.status)}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 {request.request_scope}
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Svarsläge</div>
 <div className="mt-2 text-sm font-semibold text-slate-950 ">
 {responseSummary}
 </div>
 {importProgress.length ? (
   <ul aria-label="Pågående E66-import" className="mt-2 space-y-1 text-sm text-amber-900">
    {importProgress.map(status => <li key={status}>{status}</li>)}
   </ul>
  ) : importSummary ? <p role="status" className="mt-2 text-sm text-slate-700">{importSummary}</p> : null}
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Kopplade outbounds</div>
 <div className="mt-2 text-sm font-semibold text-slate-950 ">
 {relatedOutbounds.length || 'Ingen'}
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Kopplat dokument</div>
 <div className="mt-2 text-sm font-semibold text-slate-950 ">
 {document ? document.title ?? document.file_name ?? document.id : 'Inget kopplat dokument'}
 </div>
 </div>
 </section>

 <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
 <div className="space-y-6">
 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <h2 className="text-lg font-semibold text-slate-950 ">
 Ärendedetaljer
 </h2>

 <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Nätägare</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {gridOwnerName(gridOwner)}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Anläggning</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {siteName(site)}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Mätpunkt</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {meteringPointName(meteringPoint)}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Extern referens</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {request.external_reference ?? '—'}
 </div>
 </div>
 </div>

 <div className="mt-5 grid gap-3 md:grid-cols-2">
 <div className="rounded-2xl border border-slate-200 p-4 ">
 <div className="text-sm font-semibold text-slate-900 ">
 Tidsstämplar
 </div>
 <div className="mt-3 space-y-2 text-sm text-slate-700 ">
 <div>
 Requested:{' '}
 <span className="font-medium">{formatDateTime(request.requested_at)}</span>
 </div>
 <div>
 Sent: <span className="font-medium">{formatDateTime(request.sent_at)}</span>
 </div>
 <div>
 Received:{' '}
 <span className="font-medium">{formatDateTime(request.received_at)}</span>
 </div>
 <div>
 Failed:{' '}
 <span className="font-medium">{formatDateTime(request.failed_at)}</span>
 </div>
 <div>
 Updated:{' '}
 <span className="font-medium">{formatDateTime(request.updated_at)}</span>
 </div>
 </div>
 </div>

 <div className="rounded-2xl border border-slate-200 p-4 ">
 <div className="text-sm font-semibold text-slate-900 ">
 Period och automationsdata
 </div>
 <div className="mt-3 space-y-2 text-sm text-slate-700 ">
 <div>
 Period:{' '}
 <span className="font-medium">
 {request.requested_period_start ?? '—'} → {request.requested_period_end ?? '—'}
 </span>
 </div>
 <div>
 Automation origin:{' '}
 <span className="font-medium">{request.automation_origin ?? '—'}</span>
 </div>
 <div>
 Automation key:{' '}
 <span className="font-medium break-all">{request.automation_key ?? '—'}</span>
 </div>
 <div>
 Dokument ID:{' '}
 <span className="font-medium">{request.authorization_document_id ?? '—'}</span>
 </div>
 </div>
 </div>
 </div>

 {request.notes ? (
 <div className="mt-5 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700 ">
 {request.notes}
 </div>
 ) : null}

 {request.failure_reason ? (
 <div className="mt-5 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ">
 {request.failure_reason}
 </div>
 ) : null}
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <h2 className="text-lg font-semibold text-slate-950 ">
 Kopplat dokument
 </h2>

 {document ? (
 <div className="mt-4 rounded-2xl border border-slate-200 p-4 ">
 <div className="text-sm font-semibold text-slate-900 ">
 {document.title ?? document.file_name ?? document.id}
 </div>

 <div className="mt-3 grid gap-2 text-sm text-slate-700 ">
 <div>
 Typ: <span className="font-medium">{document.document_type}</span>
 </div>
 <div>
 Status: <span className="font-medium">{formatStatusLabel(document.status)}</span>
 </div>
 <div>
 Checksum:{' '}
 <span className="font-medium break-all">
 {document.file_checksum ?? '—'}
 </span>
 </div>
 <div>
 Upload key:{' '}
 <span className="font-medium break-all">
 {document.upload_idempotency_key ?? '—'}
 </span>
 </div>
 </div>

 <div className="mt-4 flex flex-wrap gap-2">
 <a
 href={`/api/admin/customer-documents/${document.id}?mode=open`}
 target="_blank"
 rel="noreferrer"
 className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 "
 >
 Öppna dokument
 </a>
 <Link
 href={`/admin/customers/${request.customer_id}`}
 className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 "
 >
 Till kundkortet
 </Link>
 </div>
 </div>
 ) : (
 <p className="mt-4 text-sm text-slate-700 ">
 Ingen dokumentkoppling på requesten.
 </p>
 )}
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <h2 className="text-lg font-semibold text-slate-950 ">
 Kopplade outbounds
 </h2>

 <div className="mt-5 space-y-4">
 {relatedOutbounds.length === 0 ? (
 <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-slate-700 ">
 Inga kopplade outbounds.
 </div>
 ) : (
 relatedOutbounds.map((outbound) => (
 <div key={outbound.id} className="rounded-2xl border p-4 ">
 <div className="flex flex-wrap items-center gap-2">
 <span
 className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(outbound.status)}`}
 >
 {formatStatusLabel(outbound.status)}
 </span>
 <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ">
 {outbound.channel_type}
 </span>
 </div>

 <div className="mt-3 grid gap-2 text-sm text-slate-700 ">
 <div>
 Outbound ID: <span className="font-medium">{outbound.id}</span>
 </div>
 <div>
 Typ av begäran: <span className="font-medium">{outbound.request_type}</span>
 </div>
 <div>
 Extern referens:{' '}
 <span className="font-medium">{outbound.external_reference ?? '—'}</span>
 </div>
 <div>
 Failure reason:{' '}
 <span className="font-medium">{outbound.failure_reason ?? '—'}</span>
 </div>
 </div>

 <div className="mt-4 flex flex-wrap gap-2">
 <Link
 href={
 outbound.channel_type === 'unresolved'
 ? '/admin/outbound/unresolved'
 : '/admin/outbound'
 }
 className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 "
 >
 Visa utskick
 </Link>
 </div>
 </div>
 ))
 )}
 </div>
 </div>

 {tenantScope.isPlatformAdmin ? (
 <details className="rounded-2xl border border-slate-200 bg-white p-4">
 <summary className="cursor-pointer text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Tekniska uppgifter · superadmin</summary>
 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <h2 className="text-lg font-semibold text-slate-950 ">
 Payloads
 </h2>

 <div className="mt-5 grid gap-4 xl:grid-cols-2">
 <div className="rounded-2xl border border-slate-200 p-4 ">
 <div className="text-sm font-semibold text-slate-900 ">
 Request payload
 </div>
 <pre className="mt-3 overflow-x-auto rounded-2xl bg-emerald-700 p-4 text-xs text-slate-100">
 {JSON.stringify(request.request_payload ?? {}, null, 2)}
 </pre>
 </div>

 <div className="rounded-2xl border border-slate-200 p-4 ">
 <div className="text-sm font-semibold text-slate-900 ">
 Response payload
 </div>
 <pre className="mt-3 overflow-x-auto rounded-2xl bg-emerald-700 p-4 text-xs text-slate-100">
 {JSON.stringify(request.response_payload ?? {}, null, 2)}
 </pre>
 </div>
 </div>
 </div>
 </details>
 ) : null}

 {tenantScope.isPlatformAdmin ? (

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="flex items-center justify-between gap-4">
 <h2 className="text-lg font-semibold text-slate-950 ">
 Kopplade Ediel-meddelanden
 </h2>

 <Link
 href="/admin/ediel"
 className="text-sm font-medium text-slate-700 underline-offset-4 hover:underline "
 >
 Öppna Ediel-vyn
 </Link>
 </div>

 <div className="mt-5 space-y-4">
 {edielMessages.length === 0 ? (
 <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-700 ">
 Inga kopplade Ediel-meddelanden ännu.
 </div>
 ) : (
 edielMessages.map((message) => (
 <div
 key={message.id}
 className="rounded-2xl border border-slate-200 p-4 "
 >
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <div className="flex flex-wrap items-center gap-2">
 <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(message.status)}`}>
 {formatStatusLabel(message.status)}
 </span>
 <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ">
 {message.direction}
 </span>
 </div>
 <div className="mt-3 text-sm font-semibold text-slate-900 ">
 {message.message_family} {message.message_code}
 </div>
 <div className="mt-1 text-sm text-slate-700 ">
 Ref: {message.external_reference ?? '—'} · Version {message.message_version ?? '—'}
 </div>
 </div>

 <div className="text-right text-xs text-slate-700 ">
 <div>{formatDateTime(edielOccurredAt(message))}</div>
 <div className="mt-1 break-all">{message.id}</div>
 </div>
 </div>

 <div className="mt-4 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
 <div>Avsändare: <span className="font-medium">{message.sender_ediel_id ?? '—'}</span></div>
 <div>Mottagare: <span className="font-medium">{message.receiver_ediel_id ?? '—'}</span></div>
 <div>Interchange: <span className="font-medium">{message.interchange_reference ?? '—'}</span></div>
 <div>Transaction: <span className="font-medium">{message.transaction_reference ?? '—'}</span></div>
 </div>

 <div className="mt-4 flex flex-wrap gap-2">
 <Link
 href={`/admin/ediel/messages/${message.id}`}
 className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 "
 >
 Öppna meddelande
 </Link>

 {['draft', 'prepared', 'queued'].includes(message.status) ? (
 <form action={sendEdielMessageAction}>
 <input type="hidden" name="edielMessageId" value={message.id} />
 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white ">
 Skicka nu
 </button>
 </form>
 ) : null}
 </div>
 </div>
 ))
 )}
 </div>
 </div>
 ) : null}

 </div>

 <div className="space-y-6">
 {tenantScope.isPlatformAdmin ? (
 <div className="rounded-3xl border border-emerald-200 bg-emerald-50/70 p-6 shadow-sm ">
 <h2 className="text-lg font-semibold text-slate-950 ">
 Ediel direkt från requestdetaljen
 </h2>
 <p className="mt-2 text-sm text-slate-700 ">
 Här använder du samma grid owner request som källa. Ingen separat kö eller parallell logik byggs. Actions går via samma Ediel orchestrator.
 </p>

 <div className="mt-5 grid gap-4 md:grid-cols-2">
 <form action={prepareUtiltsE73Action} className="rounded-2xl border border-slate-200 bg-white p-4 ">
 <input type="hidden" name="gridOwnerDataRequestId" value={request.id} />
 <div className="text-sm font-semibold text-slate-900 ">Förbered UTILTS E73</div>
 <p className="mt-2 text-sm text-slate-700 ">
 Begär mätvärden utifrån exakt detta data request-id.
 </p>
 <button className="mt-4 w-full rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white ">
 Förbered E73
 </button>
 </form>

 <form action={prepareUtiltsE66Action} className="rounded-2xl border border-slate-200 bg-white p-4 ">
 <input type="hidden" name="gridOwnerDataRequestId" value={request.id} />
 <div className="text-sm font-semibold text-slate-900 ">Förbered UTILTS E66</div>
 <p className="mt-2 text-sm text-slate-700 ">
 Skapa E66 med period och kvantitet från samma request. Justera vid behov innan skick.
 </p>

 <div className="mt-3 grid gap-3">
 <input
 name="quantity"
 defaultValue="0"
 placeholder="Kvantitet, t.ex. 1250"
 className="min-w-0 w-full h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />
 <input
 name="periodStart"
 type="date"
 defaultValue={request.requested_period_start ?? ''}
 className="min-w-0 w-full h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />
 <input
 name="periodEnd"
 type="date"
 defaultValue={request.requested_period_end ?? ''}
 className="min-w-0 w-full h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />
 <input
 name="registrationTime"
 type="datetime-local"
 defaultValue=""
 className="min-w-0 w-full h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />
 </div>

 <button className="mt-4 w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 ">
 Förbered E66
 </button>
 </form>
 </div>
 </div>
 ) : null}

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <h2 className="text-lg font-semibold text-slate-950 ">
 Uppdatera status
 </h2>

 <form action={updateGridOwnerDataRequestStatusAction} className="mt-5 grid gap-3">
 <input type="hidden" name="request_id" value={request.id} />
 <input type="hidden" name="customer_id" value={request.customer_id} />
 <input type="hidden" name="original_status" value={request.status} />
 <input type="hidden" name="original_external_reference" value={request.external_reference ?? ''} />
 <input type="hidden" name="original_notes" value={request.notes ?? ''} />
 <input type="hidden" name="original_response_payload_note" value={adminNote} />
 <input type="hidden" name="original_failure_reason" value={request.failure_reason ?? ''} />

 <select
 name="status"
 defaultValue={request.status}
 className="min-w-0 w-full h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 >
 <option value="pending">Pending</option>
 <option value="sent">Sent</option>
 <option value="received">Received</option>
 <option value="failed">Failed</option>
 <option value="cancelled">Cancelled</option>
 </select>

 <input
 name="external_reference"
 defaultValue={request.external_reference ?? ''}
 placeholder="Extern referens"
 className="min-w-0 w-full h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />

 <input
 name="response_payload_note"
 defaultValue={adminNote}
 placeholder="Svar / intern notering"
 className="min-w-0 w-full h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />

 <input
 name="failure_reason"
 defaultValue={request.failure_reason ?? ''}
 placeholder="Felorsak"
 className="min-w-0 w-full h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />

 <input
 name="notes"
 defaultValue={request.notes ?? ''}
 placeholder="Notering"
 className="min-w-0 w-full h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />

 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white ">
 Uppdatera status
 </button>
 </form>
 </div>

 {relatedOutbounds.map((outbound) => (
 <div
 key={`status:${outbound.id}`}
 className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm "
 >
 <h2 className="text-lg font-semibold text-slate-950 ">
 Uppdatera outbound {outbound.id}
 </h2>

 <form action={updateOutboundRequestStatusAction} className="mt-5 grid gap-3">
 <input type="hidden" name="outbound_request_id" value={outbound.id} />
 <input type="hidden" name="customer_id" value={outbound.customer_id} />

 <input type="hidden" name="original_status" value={outbound.status} />
 <input type="hidden" name="original_external_reference" value={outbound.external_reference ?? ''} />
 <input type="hidden" name="original_failure_reason" value={outbound.failure_reason ?? ''} />
 <input type="hidden" name="original_response_payload_note" value="" />
 <input type="hidden" name="original_dispatch_step" value="" />
 <select
 name="status"
 defaultValue={outbound.status}
 className="min-w-0 w-full h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 >
 {!['queued', 'prepared', 'failed', 'cancelled'].includes(outbound.status) ? (
 <option value={outbound.status}>Behåll aktuell status</option>
 ) : null}
 <option value="queued">Queued</option>
 <option value="prepared">Prepared</option>
 <option value="failed">Failed</option>
 <option value="cancelled">Cancelled</option>
 </select>

 <input
 name="external_reference"
 defaultValue={outbound.external_reference ?? ''}
 placeholder="Extern referens"
 className="min-w-0 w-full h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />

 <input
 name="response_payload_note"
 placeholder="Svar / intern notering"
 className="min-w-0 w-full h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />

 <input
 name="dispatch_step"
 placeholder="Dispatch step"
 className="min-w-0 w-full h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />

 <input
 name="failure_reason"
 defaultValue={outbound.failure_reason ?? ''}
 placeholder="Felorsak"
 className="min-w-0 w-full h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />

 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white ">
 Uppdatera outboundstatus
 </button>
 </form>
 <ManualOutboundDeliveryForm request={outbound} action={updateOutboundRequestStatusAction}
   linkedOriginal={edielMessages.some(message => message.direction === 'outbound' && message.outbound_request_id === outbound.id)} />
 </div>
 ))}

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <h2 className="text-lg font-semibold text-slate-950 ">Timeline</h2>

 <div className="mt-5 space-y-3">
 {timeline.map((entry) => (
 <div key={entry.id} className="rounded-2xl border border-slate-200 p-4 ">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <div className="font-medium text-slate-900 ">
 {entry.title}
 </div>
 <div className="mt-1 text-sm text-slate-700 ">
 {entry.description}
 </div>
 </div>

 <div className="text-right">
 <span
 className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${tone(entry.status)}`}
 >
 {formatStatusLabel(entry.status)}
 </span>
 <div className="mt-2 text-xs text-slate-700 ">
 {formatDateTime(entry.occurredAt)}
 </div>
 </div>
 </div>

 {entry.href ? (
 <div className="mt-3">
 <Link
 href={entry.href}
 className="text-xs font-medium text-emerald-700 underline "
 >
 Öppna relaterad vy
 </Link>
 </div>
 ) : null}
 </div>
 ))}
 </div>
 </div>
 </div>
 </section>
 </div>
 </div>
 )
}
