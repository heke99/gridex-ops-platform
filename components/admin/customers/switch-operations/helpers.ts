import type { OutboundRequestRow } from '@/lib/cis/types'
import type {
  CustomerSiteRow,
  MeteringPointRow,
} from '@/lib/masterdata/types'
import type {
  SupplierSwitchEventRow,
  SupplierSwitchRequestRow,
} from '@/lib/operations/types'
import type {
  EdielRecommendationRouteIssue,
  EdielRecommendationRouteRow,
} from '@/lib/ediel/recommendations'
import {
  explainWhySwitchIsStuck,
  getSwitchLifecycle,
} from '@/lib/operations/controlTower'
import type {
  SiteLifecycleSummary,
  SwitchRecommendationSummary,
  ValidationSummary,
} from './types'

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'

  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function statusTone(status: string | null | undefined): string {
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

  if (
    ['failed', 'rejected', 'cancelled', 'blocked', 'validation_failed', 'missing_route'].includes(
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

export function lifecycleTone(stage: string): string {
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

export function routeLabel(route: EdielRecommendationRouteRow | null): string {
  if (!route) return '—'

  return `${route.route_name} (${route.route_scope})${
    route.grid_owner_name ? ` · ${route.grid_owner_name}` : ''
  }`
}

export function routeIssueTone(issue: EdielRecommendationRouteIssue): string {
  return issue.severity === 'error'
    ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
    : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
}

export function siteLabel(siteId: string, sites: CustomerSiteRow[]): string {
  return sites.find((site) => site.id === siteId)?.site_name ?? siteId
}

export function meteringPointLabel(
  meteringPointId: string,
  meteringPoints: MeteringPointRow[]
): string {
  return (
    meteringPoints.find((point) => point.id === meteringPointId)?.meter_point_id ??
    meteringPointId
  )
}

export function readValidationSummary(
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

export function nextActionLabel(params: {
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

export function customerJourneyHref(params: {
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

export function requestSortTime(request: SupplierSwitchRequestRow): number {
  return new Date(
    request.completed_at ??
      request.failed_at ??
      request.submitted_at ??
      request.created_at
  ).getTime()
}

export function outboundSortTime(outbound: OutboundRequestRow): number {
  return new Date(
    outbound.acknowledged_at ??
      outbound.failed_at ??
      outbound.sent_at ??
      outbound.prepared_at ??
      outbound.queued_at ??
      outbound.created_at
  ).getTime()
}

export function getLatestOutboundForRequest(
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

export function getLatestEventForRequest(
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

export function buildSiteLifecycleSummaries(params: {
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

export function buildSwitchRecommendationSummary(params: {
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
    const outbound = getLatestOutboundForRequest(request.id, switchOutboundRequests)

    const lifecycle = getSwitchLifecycle({
      request,
      readiness: null,
      outboundRequest: outbound,
    })

    return lifecycle.stage === 'awaiting_response'
  }).length

  const readyToExecuteCount = switchRequests.filter((request) => {
    const outbound = getLatestOutboundForRequest(request.id, switchOutboundRequests)

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