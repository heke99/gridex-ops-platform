import { supabaseService } from '@/lib/supabase/service'
import type { GridOwnerInformationRequestInput, GridOwnerInformationRequestResult, PriceArea } from '@/lib/energy/types'
import { normaliseGridAreaCode } from '@/lib/energy/resolver'
import { evaluateGridOwnerBusinessApproval } from '@/lib/ediel/gridOwnerBusinessApproval'
import { resolvePlatformGridOwnerByAnyId } from '@/lib/grid-owners/platformGridOwnerResolver'

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

function normalisePriceArea(value: unknown): PriceArea | null {
  const area = clean(value)?.toUpperCase()
  return area === 'SE1' || area === 'SE2' || area === 'SE3' || area === 'SE4' ? area : null
}


async function findOperationalRouteReadiness(input: GridOwnerInformationRequestInput) {
  if (!input.gridOwnerId) return null
  try {
    const approval = await evaluateGridOwnerBusinessApproval({
      companyId: input.companyId,
      gridOwnerId: input.gridOwnerId,
      process: 'facility_lookup',
      environment: 'production',
    })
    if (!approval.businessProductionApproved) return { approval, ready: false }
    return { approval, ready: true }
  } catch (error) {
    if (missingSchema(error)) return null
    throw error
  }
}

function metadataWithOperationalRoute(input: {
  base?: Record<string, unknown> | null
  approval: NonNullable<Awaited<ReturnType<typeof findOperationalRouteReadiness>>>['approval']
}) {
  return {
    ...(input.base ?? {}),
    auto_send_allowed: input.approval.businessProductionApproved,
    production_guard: 'switch_blocked_until_facility_verified',
    route_source: input.approval.businessProductionApproved ? 'company_operational_routes' : 'manual',
    communication_route_id: input.approval.communicationRouteId,
    ediel_route_profile_id: input.approval.edielRouteProfileId,
    technical_send_ready: input.approval.technicalSendReady,
    business_production_approved: input.approval.businessProductionApproved,
    actor_scope: input.approval.actorScope,
    process_relevant: input.approval.processRelevant,
    route_warnings: input.approval.warnings,
    route_blockers: input.approval.blockers,
  }
}

async function findContactRoute(input: GridOwnerInformationRequestInput) {
  const gridAreaCode = normaliseGridAreaCode(input.gridAreaCode)
  const query = supabaseService
    .from('grid_owner_contact_routes')
    .select('*')
    .eq('status', 'active')
    .eq('request_type', input.requestType ?? 'facility_lookup')
    .or(`company_id.is.null,company_id.eq.${input.companyId}`)
    .order('priority', { ascending: true })
    .limit(25)

  const { data, error } = await query
  if (error) {
    if (missingSchema(error)) return null
    throw error
  }

  const rows = data ?? []
  return rows.find((row) => {
    const ownerMatches = !row.grid_owner_id || !input.gridOwnerId || row.grid_owner_id === input.gridOwnerId
    const areaMatches = !row.grid_area_code || !gridAreaCode || String(row.grid_area_code).toUpperCase() === gridAreaCode
    return ownerMatches && areaMatches
  }) ?? rows[0] ?? null
}

