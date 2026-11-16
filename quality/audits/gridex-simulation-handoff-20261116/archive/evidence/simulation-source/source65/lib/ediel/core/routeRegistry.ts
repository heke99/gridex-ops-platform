// lib/ediel/core/routeRegistry.ts

import { processActorRole } from '@/lib/ediel/core/marketRole'
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
  type EdielAckRouteProfileSelection,
} from '@/lib/ediel/config'
import { resolveCanonicalActorContext } from '@/lib/ediel/core/actorRegistry'
import { isEdielPortalParty, isEdielPortalEmail } from '@/lib/ediel/core/productionGuards'
import { validateApplicationReferencePolicy } from '@/lib/ediel/intent/applicationReferencePolicy'

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

function trimOrNull(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function routeMatchesEnvironment(route: CommunicationRouteRow, environment: EdielEnvironment): boolean {
  const routeEnvironment = String((route as CommunicationRouteRow & { environment_type?: unknown }).environment_type ?? '').trim()
  if (environment === 'production') return routeEnvironment === 'production'
  return routeEnvironment === 'tgt_test' || routeEnvironment === 'agt_test' || routeEnvironment === 'bilateral_test'
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
  if (scopedCompanyId) query = query.eq('company_id', scopedCompanyId)

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return (data as CommunicationRouteRow | null) ?? null
}

async function resolveCommunicationRoute(params: {
  requestType: CanonicalRouteRequestType
  gridOwnerId?: string | null
  preferredRouteId?: string | null
  companyId?: string | null
  environment: EdielEnvironment
}): Promise<{
  route: CommunicationRouteRow | null
  source: 'explicit_route' | 'auto_route'
}> {
  if (params.preferredRouteId) {
    const explicitRoute = await getCommunicationRouteById(params.preferredRouteId, params.companyId)
    if (explicitRoute?.is_active) {
      if (!routeMatchesEnvironment(explicitRoute, params.environment)) {
        throw new Error(`canonical_route_environment_mismatch:${explicitRoute.id}:${params.environment}`)
      }
      return { route: explicitRoute, source: 'explicit_route' }
    }
  }

  return {
    route: await findBestCommunicationRoute({
      companyId: params.companyId ?? null,
      requestType: params.requestType,
      gridOwnerId: params.gridOwnerId ?? null,
      environment: params.environment,
    }),
    source: 'auto_route',
  }
}

/** An ACK replies to the source's sender. When that sender is exactly one
 * active grid owner of this tenant, its own ACK route is tried before the
 * tenant's generic ACK route (findBestCommunicationRoute falls back). */
async function replyGridOwnerId(companyId: string, receiverEdielId?: string | null): Promise<string | null> {
  const ediel = trimOrNull(receiverEdielId)
  if (!ediel) return null
  const { supabaseService } = await import('@/lib/supabase/service')
  const { data, error } = await supabaseService.from('grid_owners').select('id').eq('company_id', companyId).eq('ediel_id', ediel).eq('is_active', true).limit(2)
  if (error) throw error
  return data?.length === 1 ? (data[0] as { id: string }).id : null
}

export async function resolveCanonicalRouteContext(params: {
  requestType: CanonicalRouteRequestType
  gridOwner?: GridOwnerRow | null
  preferredRouteId?: string | null
  companyId: string
  environment: EdielEnvironment
  messageStandard?: EdielMessageStandard
  receiverEdielId?: string | null
  applicationReference?: string | null
  ackProfile?: Pick<EdielAckRouteProfileSelection, 'family' | 'code'>
}): Promise<CanonicalRouteContext> {
  const environment = params.environment
  const companyId = trimOrNull(params.companyId)
  if (!companyId) throw new Error('canonical_route_company_required')
  if (params.ackProfile !== undefined && (!params.ackProfile || params.requestType !== 'ediel_ack')) {
    throw new Error('ediel_ack_route_profile_basis_required')
  }

  // TEN-02/TEN-05: the process (application reference) selects the tenant's role profile.
  const actor = await resolveCanonicalActorContext(environment, companyId, processActorRole(params.applicationReference))
  const resolvedRoute = await resolveCommunicationRoute({
    requestType: params.requestType,
    gridOwnerId: params.gridOwner?.id ?? (params.requestType === 'ediel_ack' ? await replyGridOwnerId(companyId, params.receiverEdielId) : null),
    preferredRouteId: params.preferredRouteId ?? null,
    companyId,
    environment,
  })
  const route = resolvedRoute.route

  if (!route) {
    throw new Error(
      `Ingen aktiv communication_route hittades för ${params.requestType}${params.gridOwner?.name ? ` / ${params.gridOwner.name}` : ''}.`
    )
  }

  if (!routeMatchesEnvironment(route, environment)) {
    throw new Error(`canonical_route_environment_mismatch:${route.id}:${environment}`)
  }

  const routeRuntime = await getEdielRouteRuntimeByCommunicationRouteId(route.id, {
    companyId,
    ...(params.ackProfile !== undefined ? { ackProfile: { ...params.ackProfile, environment,
      applicationReference: params.applicationReference ?? '' } } : {}),
  })
  if (routeRuntime?.environment && routeRuntime.environment !== environment) {
    throw new Error(`canonical_route_profile_environment_mismatch:${route.id}:${environment}:${routeRuntime.environment}`)
  }

  const targetSystem = String(route.target_system ?? '').toLowerCase()
  const isEdielPortalTgtRoute = targetSystem.includes('ediel_portal_tgt') || targetSystem.includes('tgt')
  const senderEdielId = actor.senderEdielId
  const senderName = trimOrNull(routeRuntime?.sender_name) ?? actor.senderName
  const senderSubAddress =
    trimOrNull(routeRuntime?.sender_subaddress) ??
    trimOrNull(routeRuntime?.sender_sub_address) ??
    actor.senderSubAddress

  // ACKs use the actual inbound sender as receiver. Static route data is only
  // a fallback for ordinary outbound business flows.
  const receiverEdielId =
    trimOrNull(params.receiverEdielId) ??
    trimOrNull(routeRuntime?.receiver_ediel_id) ??
    trimOrNull(params.gridOwner?.ediel_id)

  if (!receiverEdielId) {
    throw new Error(`Route ${route.route_name} saknar receiver_ediel_id och canonical receiver override saknas.`)
  }

  const receiverName = trimOrNull(routeRuntime?.receiver_name) ?? trimOrNull(params.gridOwner?.name)
  const receiverSubAddress =
    trimOrNull(routeRuntime?.receiver_subaddress) ??
    trimOrNull(routeRuntime?.receiver_sub_address)
  const receiverMessageSubAddress =
    trimOrNull(routeRuntime?.receiver_message_subaddress) ?? receiverSubAddress
  const subaddressRequired = routeRuntime?.subaddress_required === true

  if (subaddressRequired && !receiverMessageSubAddress && !senderSubAddress) {
    throw new Error('Route saknar registrerad subadress. Kontrollera route-inställningar innan meddelandet skickas.')
  }

  const mailbox = trimOrNull(routeRuntime?.mailbox) ?? actor.mailbox
  const messageStandard = params.messageStandard ?? routeRuntime?.message_standard ?? 'edifact'
  const isAiList = messageStandard === 'ai_list'
  if (isAiList && (routeRuntime?.message_standard !== 'ai_list' || routeRuntime?.message_family !== 'AI_LIST' || routeRuntime?.is_enabled !== true)) {
    throw new Error('ai_list_actual_route_profile_required')
  }
  if (isAiList && (!validateApplicationReferencePolicy({messageFamily:'AI_LIST',applicationReference:params.applicationReference}).ok
    || !validateApplicationReferencePolicy({messageFamily:'AI_LIST',applicationReference:routeRuntime?.application_reference}).ok)) {
    throw new Error('ai_list_application_reference_forbidden')
  }
  const applicationReference = isAiList ? null :
    trimOrNull(params.applicationReference) ??
    trimOrNull(routeRuntime?.application_reference) ??
    actor.defaultApplicationReference

  if (route.company_id !== companyId) {
    throw new Error(`canonical_route_tenant_mismatch:${route.id}`)
  }

  if (environment === 'production') {
    if (!isAiList && !applicationReference) {
      throw new Error(`production_application_reference_required:${route.id}`)
    }
    const normalizedApplicationReference = String(applicationReference).toUpperCase()

    if (isEdielPortalTgtRoute || isEdielPortalParty(receiverEdielId) || isEdielPortalEmail(route.target_email)) {
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
      ? `Explicit route ${route.route_name} valdes för ${params.requestType} i ${environment}. Receiver ${receiverEdielId}, application reference ${applicationReference ?? '—'} och ack_mode ${ackMode}.`
      : `Route ${route.route_name} valdes automatiskt för ${params.requestType} i ${environment}${params.gridOwner?.name ? ` mot ${params.gridOwner.name}` : ''}. Receiver ${receiverEdielId}, application reference ${applicationReference ?? '—'} och ack_mode ${ackMode}.`

  return {
    companyId,
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

/** Call only after the actual protected original/operation replay branch.
 * Fresh mapped business routes use the same private source/dispatch authority;
 * technical/common ACK routes are qualified by their separate opaque owners. */
export async function assertFreshBusinessRegistryRouteSource(context:CanonicalRouteContext,messageFamily:string):Promise<void>{
  if(!['PRODAT','UTILTS','AI','AI_LIST'].includes(messageFamily))return
  const {readRegistryDispatchSource}=await import('@/lib/actor-registry/registryMarketSource')
  const profileId=context.routeRuntime?.route_profile_id
  if(!context.companyId||!profileId)throw new Error('ediel_registry_owned_route_profile_required')
  const source=await readRegistryDispatchSource({companyId:context.companyId,communicationRouteId:context.route.id,routeProfileId:profileId,environment:context.environment,messageFamily,applicationReference:context.applicationReference})
  if(source&&(source.wire.interchangePartyId!==context.receiverEdielId||source.wire.address!==context.receiverEmail||source.wire.subaddress!==context.receiverSubAddress))throw new Error('ediel_registry_dispatch_context_mismatch')
}
