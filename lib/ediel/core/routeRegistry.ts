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
import { isEdielPortalParty } from '@/lib/ediel/core/productionGuards'

export type CanonicalRouteRequestType =
  | 'supplier_switch'
  | 'customer_masterdata'
  | 'metering_access'
  | 'meter_values'
  | 'billing_underlay'
  | 'partner_export'
  | 'ediel_ack'

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
  receiverMessageSubAddress: string | null
  subaddressRequired: boolean
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

function isProdatRouteRequestType(value: CanonicalRouteRequestType): boolean {
  return value === 'supplier_switch' || value === 'customer_masterdata' || value === 'metering_access'
}

function defaultApplicationReferenceForRequestType(value: CanonicalRouteRequestType): string | null {
  if (value === 'metering_access') return '23-DGI-PRODAT'
  if (value === 'supplier_switch' || value === 'customer_masterdata') return '23-DDQ-PRODAT'
  return null
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
  // DEPRECATED DEFAULT: omitting `environment` silently resolves the TEST
  // lane. Call-site audit (2026-07-03, production readiness audit M5) shows
  // every runtime caller passes an explicit environment, so this default is
  // never exercised today. New callers MUST pass environment explicitly —
  // production flows rely on fail-closed environment separation.
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
  const senderEdielId = actor.senderEdielId
  const senderName = trimOrNull(routeRuntime?.sender_name) ?? actor.senderName
  const senderSubAddress =
    trimOrNull(routeRuntime?.sender_subaddress) ??
    trimOrNull(routeRuntime?.sender_sub_address) ??
    actor.senderSubAddress

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
    trimOrNull(routeRuntime?.receiver_subaddress) ??
    trimOrNull(routeRuntime?.receiver_sub_address)
  const receiverMessageSubAddress =
    trimOrNull(routeRuntime?.receiver_message_subaddress) ?? receiverSubAddress
  const subaddressRequired = routeRuntime?.subaddress_required === true

  if (subaddressRequired && !receiverMessageSubAddress && !senderSubAddress) {
    throw new Error(
      'Route saknar registrerad subadress. Kontrollera route-inställningar innan meddelandet skickas.'
    )
  }

  // Edielportalen PRODAT can use values such as 91100:ZZ:PRODAT, but the
  // route must carry that value explicitly; we do not synthesize subaddress.
  const mailbox = trimOrNull(routeRuntime?.mailbox) ?? actor.mailbox
  const applicationReference =
    trimOrNull(routeRuntime?.application_reference) ??
    (isProdatRouteRequestType(params.requestType)
      ? defaultApplicationReferenceForRequestType(params.requestType)
      : null) ??
    actor.defaultApplicationReference

  if (environment === 'production') {
    const normalizedApplicationReference = String(applicationReference ?? '').toUpperCase()
    const normalizedReceiverEmail = String(route.target_email ?? '').toLowerCase()

    if (isEdielPortalTgtRoute || isEdielPortalParty(receiverEdielId) || normalizedReceiverEmail.endsWith('@ediel.se')) {
      throw new Error(
        `Produktionsruntime får inte använda Edielportalens TGT-route (${route.route_name}). Välj testmiljö eller en riktig motpartsroute.`
      )
    }

    if (normalizedApplicationReference.includes('TGT') || normalizedApplicationReference.includes('EDIELPORTAL')) {
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
    receiverMessageSubAddress ?? receiverSubAddress ?? 'no-subaddress',
    applicationReference ?? 'default-application-reference',
    messageStandard,
    environment,
    defaultMessageVersion ?? 'default-version',
  ].join('|')

  const routeDecisionReason =
    resolvedRoute.source === 'explicit_route'
      ? `Explicit route ${route.route_name} valdes för ${params.requestType}. Runtime-profilen gav receiver ${receiverEdielId}, subaddress ${receiverMessageSubAddress ?? receiverSubAddress ?? 'ingen'}, mailbox ${mailbox ?? '—'} application reference ${applicationReference ?? '—'} och ack_mode ${ackMode}.`
      : `Route ${route.route_name} valdes automatiskt för ${params.requestType}${
          params.gridOwner?.name ? ` mot ${params.gridOwner.name}` : ''
        }. Runtime-profilen gav receiver ${receiverEdielId}, subaddress ${receiverMessageSubAddress ?? receiverSubAddress ?? 'ingen'}, mailbox ${mailbox ?? '—'} application reference ${applicationReference ?? '—'} och ack_mode ${ackMode}.`

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
    receiverMessageSubAddress,
    subaddressRequired,
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
