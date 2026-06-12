'use client'

import Link from 'next/link'
import CustomerSwitchCreatePanel from '@/components/admin/customers/CustomerSwitchCreatePanel'
import {
 getRecommendationSummary,
 type EdielRecommendationMessageRow,
} from '@/lib/ediel/recommendations'
import { getSwitchLifecycle, explainWhySwitchIsStuck } from '@/lib/operations/controlTower'
import {
 buildSiteLifecycleSummaries,
 buildSwitchRecommendationSummary,
 formatDateTime,
 getLatestOutboundForRequest,
 outboundSortTime,
 readValidationSummary,
 siteLabel,
 statusTone,
} from '@/components/admin/customers/switch-operations/helpers'
import type {
 CustomerSwitchOperationsCardProps,
 SwitchTimelineEntry,
} from '@/components/admin/customers/switch-operations/types'
import SwitchRecommendationPanel from '@/components/admin/customers/switch-operations/SwitchRecommendationPanel'
import SiteLifecycleSection from '@/components/admin/customers/switch-operations/SiteLifecycleSection'
import type { ReactNode } from 'react'

function normalizeRecommendationStatus(value: string): EdielRecommendationMessageRow['status'] {
 if (
 value === 'draft' ||
 value === 'prepared' ||
 value === 'queued' ||
 value === 'sent' ||
 value === 'acknowledged' ||
 value === 'failed' ||
 value === 'received' ||
 value === 'parsed' ||
 value === 'validated'
 ) {
 return value
 }

 return 'draft'
}

function normalizeRecommendationFamily(value: string): EdielRecommendationMessageRow['message_family'] {
 if (
 value === 'PRODAT' ||
 value === 'UTILTS' ||
 value === 'CONTRL' ||
 value === 'APERAK' ||
 value === 'UTILTS_ERR' ||
 value === 'AI_LIST'
 ) {
 return value
 }

 if (value === 'XML') {
 return 'NBS_XML'
 }

 return 'OTHER'
}

function normalizeRecommendationAckStatus(
 value: string | null
): EdielRecommendationMessageRow['contrl_status'] {
 if (value === 'pending' || value === 'sent' || value === 'failed' || value === 'not_required') {
 return value
 }

 if (value === 'received' || value === 'acknowledged') {
 return 'received'
 }

 return null
}

function toRecommendationMessages(params: {
 customerId: string
 edielMessages: CustomerSwitchOperationsCardProps['edielMessages']
}): EdielRecommendationMessageRow[] {
 return params.edielMessages.map((row) => ({
 id: row.id,
 direction: row.direction,
 message_family: normalizeRecommendationFamily(row.message_family),
 message_code: row.message_code,
 status: normalizeRecommendationStatus(row.status),
 communication_route_id: row.communication_route_id,
 switch_request_id: row.switch_request_id,
 grid_owner_data_request_id: row.grid_owner_data_request_id,
 outbound_request_id: row.outbound_request_id,
 customer_id: params.customerId,
 site_id: null,
 metering_point_id: null,
 external_reference: row.external_reference,
 transaction_reference: row.transaction_reference,
 receiver_email: row.receiver_email,
 created_at: row.created_at,
 contrl_status: normalizeRecommendationAckStatus(null),
 aperak_status: normalizeRecommendationAckStatus(null),
 }))
}


function SwitchRequestSection({
 title,
 description,
 children,
}: {
 title: string
 description?: string
 children: ReactNode
}) {
 return (
 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="mb-4">
 <h3 className="text-base font-semibold text-slate-950 ">{title}</h3>
 {description ? (
 <p className="mt-1 text-sm text-slate-700 ">{description}</p>
 ) : null}
 </div>
 {children}
 </section>
 )
}

