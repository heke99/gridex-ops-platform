// lib/ediel/core/routeRegistry.ts

import { findBestCommunicationRoute } from '@/lib/cis/db-routes'
import type { CommunicationRouteRow } from '@/lib/cis/types'
import type { GridOwnerRow } from '@/lib/masterdata/types'
import type {
  EdielEnvironment,
  EdielMessageStandard,
  EdielRouteProfileAckMode,
} from '@/lib/ediel/types'
import {
  getEdielRouteRuntimeByCommunicationRouteId,
  type EdielRouteRuntimeRow,
} from '@/lib/ediel/config'
import { resolveCanonicalActorContext } from '@/lib/ediel/core/actorRegistry'

export type CanonicalRouteRequestType =
  | 'supplier_switch'
  | 'meter_values'
  | 'billing_underlay'

export type CanonicalRouteContext = {
  actor: Awaited<ReturnType<typeof resolveCanonicalActorContext>>
  route: CommunicationRouteRow
  routeRuntime: EdielRouteRuntimeRow | null
  senderEdielId: string
  senderName: string | null
  senderSubAddress: string | null
  receiverEdielId: string
  receiverName: string | null
  receiverSubAddress: string | null
  receiverEmail: string | null
  mailbox: string | null
  applicationReference: string | null
  defaultMessageVersion: string | null
  ackMode: EdielRouteProfileAckMode
  payloadFormat: 'edifact' | 'xml' | 'raw' | null
  messageStandard: EdielMessageStandard
  environment: EdielEnvironment
  routeKey: string
  routeDecisionReason: string
  routeSelectionSource: 'explicit_route' | 'auto_route'
}

function trimOrNull(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function getCommunicationRouteById(id: string): Promise<CommunicationRouteRow | null> {
  const { supabaseService } = await import('@/lib/supabase/service')
  const { data, error } = await supabaseService
    .from('communication_routes')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return (data as CommunicationRouteRow | null) ?? null
}

async function resolveCommunicationRoute(params: {
  requestType: CanonicalRouteRequestType
  gridOwnerId?: string | null
  preferredRouteId?: string | null
}): Promise<{
  route: CommunicationRouteRow | null
  source: 'explicit_route' | 'auto_route'
}> {
  if (params.preferredRouteId) {
    const explicitRoute = await getCommunicationRouteById(params.preferredRouteId)
    if (explicitRoute?.is_active) {
      return {
        route: explicitRoute,
        source: 'explicit_route',
      }
    }
  }

  return {
    route: await findBestCommunicationRoute({
      requestType: params.requestType,
      gridOwnerId: params.gridOwnerId ?? null,
    }),
    source: 'auto_route',
  }
}

export async function resolveCanonicalRouteContext(params: {
  requestType: CanonicalRouteRequestType
  gridOwner?: GridOwnerRow | null
  preferredRouteId?: string | null
  environment?: EdielEnvironment
  messageStandard?: EdielMessageStandard
}): Promise<CanonicalRouteContext> {
  const environment = params.environment ?? 'test'
  const actor = await resolveCanonicalActorContext(environment)
  const resolvedRoute = await resolveCommunicationRoute({
    requestType: params.requestType,
    gridOwnerId: params.gridOwner?.id ?? null,
    preferredRouteId: params.preferredRouteId ?? null,
  })
  const route = resolvedRoute.route

  if (!route) {
    throw new Error(
      `Ingen aktiv communication_route hittades för ${params.requestType}${
        params.gridOwner?.name ? ` / ${params.gridOwner.name}` : ''
      }.`
    )
  }

  const routeRuntime = await getEdielRouteRuntimeByCommunicationRouteId(route.id)

  const senderEdielId = trimOrNull(routeRuntime?.sender_ediel_id) ?? actor.senderEdielId
  const senderName = trimOrNull(routeRuntime?.sender_name) ?? actor.senderName
  const senderSubAddress = trimOrNull(routeRuntime?.sender_sub_address) ?? actor.senderSubAddress

  const receiverEdielId =
    trimOrNull(routeRuntime?.receiver_ediel_id) ??
    trimOrNull(params.gridOwner?.ediel_id)

  if (!receiverEdielId) {
    throw new Error(
      `Route ${route.route_name} saknar receiver_ediel_id och grid owner saknar ediel_id.`
    )
  }

  const receiverName =
    trimOrNull(routeRuntime?.receiver_name) ?? trimOrNull(params.gridOwner?.name)
  const receiverSubAddress =
    trimOrNull(routeRuntime?.receiver_sub_address) ??
    (route.target_system === 'ediel_portal_tgt' && params.requestType === 'supplier_switch'
      ? 'PRODAT'
      : 'EDIEL')
  const mailbox = trimOrNull(routeRuntime?.mailbox) ?? actor.mailbox
  const applicationReference =
    trimOrNull(routeRuntime?.application_reference) ??
    (route.target_system === 'ediel_portal_tgt' && params.requestType === 'supplier_switch'
      ? '23-DDQ-PRODAT'
      : actor.defaultApplicationReference)
  const defaultMessageVersion = trimOrNull(routeRuntime?.default_message_version)
  const ackMode = routeRuntime?.ack_mode ?? 'default'
  const messageStandard = params.messageStandard ?? routeRuntime?.message_standard ?? 'edifact'

  const routeKey = [
    params.requestType,
    route.id,
    receiverEdielId,
    receiverSubAddress,
    messageStandard,
    environment,
    defaultMessageVersion ?? 'default-version',
  ].join('|')

  const routeDecisionReason =
    resolvedRoute.source === 'explicit_route'
      ? `Explicit route ${route.route_name} valdes för ${params.requestType}. Runtime-profilen gav receiver ${receiverEdielId}, subaddress ${receiverSubAddress}, mailbox ${mailbox ?? '—'} och ack_mode ${ackMode}.`
      : `Route ${route.route_name} valdes automatiskt för ${params.requestType}${
          params.gridOwner?.name ? ` mot ${params.gridOwner.name}` : ''
        }. Runtime-profilen gav receiver ${receiverEdielId}, subaddress ${receiverSubAddress}, mailbox ${mailbox ?? '—'} och ack_mode ${ackMode}.`

  return {
    actor,
    route,
    routeRuntime,
    senderEdielId,
    senderName,
    senderSubAddress,
    receiverEdielId,
    receiverName,
    receiverSubAddress,
    receiverEmail: trimOrNull(route.target_email),
    mailbox,
    applicationReference,
    defaultMessageVersion,
    ackMode,
    payloadFormat: routeRuntime?.payload_format ?? null,
    messageStandard,
    environment,
    routeKey,
    routeDecisionReason,
    routeSelectionSource: resolvedRoute.source,
  }
}
