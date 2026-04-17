'use client'

import Link from 'next/link'
import type { OutboundRequestRow } from '@/lib/cis/types'
import CustomerSwitchCreatePanel from '@/components/admin/customers/CustomerSwitchCreatePanel'
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

type SiteLifecycleSummary = {
  site: CustomerSiteRow
  requests: SupplierSwitchRequestRow[]
  latestRequest: SupplierSwitchRequestRow | null
  outbound: OutboundRequestRow | null
  validation: ValidationSummary | null
  lifecycle: ReturnType<typeof getSwitchLifecycle> | null
  latestEvent: SupplierSwitchEventRow | null
  stuckReason: string
}

type SwitchRecommendationSummary = {
  latestRequest: SupplierSwitchRequestRow | null
  latestOutbound: OutboundRequestRow | null
  latestLifecycle: ReturnType<typeof getSwitchLifecycle> | null
  latestValidation: ValidationSummary | null
  latestEvent: SupplierSwitchEventRow | null
  nextStep: string
  primaryWorkspaceHref: string
  primaryWorkspaceLabel: string
  unresolvedCount: number
  autoQueuedCount: number
  awaitingResponseCount: number
  readyToExecuteCount: number
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

  if (
    ['completed', 'accepted', 'acknowledged', 'validation_passed', 'ready_to_execute'].includes(
      status
    )
  ) {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
  }

  if (['failed', 'rejected', 'cancelled', 'blocked', 'validation_failed', 'missing_route'].includes(status)) {
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
    typeof source.issueCount === 'number'
      ? source.issueCount
      : Array.isArray(source.issues)
        ? source.issues.length
        : 0
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
    return 'Outbound saknas. Kontrollera route-resolution eller köa outbound manuellt.'
  }

  if (outboundRequest?.channel_type === 'unresolved') {
    return 'Route saknas. Gå till unresolved/outbound och koppla rätt route mot nätägaren.'
  }

  if (outboundRequest && ['queued', 'prepared'].includes(outboundRequest.status)) {
    return 'Outbound finns. Nästa steg är dispatch vidare till nätägaren.'
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
      href: '/admin/operations/switches?stage=queued_for_outbound',
      label: 'Öppna saknar outbound',
    }
  }

  if (lifecycleStage === 'awaiting_response') {
    return {
      href: '/admin/operations/switches?stage=awaiting_response',
      label: 'Öppna väntar svar',
    }
  }

  if (lifecycleStage === 'ready_to_execute') {
    return {
      href: '/admin/operations/ready-to-execute',
      label: 'Öppna ready-to-execute',
    }
  }

  if (lifecycleStage === 'blocked') {
    return {
      href: '/admin/operations/switches?stage=blocked',
      label: 'Öppna blockerade switchar',
    }
  }

  return {
    href: `/admin/operations/switches/${requestId}`,
    label: 'Öppna switch detail',
  }
}

function requestSortTime(request: SupplierSwitchRequestRow): number {
  return new Date(
    request.completed_at ??
      request.failed_at ??
      request.submitted_at ??
      request.created_at
  ).getTime()
}

function outboundSortTime(outbound: OutboundRequestRow): number {
  return new Date(
    outbound.acknowledged_at ??
      outbound.failed_at ??
      outbound.sent_at ??
      outbound.prepared_at ??
      outbound.queued_at ??
      outbound.created_at
  ).getTime()
}

function getLatestOutboundForRequest(
  requestId: string,
  outboundRequests: OutboundRequestRow[]
): OutboundRequestRow | null {
  const rows = outboundRequests
    .filter(
      (row) =>
        row.source_type === 'supplier_switch_request' &&
        row.source_id === requestId
    )
    .sort((a, b) => outboundSortTime(b) - outboundSortTime(a))

  return rows[0] ?? null
}

function getLatestEventForRequest(
  requestId: string,
  events: SupplierSwitchEventRow[]
): SupplierSwitchEventRow | null {
  const rows = events
    .filter((event) => event.switch_request_id === requestId)
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )

  return rows[0] ?? null
}

