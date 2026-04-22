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
}): Promise<CommunicationRouteRow | null> {
  if (params.preferredRouteId) {
    const explicitRoute = await getCommunicationRouteById(params.preferredRouteId)
    if (explicitRoute?.is_active) return explicitRoute
  }

  return findBestCommunicationRoute({
    requestType: params.requestType,
    gridOwnerId: params.gridOwnerId ?? null,
  })
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
  const route = await resolveCommunicationRoute({
    requestType: params.requestType,
    gridOwnerId: params.gridOwner?.id ?? null,
    preferredRouteId: params.preferredRouteId ?? null,
  })

  if (!route) {
    throw new Error(
      `Ingen aktiv communication_route hittades för ${params.requestType}${
        params.gridOwner?.name ? ` / ${params.gridOwner.name}` : ''
      }.`
    )
  }

  const routeRuntime = await getEdielRouteRuntimeByCommunicationRouteId(route.id)

  const senderEdielId = actor.senderEdielId
  const senderName = actor.senderName
  const senderSubAddress = actor.senderSubAddress

  const receiverEdielId =
    trimOrNull(routeRuntime?.receiver_ediel_id) ??
    trimOrNull(params.gridOwner?.ediel_id)

  if (!receiverEdielId) {
    throw new Error(
      `Route ${route.route_name} saknar receiver_ediel_id och grid owner saknar ediel_id.`
    )
  }

  return {
    actor,
    route,
    routeRuntime,
    senderEdielId,
    senderName,
    senderSubAddress,
    receiverEdielId,
    receiverName:
      trimOrNull(routeRuntime?.receiver_name) ?? trimOrNull(params.gridOwner?.name),
    receiverSubAddress: trimOrNull(routeRuntime?.receiver_sub_address) ?? 'EDIEL',
    receiverEmail: trimOrNull(route.target_email),
    mailbox: trimOrNull(routeRuntime?.mailbox) ?? actor.mailbox,
    applicationReference:
      trimOrNull(routeRuntime?.application_reference) ??
      actor.defaultApplicationReference,
    defaultMessageVersion: trimOrNull(routeRuntime?.default_message_version),
    ackMode: routeRuntime?.ack_mode ?? 'default',
    payloadFormat: routeRuntime?.payload_format ?? null,
    messageStandard: params.messageStandard ?? routeRuntime?.message_standard ?? 'edifact',
    environment,
  }
}