async function findActorRoute(input: GridOwnerInformationRequestInput) {
  if (!input.gridOwnerId) return null

  // input.gridOwnerId can be either a platform_grid_owners.id or an OPS
  // grid_owners.id (customer_sites store the OPS id) — resolve across both.
  const owner = await resolvePlatformGridOwnerByAnyId({
    gridOwnerId: input.gridOwnerId,
    select: 'id,name,ediel_id',
  })

  const edielId = clean(owner?.ediel_id)
  if (!edielId) return null

  const identifier = await supabaseService
    .from('platform_actor_identifiers')
    .select('actor_id')
    .eq('identifier_type', 'EdielId')
    .eq('identifier_value', edielId)
    .maybeSingle()

  if (identifier.error) {
    if (missingSchema(identifier.error)) return null
    throw identifier.error
  }
  if (!identifier.data?.actor_id) return null

  const route = await supabaseService
    .from('platform_actor_routes')
    .select('id,message_family,subaddress,communication_address,status,is_verified,auto_send_allowed,requires_poa')
    .eq('actor_id', identifier.data.actor_id)
    .eq('message_family', 'PRODAT')
    .eq('environment', 'production')
    .order('is_verified', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (route.error) {
    if (missingSchema(route.error)) return null
    throw route.error
  }

  return route.data ?? null
}


async function existingOpenRequest(input: GridOwnerInformationRequestInput) {
  if (!input.customerSiteId) return null
  const { data, error } = await supabaseService
    .from('grid_owner_information_requests')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('customer_site_id', input.customerSiteId)
    .eq('request_type', input.requestType ?? 'facility_lookup')
    .in('status', ['draft', 'ready_to_send', 'sent', 'waiting_response', 'needs_review'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    if (missingSchema(error)) return null
    throw error
  }
  return data ?? null
}

// Detects an open MANUAL grid-owner information request for the same site. The
// manual e-mail pipeline (requestMissingFacilityInformation) uses the request
// type `facility_identifier_lookup` / channel `manual_email`. When such a
// request is already open we must NOT create a parallel Ediel request for the
// same facility lookup, otherwise the site would have two competing open
// requests with different statuses.
async function existingOpenManualRequest(input: GridOwnerInformationRequestInput) {
  if (!input.customerSiteId) return null
  const { data, error } = await supabaseService
    .from('grid_owner_information_requests')
    .select('id,status,channel')
    .eq('company_id', input.companyId)
    .eq('customer_site_id', input.customerSiteId)
    .eq('channel', 'manual_email')
    .in('status', [
      'draft', 'ready_to_send', 'ready_to_send_manual_email', 'manual_email_queued',
      'manual_email_sent', 'waiting_manual_response', 'manual_response_received', 'needs_review',
    ])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    if (missingSchema(error)) return null
    throw error
  }
  return data ?? null
}

export async function ensureGridOwnerInformationRequest(input: GridOwnerInformationRequestInput): Promise<GridOwnerInformationRequestResult> {
  const warnings: string[] = []
  const gridAreaCode = normaliseGridAreaCode(input.gridAreaCode)
  const priceArea = normalisePriceArea(input.priceArea)

  if (!input.companyId || (!gridAreaCode && !input.gridOwnerId)) {
    return {
      requestId: null,
      status: 'skipped',
      channel: null,
      nextStep: 'Nätområde eller nätägare saknas. Kör Energy Resolver eller granska ansökan manuellt först.',
      warnings: ['missing_grid_owner_context'],
    }
  }

  // Missing-facility lookups belong to the manual e-mail pipeline. If a manual
  // request is already open for this site, do not create a parallel Ediel
  // request — the manual flow owns the conversation with the grid owner.
  const manualOpen = await existingOpenManualRequest(input)
  if (manualOpen) {
    return {
      requestId: null,
      status: 'skipped',
      channel: 'manual',
      nextStep: 'En manuell nätägarbegäran pågår redan för anläggningen. Hantera den manuella förfrågan i stället för att skapa en Ediel-begäran.',
      warnings: ['manual_request_in_progress'],
    }
  }

  const operationalRoute = await findOperationalRouteReadiness(input)
  const existing = await existingOpenRequest(input)
  if (existing) {
    if (operationalRoute?.ready && !['sent', 'waiting_response', 'received', 'completed'].includes(String(existing.status ?? ''))) {
      const now = new Date().toISOString()
      const metadata = metadataWithOperationalRoute({
        base: (existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata))
          ? existing.metadata as Record<string, unknown>
          : {},
        approval: operationalRoute.approval,
      })
      const update = await supabaseService
        .from('grid_owner_information_requests')
        .update({
          status: 'ready_to_send',
          channel: 'ediel',
          template_id: 'facility_lookup.prodat_z01',
          actor_route_id: operationalRoute.approval.routeReadiness?.platform_actor_route_id ?? existing.actor_route_id ?? null,
          communication_route_id: operationalRoute.approval.communicationRouteId,
          ediel_route_profile_id: operationalRoute.approval.edielRouteProfileId,
          dispatch_status: 'ready',
          dispatch_error_code: null,
          dispatch_error_message: null,
          metadata,
          updated_at: now,
        })
        .eq('id', existing.id)
        .eq('company_id', input.companyId)
        .select('id,status,channel,contact_route_id,actor_route_id,communication_route_id,ediel_route_profile_id,outbound_request_id,ediel_message_id,operation_id,dispatch_status,metadata')
        .maybeSingle()
      if (update.error && !missingSchema(update.error)) throw update.error
      const upgraded = update.data ?? existing
      return {
        requestId: upgraded.id as string,
        status: upgraded.status,
        channel: upgraded.channel,
        routeId: upgraded.communication_route_id ?? operationalRoute.approval.communicationRouteId ?? upgraded.contact_route_id ?? upgraded.actor_route_id ?? null,
        communicationRouteId: upgraded.communication_route_id ?? operationalRoute.approval.communicationRouteId ?? null,
        edielRouteProfileId: upgraded.ediel_route_profile_id ?? operationalRoute.approval.edielRouteProfileId ?? null,
        outboundRequestId: upgraded.outbound_request_id ?? null,
        edielMessageId: upgraded.ediel_message_id ?? null,
        operationId: upgraded.operation_id ?? null,
        dispatchStatus: upgraded.dispatch_status ?? null,
        nextStep: 'Nätägarbegäran är kopplad till produktionsklar Ediel-route och kan skickas automatiskt.',
        warnings,
      }
    }
    return {
      requestId: existing.id as string,
      status: existing.status,
      channel: existing.channel,
      routeId: existing.communication_route_id ?? operationalRoute?.approval.communicationRouteId ?? existing.contact_route_id ?? existing.actor_route_id ?? null,
      communicationRouteId: existing.communication_route_id ?? operationalRoute?.approval.communicationRouteId ?? null,
      edielRouteProfileId: existing.ediel_route_profile_id ?? operationalRoute?.approval.edielRouteProfileId ?? null,
      outboundRequestId: existing.outbound_request_id ?? null,
      edielMessageId: existing.ediel_message_id ?? null,
      operationId: existing.operation_id ?? null,
      dispatchStatus: existing.dispatch_status ?? null,
      nextStep: existing.status === 'waiting_response'
        ? 'Invänta svar från nätägaren och markera anläggningsuppgifter mottagna när svaret kommit.'
        : operationalRoute?.ready
          ? 'Nätägarbegäran är redo att skickas automatiskt via godkänd produktionsroute.'
          : 'Granska och skicka/hantera befintlig nätägarbegäran.',
      warnings: operationalRoute && !operationalRoute.ready ? [...warnings, ...operationalRoute.approval.blockers.map((b) => b.code)] : warnings,
    }
  }

  const contactRoute = operationalRoute?.ready ? null : await findContactRoute(input)
  const actorRoute = contactRoute || operationalRoute?.ready ? null : await findActorRoute(input)
  if (!contactRoute && !actorRoute && !operationalRoute?.ready) warnings.push('grid_owner_contact_route_missing')
  if (actorRoute && (!actorRoute.is_verified || actorRoute.status !== 'active')) warnings.push('actor_route_needs_verification')
  if (operationalRoute && !operationalRoute.ready) warnings.push(...operationalRoute.approval.blockers.map((b) => b.code))

  const channel = (operationalRoute?.ready ? 'ediel' : contactRoute?.channel ?? (actorRoute ? 'ediel' : 'manual')) as 'email' | 'ediel' | 'portal' | 'manual'
  const routeIsSendReady = Boolean(operationalRoute?.ready) || Boolean(contactRoute && channel !== 'manual') || Boolean(actorRoute?.is_verified && actorRoute.status === 'active')
  const status = routeIsSendReady ? 'ready_to_send' : actorRoute ? 'needs_review' : 'draft'
  const now = new Date().toISOString()
  const routeMetadata = operationalRoute
    ? metadataWithOperationalRoute({ approval: operationalRoute.approval })
    : {
        auto_send_allowed: Boolean(contactRoute?.auto_send_allowed ?? actorRoute?.auto_send_allowed),
        production_guard: 'switch_blocked_until_facility_verified',
        route_source: contactRoute ? 'grid_owner_contact_routes' : actorRoute ? 'platform_actor_routes' : 'manual',
      }

  const { data, error } = await supabaseService
    .from('grid_owner_information_requests')
    .insert({
      company_id: input.companyId,
      customer_id: clean(input.customerId),
      customer_site_id: clean(input.customerSiteId),
      customer_application_id: clean(input.customerApplicationId),
      resolution_id: clean(input.resolutionId),
      grid_owner_id: clean(input.gridOwnerId),
      grid_area_code: gridAreaCode,
      price_area: priceArea,
      request_type: input.requestType ?? 'facility_lookup',
      status,
      channel,
      template_id: clean(contactRoute?.template_id) ?? (actorRoute || operationalRoute?.ready ? 'facility_lookup.prodat_z01' : 'facility_lookup.default'),
      contact_route_id: clean(contactRoute?.id),
      actor_route_id: clean(actorRoute?.id) ?? operationalRoute?.approval.routeReadiness?.platform_actor_route_id ?? null,
      communication_route_id: operationalRoute?.approval.communicationRouteId ?? null,
      ediel_route_profile_id: operationalRoute?.approval.edielRouteProfileId ?? null,
      dispatch_status: operationalRoute?.ready ? 'ready' : 'not_started',
      dispatch_error_code: null,
      dispatch_error_message: null,
      requires_poa: contactRoute?.requires_poa ?? actorRoute?.requires_poa ?? true,
      created_by: clean(input.createdBy),
      metadata: {
        created_from: 'energy_resolver',
        ...routeMetadata,
      },
      updated_at: now,
    })
    .select('id,status,channel,contact_route_id,actor_route_id,communication_route_id,ediel_route_profile_id,outbound_request_id,ediel_message_id,operation_id,dispatch_status')
    .single()

  if (error) {
    if (missingSchema(error)) {
      return {
        requestId: null,
        status: 'skipped',
        channel: null,
        nextStep: 'Kör migrationen för grid_owner_information_requests innan nätägarbegäran kan skapas.',
        warnings: [...warnings, 'grid_owner_information_requests_schema_missing'],
      }
    }
    throw error
  }

  if (input.resolutionId) {
    const resolutionResult = await supabaseService
      .from('customer_site_resolution')
      .update({ resolution_status: 'facility_data_requested', updated_at: now })
      .eq('id', input.resolutionId)
      .eq('company_id', input.companyId)
    if (resolutionResult.error && !missingSchema(resolutionResult.error)) throw resolutionResult.error
  }

  if (input.customerApplicationId) {
    const appResult = await supabaseService
      .from('website_customer_applications')
      .update({
        grid_owner_information_request_id: data.id,
        status: status === 'ready_to_send' ? 'information_request_ready' : 'needs_facility_data',
        updated_at: now,
      })
      .eq('id', input.customerApplicationId)
      .eq('company_id', input.companyId)
    if (appResult.error && !missingSchema(appResult.error)) throw appResult.error
  }

  return {
    requestId: data.id as string,
    status: data.status,
    channel: data.channel,
    routeId: data.communication_route_id ?? operationalRoute?.approval.communicationRouteId ?? data.contact_route_id ?? data.actor_route_id ?? null,
    communicationRouteId: data.communication_route_id ?? operationalRoute?.approval.communicationRouteId ?? null,
    edielRouteProfileId: data.ediel_route_profile_id ?? operationalRoute?.approval.edielRouteProfileId ?? null,
    outboundRequestId: data.outbound_request_id ?? null,
    edielMessageId: data.ediel_message_id ?? null,
    operationId: data.operation_id ?? null,
    dispatchStatus: data.dispatch_status ?? null,
    nextStep: status === 'ready_to_send'
      ? 'Nätägarbegäran är redo att skickas via produktionsklar Ediel-route. Leverantörsbyte är blockerat tills anläggningsuppgifter är mottagna.'
      : actorRoute
        ? 'Verifiera importerad Ediel-route/subadress innan sändning. Leverantörsbyte är blockerat tills route och anläggningsuppgifter är gröna.'
        : 'Komplettera kontaktväg eller hantera nätägarbegäran manuellt. Leverantörsbyte är blockerat tills anläggningsuppgifter är mottagna.',
    warnings,
  }
}

// The legacy markFacilityDataReceived helper was removed: facility completion
// has exactly one implementation — completeFacilityLookup in
// lib/facility/facilityLookupWorkflow.ts (via completeFacilityLookupAndRunNextSteps).
