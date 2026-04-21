// lib/ediel/recommendations.ts

import type { EdielMessageRow } from '@/lib/ediel/types'

export type EdielRecommendationSwitchRow = {
  id: string
  status: string
  customer_id: string | null
  site_id: string | null
  metering_point_id: string | null
  external_reference: string | null
  created_at: string
}

export type EdielRecommendationOutboundRow = {
  id: string
  request_type: string
  source_type: string | null
  source_id: string | null
  status: string
  channel_type: string | null
  communication_route_id: string | null
  external_reference: string | null
  customer_id: string | null
  site_id: string | null
  metering_point_id: string | null
  created_at: string
}

export type EdielRecommendationRouteProfile = {
  is_enabled: boolean
  sender_ediel_id: string | null
  receiver_ediel_id: string | null
  mailbox: string | null
  sender_sub_address: string | null
  receiver_sub_address: string | null
  application_reference: string | null
}

export type EdielRecommendationRouteRow = {
  id: string
  route_name: string
  route_scope: string
  route_type: string
  target_email: string | null
  target_system: string | null
  grid_owner_id: string | null
  grid_owner_name: string | null
  grid_owner_ediel_id: string | null
  is_active: boolean
  profile: EdielRecommendationRouteProfile | null
}

export type EdielRecommendationMessageRow = Pick<
  EdielMessageRow,
  | 'id'
  | 'direction'
  | 'message_family'
  | 'message_code'
  | 'status'
  | 'communication_route_id'
  | 'switch_request_id'
  | 'grid_owner_data_request_id'
  | 'outbound_request_id'
  | 'customer_id'
  | 'site_id'
  | 'metering_point_id'
  | 'external_reference'
  | 'transaction_reference'
  | 'receiver_email'
  | 'created_at'
  | 'contrl_status'
  | 'aperak_status'
>

export type EdielRouteIssue = {
  key:
    | 'route_missing'
    | 'route_inactive'
    | 'profile_missing'
    | 'profile_disabled'
    | 'sender_ediel_missing'
    | 'receiver_ediel_missing'
    | 'target_email_missing'
    | 'mailbox_missing'
  severity: 'warning' | 'error'
  label: string
  resolution: string
}

export type EdielRecommendationSummary = {
  selectedSwitchId: string
  recommendedRoute: EdielRecommendationRouteRow | null
  recommendedSendMessage: EdielRecommendationMessageRow | null
  recommendedInboundUtilts: EdielRecommendationMessageRow | null
  recommendedAckSource: EdielRecommendationMessageRow | null
  routeIssues: EdielRouteIssue[]
  routeSummary: string
  routeHealth: {
    isRouteActive: boolean
    isEdielEnabled: boolean
    hasTargetEmail: boolean
    hasSenderEdielId: boolean
    hasReceiverEdielId: boolean
    hasMailbox: boolean
    isReadyForOutbound: boolean
  }
}

function byNewest<T extends { created_at: string }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
}

function isRouteHealthy(route: EdielRecommendationRouteRow | null) {
  return {
    isRouteActive: Boolean(route?.is_active),
    isEdielEnabled: Boolean(route?.profile?.is_enabled ?? route?.is_active ?? false),
    hasTargetEmail: Boolean(route?.target_email),
    hasSenderEdielId: Boolean(route?.profile?.sender_ediel_id),
    hasReceiverEdielId: Boolean(
      route?.profile?.receiver_ediel_id ?? route?.grid_owner_ediel_id
    ),
    hasMailbox: Boolean(route?.profile?.mailbox),
  }
}

