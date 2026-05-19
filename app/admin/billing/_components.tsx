// app/admin/billing/_components.tsx
import Link from 'next/link'
import type {
 BillingUnderlayRow,
 GridOwnerDataRequestRow,
 PartnerExportRow,
} from '@/lib/cis/types'
import type { BillingReadinessResult } from '@/lib/cis/billingReadiness'
import {
 ingestBillingUnderlayAction,
 updateGridOwnerDataRequestStatusAction,
 updatePartnerExportStatusAction,
 queueReadyBillingExportsFromBillingAction,
} from '@/app/admin/cis/actions'

export function billingTone(status: string): string {
 if (['validated', 'exported', 'received', 'acknowledged'].includes(status)) {
 return 'bg-emerald-100 text-emerald-700'
 }
 if (['failed', 'cancelled'].includes(status)) {
 return 'bg-red-100 text-red-700'
 }
 if (['sent'].includes(status)) {
 return 'bg-emerald-100 text-emerald-700'
 }
 return 'bg-amber-100 text-amber-700'
}

function readinessTone(status: BillingReadinessResult['status'] | string): string {
 if (status === 'ready') return 'border-emerald-300 bg-emerald-100 text-emerald-900'
 if (status === 'warning') return 'border-amber-300 bg-amber-100 text-amber-950'
 if (status === 'requires_correction' || status === 'blocked') return 'border-red-300 bg-red-100 text-red-950'
 if (status === 'already_exported') return 'border-slate-300 bg-slate-100 text-slate-900'
 return 'border-slate-300 bg-white text-slate-900'
}

function ReadinessBadge({ readiness }: { readiness: BillingReadinessResult | null | undefined }) {
 if (!readiness) {
 return <span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-bold text-slate-900">Ej kontrollerad</span>
 }

 return (
 <span className={`rounded-full border px-3 py-1 text-xs font-bold ${readinessTone(readiness.status)}`}>
 {readiness.label}
 </span>
 )
}

