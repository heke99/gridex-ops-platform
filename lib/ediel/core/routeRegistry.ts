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
  companyId: string | null
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

async function getCommunicationRouteById(
  id: string,
  companyId?: string | null
): Promise<CommunicationRouteRow | null> {
  const { supabaseService } = await import('@/lib/supabase/service')
  let query = supabaseService
    .from('communication_routes')
    .select('*')
    .eq('id', id)

  const scopedCompanyId = trimOrNull(companyId)
  if (scopedCompanyId) {
    query = query.eq('company_id', scopedCompanyId)
  }

  const { data, error } = await query.maybeSingle()

  if (error) throw error
  return (data as CommunicationRouteRow | null) ?? null
}

async function resolveCommunicationRoute(params: {
  requestType: CanonicalRouteRequestType
  gridOwnerId?: string | null
  preferredRouteId?: string | null
  companyId?: string | null
}): Promise<{
  route: CommunicationRouteRow | null
  source: 'explicit_route' | 'auto_route'
}> {
  if (params.preferredRouteId) {
    const explicitRoute = await getCommunicationRouteById(params.preferredRouteId, params.companyId)
    if (explicitRoute?.is_active) {
      return {
        route: explicitRoute,
        source: 'explicit_route',
      }
    }
  }

  return {
    route: await findBestCommunicationRoute({
      companyId: params.companyId ?? null,
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
  companyId?: string | null
  environment?: EdielEnvironment
  messageStandard?: EdielMessageStandard
}): Promise<CanonicalRouteContext> {
  const environment = params.environment ?? 'test'
  const companyId = trimOrNull(params.companyId)
  const actor = await resolveCanonicalActorContext(environment, companyId)
  const resolvedRoute = await resolveCommunicationRoute({
    requestType: params.requestType,
    gridOwnerId: params.gridOwner?.id ?? null,
    preferredRouteId: params.preferredRouteId ?? null,
    companyId,
  })
  const route = resolvedRoute.route

  if (!route) {
    throw new Error(
      `Ingen aktiv communication_route hittades för ${params.requestType}${
        params.gridOwner?.name ? ` / ${params.gridOwner.name}` : ''
      }.`
    )
  }

  const routeRuntime = await getEdielRouteRuntimeByCommunicationRouteId(route.id, { companyId })

  const targetSystem = String(route.target_system ?? '').toLowerCase()
  const isEdielPortalTgtRoute = targetSystem.includes('ediel_portal_tgt') || targetSystem.includes('tgt')
  const senderEdielId = trimOrNull(routeRuntime?.sender_ediel_id) ?? actor.senderEdielId
  const senderName = trimOrNull(routeRuntime?.sender_name) ?? actor.senderName
  const senderSubAddress = isEdielPortalTgtRoute
    ? null
    : trimOrNull(routeRuntime?.sender_sub_address) ?? actor.senderSubAddress

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
    (isEdielPortalTgtRoute && params.requestType === 'supplier_switch'
      ? 'PRODAT'
      : 'EDIEL')
  const mailbox = trimOrNull(routeRuntime?.mailbox) ?? actor.mailbox
  const applicationReference =
    trimOrNull(routeRuntime?.application_reference) ??
    (isEdielPortalTgtRoute && params.requestType === 'supplier_switch'
      ? '23-DDQ-PRODAT'
      : actor.defaultApplicationReference)

  if (environment === 'production') {
    const normalizedApplicationReference = String(applicationReference ?? '').toUpperCase()
    const normalizedReceiverEmail = String(route.target_email ?? '').toLowerCase()

    if (isEdielPortalTgtRoute || receiverEdielId === '91100' || normalizedReceiverEmail.endsWith('@ediel.se')) {
      throw new Error(
        `Produktionsruntime får inte använda Edielportalens TGT-route (${route.route_name}). Välj testmiljö eller en riktig motpartsroute.`
      )
    }

    if (normalizedApplicationReference.startsWith('23-DDQ')) {
      throw new Error(
        `Produktionsruntime får inte använda TGT application reference ${applicationReference}. Uppdatera route profile/actor settings innan utskick.`
      )
    }
  }

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
    companyId: companyId ?? route.company_id ?? null,
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
