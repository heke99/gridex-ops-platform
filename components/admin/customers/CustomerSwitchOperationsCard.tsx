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
import {
  explainWhySwitchIsStuck,
  getSwitchLifecycle,
  summarizeDispatchAttempt,
} from '@/lib/operations/controlTower'
import { queueSupplierSwitchOutboundAction } from '@/app/admin/cis/actions'
import { retryOutboundRequestFromCustomerAction } from '@/app/admin/customers/[id]/switch-actions'

type Props = {
  customerId: string
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  switchRequests: SupplierSwitchRequestRow[]
  switchEvents: SupplierSwitchEventRow[]
  outboundRequests: OutboundRequestRow[]
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'

  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function statusTone(status: string | null | undefined): string {
  if (!status) {
    return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }

  if (['completed', 'accepted', 'acknowledged'].includes(status)) {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
  }

  if (['failed', 'rejected', 'cancelled'].includes(status)) {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
  }

  if (['sent', 'submitted'].includes(status)) {
    return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
  }

  return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
}

function lifecycleTone(stage: string): string {
  if (['completed', 'ready_to_execute'].includes(stage)) {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
  }

  if (['failed', 'blocked'].includes(stage)) {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
  }

  if (['awaiting_response'].includes(stage)) {
    return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
  }

  return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
}

function siteLabel(siteId: string, sites: CustomerSiteRow[]): string {
  return sites.find((site) => site.id === siteId)?.site_name ?? siteId
}

function meteringPointLabel(
  meteringPointId: string,
  meteringPoints: MeteringPointRow[]
): string {
  return (
    meteringPoints.find((point) => point.id === meteringPointId)?.meter_point_id ??
    meteringPointId
  )
}

type SwitchTimelineEntry = {
  id: string
  occurredAt: string
  title: string
  description: string
  tone: string
}

export default function CustomerSwitchOperationsCard({
  customerId,
  sites,
  meteringPoints,
  switchRequests,
  switchEvents,
  outboundRequests,
}: Props) {
  const switchOutboundRequests = outboundRequests.filter(
    (request) => request.request_type === 'supplier_switch'
  )

  const openSwitches = switchRequests.filter((request) =>
    ['queued', 'submitted', 'accepted', 'failed'].includes(request.status)
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

  const stuckSwitches = openSwitches.filter((request) => {
    const outbound = switchOutboundRequests.find(
      (row) =>
        row.source_type === 'supplier_switch_request' &&
        row.source_id === request.id
    )

    return !outbound || ['failed', 'cancelled', 'queued', 'prepared'].includes(outbound.status)
  })

  const latestDispatch = [...switchOutboundRequests]
    .sort((a, b) => {
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
    })[0]

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
      description:
        event.message ?? `${event.event_type} · ${event.event_status}`,
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
      tone: outbound.status,
    })),
  ].sort(
    (a, b) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  )

  return (
    <section className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-4">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-sm text-slate-500 dark:text-slate-400">
            Aktiva switchar
          </div>
          <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
            {openSwitches.length}
          </div>
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            queued / submitted / accepted / failed
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-sm text-slate-500 dark:text-slate-400">
            Saknar outbound
          </div>
          <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
            {missingOutbound.length}
          </div>
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            redo switchar utan dispatch-post
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-sm text-slate-500 dark:text-slate-400">
            Behöver operatör
          </div>
          <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
            {stuckSwitches.length}
          </div>
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            blockerade, köade för länge eller failade
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-sm text-slate-500 dark:text-slate-400">
            Senaste dispatch
          </div>
          <div className="mt-2 text-sm font-semibold text-slate-950 dark:text-white">
            {latestDispatch
              ? summarizeDispatchAttempt(latestDispatch)
              : 'Ingen dispatch ännu.'}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                  Supplier switch & outbound
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Här ser du varför en switch sitter fast, senaste dispatchförsök och manuell retry.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  href="/admin/operations/switches"
                  className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                >
                  Öppna switchar
                </Link>
                <Link
                  href="/admin/outbound"
                  className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                >
                  Öppna outbound
                </Link>
              </div>
            </div>
          </div>

          <div className="space-y-4 p-6">
            {switchRequests.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Inga supplier switch-ärenden ännu för kunden.
              </div>
            ) : (
              switchRequests.map((request) => {
                const outbound = switchOutboundRequests.find(
                  (row) =>
                    row.source_type === 'supplier_switch_request' &&
                    row.source_id === request.id
                )

                const lifecycle = getSwitchLifecycle({
                  request,
                  readiness: null,
                  outboundRequest: outbound ?? null,
                })

                const latestEvent = switchEvents.find(
                  (event) => event.switch_request_id === request.id
                )

                const stuckReason = explainWhySwitchIsStuck({
                  request,
                  readiness: null,
                  outboundRequest: outbound ?? null,
                })

                return (
                  <article
                    key={request.id}
                    className="rounded-3xl border border-slate-200 p-5 dark:border-slate-800"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(
                          request.status
                        )}`}
                      >
                        {request.status}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${lifecycleTone(
                          lifecycle.stage
                        )}`}
                      >
                        {lifecycle.label}
                      </span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {request.request_type}
                      </span>
                    </div>

                    <h3 className="mt-3 text-base font-semibold text-slate-950 dark:text-white">
                      Switchärende {request.id}
                    </h3>

                    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                        <div className="text-slate-500 dark:text-slate-400">Anläggning</div>
                        <div className="mt-1 font-medium text-slate-900 dark:text-white">
                          {siteLabel(request.site_id, sites)}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                        <div className="text-slate-500 dark:text-slate-400">Mätpunkt</div>
                        <div className="mt-1 font-medium text-slate-900 dark:text-white">
                          {meteringPointLabel(request.metering_point_id, meteringPoints)}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                        <div className="text-slate-500 dark:text-slate-400">Startdatum</div>
                        <div className="mt-1 font-medium text-slate-900 dark:text-white">
                          {request.requested_start_date ?? '—'}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                        <div className="text-slate-500 dark:text-slate-400">Outbound</div>
                        <div className="mt-1 font-medium text-slate-900 dark:text-white">
                          {outbound?.status ?? 'saknas'}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                      <div>
                        <span className="font-medium text-slate-900 dark:text-white">
                          Varför sitter den fast:
                        </span>{' '}
                        {stuckReason}
                      </div>
                      <div>
                        <span className="font-medium text-slate-900 dark:text-white">
                          Senaste dispatchförsök:
                        </span>{' '}
                        {summarizeDispatchAttempt(outbound ?? null)}
                      </div>
                      <div>
                        <span className="font-medium text-slate-900 dark:text-white">
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
                          <button className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                            Köa outbound nu
                          </button>
                        </form>
                      ) : null}

                      {outbound &&
                      ['failed', 'cancelled'].includes(outbound.status) ? (
                        <form action={retryOutboundRequestFromCustomerAction}>
                          <input type="hidden" name="customer_id" value={customerId} />
                          <input
                            type="hidden"
                            name="outbound_request_id"
                            value={outbound.id}
                          />
                          <button className="rounded-2xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 dark:border-rose-800 dark:text-rose-300">
                            Retry outbound
                          </button>
                        </form>
                      ) : null}

                      <Link
                        href="/admin/outbound"
                        className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                      >
                        Gå till outbound
                      </Link>
                    </div>
                  </article>
                )
              })
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
      </div>
    </section>
  )
}