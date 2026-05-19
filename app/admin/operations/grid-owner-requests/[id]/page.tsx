import Link from 'next/link'
import { notFound } from 'next/navigation'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
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

 if (request.status === 'received') return 'Underlag mottaget från nätägare'
 if (latestOutbound?.status === 'acknowledged') return 'Outbound kvitterad'
 if (latestOutbound?.status === 'sent') return 'Skickad, inväntar svar'
 if (latestOutbound?.status === 'failed') return 'Outbound felade'
 if (latestOutbound?.status === 'cancelled') return 'Outbound stoppad'
 if (request.status === 'cancelled') return 'Request stoppad'
 if (request.status === 'failed') return 'Request felade'
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
 title: 'Grid owner request',
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
 title: 'Outbound request',
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
 await requirePermissionServer('masterdata.read')

 const { id } = await params
 const supabase = await createSupabaseServerClient()
 const {
 data: { user },
 } = await supabase.auth.getUser()

 const requestQuery = await supabase
 .from('grid_owner_data_requests')
 .select('*')
 .eq('id', id)
 .maybeSingle()

 if (requestQuery.error) throw requestQuery.error
 const request = (requestQuery.data as GridOwnerDataRequestRow | null) ?? null

 if (!request) notFound()

 const [
 siteQuery,
 documentQuery,
 gridOwners,
 outboundByCustomer,
 edielMessagesQuery,
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
 supabase
 .from('ediel_messages')
 .select('*')
 .eq('grid_owner_data_request_id', request.id)
 .order('created_at', { ascending: false }),
 ])

 if (siteQuery.error) throw siteQuery.error
 if (documentQuery.error) throw documentQuery.error
 if (edielMessagesQuery.error) throw edielMessagesQuery.error

 const site = (siteQuery.data as CustomerSiteRow | null) ?? null
 const document = (documentQuery.data as CustomerAuthorizationDocumentRow | null) ?? null
 const edielMessages = (edielMessagesQuery.data as EdielMessageRow[] | null) ?? []

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

 const responseSummary = summarizeResponse(request, relatedOutbounds)

 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Grid owner request detail"
 subtitle="Detailvy för en enskild nätägarbegäran med dokument, outbound, payloads och timeline."
 userEmail={user?.email ?? null}
 />

 <div className="space-y-6 p-8">
 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="flex flex-wrap items-start justify-between gap-4">
 <div>
 <div className="flex flex-wrap items-center gap-2">
 <span
 className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(request.status)}`}
 >
 {request.status}
 </span>
 <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ">
 {request.request_scope}
 </span>
 </div>

 <h1 className="mt-3 text-2xl font-semibold text-slate-950 ">
 Grid owner request {request.id}
 </h1>

 <p className="mt-2 text-sm text-slate-700 ">
 Kund {request.customer_id} · Anläggning {siteName(site)} · Mätpunkt{' '}
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
 {request.status}
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
 Status: <span className="font-medium">{document.status}</span>
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
 {outbound.status}
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
 Request type: <span className="font-medium">{outbound.request_type}</span>
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
 Öppna outbound-vy
 </Link>
 </div>
 </div>
 ))
 )}
 </div>
 </div>

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
 {message.status}
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
 </div>

 <div className="space-y-6">
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
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />
 <input
 name="periodStart"
 type="date"
 defaultValue={request.requested_period_start ?? ''}
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />
 <input
 name="periodEnd"
 type="date"
 defaultValue={request.requested_period_end ?? ''}
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />
 <input
 name="registrationTime"
 type="datetime-local"
 defaultValue=""
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />
 </div>

 <button className="mt-4 w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 ">
 Förbered E66
 </button>
 </form>
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <h2 className="text-lg font-semibold text-slate-950 ">
 Uppdatera requeststatus
 </h2>

 <form action={updateGridOwnerDataRequestStatusAction} className="mt-5 grid gap-3">
 <input type="hidden" name="request_id" value={request.id} />
 <input type="hidden" name="customer_id" value={request.customer_id} />

 <select
 name="status"
 defaultValue={request.status}
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
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
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />

 <input
 name="response_payload_note"
 placeholder="Svar / intern notering"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />

 <input
 name="failure_reason"
 defaultValue={request.failure_reason ?? ''}
 placeholder="Felorsak"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />

 <input
 name="notes"
 defaultValue={request.notes ?? ''}
 placeholder="Notering"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />

 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white ">
 Uppdatera requeststatus
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

 <select
 name="status"
 defaultValue={outbound.status}
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 >
 <option value="queued">Queued</option>
 <option value="prepared">Prepared</option>
 <option value="sent">Sent</option>
 <option value="acknowledged">Acknowledged</option>
 <option value="failed">Failed</option>
 <option value="cancelled">Cancelled</option>
 </select>

 <input
 name="external_reference"
 defaultValue={outbound.external_reference ?? ''}
 placeholder="Extern referens"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />

 <input
 name="response_payload_note"
 placeholder="Svar / intern notering"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />

 <input
 name="dispatch_step"
 placeholder="Dispatch step"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />

 <input
 name="failure_reason"
 defaultValue={outbound.failure_reason ?? ''}
 placeholder="Felorsak"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />

 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white ">
 Uppdatera outboundstatus
 </button>
 </form>
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
 {entry.status}
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