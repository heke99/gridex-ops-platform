// app/admin/metering/_components.tsx
import Link from 'next/link'
import type { GridOwnerDataRequestRow, MeteringValueRow } from '@/lib/cis/types'
import {
 ingestMeteringValueAction,
 updateGridOwnerDataRequestStatusAction,
} from '@/app/admin/cis/actions'
import { prepareUtiltsE73Action } from '@/app/admin/ediel/actions'

function formatDateTime(value: string | null | undefined): string {
 if (!value) return '—'
 return new Intl.DateTimeFormat('sv-SE', {
 dateStyle: 'medium',
 timeStyle: 'short',
 }).format(new Date(value))
}

function statusTone(status: string): string {
 if (['received', 'acknowledged', 'validated', 'exported'].includes(status)) {
 return 'bg-emerald-100 text-emerald-700'
 }
 if (['failed', 'cancelled'].includes(status)) {
 return 'bg-red-100 text-red-700'
 }
 if (status === 'sent') return 'bg-emerald-100 text-emerald-700'
 return 'bg-amber-100 text-amber-700'
}

function sourceTone(sourceSystem: string): string {
 const normalized = sourceSystem.toLowerCase()
 if (normalized.includes('ediel') || normalized.includes('utilts')) {
 return 'bg-emerald-100 text-emerald-700'
 }
 if (normalized.includes('manual')) return 'bg-slate-100 text-slate-700'
 return 'bg-emerald-100 text-emerald-700'
}

function shortId(value: string | null | undefined): string {
 if (!value) return '—'
 if (value.length <= 12) return value
 return `${value.slice(0, 8)}…${value.slice(-4)}`
}

function requestKindLabel(scope: string): string {
 if (scope === 'meter_values') return 'Mätvärden'
 if (scope === 'billing_underlay') return 'Billingunderlag'
 if (scope === 'customer_masterdata') return 'Masterdata'
 return scope
}

function isOpenRequest(request: GridOwnerDataRequestRow): boolean {
 return request.status === 'pending' || request.status === 'sent'
}

function isEdielValue(value: MeteringValueRow): boolean {
 const source = value.source_system.toLowerCase()
 return source.includes('ediel') || source.includes('utilts')
}

function isCorrectedValue(value: MeteringValueRow): boolean {
 const quality = String(value.quality_code ?? '').toLowerCase()
 return Boolean((value.revision_number ?? 1) > 1 || value.previous_value_id || quality.includes('correct') || quality.includes('korr') || quality.includes('rätt'))
}

export function MeteringFilterBar({ query }: { query: string }) {
 return (
 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
 <form className="grid gap-4 xl:grid-cols-[1fr_auto]">
 <input
 name="q"
 defaultValue={query}
 placeholder="Sök kund, anläggning, mätpunkt, ärende-id, kvalitet eller källa"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm outline-none focus:border-emerald-700"
 />
 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white">
 Filtrera
 </button>
 </form>
 </section>
 )
}

export function MeteringOperationalSummary({
 requests,
 values,
}: {
 requests: GridOwnerDataRequestRow[]
 values: MeteringValueRow[]
}) {
 const openRequests = requests.filter(isOpenRequest)
 const sentRequests = requests.filter((request) => request.status === 'sent')
 const receivedRequests = requests.filter((request) => request.status === 'received')
 const failedRequests = requests.filter((request) => request.status === 'failed')
 const edielValues = values.filter(isEdielValue)
 const valuesWithSourceRequest = values.filter((value) => Boolean(value.source_request_id))
 const correctedValues = values.filter(isCorrectedValue)
 const missingTenantValues = values.filter((value) => !value.company_id)

 return (
 <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-8">
 <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
 <div className="text-sm font-medium text-amber-700">Öppna requests</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950">{openRequests.length}</div>
 </div>

 <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
 <div className="text-sm font-medium text-emerald-700">Skickade E73-liknande</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950">{sentRequests.length}</div>
 </div>

 <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
 <div className="text-sm font-medium text-emerald-700">Mottagna</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950">{receivedRequests.length}</div>
 </div>

 <div className="rounded-3xl border border-red-200 bg-red-50 p-5">
 <div className="text-sm font-medium text-red-700">Felade</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950">{failedRequests.length}</div>
 </div>

 <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
 <div className="text-sm font-medium text-emerald-700">UTILTS/Ediel-värden</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950">{edielValues.length}</div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-5">
 <div className="text-sm font-medium text-slate-700">Kopplade värden</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950">
 {valuesWithSourceRequest.length}
 </div>
 </div>

 <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
 <div className="text-sm font-medium text-amber-900">Korrigerade värden</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950">{correctedValues.length}</div>
 </div>

 <div className="rounded-3xl border border-red-200 bg-red-50 p-5">
 <div className="text-sm font-medium text-red-900">Saknar tenant</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950">{missingTenantValues.length}</div>
 </div>
 </section>
 )
}

