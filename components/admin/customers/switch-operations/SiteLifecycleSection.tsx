'use client'

import Link from 'next/link'
import type { MeteringPointRow } from '@/lib/masterdata/types'
import type { SiteLifecycleSummary } from './types'
import {
 customerJourneyHref,
 formatDateTime,
 lifecycleTone,
 meteringPointLabel,
 statusTone,
} from './helpers'

type Props = {
 customerId: string
 meteringPoints: MeteringPointRow[]
 siteLifecycleSummaries: SiteLifecycleSummary[]
}

export default function SiteLifecycleSection({
 customerId,
 meteringPoints,
 siteLifecycleSummaries,
}: Props) {
 return (
 <div className="rounded-3xl border border-slate-200 bg-white shadow-sm ">
 <div className="border-b border-slate-200 px-6 py-5 ">
 <h2 className="text-lg font-semibold text-slate-900 ">
 Flödesstatus per anläggning
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Kundkortet visar var varje anläggning befinner sig i leverantörsbytet, om utskick skapades automatiskt och vilken arbetsyta som är rätt nästa steg.
 </p>
 </div>

 <div className="space-y-4 p-6">
 {siteLifecycleSummaries.length === 0 ? (
 <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-700 ">
 Inga anläggningar finns ännu för kunden.
 </div>
 ) : (
 siteLifecycleSummaries.map((summary) => {
 const journeyLink =
 summary.lifecycle && summary.latestRequest
 ? customerJourneyHref({
 lifecycleStage: summary.lifecycle.stage,
 requestId: summary.latestRequest.id,
 })
 : null

 return (
 <article
 key={summary.site.id}
 className="rounded-3xl border border-slate-200 p-5 "
 >
 <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
 <div>
 <div className="flex flex-wrap items-center gap-2">
 <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ">
 {summary.site.site_name}
 </span>

 {summary.lifecycle ? (
 <span
 className={`rounded-full px-3 py-1 text-xs font-semibold ${lifecycleTone(
 summary.lifecycle.stage
 )}`}
 >
 {summary.lifecycle.label}
 </span>
 ) : (
 <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ">
 Inget switchärende
 </span>
 )}

 {summary.latestRequest ? (
 <span
 className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(
 summary.latestRequest.status
 )}`}
 >
 {summary.latestRequest.status}
 </span>
 ) : null}

 {summary.outbound ? (
 <span
 className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(
 summary.outbound.channel_type === 'unresolved'
 ? 'missing_route'
 : summary.outbound.status
 )}`}
 >
 utskick:{' '}
 {summary.outbound.channel_type === 'unresolved'
 ? 'route saknas'
 : summary.outbound.status}
 </span>
 ) : null}
 </div>

 <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Site</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {summary.site.facility_id ?? summary.site.id}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Mätpunkt</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {summary.latestRequest
 ? meteringPointLabel(
 summary.latestRequest.metering_point_id,
 meteringPoints
 )
 : '—'}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Requests</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {summary.requests.length}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Senaste event</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {summary.latestEvent?.event_status ?? '—'}
 </div>
 </div>
 </div>

 <div className="mt-4 grid gap-3 md:grid-cols-2">
 <div className="rounded-2xl border border-slate-200 p-4 ">
 <div className="text-sm font-semibold text-slate-900 ">
 Flödesförklaring
 </div>
 <p className="mt-2 text-sm text-slate-700 ">
 {summary.lifecycle?.reason ??
 'Inget switchärende finns ännu för denna anläggning.'}
 </p>
 </div>

 <div className="rounded-2xl border border-slate-200 p-4 ">
 <div className="text-sm font-semibold text-slate-900 ">
 Vad sitter fast?
 </div>
 <p className="mt-2 text-sm text-slate-700 ">
 {summary.stuckReason}
 </p>
 </div>
 </div>

 {summary.validation ? (
 <div className="mt-4 rounded-2xl border border-slate-200 p-4 ">
 <div className="text-sm font-semibold text-slate-900 ">
 Valideringsöversikt
 </div>
 <div className="mt-2 grid gap-2 text-sm text-slate-700 md:grid-cols-3">
 <div>
 Status:{' '}
 <span className="font-medium">{summary.validation.label}</span>
 </div>
 <div>
 Senast validerad:{' '}
 <span className="font-medium">
 {formatDateTime(summary.validation.validatedAt)}
 </span>
 </div>
 <div>
 Antal avvikelser:{' '}
 <span className="font-medium">
 {summary.validation.issueCount}
 </span>
 </div>
 </div>

 <div className="mt-2 text-sm text-slate-700 ">
 Avvikelsekoder:{' '}
 <span className="font-medium">
 {summary.validation.issueCodes.length > 0
 ? summary.validation.issueCodes.join(', ')
 : '—'}
 </span>
 </div>
 </div>
 ) : null}
 </div>

 <div className="rounded-3xl border border-slate-200 p-5 ">
 <h3 className="text-sm font-semibold text-slate-900 ">
 Nästa arbetsyta
 </h3>

 <div className="mt-4 space-y-3">
 {summary.latestRequest ? (
 <>
 <Link
 href={`/admin/operations/switches/${summary.latestRequest.id}`}
 className="block rounded-2xl border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-700 "
 >
 Öppna leverantörsbyte
 </Link>

 {journeyLink ? (
 <Link
 href={journeyLink.href}
 className="block rounded-2xl border border-emerald-300 px-4 py-2.5 text-center text-sm font-semibold text-emerald-700 "
 >
 {journeyLink.label}
 </Link>
 ) : null}
 </>
 ) : (
 <Link
 href={`/admin/customers/${customerId}#masterdata`}
 className="block rounded-2xl border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-700 "
 >
 Kontrollera anläggning och grunddata
 </Link>
 )}

 <Link
 href="/admin/operations/switches"
 className="block rounded-2xl border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-700 "
 >
 Öppna leverantörsbyten
 </Link>

 <Link
 href="/admin/outbound"
 className="block rounded-2xl border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-700 "
 >
 Öppna utskick
 </Link>

 <Link
 href="/admin/outbound/unresolved"
 className="block rounded-2xl border border-red-300 px-4 py-2.5 text-center text-sm font-semibold text-red-700 "
 >
 Öppna saknade rutter
 </Link>

 <Link
 href={`/admin/customers/${customerId}`}
 className="block rounded-2xl border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-700 "
 >
 Stanna på kundkortet
 </Link>
 </div>
 </div>
 </div>
 </article>
 )
 })
 )}
 </div>
 </div>
 )
}