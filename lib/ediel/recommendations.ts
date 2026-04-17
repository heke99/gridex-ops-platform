// lib/ediel/recommendations.ts

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

export type EdielRecommendationMessageRow = {
  id: string
  direction: string
  message_family: string
  message_code: string
  status: string
  communication_route_id: string | null
  outbound_request_id: string | null
  switch_request_id: string | null
  grid_owner_data_request_id: string | null
  receiver_email: string | null
  sender_ediel_id: string | null
  receiver_ediel_id: string | null
  sender_sub_address: string | null
  receiver_sub_address: string | null
  external_reference: string | null
  correlation_reference: string | null
  transaction_reference: string | null
  created_at: string
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
  profile: {
    is_enabled: boolean
    sender_ediel_id: string | null
    receiver_ediel_id: string | null
    mailbox: string | null
    sender_sub_address?: string | null
    receiver_sub_address?: string | null
    application_reference?: string | null
  } | null
}

export type EdielRecommendationRouteIssue = {
  key:
    | 'inactive_route'
    | 'ediel_disabled'
    | 'target_email'
    | 'sender_ediel_id'
    | 'receiver_ediel_id'
    | 'mailbox'
  severity: 'error' | 'warning'
  label: string
  resolution: string
}

export type EdielRecommendationSummary = {
  selectedSwitchId: string
  recommendedRoute: EdielRecommendationRouteRow | null
  recommendedSendMessage: EdielRecommendationMessageRow | null
  recommendedInboundUtilts: EdielRecommendationMessageRow | null
  recommendedAckSource: EdielRecommendationMessageRow | null
  routeHealth: {
    hasTargetEmail: boolean
    hasSenderEdielId: boolean
    hasReceiverEdielId: boolean
    hasMailbox: boolean
    isRouteActive: boolean
    isEdielEnabled: boolean
    isReadyForOutbound: boolean
  }
  routeIssues: EdielRecommendationRouteIssue[]
  routeSummary: string
}

export function sortNewestFirst<T extends { created_at: string }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
}

export function dedupeMessages(
  rows: EdielRecommendationMessageRow[]
): EdielRecommendationMessageRow[] {
  const seen = new Set<string>()
  const result: EdielRecommendationMessageRow[] = []

  for (const row of rows) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    result.push(row)
  }

  return result
}

export function dedupeRoutes(
  rows: EdielRecommendationRouteRow[]
): EdielRecommendationRouteRow[] {
  const seen = new Set<string>()
  const result: EdielRecommendationRouteRow[] = []

  for (const row of rows) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    result.push(row)
  }

  return result
}

export function getEnabledEdielRoutes(
  routes: EdielRecommendationRouteRow[]
): EdielRecommendationRouteRow[] {
  return routes.filter((route) => route.is_active && route.profile?.is_enabled)
}

export function getNewestSwitchId(
  switchRequests: EdielRecommendationSwitchRow[]
): string {
  return sortNewestFirst(switchRequests)[0]?.id ?? ''
}

export function findSelectedSwitchOutbound(
  outboundRequests: EdielRecommendationOutboundRow[],
  selectedSwitchId: string
): EdielRecommendationOutboundRow | null {
  return (
    outboundRequests.find(
      (row) =>
        row.source_type === 'supplier_switch_request' &&
        row.source_id === selectedSwitchId
    ) ?? null
  )
}

export function getPreferredRouteId(params: {
  routes: EdielRecommendationRouteRow[]
  outboundRequests: EdielRecommendationOutboundRow[]
  selectedSwitchId: string
}): string {
  const enabledRoutes = getEnabledEdielRoutes(params.routes)
  const fallbackRouteId = enabledRoutes[0]?.id ?? params.routes[0]?.id ?? ''

  const selectedSwitchOutbound = findSelectedSwitchOutbound(
    params.outboundRequests,
    params.selectedSwitchId
  )

  if (
    selectedSwitchOutbound?.communication_route_id &&
    params.routes.some(
      (route) => route.id === selectedSwitchOutbound.communication_route_id
    )
  ) {
    return selectedSwitchOutbound.communication_route_id
  }

  return fallbackRouteId
}