export function MeteringRequestsSection({
 requests,
}: {
 requests: GridOwnerDataRequestRow[]
}) {
 return (
 <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
 <div className="border-b border-slate-200 px-6 py-5">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <h2 className="text-lg font-semibold text-slate-950">Mätvärdesrequests</h2>
 <p className="mt-1 text-sm text-slate-700">
 {requests.length} träffar. Använd E73-knappen för att begära saknade värden via Ediel.
 </p>
 </div>
 <Link
 href="/admin/ediel"
 className="rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
 >
 Öppna Ediel workbench
 </Link>
 </div>
 </div>

 <div className="space-y-4 p-6">
 {requests.length === 0 ? (
 <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-slate-700">
 Inga mätvärdesrequests hittades.
 </div>
 ) : (
 requests.slice(0, 20).map((request) => (
 <div key={request.id} className="rounded-2xl border border-slate-200 p-4">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div className="flex flex-wrap items-center gap-2">
 <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(request.status)}`}>
 {request.status}
 </span>
 <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
 {requestKindLabel(request.request_scope)}
 </span>
 {request.response_payload?.edielMessageId ? (
 <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
 Inkommet via Ediel
 </span>
 ) : null}
 </div>

 <div className="flex flex-wrap gap-2">
 <Link
 href={`/admin/operations/grid-owner-requests/${request.id}`}
 className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
 >
 Detailvy
 </Link>
 <Link
 href={`/admin/customers/${request.customer_id}`}
 className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
 >
 Kundkort
 </Link>
 </div>
 </div>

 <div className="mt-4 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
 <div>Kund: <span className="font-medium">{shortId(request.customer_id)}</span></div>
 <div>Request: <span className="font-medium">{shortId(request.id)}</span></div>
 <div>Site: <span className="font-medium">{shortId(request.site_id)}</span></div>
 <div>Mätpunkt: <span className="font-medium">{shortId(request.metering_point_id)}</span></div>
 <div>Period: <span className="font-medium">{request.requested_period_start ?? '—'} → {request.requested_period_end ?? '—'}</span></div>
 <div>Extern ref: <span className="font-medium">{request.external_reference ?? '—'}</span></div>
 <div>Skickad: <span className="font-medium">{formatDateTime(request.sent_at)}</span></div>
 <div>Mottagen: <span className="font-medium">{formatDateTime(request.received_at)}</span></div>
 </div>

 <div className="mt-4 grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)]">
 <form action={prepareUtiltsE73Action}>
 <input type="hidden" name="gridOwnerDataRequestId" value={request.id} />
 <button
 disabled={!isOpenRequest(request)}
 className="w-full rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
 >
 Förbered UTILTS E73
 </button>
 </form>

 <form
 action={updateGridOwnerDataRequestStatusAction}
 className="grid gap-2 md:grid-cols-[160px_1fr_1fr_auto]"
 >
 <input type="hidden" name="request_id" value={request.id} />
 <input type="hidden" name="customer_id" value={request.customer_id} />
 <select
 name="status"
 defaultValue={request.status}
 className="h-11 rounded-2xl border border-slate-300 px-3 text-sm"
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
 className="h-11 rounded-2xl border border-slate-300 px-3 text-sm"
 />
 <input
 name="response_payload_note"
 placeholder="Notering"
 className="h-11 rounded-2xl border border-slate-300 px-3 text-sm"
 />
 <button className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
 Uppdatera
 </button>
 </form>
 </div>
 </div>
 ))
 )}
 </div>
 </div>
 )
}

export function MeteringIngestForm() {
 return (
 <form
 action={ingestMeteringValueAction}
 className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
 >
 <h2 className="text-lg font-semibold text-slate-950">Registrera inkommet mätvärde</h2>
 <p className="mt-1 text-sm text-slate-700">
 Reservväg för manuell registrering. UTILTS E66/E30 ska normalt skapa värden automatiskt.
 </p>

 <div className="mt-5 grid gap-4">
 <input name="customer_id" placeholder="Kund-id" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" required />
 <input name="site_id" placeholder="Anläggnings-id" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
 <input name="metering_point_id" placeholder="Mätpunkt-id" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" required />
 <input name="source_request_id" placeholder="Källärende-id" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
 <input name="grid_owner_id" placeholder="Nätägare-id" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />

 <select name="reading_type" defaultValue="consumption" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm">
 <option value="consumption">Consumption</option>
 <option value="production">Production</option>
 <option value="estimated">Estimated</option>
 <option value="adjustment">Adjustment</option>
 </select>

 <input name="value_kwh" placeholder="kWh" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" required />
 <input name="quality_code" placeholder="Kvalitetskod" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
 <input name="read_at" type="datetime-local" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
 <input name="period_start" type="datetime-local" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
 <input name="period_end" type="datetime-local" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
 <input name="source_system" defaultValue="manual_admin" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
 <input name="raw_payload_note" placeholder="Notering / rådatareferens" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
 </div>

 <div className="mt-6">
 <button className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white">
 Registrera mätvärde
 </button>
 </div>
 </form>
 )
}

export function MeteringValuesTable({ values }: { values: MeteringValueRow[] }) {
 return (
 <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
 <div className="border-b border-slate-200 px-6 py-5">
 <h2 className="text-lg font-semibold text-slate-950">Senaste mätvärden</h2>
 <p className="mt-1 text-sm text-slate-700">
 {values.length} rader. Ediel/UTILTS-rader ska ha source request där det går.
 </p>
 </div>

 <div className="overflow-x-auto">
 <table className="min-w-full text-sm">
 <thead className="bg-slate-50">
 <tr className="border-b border-slate-200 text-left">
 <th className="px-6 py-4 font-semibold text-slate-700">Tid</th>
 <th className="px-6 py-4 font-semibold text-slate-700">Kund</th>
 <th className="px-6 py-4 font-semibold text-slate-700">Mätpunkt</th>
 <th className="px-6 py-4 font-semibold text-slate-700">Typ/source</th>
 <th className="px-6 py-4 font-semibold text-slate-700">kWh</th>
 <th className="px-6 py-4 font-semibold text-slate-700">Period</th>
 <th className="px-6 py-4 font-semibold text-slate-700">Revision</th>
 <th className="px-6 py-4 text-right font-semibold text-slate-700">Öppna</th>
 </tr>
 </thead>
 <tbody>
 {values.length === 0 ? (
 <tr>
 <td colSpan={8} className="px-6 py-10 text-center text-sm text-slate-700">
 Inga mätvärden ännu.
 </td>
 </tr>
 ) : (
 values.slice(0, 80).map((value) => (
 <tr key={value.id} className="border-b border-slate-100">
 <td className="px-6 py-4 text-slate-700">{formatDateTime(value.read_at)}</td>
 <td className="px-6 py-4 text-slate-700">{shortId(value.customer_id)}</td>
 <td className="px-6 py-4 text-slate-700">{shortId(value.metering_point_id)}</td>
 <td className="px-6 py-4">
 <div className="flex flex-wrap gap-1">
 <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
 {value.reading_type}
 </span>
 <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${sourceTone(value.source_system)}`}>
 {value.source_system}
 </span>
 </div>
 </td>
 <td className="px-6 py-4 font-medium text-slate-900">{value.value_kwh}</td>
 <td className="px-6 py-4 text-slate-700">
 {value.period_start ?? '—'} → {value.period_end ?? '—'}
 </td>
 <td className="px-6 py-4">
 <div className="flex flex-wrap gap-1">
 <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${isCorrectedValue(value) ? 'bg-amber-100 text-amber-950' : 'bg-slate-100 text-slate-800'}`}>
 v{value.revision_number ?? 1}
 </span>
 {value.is_current === false ? (
 <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800">Ersatt</span>
 ) : null}
 </div>
 </td>
 <td className="px-6 py-4 text-right">
 {value.source_request_id ? (
 <Link
 href={`/admin/operations/grid-owner-requests/${value.source_request_id}`}
 className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
 >
 Source request
 </Link>
 ) : (
 <span className="text-xs text-slate-700">—</span>
 )}
 </td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 </section>
 )
}