export function BillingReadinessExportPanel() {
 const currentMonth = new Date().toISOString().slice(0, 7)

 return (
 <form action={queueReadyBillingExportsFromBillingAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
 <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-900">6C exportberedskap</p>
 <h2 className="mt-2 text-lg font-black text-slate-950">Köa bara redo underlag</h2>
 <p className="mt-2 text-sm font-medium leading-6 text-slate-700">
 Exportkörningen stoppar inte hela perioden om en kund eller mätpunkt saknar data. Systemet köar färdiga rader och flaggar ofullständiga rader för handläggning.
 </p>
 <div className="mt-5 grid gap-4">
 <input
 name="period_month"
 type="month"
 defaultValue={currentMonth}
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-700"
 required
 />
 <input
 name="target_system"
 defaultValue="billing_partner"
 placeholder="Mottagande exportsystem"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-700"
 />
 <button className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-800">
 Köa redo underlag
 </button>
 </div>
 </form>
 )
}

export function BillingFilterBar({
 query,
 status,
}: {
 query: string
 status: string
}) {
 return (
 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
 <form className="grid gap-4 xl:grid-cols-[1.3fr_220px_auto]">
 <input
 name="q"
 defaultValue={query}
 placeholder="Sök på kund, site, mätpunkt, period eller referens"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm outline-none focus:border-emerald-700"
 />
 <select
 name="status"
 defaultValue={status}
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 >
 <option value="all">Alla statusar</option>
 <option value="pending">Pending</option>
 <option value="received">Received</option>
 <option value="validated">Validated</option>
 <option value="exported">Exported</option>
 <option value="failed">Failed</option>
 </select>
 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white">
 Filtrera
 </button>
 </form>
 </section>
 )
}

export function BillingRequestsSection({
 requests,
}: {
 requests: GridOwnerDataRequestRow[]
}) {
 return (
 <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
 <div className="border-b border-slate-200 px-6 py-5">
 <h2 className="text-lg font-semibold text-slate-950">
 Billing-requests mot nätägare
 </h2>
 <p className="mt-1 text-sm text-slate-700">{requests.length} träffar.</p>
 </div>

 <div className="space-y-4 p-6">
 {requests.length === 0 ? (
 <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-slate-700">
 Inga billing-requests hittades.
 </div>
 ) : (
 requests.slice(0, 12).map((request) => (
 <div key={request.id} className="rounded-2xl border p-4">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div className="flex flex-wrap items-center gap-2">
 <span
 className={`rounded-full px-3 py-1 text-xs font-semibold ${billingTone(
 request.status
 )}`}
 >
 {request.status}
 </span>
 <span className="text-xs text-slate-700">{request.request_scope}</span>
 </div>

 <Link
 href={`/admin/operations/grid-owner-requests/${request.id}`}
 className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
 >
 Öppna detailvy
 </Link>
 </div>

 <div className="mt-3 grid gap-2 text-sm text-slate-700">
 <div>
 Kund: <span className="font-medium">{request.customer_id}</span>
 </div>
 <div>
 Site: <span className="font-medium">{request.site_id ?? '—'}</span>
 </div>
 <div>
 Mätpunkt:{' '}
 <span className="font-medium">{request.metering_point_id ?? '—'}</span>
 </div>
 <div>
 Period:{' '}
 <span className="font-medium">
 {request.requested_period_start ?? '—'} →{' '}
 {request.requested_period_end ?? '—'}
 </span>
 </div>
 <div>
 Extern referens:{' '}
 <span className="font-medium">{request.external_reference ?? '—'}</span>
 </div>
 </div>

 <form
 action={updateGridOwnerDataRequestStatusAction}
 className="mt-4 grid gap-3 md:grid-cols-2"
 >
 <input type="hidden" name="request_id" value={request.id} />
 <input type="hidden" name="customer_id" value={request.customer_id} />

 <select
 name="status"
 defaultValue={request.status}
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
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
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 />

 <input
 name="response_payload_note"
 placeholder="Svar / intern notering"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 />

 <input
 name="failure_reason"
 defaultValue={request.failure_reason ?? ''}
 placeholder="Felorsak"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 />

 <div className="md:col-span-2">
 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white">
 Uppdatera requeststatus
 </button>
 </div>
 </form>
 </div>
 ))
 )}
 </div>
 </div>
 )
}

export function BillingUnderlaysSection({
 underlays,
 requestById,
 readinessByUnderlayId,
}: {
 underlays: BillingUnderlayRow[]
 requestById: Map<string, GridOwnerDataRequestRow>
 readinessByUnderlayId: Map<string, BillingReadinessResult>
}) {
 return (
 <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
 <div className="border-b border-slate-200 px-6 py-5">
 <h2 className="text-lg font-semibold text-slate-950">Billing underlag</h2>
 <p className="mt-1 text-sm text-slate-700">{underlays.length} träffar.</p>
 </div>

 <div className="space-y-4 p-6">
 {underlays.length === 0 ? (
 <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-slate-700">
 Inga billing underlag hittades.
 </div>
 ) : (
 underlays.slice(0, 20).map((underlay) => {
 const sourceRequest = underlay.source_request_id
 ? requestById.get(underlay.source_request_id) ?? null
 : null

 const readiness = readinessByUnderlayId.get(underlay.id) ?? null

 return (
 <div key={underlay.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div className="flex flex-wrap items-center gap-2">
 <span
 className={`rounded-full px-3 py-1 text-xs font-bold ${billingTone(
 underlay.status
 )}`}
 >
 {underlay.status}
 </span>
 <ReadinessBadge readiness={readiness} />
 <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-900">
 {underlay.underlay_year ?? '—'}-
 {String(underlay.underlay_month ?? '').padStart(2, '0')}
 </span>
 </div>

 {sourceRequest ? (
 <Link
 href={`/admin/operations/grid-owner-requests/${sourceRequest.id}`}
 className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
 >
 Öppna source request
 </Link>
 ) : null}
 </div>

 <div className="mt-3 grid gap-2 text-sm text-slate-700">
 <div>
 Kund: <span className="font-medium">{underlay.customer_id}</span>
 </div>
 <div>
 Site: <span className="font-medium">{underlay.site_id ?? '—'}</span>
 </div>
 <div>
 Mätpunkt:{' '}
 <span className="font-medium">{underlay.metering_point_id ?? '—'}</span>
 </div>
 <div>
 Total kWh: <span className="font-medium">{underlay.total_kwh ?? '—'}</span>
 </div>
 <div>
 Total ex moms:{' '}
 <span className="font-medium">
 {underlay.total_sek_ex_vat ?? '—'} {underlay.currency}
 </span>
 </div>
 <div>
 Source request:{' '}
 <span className="font-medium">
 {sourceRequest?.id ?? underlay.source_request_id ?? '—'}
 </span>
 </div>
 <div>
 Matchade mätvärden:{' '}
 <span className="font-medium">{readiness?.matchedMeterValueCount ?? 0}</span>
 </div>
 </div>

 {readiness?.issues.length ? (
 <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
 <div className="text-xs font-black uppercase tracking-[0.14em] text-amber-950">Flaggor per underlag</div>
 <ul className="mt-2 space-y-1 text-sm font-medium leading-6 text-amber-950">
 {readiness.issues.slice(0, 4).map((issue) => (
 <li key={`${underlay.id}:${issue.code}`}>• {issue.title}: {issue.description}</li>
 ))}
 </ul>
 </div>
 ) : null}
 </div>
 )
 })
 )}
 </div>
 </div>
 )
}

export function BillingExportsSection({
 exports,
 requestById,
 underlayById,
}: {
 exports: PartnerExportRow[]
 requestById: Map<string, GridOwnerDataRequestRow>
 underlayById: Map<string, BillingUnderlayRow>
}) {
 return (
 <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
 <div className="border-b border-slate-200 px-6 py-5">
 <h2 className="text-lg font-semibold text-slate-950">
 Billing-exporter till partner
 </h2>
 <p className="mt-1 text-sm text-slate-700">{exports.length} träffar.</p>
 </div>

 <div className="space-y-4 p-6">
 {exports.length === 0 ? (
 <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-slate-700">
 Inga billing-exporter ännu.
 </div>
 ) : (
 exports.slice(0, 12).map((exportRow) => {
 const relatedUnderlay = exportRow.billing_underlay_id
 ? underlayById.get(exportRow.billing_underlay_id) ?? null
 : null
 const sourceRequest = relatedUnderlay?.source_request_id
 ? requestById.get(relatedUnderlay.source_request_id) ?? null
 : null

 return (
 <div key={exportRow.id} className="rounded-2xl border p-4">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div className="flex flex-wrap items-center gap-2">
 <span
 className={`rounded-full px-3 py-1 text-xs font-semibold ${billingTone(
 exportRow.status
 )}`}
 >
 {exportRow.status}
 </span>
 <span className="text-xs text-slate-700">{exportRow.export_kind}</span>
 </div>

 {sourceRequest ? (
 <Link
 href={`/admin/operations/grid-owner-requests/${sourceRequest.id}`}
 className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
 >
 Öppna source request
 </Link>
 ) : null}
 </div>

 <div className="mt-3 grid gap-2 text-sm text-slate-700">
 <div>
 Kund: <span className="font-medium">{exportRow.customer_id}</span>
 </div>
 <div>
 Target system:{' '}
 <span className="font-medium">{exportRow.target_system}</span>
 </div>
 <div>
 Billing underlag:{' '}
 <span className="font-medium">{exportRow.billing_underlay_id ?? '—'}</span>
 </div>
 <div>
 Extern referens:{' '}
 <span className="font-medium">{exportRow.external_reference ?? '—'}</span>
 </div>
 <div>
 Source request:{' '}
 <span className="font-medium">
 {sourceRequest?.id ?? relatedUnderlay?.source_request_id ?? '—'}
 </span>
 </div>
 </div>

 <form
 action={updatePartnerExportStatusAction}
 className="mt-4 grid gap-3 md:grid-cols-2"
 >
 <input type="hidden" name="export_id" value={exportRow.id} />
 <input type="hidden" name="customer_id" value={exportRow.customer_id} />

 <select
 name="status"
 defaultValue={exportRow.status}
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 >
 <option value="queued">Queued</option>
 <option value="sent">Sent</option>
 <option value="acknowledged">Acknowledged</option>
 <option value="failed">Failed</option>
 <option value="cancelled">Cancelled</option>
 </select>

 <input
 name="external_reference"
 defaultValue={exportRow.external_reference ?? ''}
 placeholder="Extern referens"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 />

 <input
 name="response_payload_note"
 placeholder="Svar / intern notering"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 />

 <input
 name="failure_reason"
 defaultValue={exportRow.failure_reason ?? ''}
 placeholder="Felorsak"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 />

 <div className="md:col-span-2">
 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white">
 Uppdatera exportstatus
 </button>
 </div>
 </form>
 </div>
 )
 })
 )}
 </div>
 </div>
 )
}

export function BillingIngestForm() {
 return (
 <form
 action={ingestBillingUnderlayAction}
 className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
 >
 <h2 className="text-lg font-semibold text-slate-950">
 Registrera inkommet billing underlag
 </h2>
 <p className="mt-1 text-sm text-slate-700">
 Första ingest-versionen innan automatisk nätägarintegration finns på plats.
 </p>

 <div className="mt-5 grid gap-4">
 <input
 name="customer_id"
 placeholder="Customer ID"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 required
 />
 <input
 name="site_id"
 placeholder="Site ID"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 />
 <input
 name="metering_point_id"
 placeholder="Metering point ID"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 />
 <input
 name="source_request_id"
 placeholder="Source request ID"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 />
 <input
 name="grid_owner_id"
 placeholder="Grid owner ID"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 />

 <div className="grid gap-4 sm:grid-cols-2">
 <input
 name="underlay_year"
 placeholder="År"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 />
 <input
 name="underlay_month"
 placeholder="Månad"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 />
 </div>

 <select
 name="status"
 defaultValue="received"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 >
 <option value="pending">Pending</option>
 <option value="received">Received</option>
 <option value="validated">Validated</option>
 <option value="exported">Exported</option>
 <option value="failed">Failed</option>
 </select>

 <input
 name="total_kwh"
 placeholder="Total kWh"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 />
 <input
 name="total_sek_ex_vat"
 placeholder="Total SEK ex moms"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 />
 <input
 name="currency"
 defaultValue="SEK"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 />
 <input
 name="source_system"
 defaultValue="grid_owner"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 />
 <input
 name="payload_note"
 placeholder="Payload / intern notering"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 />
 <input
 name="failure_reason"
 placeholder="Felorsak"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 />
 </div>

 <div className="mt-6">
 <button className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white">
 Registrera billing underlag
 </button>
 </div>
 </form>
 )
}