export function getSelectedRoute(
  routes: EdielRecommendationRouteRow[],
  selectedRouteId: string
): EdielRecommendationRouteRow | null {
  return routes.find((route) => route.id === selectedRouteId) ?? null
}

export function getRecommendedRoutes(params: {
  routes: EdielRecommendationRouteRow[]
  outboundRequests: EdielRecommendationOutboundRow[]
  selectedSwitchId: string
}): EdielRecommendationRouteRow[] {
  const selectedSwitchOutbound = findSelectedSwitchOutbound(
    params.outboundRequests,
    params.selectedSwitchId
  )

  const enabledRoutes = getEnabledEdielRoutes(params.routes)
  const preferred = selectedSwitchOutbound?.communication_route_id
    ? params.routes.filter(
        (route) => route.id === selectedSwitchOutbound.communication_route_id
      )
    : []

  return dedupeRoutes([...preferred, ...enabledRoutes, ...params.routes])
}

export function getAllSendableMessages(
  messages: EdielRecommendationMessageRow[]
): EdielRecommendationMessageRow[] {
  return sortNewestFirst(
    messages.filter(
      (message) =>
        message.direction === 'outbound' &&
        ['draft', 'prepared', 'queued'].includes(message.status) &&
        Boolean(message.receiver_email?.trim())
    )
  )
}

export function getRecommendedSendableMessages(params: {
  messages: EdielRecommendationMessageRow[]
  selectedSwitchId: string
  selectedRouteId: string
}): EdielRecommendationMessageRow[] {
  const allSendableMessages = getAllSendableMessages(params.messages)

  const bySwitch = params.selectedSwitchId
    ? allSendableMessages.filter(
        (message) => message.switch_request_id === params.selectedSwitchId
      )
    : []

  const byRoute = params.selectedRouteId
    ? allSendableMessages.filter(
        (message) => message.communication_route_id === params.selectedRouteId
      )
    : []

  const byBoth =
    params.selectedSwitchId && params.selectedRouteId
      ? allSendableMessages.filter(
          (message) =>
            message.switch_request_id === params.selectedSwitchId &&
            message.communication_route_id === params.selectedRouteId
        )
      : []

  const recommended = dedupeMessages([...byBoth, ...bySwitch, ...byRoute])
  return recommended.length > 0 ? recommended : allSendableMessages
}

export function getAllInboundUtiltsMessages(
  messages: EdielRecommendationMessageRow[]
): EdielRecommendationMessageRow[] {
  return sortNewestFirst(
    messages.filter(
      (message) =>
        message.direction === 'inbound' && message.message_family === 'UTILTS'
    )
  )
}

export function getRecommendedInboundUtiltsMessages(params: {
  messages: EdielRecommendationMessageRow[]
  selectedRoute: EdielRecommendationRouteRow | null
  selectedRouteId: string
}): EdielRecommendationMessageRow[] {
  const allInboundUtiltsMessages = getAllInboundUtiltsMessages(params.messages)

  const byRoute = params.selectedRouteId
    ? allInboundUtiltsMessages.filter(
        (message) => message.communication_route_id === params.selectedRouteId
      )
    : []

  const byEdielPair =
    params.selectedRoute?.profile?.sender_ediel_id &&
    params.selectedRoute?.profile?.receiver_ediel_id
      ? allInboundUtiltsMessages.filter(
          (message) =>
            message.sender_ediel_id === params.selectedRoute?.profile?.receiver_ediel_id &&
            message.receiver_ediel_id === params.selectedRoute?.profile?.sender_ediel_id
        )
      : []

  const recommended = dedupeMessages([...byRoute, ...byEdielPair])
  return recommended.length > 0 ? recommended : allInboundUtiltsMessages
}

