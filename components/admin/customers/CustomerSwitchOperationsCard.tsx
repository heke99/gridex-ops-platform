'use client'

'use client'

import Link from 'next/link'
import CustomerSwitchCreatePanel from '@/components/admin/customers/CustomerSwitchCreatePanel'
import { getRecommendationSummary } from '@/lib/ediel/recommendations'
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
import SwitchRequestSection from '@/components/admin/customers/switch-operations/SwitchRequestSection'
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

  const edielRecommendation = getRecommendationSummary({
    switchRequests,
    outboundRequests: switchOutboundRequests,
    messages: edielMessages,
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
      title: 'Switch request',
      description: `${request.request_type} · ${request.status} · ${siteLabel(
        request.site_id,
        sites
      )}`,
      tone: request.status,
    })),
    ...switchEvents.map((event) => ({
      id: `switch-event:${event.id}`,
      occurredAt: event.created_at,
      title: 'Switch event',
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
      title: 'Outbound dispatch',
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
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-sm text-slate-500 dark:text-slate-400">Aktiva switchar</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
            {openSwitches.length}
          </div>
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Draft, queued, submitted, accepted och failed som fortfarande kräver uppföljning.
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-sm text-slate-500 dark:text-slate-400">Saknar outbound</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
            {missingOutbound.length}
          </div>
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Switchärenden där extern dispatch ännu inte finns.
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-sm text-slate-500 dark:text-slate-400">
            Blockerade av validation
          </div>
          <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
            {blockedByValidation.length}
          </div>
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Switchar där readiness eller validering fortfarande stoppar flödet.
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-sm text-slate-500 dark:text-slate-400">Väntar dispatch</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
            {awaitingDispatch.length}
          </div>
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Outbound finns men har ännu inte gått hela vägen vidare.
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-sm text-slate-500 dark:text-slate-400">Väntar kvittens</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
            {awaitingResponse.length}
          </div>
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Skickade switchar som väntar på extern återkoppling.
          </div>
        </div>

        <div className="rounded-3xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-sm dark:border-emerald-900/50 dark:bg-emerald-950/10">
          <div className="text-sm text-slate-500 dark:text-slate-400">Redo att slutföra</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
            {readyToExecute.length}
          </div>
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Kvitterade switchar där nästa steg är intern finalize/execution.
          </div>
        </div>

        <div className="rounded-3xl border border-blue-200 bg-blue-50/60 p-6 shadow-sm dark:border-blue-900/50 dark:bg-blue-950/10">
          <div className="text-sm text-slate-500 dark:text-slate-400">Auto-köad outbound</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
            {autoQueuedOutbound.length}
          </div>
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Switchar som redan fått outbound automatiskt efter skapande.
          </div>
        </div>

        <div className="rounded-3xl border border-rose-200 bg-rose-50/60 p-6 shadow-sm dark:border-rose-900/50 dark:bg-rose-950/10">
          <div className="text-sm text-slate-500 dark:text-slate-400">Unresolved routes</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
            {unresolvedOutbound.length}
          </div>
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Switchar där route mot nätägare fortfarande saknas.
          </div>
        </div>
      </div>

      <CustomerSwitchCreatePanel customerId={customerId} sites={sites} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_420px]">
        <div className="space-y-6">
          <SiteLifecycleSection
            customerId={customerId}
            meteringPoints={meteringPoints}
            siteLifecycleSummaries={siteLifecycleSummaries}
          />

          <SwitchRequestSection
            customerId={customerId}
            sites={sites}
            meteringPoints={meteringPoints}
            switchRequests={switchRequests}
            switchEvents={switchEvents}
            switchOutboundRequests={switchOutboundRequests}
          />
        </div>

        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Så hittar du rätt sida
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Snabbguide för handläggare så man slipper tänka efter varje gång.
              </p>
            </div>

            <div className="space-y-3 p-6 text-sm text-slate-600 dark:text-slate-300">
              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="font-semibold text-slate-900 dark:text-white">1. Kundkort</div>
                <p className="mt-1">
                  Börja här när du vill förstå status, validation, senaste event,
                  site-lifecycle och vilket nästa steg som gäller per anläggning.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="font-semibold text-slate-900 dark:text-white">
                  2. Ready to execute
                </div>
                <p className="mt-1">
                  Gå hit när kundkortet visar ready_to_execute eller när outbound redan är
                  acknowledged och du bara vill slutföra switchen.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="font-semibold text-slate-900 dark:text-white">
                  3. Switch detail
                </div>
                <p className="mt-1">
                  Gå hit när du behöver full timeline, execution, statusändringar eller exakt
                  felsökning för ett enskilt ärende.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="font-semibold text-slate-900 dark:text-white">4. Outbound</div>
                <p className="mt-1">
                  Gå hit när problemet handlar om route, dispatch, unresolved eller retry på
                  extern kommunikation.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="font-semibold text-slate-900 dark:text-white">
                  5. Switchlistan / operations
                </div>
                <p className="mt-1">
                  Gå hit när du vill jobba i kö, filtrera på lifecycle stage och se många
                  ärenden samtidigt.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Senaste dispatch
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Snabb överblick över senaste outbound-aktiviteten för kundens switchar.
              </p>
            </div>

            <div className="p-6">
              {!latestDispatch ? (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  Ingen outbound-dispatch ännu.
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(
                        latestDispatch.channel_type === 'unresolved'
                          ? 'missing_route'
                          : latestDispatch.status
                      )}`}
                    >
                      {latestDispatch.channel_type === 'unresolved'
                        ? 'route saknas'
                        : latestDispatch.status}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {latestDispatch.channel_type}
                    </span>
                  </div>

                  <div className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                    <div>
                      Outbound ID: <span className="font-medium">{latestDispatch.id}</span>
                    </div>
                    <div>
                      Källa:{' '}
                      <span className="font-medium">
                        {latestDispatch.source_type} / {latestDispatch.source_id}
                      </span>
                    </div>
                    <div>
                      Senast uppdaterad:{' '}
                      <span className="font-medium">
                        {formatDateTime(
                          latestDispatch.acknowledged_at ??
                            latestDispatch.failed_at ??
                            latestDispatch.sent_at ??
                            latestDispatch.prepared_at ??
                            latestDispatch.queued_at ??
                            latestDispatch.created_at
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Switch-timeline
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Samlad tidslinje för request, events och outbound dispatch.
              </p>
            </div>

            <div className="space-y-3 p-6">
              {switchTimeline.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  Ingen switchhistorik ännu.
                </div>
              ) : (
                switchTimeline.slice(0, 14).map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">
                        {entry.title}
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(
                          entry.tone
                        )}`}
                      >
                        {entry.tone}
                      </span>
                    </div>

                    <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                      {entry.description}
                    </div>

                    <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                      {formatDateTime(entry.occurredAt)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Snabblänkar i lifecycle
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Direkt till rätt kö beroende på vad kundens switchar väntar på.
              </p>
            </div>

            <div className="grid gap-3 p-6">
              <Link
                href="/admin/operations/switches?stage=blocked"
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-200"
              >
                Blockerade switchar
              </Link>
              <Link
                href="/admin/operations/switches?stage=queued_for_outbound"
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-200"
              >
                Saknar outbound
              </Link>
              <Link
                href="/admin/operations/switches?stage=awaiting_dispatch"
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-200"
              >
                Väntar dispatch
              </Link>
              <Link
                href="/admin/operations/switches?stage=awaiting_response"
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-200"
              >
                Väntar kvittens
              </Link>
              <Link
                href="/admin/operations/ready-to-execute"
                className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm font-semibold text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/10 dark:text-emerald-300"
              >
                Ready to execute
              </Link>
              <Link
                href="/admin/outbound/unresolved"
                className="rounded-2xl border border-rose-200 bg-rose-50/60 px-4 py-3 text-sm font-semibold text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/10 dark:text-rose-300"
              >
                Unresolved routes
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Fastsittande switchar
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Ärenden som sannolikt kräver manuell uppföljning.
              </p>
            </div>

            <div className="space-y-3 p-6">
              {stuckSwitches.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  Inga uppenbart fastsittande switchar just nu.
                </div>
              ) : (
                stuckSwitches.slice(0, 8).map((request) => {
                  const outbound = getLatestOutboundForRequest(
                    request.id,
                    switchOutboundRequests
                  )

                  return (
                    <div
                      key={request.id}
                      className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(
                            request.status
                          )}`}
                        >
                          {request.status}
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

                      <div className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">
                        {siteLabel(request.site_id, sites)}
                      </div>
                      <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        {explainWhySwitchIsStuck({
                          request,
                          outboundRequest: outbound,
                          readiness: null,
                        })}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-3">
                        <Link
                          href={`/admin/operations/switches/${request.id}`}
                          className="text-sm font-medium text-slate-700 underline-offset-4 hover:underline dark:text-slate-200"
                        >
                          Öppna switch detail
                        </Link>

                        {outbound?.channel_type === 'unresolved' ? (
                          <Link
                            href="/admin/outbound/unresolved"
                            className="text-sm font-medium text-rose-700 underline-offset-4 hover:underline dark:text-rose-300"
                          >
                            Öppna unresolved
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}