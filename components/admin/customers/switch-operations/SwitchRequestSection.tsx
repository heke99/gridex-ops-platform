'use client'

import Link from 'next/link'
import type { OutboundRequestRow } from '@/lib/cis/types'
import type {
 CustomerSiteRow,
 MeteringPointRow,
} from '@/lib/masterdata/types'
import type {
 SupplierSwitchEventRow,
 SupplierSwitchRequestRow,
} from '@/lib/operations/types'
import { queueSupplierSwitchOutboundAction } from '@/app/admin/cis/actions'
import { retryOutboundRequestFromCustomerAction } from '@/app/admin/customers/[id]/switch-actions'
import {
 explainWhySwitchIsStuck,
 getSwitchLifecycle,
 summarizeDispatchAttempt,
} from '@/lib/operations/controlTower'
import {
 customerJourneyHref,
 formatDateTime,
 getLatestEventForRequest,
 getLatestOutboundForRequest,
 lifecycleTone,
 meteringPointLabel,
 nextActionLabel,
 readValidationSummary,
 requestSortTime,
 siteLabel,
 statusTone,
} from './helpers'

type Props = {
 customerId: string
 sites: CustomerSiteRow[]
 meteringPoints: MeteringPointRow[]
 switchRequests: SupplierSwitchRequestRow[]
 switchEvents: SupplierSwitchEventRow[]
 switchOutboundRequests: OutboundRequestRow[]
}