function buildSiteLifecycleSummaries(params: {
  sites: CustomerSiteRow[]
  switchRequests: SupplierSwitchRequestRow[]
  switchEvents: SupplierSwitchEventRow[]
  switchOutboundRequests: OutboundRequestRow[]
}): SiteLifecycleSummary[] {
  const { sites, switchRequests, switchEvents, switchOutboundRequests } = params

  return sites.map((site) => {
    const requests = switchRequests
      .filter((request) => request.site_id === site.id)
      .sort((a, b) => requestSortTime(b) - requestSortTime(a))

    const latestRequest = requests[0] ?? null
    const outbound = latestRequest
      ? getLatestOutboundForRequest(latestRequest.id, switchOutboundRequests)
      : null
    const validation = latestRequest
      ? readValidationSummary(latestRequest.validation_snapshot)
      : null
    const lifecycle = latestRequest
      ? getSwitchLifecycle({
          request: latestRequest,
          readiness: null,
          outboundRequest: outbound,
        })
      : null
    const latestEvent = latestRequest
      ? getLatestEventForRequest(latestRequest.id, switchEvents)
      : null

    return {
      site,
      requests,
      latestRequest,
      outbound,
      validation,
      lifecycle,
      latestEvent,
      stuckReason: latestRequest
        ? explainWhySwitchIsStuck({
            request: latestRequest,
            outboundRequest: outbound,
            readiness: null,
          })
        : 'Inget switchärende finns ännu för denna anläggning.',
    }
  })
}