function buildRouteIssues(route: EdielRecommendationRouteRow | null): EdielRouteIssue[] {
  if (!route) {
    return [
      {
        key: 'route_missing',
        severity: 'error',
        label: 'Ingen Ediel-route vald',
        resolution: 'Skapa eller välj en aktiv communication_route för aktivt scope.',
      },
    ]
  }

  const issues: EdielRouteIssue[] = []

  if (!route.is_active) {
    issues.push({
      key: 'route_inactive',
      severity: 'error',
      label: 'Route är inaktiv',
      resolution: 'Aktivera communication_route innan outbound får skickas.',
    })
  }

  if (!route.profile) {
    issues.push({
      key: 'profile_missing',
      severity: 'error',
      label: 'Route profile saknas',
      resolution: 'Skapa en ediel_route_profile kopplad till route.',
    })
  } else {
    if (!route.profile.is_enabled) {
      issues.push({
        key: 'profile_disabled',
        severity: 'error',
        label: 'Route profile är avstängd',
        resolution: 'Sätt is_enabled=true på ediel_route_profile.',
      })
    }

    if (!route.profile.sender_ediel_id) {
      issues.push({
        key: 'sender_ediel_missing',
        severity: 'error',
        label: 'Sender Ediel-id saknas',
        resolution: 'Fyll sender_ediel_id i route profile eller actor settings.',
      })
    }

    if (!(route.profile.receiver_ediel_id || route.grid_owner_ediel_id)) {
      issues.push({
        key: 'receiver_ediel_missing',
        severity: 'error',
        label: 'Receiver Ediel-id saknas',
        resolution: 'Fyll receiver_ediel_id i route profile eller ediel_id på grid owner.',
      })
    }

    if (!route.profile.mailbox) {
      issues.push({
        key: 'mailbox_missing',
        severity: 'warning',
        label: 'Mailbox saknas',
        resolution: 'Fyll mailbox om IMAP/SMTP-kedjan ska vara helt driftbar.',
      })
    }
  }

  if (!route.target_email) {
    issues.push({
      key: 'target_email_missing',
      severity: 'warning',
      label: 'Target email saknas',
      resolution: 'Fyll target_email om routen använder mailbaserat Ediel-utbyte.',
    })
  }

  return issues
}

function filterMessagesForSwitch(
  messages: EdielRecommendationMessageRow[],
  selectedSwitchId: string,
  selectedRouteId?: string | null
) {
  return messages.filter((message) => {
    if (selectedSwitchId && message.switch_request_id !== selectedSwitchId) return false
    if (selectedRouteId && message.communication_route_id !== selectedRouteId) return false
    return true
  })
}

export function getNewestSwitchId(
  switchRequests: EdielRecommendationSwitchRow[]
): string {
  return byNewest(switchRequests)[0]?.id ?? ''
}

export function getRecommendedRoutes(params: {
  routes: EdielRecommendationRouteRow[]
  outboundRequests: EdielRecommendationOutboundRow[]
  selectedSwitchId?: string | null
}): EdielRecommendationRouteRow[] {
  const { routes, outboundRequests, selectedSwitchId } = params

  const latestOutboundRouteId =
    selectedSwitchId
      ? byNewest(
          outboundRequests.filter(
            (row) =>
              row.source_type === 'supplier_switch_request' &&
              row.source_id === selectedSwitchId &&
              row.communication_route_id
          )
        )[0]?.communication_route_id ?? null
      : null

  const scored = routes.map((route) => {
    const health = isRouteHealthy(route)

    let score = 0
    if (route.id === latestOutboundRouteId) score += 100
    if (route.is_active) score += 20
    if (route.profile?.is_enabled) score += 20
    if (health.hasSenderEdielId) score += 10
    if (health.hasReceiverEdielId) score += 10
    if (health.hasTargetEmail) score += 5
    if (health.hasMailbox) score += 5
    if (route.route_scope === 'supplier_switch') score += 5

    return { route, score }
  })

  return scored
    .sort((a, b) => b.score - a.score)
    .map((row) => row.route)
}

export function getPreferredRouteId(params: {
  routes: EdielRecommendationRouteRow[]
  outboundRequests: EdielRecommendationOutboundRow[]
  selectedSwitchId?: string | null
}): string {
  return getRecommendedRoutes(params)[0]?.id ?? ''
}

export function getSelectedRoute(
  routes: EdielRecommendationRouteRow[],
  selectedRouteId?: string | null
): EdielRecommendationRouteRow | null {
  if (!selectedRouteId) return null
  return routes.find((route) => route.id === selectedRouteId) ?? null
}

export function getRecommendedSendableMessages(params: {
  messages: EdielRecommendationMessageRow[]
  selectedSwitchId?: string | null
  selectedRouteId?: string | null
}): EdielRecommendationMessageRow[] {
  const rows = filterMessagesForSwitch(
    params.messages.filter(
      (message) =>
        message.direction === 'outbound' &&
        (message.status === 'draft' ||
          message.status === 'prepared' ||
          message.status === 'queued')
    ),
    params.selectedSwitchId ?? '',
    params.selectedRouteId
  )

  return byNewest(rows)
}

export function getRecommendedInboundUtiltsMessages(params: {
  messages: EdielRecommendationMessageRow[]
  selectedRoute?: EdielRecommendationRouteRow | null
  selectedRouteId?: string | null
}): EdielRecommendationMessageRow[] {
  return byNewest(
    params.messages.filter((message) => {
      if (message.direction !== 'inbound') return false
      if (message.message_family !== 'UTILTS') return false
      if (params.selectedRouteId && message.communication_route_id !== params.selectedRouteId) {
        return false
      }

      if (params.selectedRoute?.grid_owner_id && !message.grid_owner_data_request_id) {
        return true
      }

      return true
    })
  )
}

