//components/admin/customers/CustomerSwitchOperationsCard.tsx
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

type SwitchTimelineEntry = {
  id: string
  occurredAt: string
  title: string
  description: string
  tone: string
}

type ValidationSummary = {
  label: string
  isReady: boolean | null
  issueCount: number
  validatedAt: string | null
  issueCodes: string[]
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

  if (['completed', 'accepted', 'acknowledged', 'validation_passed'].includes(status)) {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
  }

  if (
    ['failed', 'rejected', 'cancelled', 'blocked', 'validation_failed'].includes(
      status
    )
  ) {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
  }

  if (['sent', 'submitted', 'awaiting_response'].includes(status)) {
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

function readValidationSummary(
  snapshot: SupplierSwitchRequestRow['validation_snapshot']
): ValidationSummary {
  const source =
    snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? snapshot
      : {}

  const isReady = typeof source.isReady === 'boolean' ? source.isReady : null
  const issueCount =
    typeof source.issueCount === 'number' ? source.issueCount : 0
  const validatedAt =
    typeof source.validatedAt === 'string' ? source.validatedAt : null

  const issueCodesRaw = source.issueCodes
  const issueCodes = Array.isArray(issueCodesRaw)
    ? issueCodesRaw.filter((value): value is string => typeof value === 'string')
    : []

  if (isReady === null) {
    return {
      label: 'Inte validerad',
      isReady: null,
      issueCount,
      validatedAt,
      issueCodes,
    }
  }

  return {
    label: isReady ? 'Ready for processing' : 'Pending review',
    isReady,
    issueCount,
    validatedAt,
    issueCodes,
  }
}

function nextActionLabel(params: {
  request: SupplierSwitchRequestRow
  outboundRequest: OutboundRequestRow | null
  validation: ValidationSummary
  lifecycleLabel: string
}): string {
  const { request, outboundRequest, validation, lifecycleLabel } = params

  if (request.status === 'completed') {
    return 'Klar. Kontrollera kundkort, outbound och historik vid behov.'
  }

  if (request.status === 'failed' || request.status === 'rejected') {
    return 'Gå till detail view och avgör om ärendet ska rättas, retryas eller avslutas.'
  }

  if (validation.isReady === false) {
    return 'Öppna detail view, rätta blockerare och kör validering igen.'
  }

  if (validation.isReady === null && request.status === 'draft') {
    return 'Kör validering först så systemet kan avgöra om switchen är redo.'
  }

  if (!outboundRequest && ['queued', 'submitted', 'accepted'].includes(request.status)) {
    return 'Köa outbound eller öppna switch detail för att se varför dispatch saknas.'
  }

  if (outboundRequest && ['queued', 'prepared'].includes(outboundRequest.status)) {
    return 'Öppna outbound eller switch detail och dispatcha ärendet vidare.'
  }

  if (outboundRequest?.status === 'sent') {
    return 'Invänta kvittens eller följ upp från detail view / outbound.'
  }

  if (outboundRequest?.status === 'acknowledged') {
    return 'Switchen är kvitterad. Nästa steg är intern slutföring.'
  }

  return `Nästa steg enligt lifecycle: ${lifecycleLabel}.`
}

function customerJourneyHref(params: {
  lifecycleStage: string
  requestId: string
}): { href: string; label: string } {
  const { lifecycleStage, requestId } = params

  if (lifecycleStage === 'awaiting_dispatch') {
    return {
      href: '/admin/outbound',
      label: 'Öppna outbound queue',
    }
  }

  if (lifecycleStage === 'queued_for_outbound') {
    return {
      href: '/admin/operations/switches',
      label: 'Öppna switchlistan',
    }
  }

  return {
    href: `/admin/operations/switches/${requestId}`,
    label: 'Öppna switch detail',
  }
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

    return lifecycle.stage === 'ready_to_execute'
  })

  const stuckSwitches = openSwitches.filter((request) => {
    const outbound = switchOutboundRequests.find(
      (row) =>
        row.source_type === 'supplier_switch_request' &&
        row.source_id === request.id
    )

    return (
      !outbound ||
      ['failed', 'cancelled', 'queued', 'prepared'].includes(outbound.status)
    )
  })

  const latestDispatch = [...switchOutboundRequests].sort((a, b) => {
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
    <section id="switch-operations" className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-sm text-slate-500 dark:text-slate-400">
            Aktiva switchar
          </div>
          <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
            {openSwitches.length}
          </div>
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            draft / queued / submitted / accepted / failed
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
            ärenden utan dispatch-post
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-sm text-slate-500 dark:text-slate-400">
            Pending review
          </div>
          <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
            {blockedByValidation.length}
          </div>
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            blockerade av validation snapshot
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-sm text-slate-500 dark:text-slate-400">
            Ready to execute
          </div>
          <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
            {readyToExecute.length}
          </div>
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            kvitterade men ej slutmarkerade
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                  Supplier switch & outbound
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Kundkortet visar nu validation, outbound, senaste event och tydligt nästa steg för varje switch.
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
                <Link
                  href="/admin/operations"
                  className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                >
                  Öppna operations
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
                const outbound =
                  switchOutboundRequests.find(
                    (row) =>
                      row.source_type === 'supplier_switch_request' &&
                      row.source_id === request.id
                  ) ?? null

                const lifecycle = getSwitchLifecycle({
                  request,
                  readiness: null,
                  outboundRequest: outbound,
                })

                const latestEvent = switchEvents.find(
                  (event) => event.switch_request_id === request.id
                )

                const stuckReason = explainWhySwitchIsStuck({
                  request,
                  readiness: null,
                  outboundRequest: outbound,
                })

                const validation = readValidationSummary(request.validation_snapshot)
                const nextStep = nextActionLabel({
                  request,
                  outboundRequest: outbound,
                  validation,
                  lifecycleLabel: lifecycle.label,
                })
                const journeyLink = customerJourneyHref({
                  lifecycleStage: lifecycle.stage,
                  requestId: request.id,
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
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(
                          validation.isReady === false
                            ? 'validation_failed'
                            : validation.isReady === true
                              ? 'validation_passed'
                              : 'draft'
                        )}`}
                      >
                        {validation.label}
                      </span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {request.request_type}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h3 className="text-base font-semibold text-slate-950 dark:text-white">
                          Switchärende {request.id}
                        </h3>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          Skapat {formatDateTime(request.created_at)}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/admin/operations/switches/${request.id}`}
                          className="rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                        >
                          Öppna detail
                        </Link>
                        <Link
                          href={journeyLink.href}
                          className="rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                        >
                          {journeyLink.label}
                        </Link>
                      </div>
                    </div>

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

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                          Vad händer nu?
                        </div>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                          {nextStep}
                        </p>
                        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                          Lifecycle: {lifecycle.reason}
                        </p>
                      </div>

                      <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                          Validation snapshot
                        </div>
                        <div className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-300">
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
                        {summarizeDispatchAttempt(outbound)}
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
                        href={`/admin/operations/switches/${request.id}`}
                        className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                      >
                        Gå till switch detail
                      </Link>

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
                <div className="font-semibold text-slate-900 dark:text-white">
                  1. Kundkort
                </div>
                <p className="mt-1">
                  Börja här när du vill förstå status, validation, senaste event och vilket nästa steg som gäller.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="font-semibold text-slate-900 dark:text-white">
                  2. Switch detail
                </div>
                <p className="mt-1">
                  Gå hit när du behöver full timeline, execution, statusändringar eller exakt felsökning för ett enskilt ärende.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="font-semibold text-slate-900 dark:text-white">
                  3. Outbound
                </div>
                <p className="mt-1">
                  Gå hit när problemet handlar om route, dispatch, unresolved eller retry på extern kommunikation.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="font-semibold text-slate-900 dark:text-white">
                  4. Switchlistan / operations
                </div>
                <p className="mt-1">
                  Gå hit när du vill jobba i kö, se många ärenden samtidigt eller hitta vad som sitter fast globalt.
                </p>
              </div>
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
      </div>
    </section>
  )
}