export default function CustomerSwitchOperationsCard({
 customerId,
 sites,
 meteringPoints,
 switchRequests,
 switchEvents,
 outboundRequests,
 edielMessages,
 edielRecommendationRoutes,
}: CustomerSwitchOperationsCardProps) {
 const switchOutboundRequests = outboundRequests.filter(
 (request) => request.request_type === 'supplier_switch'
 )

 const openSwitches = switchRequests.filter((request) =>
 ['queued', 'submitted', 'accepted', 'failed', 'draft'].includes(request.status)
 )

 const missingOutbound = openSwitches.filter(
 (request) =>
 !switchOutboundRequests.some(
 (outbound) =>
 outbound.source_type === 'supplier_switch_request' &&
 outbound.source_id === request.id &&
 ['queued', 'prepared', 'sent', 'acknowledged'].includes(outbound.status)
 )
 )

 const blockedByValidation = switchRequests.filter((request) => {
 const validation = readValidationSummary(request.validation_snapshot)
 return validation.isReady === false
 })

 const readyToExecute = switchRequests.filter((request) => {
 const outbound = getLatestOutboundForRequest(request.id, switchOutboundRequests)

 const lifecycle = getSwitchLifecycle({
 request,
 readiness: null,
 outboundRequest: outbound ?? null,
 })

 return lifecycle.stage === 'ready_to_execute'
 })

 const awaitingDispatch = switchRequests.filter((request) => {
 const outbound = getLatestOutboundForRequest(request.id, switchOutboundRequests)

 const lifecycle = getSwitchLifecycle({
 request,
 readiness: null,
 outboundRequest: outbound ?? null,
 })

 return lifecycle.stage === 'awaiting_dispatch'
 })

 const awaitingResponse = switchRequests.filter((request) => {
 const outbound = getLatestOutboundForRequest(request.id, switchOutboundRequests)

 const lifecycle = getSwitchLifecycle({
 request,
 readiness: null,
 outboundRequest: outbound ?? null,
 })

 return lifecycle.stage === 'awaiting_response'
 })

 const autoQueuedOutbound = switchOutboundRequests.filter(
 (request) =>
 request.source_type === 'supplier_switch_request' &&
 request.channel_type !== 'unresolved' &&
 ['queued', 'prepared'].includes(request.status)
 )

 const unresolvedOutbound = switchOutboundRequests.filter(
 (request) =>
 request.source_type === 'supplier_switch_request' &&
 request.channel_type === 'unresolved'
 )

 const stuckSwitches = openSwitches.filter((request) => {
 const outbound = getLatestOutboundForRequest(request.id, switchOutboundRequests)

 return (
 !outbound ||
 outbound.channel_type === 'unresolved' ||
 ['failed', 'cancelled', 'queued', 'prepared'].includes(outbound.status)
 )
 })

 const latestDispatch = [...switchOutboundRequests].sort(
 (a, b) => outboundSortTime(b) - outboundSortTime(a)
 )[0]

 const siteLifecycleSummaries = buildSiteLifecycleSummaries({
 sites,
 switchRequests,
 switchEvents,
 switchOutboundRequests,
 })

 const recommendation = buildSwitchRecommendationSummary({
 switchRequests,
 switchEvents,
 switchOutboundRequests,
 })

 const recommendationMessages = toRecommendationMessages({
 customerId,
 edielMessages,
 })

 const edielRecommendation = getRecommendationSummary({
 switchRequests,
 outboundRequests: switchOutboundRequests,
 messages: recommendationMessages,
 routes: edielRecommendationRoutes,
 preferredFamily: 'PRODAT',
 })

 const switchTimeline: SwitchTimelineEntry[] = [
 ...switchRequests.map((request) => ({
 id: `switch:${request.id}`,
 occurredAt:
 request.completed_at ??
 request.failed_at ??
 request.submitted_at ??
 request.created_at,
 title: 'Switchärende',
 description: `${request.request_type} · ${request.status} · ${siteLabel(
 request.site_id,
 sites
 )}`,
 tone: request.status,
 })),
 ...switchEvents.map((event) => ({
 id: `switch-event:${event.id}`,
 occurredAt: event.created_at,
 title: 'Switchhändelse',
 description: event.message ?? `${event.event_type} · ${event.event_status}`,
 tone: event.event_status,
 })),
 ...switchOutboundRequests.map((outbound) => ({
 id: `switch-outbound:${outbound.id}`,
 occurredAt:
 outbound.acknowledged_at ??
 outbound.failed_at ??
 outbound.sent_at ??
 outbound.prepared_at ??
 outbound.queued_at ??
 outbound.created_at,
 title: 'Utskick',
 description: `${outbound.status} · ${outbound.channel_type}`,
 tone: outbound.channel_type === 'unresolved' ? 'missing_route' : outbound.status,
 })),
 ].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())

 return (
 <section id="switch-operations" className="space-y-6">
 <SwitchRecommendationPanel
 customerId={customerId}
 recommendation={recommendation}
 edielRecommendation={edielRecommendation}
 edielMessageCount={edielMessages.length}
 />

 <div className="grid gap-4 xl:grid-cols-8">
 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Aktiva switchar</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950 ">
 {openSwitches.length}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Förberedda, köade, inskickade, accepterade eller avvikande ärenden som fortfarande kräver uppföljning.
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Saknar utskick</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950 ">
 {missingOutbound.length}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Switchärenden där externt utskick ännu inte finns.
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">
 Blockerade av validering
 </div>
 <div className="mt-2 text-3xl font-semibold text-slate-950 ">
 {blockedByValidation.length}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Switchar där readiness eller validering fortfarande stoppar flödet.
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Väntar utskick</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950 ">
 {awaitingDispatch.length}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Utskicket finns men har ännu inte gått hela vägen vidare.
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Väntar kvittens</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950 ">
 {awaitingResponse.length}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Skickade switchar som väntar på extern återkoppling.
 </div>
 </div>

 <div className="rounded-3xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Redo att slutföra</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950 ">
 {readyToExecute.length}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Kvitterade switchar där nästa steg är intern slutförande.
 </div>
 </div>

 <div className="rounded-3xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Automatiskt köade utskick</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950 ">
 {autoQueuedOutbound.length}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Switchar som redan fått externt utskick automatiskt efter skapande.
 </div>
 </div>

 <div className="rounded-3xl border border-red-200 bg-red-50/60 p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Ej matchade utskick</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950 ">
 {unresolvedOutbound.length}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Switchutskick där rutt eller transportkedja fortfarande saknas.
 </div>
 </div>

 <div className="rounded-3xl border border-amber-200 bg-amber-50/60 p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Fastnade switchar</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950 ">
 {stuckSwitches.length}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Ärenden som saknar väg framåt eller fortfarande står kvar i manuell uppföljning.
 </div>
 </div>
 </div>

 <SwitchRequestSection
 title="Skapa nytt switchärende"
 description="Starta nytt leverantörsbyte eller bytesspår direkt från kundkortet."
 >
 <CustomerSwitchCreatePanel customerId={customerId} sites={sites} />
 </SwitchRequestSection>

 <SiteLifecycleSection
 customerId={customerId}
 siteLifecycleSummaries={siteLifecycleSummaries}
 meteringPoints={meteringPoints}
 />

 <SwitchRequestSection
 title="Senaste utskick"
 description="Snabb överblick av senaste utskick för switchflödena."
 >
 <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 ">
 {latestDispatch ? (
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <div className="font-medium">
 {latestDispatch.status} · {latestDispatch.channel_type}
 </div>
 <div className="text-slate-700 ">
 {formatDateTime(
 latestDispatch.sent_at ??
 latestDispatch.prepared_at ??
 latestDispatch.queued_at ??
 latestDispatch.created_at
 )}
 </div>
 </div>
 <Link
 href={`/admin/outbound/${latestDispatch.id}`}
 className="rounded-2xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 "
 >
 Öppna utskick
 </Link>
 </div>
 ) : (
 'Inget externt utskick finns ännu för switchärenden på kunden.'
 )}
 </div>
 </SwitchRequestSection>

 <SwitchRequestSection
 title="Vad gör att switchar fastnar?"
 description="Kort förklaring per aktivt ärende så ansvarig snabbt ser nästa arbetsyta."
 >
 <div className="space-y-3">
 {openSwitches.length === 0 ? (
 <div className="rounded-3xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-700 ">
 Inga aktiva switchärenden för kunden just nu.
 </div>
 ) : (
 openSwitches.map((request) => {
 const outbound = getLatestOutboundForRequest(request.id, switchOutboundRequests)
 const reason = explainWhySwitchIsStuck({
 request,
 readiness: null,
 outboundRequest: outbound ?? null,
 })

 return (
 <div
 key={request.id}
 className="rounded-3xl border border-slate-200 bg-white px-4 py-4 shadow-sm "
 >
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <div className="text-sm font-semibold text-slate-900 ">
 {request.request_type} · {siteLabel(request.site_id, sites)}
 </div>
 <div className="mt-1 text-sm text-slate-700 ">
 {reason}
 </div>
 </div>
 <span
 className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusTone(
 request.status
 )}`}
 >
 {request.status}
 </span>
 </div>
 </div>
 )
 })
 )}
 </div>
 </SwitchRequestSection>

 <SwitchRequestSection
 title="Tidslinje"
 description="Senaste switch-, händelse- och utskickshistorik i samma lista."
 >
 <div className="space-y-3">
 {switchTimeline.length === 0 ? (
 <div className="rounded-3xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-700 ">
 Ingen historik ännu.
 </div>
 ) : (
 switchTimeline.slice(0, 12).map((entry) => (
 <div
 key={entry.id}
 className="rounded-3xl border border-slate-200 bg-white px-4 py-4 shadow-sm "
 >
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <div className="text-sm font-semibold text-slate-900 ">
 {entry.title}
 </div>
 <div className="mt-1 text-sm text-slate-700 ">
 {entry.description}
 </div>
 </div>
 <div className="text-sm text-slate-700 ">
 {formatDateTime(entry.occurredAt)}
 </div>
 </div>
 </div>
 ))
 )}
 </div>
 </SwitchRequestSection>
 </section>
 )
}