export default function SwitchRequestSection({
 customerId,
 sites,
 meteringPoints,
 switchRequests,
 switchEvents,
 switchOutboundRequests,
}: Props) {
 return (
 <div className="rounded-3xl border border-slate-200 bg-white shadow-sm ">
 <div className="border-b border-slate-200 px-6 py-5 ">
 <h2 className="text-lg font-semibold text-slate-900 ">
 Switchärenden på kundkortet
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Detaljerad genomgång per switchärende, med validation, outbound och nästa steg.
 </p>
 </div>

 <div className="space-y-4 p-6">
 {switchRequests.length === 0 ? (
 <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-700 ">
 Inga switchärenden ännu för kunden.
 </div>
 ) : (
 [...switchRequests]
 .sort((a, b) => requestSortTime(b) - requestSortTime(a))
 .map((request) => {
 const validation = readValidationSummary(request.validation_snapshot)

 const outbound = getLatestOutboundForRequest(
 request.id,
 switchOutboundRequests
 )

 const lifecycle = getSwitchLifecycle({
 request,
 readiness: null,
 outboundRequest: outbound ?? null,
 })

 const latestEvent = getLatestEventForRequest(request.id, switchEvents)

 const nextStep = nextActionLabel({
 request,
 outboundRequest: outbound,
 validation,
 lifecycleLabel: lifecycle.label,
 })

 const stuckReason = explainWhySwitchIsStuck({
 request,
 outboundRequest: outbound,
 readiness: null,
 })

 const journey = customerJourneyHref({
 lifecycleStage: lifecycle.stage,
 requestId: request.id,
 })

 return (
 <article
 key={request.id}
 className="rounded-3xl border border-slate-200 p-5 "
 >
 <div className="flex flex-wrap items-center gap-2">
 <span
 className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(
 request.status
 )}`}
 >
 {request.status}
 </span>
 <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ">
 {request.request_type}
 </span>
 <span
 className={`rounded-full px-3 py-1 text-xs font-semibold ${lifecycleTone(
 lifecycle.stage
 )}`}
 >
 {lifecycle.label}
 </span>
 <span
 className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(
 validation.isReady === null
 ? 'draft'
 : validation.isReady
 ? 'validation_passed'
 : 'validation_failed'
 )}`}
 >
 {validation.label}
 </span>
 {outbound ? (
 <span
 className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(
 outbound.channel_type === 'unresolved'
 ? 'missing_route'
 : outbound.status
 )}`}
 >
 {outbound.channel_type === 'unresolved'
 ? 'route saknas'
 : `outbound: ${outbound.status}`}
 </span>
 ) : null}
 </div>

 <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Site</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {siteLabel(request.site_id, sites)}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Mätpunkt</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {meteringPointLabel(request.metering_point_id, meteringPoints)}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Startdatum</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {request.requested_start_date ?? '—'}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Senast ändrad</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {formatDateTime(
 request.completed_at ??
 request.failed_at ??
 request.submitted_at ??
 request.created_at
 )}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Outbound</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {outbound
 ? outbound.channel_type === 'unresolved'
 ? 'unresolved'
 : outbound.status
 : 'saknas'}
 </div>
 </div>
 </div>

 <div className="mt-4 grid gap-3 md:grid-cols-2">
 <div className="rounded-2xl border border-slate-200 p-4 ">
 <div className="text-sm font-semibold text-slate-900 ">
 Vad händer nu?
 </div>
 <p className="mt-2 text-sm text-slate-700 ">
 {nextStep}
 </p>
 <p className="mt-2 text-xs text-slate-700 ">
 Lifecycle: {lifecycle.reason}
 </p>
 </div>

 <div className="rounded-2xl border border-slate-200 p-4 ">
 <div className="text-sm font-semibold text-slate-900 ">
 Validation snapshot
 </div>
 <div className="mt-2 space-y-1 text-sm text-slate-700 ">
 <div>
 Senast validerad:{' '}
 <span className="font-medium">
 {formatDateTime(validation.validatedAt)}
 </span>
 </div>
 <div>
 Issue count:{' '}
 <span className="font-medium">{validation.issueCount}</span>
 </div>
 <div>
 Issue codes:{' '}
 <span className="font-medium">
 {validation.issueCodes.length > 0
 ? validation.issueCodes.join(', ')
 : '—'}
 </span>
 </div>
 </div>
 </div>
 </div>

 <div className="mt-4 space-y-2 text-sm text-slate-700 ">
 <div>
 <span className="font-medium text-slate-900 ">
 Varför sitter den fast:
 </span>{' '}
 {stuckReason}
 </div>
 <div>
 <span className="font-medium text-slate-900 ">
 Senaste dispatchförsök:
 </span>{' '}
 {outbound
 ? summarizeDispatchAttempt(outbound)
 : 'Inget dispatchförsök ännu'}
 </div>
 <div>
 <span className="font-medium text-slate-900 ">
 Senaste switch-event:
 </span>{' '}
 {latestEvent?.message ??
 (latestEvent
 ? `${latestEvent.event_type} · ${latestEvent.event_status}`
 : 'Inga switch-events ännu')}
 </div>
 </div>

 <div className="mt-5 flex flex-wrap gap-3">
 {!outbound &&
 ['queued', 'submitted', 'accepted'].includes(request.status) ? (
 <form action={queueSupplierSwitchOutboundAction}>
 <input type="hidden" name="request_id" value={request.id} />
 <button className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 ">
 Köa outbound nu
 </button>
 </form>
 ) : null}

 {outbound && ['failed', 'cancelled'].includes(outbound.status) ? (
 <form action={retryOutboundRequestFromCustomerAction}>
 <input type="hidden" name="customer_id" value={customerId} />
 <input
 type="hidden"
 name="outbound_request_id"
 value={outbound.id}
 />
 <button className="rounded-2xl border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 ">
 Retry outbound
 </button>
 </form>
 ) : null}

 <Link
 href={`/admin/operations/switches/${request.id}`}
 className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 "
 >
 Gå till switch detail
 </Link>

 <Link
 href={journey.href}
 className="rounded-2xl border border-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-700 "
 >
 {journey.label}
 </Link>

 <Link
 href="/admin/outbound"
 className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 "
 >
 Gå till outbound
 </Link>

 {outbound?.channel_type === 'unresolved' ? (
 <Link
 href="/admin/outbound/unresolved"
 className="rounded-2xl border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 "
 >
 Gå till unresolved
 </Link>
 ) : null}
 </div>
 </article>
 )
 })
 )}
 </div>
 </div>
 )
}