function buildSwitchRecommendationSummary(params: {
  switchRequests: SupplierSwitchRequestRow[]
  switchEvents: SupplierSwitchEventRow[]
  switchOutboundRequests: OutboundRequestRow[]
}): SwitchRecommendationSummary {
  const { switchRequests, switchEvents, switchOutboundRequests } = params

  const sortedRequests = [...switchRequests].sort(
    (a, b) => requestSortTime(b) - requestSortTime(a)
  )

  const latestRequest = sortedRequests[0] ?? null
  const latestOutbound = latestRequest
    ? getLatestOutboundForRequest(latestRequest.id, switchOutboundRequests)
    : null
  const latestValidation = latestRequest
    ? readValidationSummary(latestRequest.validation_snapshot)
    : null
  const latestLifecycle = latestRequest
    ? getSwitchLifecycle({
        request: latestRequest,
        readiness: null,
        outboundRequest: latestOutbound,
      })
    : null
  const latestEvent = latestRequest
    ? getLatestEventForRequest(latestRequest.id, switchEvents)
    : null

  const nextStep =
    latestRequest && latestValidation && latestLifecycle
      ? nextActionLabel({
          request: latestRequest,
          outboundRequest: latestOutbound,
          validation: latestValidation,
          lifecycleLabel: latestLifecycle.label,
        })
      : 'Skapa ett nytt switchärende eller öppna kundens senaste ärende för att fortsätta.'

  const primaryWorkspace =
    latestRequest && latestLifecycle
      ? customerJourneyHref({
          lifecycleStage: latestLifecycle.stage,
          requestId: latestRequest.id,
        })
      : {
          href: '/admin/operations/switches',
          label: 'Öppna switchlistan',
        }

  const unresolvedCount = switchOutboundRequests.filter(
    (request) =>
      request.source_type === 'supplier_switch_request' &&
      request.channel_type === 'unresolved'
  ).length

  const autoQueuedCount = switchOutboundRequests.filter(
    (request) =>
      request.source_type === 'supplier_switch_request' &&
      request.channel_type !== 'unresolved' &&
      ['queued', 'prepared'].includes(request.status)
  ).length

  const awaitingResponseCount = switchRequests.filter((request) => {
    const outbound = latestRequest
      ? getLatestOutboundForRequest(request.id, switchOutboundRequests)
      : null

    const lifecycle = getSwitchLifecycle({
      request,
      readiness: null,
      outboundRequest: outbound,
    })

    return lifecycle.stage === 'awaiting_response'
  }).length

  const readyToExecuteCount = switchRequests.filter((request) => {
    const outbound = latestRequest
      ? getLatestOutboundForRequest(request.id, switchOutboundRequests)
      : null

    const lifecycle = getSwitchLifecycle({
      request,
      readiness: null,
      outboundRequest: outbound,
    })

    return lifecycle.stage === 'ready_to_execute'
  }).length

  return {
    latestRequest,
    latestOutbound,
    latestLifecycle,
    latestValidation,
    latestEvent,
    nextStep,
    primaryWorkspaceHref: primaryWorkspace.href,
    primaryWorkspaceLabel: primaryWorkspace.label,
    unresolvedCount,
    autoQueuedCount,
    awaitingResponseCount,
    readyToExecuteCount,
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

  const awaitingDispatch = switchRequests.filter((request) => {
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

    return lifecycle.stage === 'awaiting_dispatch'
  })

  const awaitingResponse = switchRequests.filter((request) => {
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
    const outbound = switchOutboundRequests.find(
      (row) =>
        row.source_type === 'supplier_switch_request' &&
        row.source_id === request.id
    )

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
      tone:
        outbound.channel_type === 'unresolved'
          ? 'missing_route'
          : outbound.status,
    })),
  ].sort(
    (a, b) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  )

  return (
    <section id="switch-operations" className="space-y-6">
      <div className="rounded-3xl border border-blue-200 bg-blue-50/70 shadow-sm dark:border-blue-900/50 dark:bg-blue-950/10">
        <div className="border-b border-blue-200 px-6 py-5 dark:border-blue-900/50">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Rekommenderat nästa steg i switchkedjan
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Den här panelen bygger bara på data som faktiskt finns i switchvyn: switch requests, outbound, validation och events.
          </p>
        </div>

        <div className="grid gap-4 p-6 md:grid-cols-5">
          <div className="rounded-2xl border border-white/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Senaste switch
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-950 dark:text-white">
              {recommendation.latestRequest?.id ?? '—'}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {recommendation.latestRequest?.status ?? 'Inget ärende ännu'}
            </div>
          </div>

          <div className="rounded-2xl border border-white/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Lifecycle
            </div>
            <div className="mt-2">
              {recommendation.latestLifecycle ? (
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${lifecycleTone(
                    recommendation.latestLifecycle.stage
                  )}`}
                >
                  {recommendation.latestLifecycle.label}
                </span>
              ) : (
                <span className="text-sm font-semibold text-slate-950 dark:text-white">
                  —
                </span>
              )}
            </div>
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {recommendation.latestLifecycle?.reason ?? 'Ingen lifecycle ännu'}
            </div>
          </div>

          <div className="rounded-2xl border border-white/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Validation
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-950 dark:text-white">
              {recommendation.latestValidation?.label ?? '—'}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              issues: {recommendation.latestValidation?.issueCount ?? 0}
            </div>
          </div>

          <div className="rounded-2xl border border-white/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Senaste outbound
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-950 dark:text-white">
              {recommendation.latestOutbound
                ? recommendation.latestOutbound.channel_type === 'unresolved'
                  ? 'unresolved'
                  : recommendation.latestOutbound.status
                : 'saknas'}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {recommendation.latestOutbound?.id ?? 'Ingen outbound ännu'}
            </div>
          </div>

          <div className="rounded-2xl border border-white/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Senaste event
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-950 dark:text-white">
              {recommendation.latestEvent?.event_status ?? '—'}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {recommendation.latestEvent?.event_type ?? 'Inget event ännu'}
            </div>
          </div>
        </div>

        <div className="grid gap-4 px-6 pb-6 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.6fr)]">
          <div className="rounded-2xl border border-white/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">
              Rekommenderad åtgärd nu
            </div>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {recommendation.nextStep}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href={recommendation.primaryWorkspaceHref}
                className="rounded-2xl border border-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
              >
                {recommendation.primaryWorkspaceLabel}
              </Link>
              <Link
                href="/admin/outbound"
                className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Öppna outbound
              </Link>
              <Link
                href="/admin/outbound/unresolved"
                className="rounded-2xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 dark:border-rose-800 dark:text-rose-300"
              >
                Öppna unresolved
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-white/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">
              Operativ snabbstatus
            </div>
            <div className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <div>
                unresolved routes:{' '}
                <span className="font-semibold text-slate-900 dark:text-white">
                  {recommendation.unresolvedCount}
                </span>
              </div>
              <div>
                auto-köade outbound:{' '}
                <span className="font-semibold text-slate-900 dark:text-white">
                  {recommendation.autoQueuedCount}
                </span>
              </div>
              <div>
                väntar kvittens:{' '}
                <span className="font-semibold text-slate-900 dark:text-white">
                  {recommendation.awaitingResponseCount}
                </span>
              </div>
              <div>
                ready to execute:{' '}
                <span className="font-semibold text-slate-900 dark:text-white">
                  {recommendation.readyToExecuteCount}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-8">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-sm text-slate-500 dark:text-slate-400">
            Aktiva switchar
          </div>
          <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
            {openSwitches.length}
          </div>
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Draft, queued, submitted, accepted och failed som fortfarande kräver uppföljning.
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
          <div className="text-sm text-slate-500 dark:text-slate-400">
            Väntar dispatch
          </div>
          <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
            {awaitingDispatch.length}
          </div>
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Outbound finns men har ännu inte gått hela vägen vidare.
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-sm text-slate-500 dark:text-slate-400">
            Väntar kvittens
          </div>
          <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
            {awaitingResponse.length}
          </div>
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Skickade switchar som väntar på extern återkoppling.
          </div>
        </div>

        <div className="rounded-3xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-sm dark:border-emerald-900/50 dark:bg-emerald-950/10">
          <div className="text-sm text-slate-500 dark:text-slate-400">
            Redo att slutföra
          </div>
          <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
            {readyToExecute.length}
          </div>
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Kvitterade switchar där nästa steg är intern finalize/execution.
          </div>
        </div>

        <div className="rounded-3xl border border-blue-200 bg-blue-50/60 p-6 shadow-sm dark:border-blue-900/50 dark:bg-blue-950/10">
          <div className="text-sm text-slate-500 dark:text-slate-400">
            Auto-köad outbound
          </div>
          <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
            {autoQueuedOutbound.length}
          </div>
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Switchar som redan fått outbound automatiskt efter skapande.
          </div>
        </div>

        <div className="rounded-3xl border border-rose-200 bg-rose-50/60 p-6 shadow-sm dark:border-rose-900/50 dark:bg-rose-950/10">
          <div className="text-sm text-slate-500 dark:text-slate-400">
            Unresolved routes
          </div>
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
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Lifecycle per anläggning
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Kundkortet visar nu var varje site faktiskt befinner sig i switchkedjan, om outbound skapades automatiskt och vilken arbetsyta som är rätt nästa steg.
              </p>
            </div>

            <div className="space-y-4 p-6">
              {siteLifecycleSummaries.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
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
                      className="rounded-3xl border border-slate-200 p-5 dark:border-slate-800"
                    >
                      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
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
                              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
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
                                outbound: {summary.outbound.channel_type === 'unresolved'
                                  ? 'unresolved'
                                  : summary.outbound.status}
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                              <div className="text-slate-500 dark:text-slate-400">Site</div>
                              <div className="mt-1 font-medium text-slate-900 dark:text-white">
                                {summary.site.facility_id ?? summary.site.id}
                              </div>
                            </div>

                            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                              <div className="text-slate-500 dark:text-slate-400">Mätpunkt</div>
                              <div className="mt-1 font-medium text-slate-900 dark:text-white">
                                {summary.latestRequest
                                  ? meteringPointLabel(
                                      summary.latestRequest.metering_point_id,
                                      meteringPoints
                                    )
                                  : '—'}
                              </div>
                            </div>

                            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                              <div className="text-slate-500 dark:text-slate-400">Requests</div>
                              <div className="mt-1 font-medium text-slate-900 dark:text-white">
                                {summary.requests.length}
                              </div>
                            </div>

                            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                              <div className="text-slate-500 dark:text-slate-400">Senaste event</div>
                              <div className="mt-1 font-medium text-slate-900 dark:text-white">
                                {summary.latestEvent?.event_status ?? '—'}
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                                Lifecycle reason
                              </div>
                              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                                {summary.lifecycle?.reason ??
                                  'Inget switchärende finns ännu för denna anläggning.'}
                              </p>
                            </div>

                            <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                                Vad sitter fast?
                              </div>
                              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                                {summary.stuckReason}
                              </p>
                            </div>
                          </div>

                          {summary.validation ? (
                            <div className="mt-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                                Validation snapshot
                              </div>
                              <div className="mt-2 grid gap-2 md:grid-cols-3 text-sm text-slate-600 dark:text-slate-300">
                                <div>
                                  Status:{' '}
                                  <span className="font-medium">
                                    {summary.validation.label}
                                  </span>
                                </div>
                                <div>
                                  Senast validerad:{' '}
                                  <span className="font-medium">
                                    {formatDateTime(summary.validation.validatedAt)}
                                  </span>
                                </div>
                                <div>
                                  Issue count:{' '}
                                  <span className="font-medium">
                                    {summary.validation.issueCount}
                                  </span>
                                </div>
                              </div>

                              <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                                Issue codes:{' '}
                                <span className="font-medium">
                                  {summary.validation.issueCodes.length > 0
                                    ? summary.validation.issueCodes.join(', ')
                                    : '—'}
                                </span>
                              </div>
                            </div>
                          ) : null}
                        </div>

                        <div className="rounded-3xl border border-slate-200 p-5 dark:border-slate-800">
                          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                            Nästa arbetsyta
                          </h3>

                          <div className="mt-4 space-y-3">
                            {summary.latestRequest ? (
                              <>
                                <Link
                                  href={`/admin/operations/switches/${summary.latestRequest.id}`}
                                  className="block rounded-2xl border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                                >
                                  Öppna switch detail
                                </Link>

                                {journeyLink ? (
                                  <Link
                                    href={journeyLink.href}
                                    className="block rounded-2xl border border-emerald-300 px-4 py-2.5 text-center text-sm font-semibold text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
                                  >
                                    {journeyLink.label}
                                  </Link>
                                ) : null}
                              </>
                            ) : (
                              <Link
                                href={`/admin/customers/${customerId}#masterdata`}
                                className="block rounded-2xl border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                              >
                                Kontrollera site/masterdata
                              </Link>
                            )}

                            <Link
                              href="/admin/operations/switches"
                              className="block rounded-2xl border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                            >
                              Öppna switchlistan
                            </Link>

                            <Link
                              href="/admin/outbound"
                              className="block rounded-2xl border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                            >
                              Öppna outbound
                            </Link>

                            <Link
                              href="/admin/outbound/unresolved"
                              className="block rounded-2xl border border-rose-300 px-4 py-2.5 text-center text-sm font-semibold text-rose-700 dark:border-rose-800 dark:text-rose-300"
                            >
                              Öppna unresolved routes
                            </Link>

                            <Link
                              href={`/admin/customers/${customerId}`}
                              className="block rounded-2xl border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
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

          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Switchärenden på kundkortet
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Detaljerad genomgång per switchärende, med validation, outbound och nästa steg.
              </p>
            </div>

            <div className="space-y-4 p-6">
              {switchRequests.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  Inga switchärenden ännu för kunden.
                </div>
              ) : (
                [...switchRequests]
                  .sort((a, b) => requestSortTime(b) - requestSortTime(a))
                  .map((request) => {
                    const validation = readValidationSummary(
                      request.validation_snapshot
                    )

                    const outbound = getLatestOutboundForRequest(
                      request.id,
                      switchOutboundRequests
                    )

                    const lifecycle = getSwitchLifecycle({
                      request,
                      readiness: null,
                      outboundRequest: outbound ?? null,
                    })

                    const latestEvent = getLatestEventForRequest(
                      request.id,
                      switchEvents
                    )

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
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
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
                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">Site</div>
                            <div className="mt-1 font-medium text-slate-900 dark:text-white">
                              {siteLabel(request.site_id, sites)}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">Mätpunkt</div>
                            <div className="mt-1 font-medium text-slate-900 dark:text-white">
                              {meteringPointLabel(
                                request.metering_point_id,
                                meteringPoints
                              )}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">Startdatum</div>
                            <div className="mt-1 font-medium text-slate-900 dark:text-white">
                              {request.requested_start_date ?? '—'}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">Senast ändrad</div>
                            <div className="mt-1 font-medium text-slate-900 dark:text-white">
                              {formatDateTime(
                                request.completed_at ??
                                  request.failed_at ??
                                  request.submitted_at ??
                                  request.created_at
                              )}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">Outbound</div>
                            <div className="mt-1 font-medium text-slate-900 dark:text-white">
                              {outbound
                                ? outbound.channel_type === 'unresolved'
                                  ? 'unresolved'
                                  : outbound.status
                                : 'saknas'}
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
                                <span className="font-medium">
                                  {validation.issueCount}
                                </span>
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
                            {outbound
                              ? summarizeDispatchAttempt(outbound)
                              : 'Inget dispatchförsök ännu'}
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
                          ['queued', 'submitted', 'accepted'].includes(
                            request.status
                          ) ? (
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
                            href={journey.href}
                            className="rounded-2xl border border-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
                          >
                            {journey.label}
                          </Link>

                          <Link
                            href="/admin/outbound"
                            className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                          >
                            Gå till outbound
                          </Link>

                          {outbound?.channel_type === 'unresolved' ? (
                            <Link
                              href="/admin/outbound/unresolved"
                              className="rounded-2xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 dark:border-rose-800 dark:text-rose-300"
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
                  Börja här när du vill förstå status, validation, senaste event, site-lifecycle och vilket nästa steg som gäller per anläggning.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="font-semibold text-slate-900 dark:text-white">
                  2. Ready to execute
                </div>
                <p className="mt-1">
                  Gå hit när kundkortet visar ready_to_execute eller när outbound redan är acknowledged och du bara vill slutföra switchen.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="font-semibold text-slate-900 dark:text-white">
                  3. Switch detail
                </div>
                <p className="mt-1">
                  Gå hit när du behöver full timeline, execution, statusändringar eller exakt felsökning för ett enskilt ärende.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="font-semibold text-slate-900 dark:text-white">
                  4. Outbound
                </div>
                <p className="mt-1">
                  Gå hit när problemet handlar om route, dispatch, unresolved eller retry på extern kommunikation.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="font-semibold text-slate-900 dark:text-white">
                  5. Switchlistan / operations
                </div>
                <p className="mt-1">
                  Gå hit när du vill jobba i kö, filtrera på lifecycle stage och se många ärenden samtidigt.
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
                      Outbound ID:{' '}
                      <span className="font-medium">{latestDispatch.id}</span>
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