export function getAllAckableMessages(
  messages: EdielRecommendationMessageRow[]
): EdielRecommendationMessageRow[] {
  return sortNewestFirst(
    messages.filter((message) => ['inbound', 'outbound'].includes(message.direction))
  )
}

export function getRecommendedAckableMessages(params: {
  messages: EdielRecommendationMessageRow[]
  selectedSwitchId: string
  selectedRouteId: string
  preferredFamily?: 'PRODAT' | 'UTILTS' | null
}): EdielRecommendationMessageRow[] {
  const allAckableMessages = getAllAckableMessages(params.messages)

  const bySwitch = params.selectedSwitchId
    ? allAckableMessages.filter(
        (message) => message.switch_request_id === params.selectedSwitchId
      )
    : []

  const byRoute = params.selectedRouteId
    ? allAckableMessages.filter(
        (message) => message.communication_route_id === params.selectedRouteId
      )
    : []

  const byFamily = params.preferredFamily
    ? allAckableMessages.filter(
        (message) => message.message_family === params.preferredFamily
      )
    : []

  const recommended = dedupeMessages([...bySwitch, ...byRoute, ...byFamily])
  return recommended.length > 0 ? recommended : allAckableMessages
}

export function getRecommendedRouteSummary(params: {
  routes: EdielRecommendationRouteRow[]
  outboundRequests: EdielRecommendationOutboundRow[]
  selectedSwitchId: string
  selectedRouteId: string
}): string {
  const selectedSwitchOutbound = findSelectedSwitchOutbound(
    params.outboundRequests,
    params.selectedSwitchId
  )

  const selectedRoute =
    params.routes.find((route) => route.id === params.selectedRouteId) ?? null

  if (
    selectedSwitchOutbound?.communication_route_id &&
    selectedRoute?.id === selectedSwitchOutbound.communication_route_id
  ) {
    return `${selectedRoute.route_name} (${selectedRoute.route_scope})${
      selectedRoute.grid_owner_name ? ` · ${selectedRoute.grid_owner_name}` : ''
    }`
  }

  if (selectedRoute) {
    return `${selectedRoute.route_name} (${selectedRoute.route_scope})${
      selectedRoute.grid_owner_name ? ` · ${selectedRoute.grid_owner_name}` : ''
    }`
  }

  return '—'
}

export function getRouteIssues(
  route: EdielRecommendationRouteRow | null
): EdielRecommendationRouteIssue[] {
  const issues: EdielRecommendationRouteIssue[] = []

  if (!route) {
    issues.push({
      key: 'inactive_route',
      severity: 'error',
      label: 'Ingen route vald',
      resolution:
        'Koppla en communication route för rätt nätägare och scope innan du försöker skicka Ediel.',
    })
    return issues
  }

  if (!route.is_active) {
    issues.push({
      key: 'inactive_route',
      severity: 'error',
      label: 'Routen är inaktiv',
      resolution: 'Aktivera communication route eller välj en annan aktiv route.',
    })
  }

  if (!route.profile?.is_enabled) {
    issues.push({
      key: 'ediel_disabled',
      severity: 'error',
      label: 'Ediel-profilen är inte aktiverad',
      resolution: 'Aktivera Ediel på routeprofilen innan outbound skickas.',
    })
  }

  if (!route.target_email?.trim()) {
    issues.push({
      key: 'target_email',
      severity: 'warning',
      label: 'target_email saknas',
      resolution:
        'Fyll target_email på communication route för att göra SMTP-sändning tydlig och spårbar.',
    })
  }

  if (!route.profile?.sender_ediel_id?.trim()) {
    issues.push({
      key: 'sender_ediel_id',
      severity: 'error',
      label: 'sender_ediel_id saknas',
      resolution: 'Fyll avsändarens Ediel-id på routeprofilen.',
    })
  }

  if (!(route.profile?.receiver_ediel_id?.trim() || route.grid_owner_ediel_id?.trim())) {
    issues.push({
      key: 'receiver_ediel_id',
      severity: 'error',
      label: 'receiver_ediel_id saknas',
      resolution:
        'Fyll mottagarens Ediel-id på routeprofilen eller säkerställ att nätägarens Ediel-id finns i masterdata.',
    })
  }

  if (!route.profile?.mailbox?.trim()) {
    issues.push({
      key: 'mailbox',
      severity: 'error',
      label: 'Mailbox saknas',
      resolution: 'Fyll mailbox på routeprofilen så att rätt Ediel-brevlåda används.',
    })
  }

  return issues
}