export function getRecommendedAckableMessages(params: {
  messages: EdielRecommendationMessageRow[]
  selectedSwitchId?: string | null
  selectedRouteId?: string | null
  preferredFamily?: 'PRODAT' | 'UTILTS'
}): EdielRecommendationMessageRow[] {
  const preferredFamily = params.preferredFamily ?? 'PRODAT'

  const filtered = filterMessagesForSwitch(
    params.messages.filter((message) => {
      if (message.direction !== 'inbound') return false
      if (message.message_family === 'CONTRL') return false
      if (message.message_family === 'APERAK') return false
      if (message.message_family === 'UTILTS_ERR') return false
      if (preferredFamily === 'PRODAT' && message.message_family !== 'PRODAT') return false
      if (preferredFamily === 'UTILTS' && message.message_family !== 'UTILTS') return false
      return true
    }),
    params.selectedSwitchId ?? '',
    params.selectedRouteId
  )

  return byNewest(filtered)
}

export function getRecommendedRouteSummary(params: {
  routes: EdielRecommendationRouteRow[]
  outboundRequests: EdielRecommendationOutboundRow[]
  selectedSwitchId?: string | null
  selectedRouteId?: string | null
}): string {
  const selectedRoute = getSelectedRoute(params.routes, params.selectedRouteId)
  if (!selectedRoute) {
    return 'Ingen route vald ännu.'
  }

  const health = isRouteHealthy(selectedRoute)
  const parts = [
    selectedRoute.route_name,
    selectedRoute.route_scope,
    selectedRoute.grid_owner_name ?? 'ingen nätägare',
    health.isRouteActive ? 'route aktiv' : 'route inaktiv',
    health.isEdielEnabled ? 'edielprofil aktiv' : 'edielprofil av',
    health.hasSenderEdielId ? 'sender ok' : 'sender saknas',
    health.hasReceiverEdielId ? 'receiver ok' : 'receiver saknas',
    health.hasTargetEmail ? 'target email ok' : 'target email saknas',
    health.hasMailbox ? 'mailbox ok' : 'mailbox saknas',
  ]

  return parts.join(' · ')
}

export function getRecommendationSummary(params: {
  switchRequests: EdielRecommendationSwitchRow[]
  outboundRequests: EdielRecommendationOutboundRow[]
  messages: EdielRecommendationMessageRow[]
  routes: EdielRecommendationRouteRow[]
  preferredFamily?: 'PRODAT' | 'UTILTS'
}): EdielRecommendationSummary {
  const selectedSwitchId = getNewestSwitchId(params.switchRequests)
  const recommendedRoute =
    getRecommendedRoutes({
      routes: params.routes,
      outboundRequests: params.outboundRequests,
      selectedSwitchId,
    })[0] ?? null

  const routeHealthBase = isRouteHealthy(recommendedRoute)
  const routeIssues = buildRouteIssues(recommendedRoute)

  const recommendedSendMessage =
    getRecommendedSendableMessages({
      messages: params.messages,
      selectedSwitchId,
      selectedRouteId: recommendedRoute?.id ?? null,
    })[0] ?? null

  const recommendedInboundUtilts =
    getRecommendedInboundUtiltsMessages({
      messages: params.messages,
      selectedRoute: recommendedRoute,
      selectedRouteId: recommendedRoute?.id ?? null,
    })[0] ?? null

  const recommendedAckSource =
    getRecommendedAckableMessages({
      messages: params.messages,
      selectedSwitchId,
      selectedRouteId: recommendedRoute?.id ?? null,
      preferredFamily: params.preferredFamily ?? 'PRODAT',
    })[0] ?? null

  return {
    selectedSwitchId,
    recommendedRoute,
    recommendedSendMessage,
    recommendedInboundUtilts,
    recommendedAckSource,
    routeIssues,
    routeSummary: getRecommendedRouteSummary({
      routes: params.routes,
      outboundRequests: params.outboundRequests,
      selectedSwitchId,
      selectedRouteId: recommendedRoute?.id ?? null,
    }),
    routeHealth: {
      ...routeHealthBase,
      isReadyForOutbound:
        routeHealthBase.isRouteActive &&
        routeHealthBase.isEdielEnabled &&
        routeHealthBase.hasSenderEdielId &&
        routeHealthBase.hasReceiverEdielId,
    },
  }
}

export function messageLabel(message: EdielRecommendationMessageRow): string {
  return `${message.message_family} ${message.message_code} · ${message.status} · ${message.id}`
}