export function buildRouteSummary(
  route: EdielRecommendationRouteRow | null,
  issues: EdielRecommendationRouteIssue[]
): string {
  if (!route) {
    return 'Ingen route kunde rekommenderas ännu.'
  }

  if (issues.length === 0) {
    return 'Route är användbar: aktiv, Ediel-aktiverad och har de viktigaste fälten för outbound.'
  }

  const blocking = issues.filter((issue) => issue.severity === 'error')

  if (blocking.length > 0) {
    return `Route är blockerad: ${blocking.map((issue) => issue.label).join(', ')}.`
  }

  return `Route är delvis användbar men bör kompletteras: ${issues
    .map((issue) => issue.label)
    .join(', ')}.`
}

export function getRecommendationSummary(params: {
  switchRequests: EdielRecommendationSwitchRow[]
  outboundRequests: EdielRecommendationOutboundRow[]
  messages: EdielRecommendationMessageRow[]
  routes: EdielRecommendationRouteRow[]
  preferredFamily?: 'PRODAT' | 'UTILTS' | null
}): EdielRecommendationSummary {
  const selectedSwitchId = getNewestSwitchId(params.switchRequests)
  const selectedRouteId = getPreferredRouteId({
    routes: params.routes,
    outboundRequests: params.outboundRequests,
    selectedSwitchId,
  })

  const recommendedRoute = getSelectedRoute(params.routes, selectedRouteId)

  const recommendedSendMessage =
    getRecommendedSendableMessages({
      messages: params.messages,
      selectedSwitchId,
      selectedRouteId,
    })[0] ?? null

  const recommendedInboundUtilts =
    getRecommendedInboundUtiltsMessages({
      messages: params.messages,
      selectedRoute: recommendedRoute,
      selectedRouteId,
    })[0] ?? null

  const recommendedAckSource =
    getRecommendedAckableMessages({
      messages: params.messages,
      selectedSwitchId,
      selectedRouteId,
      preferredFamily: params.preferredFamily ?? 'PRODAT',
    })[0] ?? null

  const routeIssues = getRouteIssues(recommendedRoute)

  const routeHealth = {
    hasTargetEmail: Boolean(recommendedRoute?.target_email?.trim()),
    hasSenderEdielId: Boolean(recommendedRoute?.profile?.sender_ediel_id?.trim()),
    hasReceiverEdielId: Boolean(
      recommendedRoute?.profile?.receiver_ediel_id?.trim() ||
        recommendedRoute?.grid_owner_ediel_id?.trim()
    ),
    hasMailbox: Boolean(recommendedRoute?.profile?.mailbox?.trim()),
    isRouteActive: Boolean(recommendedRoute?.is_active),
    isEdielEnabled: Boolean(recommendedRoute?.profile?.is_enabled),
    isReadyForOutbound: routeIssues.every((issue) => issue.severity !== 'error'),
  }

  return {
    selectedSwitchId,
    recommendedRoute,
    recommendedSendMessage,
    recommendedInboundUtilts,
    recommendedAckSource,
    routeHealth,
    routeIssues,
    routeSummary: buildRouteSummary(recommendedRoute, routeIssues),
  }
}
