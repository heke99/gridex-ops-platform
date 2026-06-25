import { randomUUID } from 'node:crypto'
import { createOutboundRequest } from '@/lib/cis/db'
import { supabaseService } from '@/lib/supabase/service'
import { evaluateCustomerProcessRouteReadiness } from '@/lib/customer-operations/customerProcessRouteReadiness'
import { emitCustomerOperationEvent } from '@/lib/customers/customerOperationEvents'
import { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import { resolveOutboundRuntimeEnvironment } from '@/lib/ediel/flows/shared'
import { createEdielMessageIntent } from '@/lib/ediel/intent/intentEngine'
import { renderAndQueueFacilityLookupZ01 } from '@/lib/ediel/intent/renderGateway'
import { translateBlockingReasonsForTenant } from '@/lib/ediel/intent/tenantStatusTranslator'
import { FACILITY_LOOKUP_APPLICATION_REFERENCE } from '@/lib/ediel/intent/renderers/facilityLookupZ01'
import { markLegacyOutboundSupersededByIntent } from '@/lib/ediel/outbox/legacyOutboundBridge'
import type { EdielEnvironment } from '@/lib/ediel/types'

type JsonRecord = Record<string, unknown>

type FacilityLookupRequestRow = {
  id: string
  company_id: string
  customer_id: string | null
  customer_site_id: string | null
  customer_application_id?: string | null
  resolution_id?: string | null
  grid_owner_id: string | null
  grid_area_code: string | null
  price_area: string | null
  request_type: string
  status: string
  channel: string | null
  template_id?: string | null
  contact_route_id?: string | null
  actor_route_id?: string | null
  communication_route_id?: string | null
  ediel_route_profile_id?: string | null
  outbound_request_id?: string | null
  ediel_message_id?: string | null
  operation_id?: string | null
  metadata: JsonRecord | null
  created_by?: string | null
}

export type FacilityLookupEdifactDispatchResult = {
  requestId: string
  status: 'queued' | 'already_waiting' | 'blocked' | 'skipped' | 'failed'
  outboundRequestId: string | null
  edielMessageId: string | null
  communicationRouteId: string | null
  edielRouteProfileId: string | null
  operationId: string | null
  blockerCode: string | null
  blockerMessage: string | null
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function missingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

function sanitize(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n'+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function compactReference(value: string | null | undefined, fallbackPrefix: string, maxLength: number): string {
  const cleaned = sanitize(value).toUpperCase().replace(/[^A-Z0-9_.\/-]/g, '')
  if (cleaned) return cleaned.slice(0, maxLength)
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(2, 12)
  return `${fallbackPrefix}${stamp}`.slice(0, maxLength)
}

function requestMetadata(row: FacilityLookupRequestRow): JsonRecord {
  return isRecord(row.metadata) ? row.metadata : {}
}

async function readFacilityLookupRequest(input: { companyId: string; requestId: string }) {
  const { data, error } = await supabaseService
    .from('grid_owner_information_requests')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('id', input.requestId)
    .maybeSingle()
  if (error) throw error
  return (data as FacilityLookupRequestRow | null) ?? null
}

async function readGridOwner(gridOwnerId: string | null | undefined): Promise<JsonRecord | null> {
  const id = clean(gridOwnerId)
  if (!id) return null
  const { data, error } = await supabaseService
    .from('platform_grid_owners')
    .select('id,name,ediel_id,owner_code,platform_market_actor_id')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    if (missingSchema(error)) return null
    throw error
  }
  return (data as JsonRecord | null) ?? null
}

async function findExistingDispatchForRequest(request: FacilityLookupRequestRow): Promise<JsonRecord | null> {
  const { data, error } = await supabaseService
    .from('outbound_requests')
    .select('id,status,response_payload,communication_route_id,ediel_route_profile_id,operation_id')
    .eq('company_id', request.company_id)
    .eq('request_type', 'customer_masterdata')
    .eq('source_type', 'manual')
    .eq('source_id', request.id)
    .in('status', ['queued', 'prepared', 'sent', 'delivery_uncertain', 'acknowledged'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    if (missingSchema(error)) return null
    throw error
  }
  return (data as JsonRecord | null) ?? null
}

async function patchRequest(input: {
  companyId: string
  requestId: string
  patch: JsonRecord
}) {
  const { error } = await supabaseService
    .from('grid_owner_information_requests')
    .update({ ...input.patch, updated_at: new Date().toISOString() })
    .eq('company_id', input.companyId)
    .eq('id', input.requestId)
  if (error && !missingSchema(error)) throw error
}

async function safePatch(table: string, input: { companyId: string; id: string | null | undefined; patch: JsonRecord }) {
  if (!input.id) return
  const { error } = await supabaseService
    .from(table)
    .update({ ...input.patch, updated_at: new Date().toISOString() })
    .eq('company_id', input.companyId)
    .eq('id', input.id)
  if (error && !missingSchema(error)) throw error
}

async function markDispatchBlocked(input: {
  request: FacilityLookupRequestRow
  actorUserId: string | null
  code: string
  message: string
  details?: JsonRecord
}): Promise<FacilityLookupEdifactDispatchResult> {
  const metadata = requestMetadata(input.request)
  await patchRequest({
    companyId: input.request.company_id,
    requestId: input.request.id,
    patch: {
      status: 'needs_review',
      dispatch_status: 'failed',
      dispatch_attempted_at: new Date().toISOString(),
      dispatch_error_code: input.code,
      dispatch_error_message: input.message,
      metadata: {
        ...metadata,
        facility_lookup_edifact_dispatch: {
          status: 'blocked',
          code: input.code,
          message: input.message,
          details: input.details ?? {},
          checked_at: new Date().toISOString(),
        },
      },
    },
  })

  if (input.request.customer_id) {
    // Tenant sees plain Swedish; the raw technical code/message stays in payload
    // for superadmin diagnostics only (PART 6).
    const blockingReasons = Array.isArray((input.details as JsonRecord | undefined)?.blockingReasons)
      ? ((input.details as JsonRecord).blockingReasons as { code: string; message: string }[])
      : [{ code: input.code, message: input.message }]
    await emitCustomerOperationEvent({
      companyId: input.request.company_id,
      customerId: input.request.customer_id,
      customerSiteId: input.request.customer_site_id ?? null,
      actorUserId: input.actorUserId,
      eventType: 'facility_lookup.edifact_blocked',
      title: 'Nätägarbegäran kunde inte köas',
      message: translateBlockingReasonsForTenant(blockingReasons),
      status: 'blocked',
      severity: 'error',
      actionRequired: true,
      source: 'facility_lookup_edifact_dispatch',
      payload: { request_id: input.request.id, code: input.code, technicalMessage: input.message, details: input.details ?? {} },
      idempotencyKey: `facility-lookup-edifact-blocked:${input.request.id}:${input.code}`,
    })
  }

  return {
    requestId: input.request.id,
    status: 'blocked',
    outboundRequestId: clean(input.request.outbound_request_id),
    edielMessageId: clean(input.request.ediel_message_id),
    communicationRouteId: clean(input.request.communication_route_id),
    edielRouteProfileId: clean(input.request.ediel_route_profile_id),
    operationId: clean(input.request.operation_id),
    blockerCode: input.code,
    blockerMessage: input.message,
  }
}

// Business process creates the intent only. The RenderGateway is the sole caller
// of EDIFACT renderers; this module no longer renders PRODAT directly.
async function createFacilityLookupIntent(input: {
  actorUserId: string
  request: FacilityLookupRequestRow
  routeContext: Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>
  routeProfileId: string | null
  operationId: string
}) {
  const reference = compactReference(`FLZ01-${input.request.id.slice(0, 8)}`, 'FLZ01', 20)
  return createEdielMessageIntent({
    actorUserId: input.actorUserId,
    companyId: input.request.company_id,
    environment: input.routeContext.environment,
    market: 'electricity',
    messageFamily: 'PRODAT',
    messageCode: 'Z01',
    businessProcess: 'facility_lookup',
    direction: 'outbound',
    senderEdielId: input.routeContext.senderEdielId,
    senderSubaddress: input.routeContext.senderSubAddress ?? null,
    receiverEdielId: input.routeContext.receiverEdielId,
    receiverSubaddress: input.routeContext.receiverMessageSubAddress ?? input.routeContext.receiverSubAddress ?? null,
    applicationReference: FACILITY_LOOKUP_APPLICATION_REFERENCE,
    // Validate (never override) the route-declared Application Reference against
    // policy at creation: a misconfigured DGI route becomes a controlled blocker.
    routeProfile: { applicationReference: input.routeContext.applicationReference ?? null },
    routeProfileId: input.routeProfileId ?? input.routeContext.route.id,
    communicationRouteId: input.routeContext.route.id,
    customerId: input.request.customer_id,
    customerSiteId: input.request.customer_site_id,
    gridOwnerInformationRequestId: input.request.id,
    operationId: input.operationId,
    // Facility lookup is the documented allowed-missing case for the metering
    // point / facility id: the identifier is requested from the grid owner. It is
    // modelled as null (never a placeholder string).
    facilityId: null,
    meteringPointId: null,
    gridAreaCode: clean(input.request.grid_area_code),
    interchangeReference: reference,
    messageReference: reference,
    transactionReference: compactReference(`FL-${input.request.id.slice(0, 12)}`, 'FL', 25),
    idempotencyKey: `facility-lookup-z01:${input.request.id}`,
    payload: {
      grid_owner_information_request_id: input.request.id,
      operation_id: input.operationId,
      lookupMode: 'customer_site_address_without_facility_identifier',
      allowedMissing: ['facility_id', 'metering_point_id'],
      gridOwnerId: input.request.grid_owner_id,
      priceArea: input.request.price_area,
    },
  })
}

export async function dispatchFacilityLookupEdifact(input: {
  companyId: string
  requestId: string
  actorUserId?: string | null
  environment?: EdielEnvironment | null
  operationId?: string | null
}): Promise<FacilityLookupEdifactDispatchResult> {
  const request = await readFacilityLookupRequest({ companyId: input.companyId, requestId: input.requestId })
  if (!request) {
    return {
      requestId: input.requestId,
      status: 'skipped',
      outboundRequestId: null,
      edielMessageId: null,
      communicationRouteId: null,
      edielRouteProfileId: null,
      operationId: null,
      blockerCode: 'facility_lookup_request_missing',
      blockerMessage: 'Nätägarbegäran hittades inte.',
    }
  }

  const actorUserId = clean(input.actorUserId) ?? clean(request.created_by) ?? 'system'
  const metadata = requestMetadata(request)
  if (['sent', 'waiting_response'].includes(request.status) && request.ediel_message_id && request.outbound_request_id) {
    return {
      requestId: request.id,
      status: 'already_waiting',
      outboundRequestId: clean(request.outbound_request_id),
      edielMessageId: clean(request.ediel_message_id),
      communicationRouteId: clean(request.communication_route_id) ?? clean(metadata.communication_route_id),
      edielRouteProfileId: clean(request.ediel_route_profile_id) ?? clean(metadata.ediel_route_profile_id),
      operationId: clean(request.operation_id) ?? clean(input.operationId),
      blockerCode: null,
      blockerMessage: null,
    }
  }

  if (request.request_type !== 'facility_lookup') {
    return markDispatchBlocked({
      request,
      actorUserId,
      code: 'unsupported_grid_owner_information_request_type',
      message: 'Endast facility_lookup kan skickas via denna Edifact-dispatcher.',
    })
  }
  if (!request.customer_id || !request.customer_site_id || !request.grid_owner_id) {
    return markDispatchBlocked({
      request,
      actorUserId,
      code: 'facility_lookup_missing_required_anchor',
      message: 'Kund, anläggning eller nätägare saknas för nätägarbegäran.',
    })
  }
  if (request.channel !== 'ediel' && clean(metadata.route_source) !== 'company_operational_routes') {
    return markDispatchBlocked({
      request,
      actorUserId,
      code: 'facility_lookup_not_ediel_ready',
      message: 'Nätägarbegäran är inte kopplad till godkänd Ediel-route.',
    })
  }

  const routeReadiness = await evaluateCustomerProcessRouteReadiness({
    companyId: request.company_id,
    customerId: request.customer_id,
    siteId: request.customer_site_id,
    gridOwnerId: request.grid_owner_id,
    process: 'facility_lookup',
    actorUserId,
    emitEvents: false,
  })
  if (!routeReadiness.ready || !routeReadiness.communicationRouteId) {
    return markDispatchBlocked({
      request,
      actorUserId,
      code: routeReadiness.blockers[0]?.code ?? 'facility_lookup_route_not_ready',
      message: routeReadiness.blockers[0]?.message ?? 'Produktionsroute saknas eller är inte godkänd för facility lookup.',
      details: { routeReadiness },
    })
  }

  const existingOutbound = await findExistingDispatchForRequest(request)
  const operationId = clean(input.operationId) ?? clean(request.operation_id) ?? randomUUID()
  const environment = input.environment ?? await resolveOutboundRuntimeEnvironment({
    preferredRouteId: routeReadiness.communicationRouteId,
    explicitEnvironment: input.environment ?? null,
  })
  const gridOwner = await readGridOwner(request.grid_owner_id)

  if (existingOutbound?.id) {
    const responsePayload = isRecord(existingOutbound.response_payload) ? existingOutbound.response_payload : {}
    let existingMessageId = clean(responsePayload.edielMessageId) ?? clean(request.ediel_message_id)

    await safePatch('outbound_requests', {
      companyId: request.company_id,
      id: clean(existingOutbound.id),
      patch: {
        grid_owner_information_request_id: request.id,
        customer_site_id: request.customer_site_id,
        operation_id: clean(existingOutbound.operation_id) ?? operationId,
      },
    })

    if (!existingMessageId) {
      const repairOperationId = clean(existingOutbound.operation_id) ?? operationId
      const routeContext = await resolveCanonicalOutboundContext({
        requestType: 'customer_masterdata',
        gridOwner: gridOwner as never,
        preferredRouteId: clean(existingOutbound.communication_route_id) ?? routeReadiness.communicationRouteId,
        companyId: request.company_id,
        environment,
        messageStandard: 'edifact',
      })
      const intent = await createFacilityLookupIntent({
        actorUserId,
        request,
        routeContext,
        routeProfileId: routeReadiness.routeProfileId,
        operationId: repairOperationId,
      })
      const rendered = await renderAndQueueFacilityLookupZ01({
        intentId: intent.id,
        actorUserId,
        request,
        routeContext,
        outboundRequestId: clean(existingOutbound.id)!,
        operationId: repairOperationId,
      })
      if (rendered.status === 'blocked') {
        return markDispatchBlocked({
          request,
          actorUserId,
          code: rendered.blockingReasons[0]?.code ?? 'facility_lookup_intent_blocked',
          message: rendered.blockingReasons[0]?.message ?? 'Facility lookup-intent blockerades före rendering.',
          details: { intentId: intent.id, blockingReasons: rendered.blockingReasons },
        })
      }
      const message = rendered.message
      existingMessageId = message.id
      // Bridge the legacy outbound row into the intent pipeline: from now on the
      // intent/outbox/message chain is the source of truth for this row.
      await markLegacyOutboundSupersededByIntent({
        companyId: request.company_id,
        outboundRequestId: clean(existingOutbound.id)!,
        intentId: intent.id,
        edielMessageId: message.id,
        actorUserId,
      })
      await safePatch('outbound_requests', {
        companyId: request.company_id,
        id: clean(existingOutbound.id),
        patch: {
          grid_owner_information_request_id: request.id,
          customer_site_id: request.customer_site_id,
          ediel_route_profile_id: routeReadiness.routeProfileId,
          response_payload: {
            ...responsePayload,
            edielMessageId: message.id,
            intentId: intent.id,
            gridOwnerInformationRequestId: request.id,
            operationId: repairOperationId,
            repairedFacilityLookupEdifactDispatch: true,
          },
        },
      })
    }

    await patchRequest({
      companyId: request.company_id,
      requestId: request.id,
      patch: {
        status: existingMessageId ? 'waiting_response' : 'ready_to_send',
        channel: 'ediel',
        dispatch_status: existingMessageId ? 'queued' : 'outbound_created',
        communication_route_id: clean(existingOutbound.communication_route_id) ?? routeReadiness.communicationRouteId,
        ediel_route_profile_id: clean(existingOutbound.ediel_route_profile_id) ?? routeReadiness.routeProfileId,
        outbound_request_id: clean(existingOutbound.id),
        ediel_message_id: existingMessageId,
        operation_id: clean(existingOutbound.operation_id) ?? clean(request.operation_id) ?? operationId,
        metadata: {
          ...metadata,
          reused_existing_outbound: true,
          outbound_request_id: clean(existingOutbound.id),
          ediel_message_id: existingMessageId,
          facility_lookup_edifact_dispatch: {
            status: existingMessageId ? 'repaired_and_queued' : 'already_queued',
            reused_at: new Date().toISOString(),
            outbound_request_id: clean(existingOutbound.id),
            ediel_message_id: existingMessageId,
          },
        },
      },
    })
    return {
      requestId: request.id,
      status: existingMessageId ? 'queued' : 'already_waiting',
      outboundRequestId: clean(existingOutbound.id),
      edielMessageId: existingMessageId,
      communicationRouteId: clean(existingOutbound.communication_route_id) ?? routeReadiness.communicationRouteId,
      edielRouteProfileId: clean(existingOutbound.ediel_route_profile_id) ?? routeReadiness.routeProfileId,
      operationId: clean(existingOutbound.operation_id) ?? clean(request.operation_id) ?? operationId,
      blockerCode: null,
      blockerMessage: null,
    }
  }

  const outbound = await createOutboundRequest({
    actorUserId,
    customerId: request.customer_id,
    siteId: request.customer_site_id,
    meteringPointId: null,
    gridOwnerId: request.grid_owner_id,
    communicationRouteId: routeReadiness.communicationRouteId,
    requestType: 'customer_masterdata',
    sourceType: 'manual',
    sourceId: request.id,
    externalReference: `FLZ01-${request.id.slice(0, 8).toUpperCase()}`,
    automationOrigin: 'facility_lookup_edifact_dispatch',
    automationKey: `facility-lookup-edifact:${request.id}`,
    operationId,
    environment,
    failOnMissingEnvironment: true,
    payload: {
      grid_owner_information_request_id: request.id,
      operation_id: operationId,
      messageFamily: 'PRODAT',
      messageCode: 'Z01',
      // Deterministic single rule source (PART 6): facility lookup is always DDQ.
      // Passing it explicitly keeps the legacy outbound row and route decision from
      // inheriting a DGI route-profile default and producing an expected/actual
      // Application Reference mismatch.
      applicationReference: FACILITY_LOOKUP_APPLICATION_REFERENCE,
      expectedResponse: 'PRODAT Z02 eller negativ APERAK',
      lookupMode: 'facility_lookup_without_identifier',
    },
  })

  if (outbound.status === 'failed') {
    return markDispatchBlocked({
      request,
      actorUserId,
      code: 'outbound_route_decision_blocked',
      message: outbound.failure_reason ?? 'Outbound route decision blockerade nätägarbegäran.',
      details: { outbound_request_id: outbound.id, blocking_reasons: outbound.blocking_reasons ?? [] },
    })
  }

  let intentId: string | null = null
  let rendered: Awaited<ReturnType<typeof renderAndQueueFacilityLookupZ01>>
  let routeContext: Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>
  try {
    routeContext = await resolveCanonicalOutboundContext({
      requestType: 'customer_masterdata',
      gridOwner: gridOwner as never,
      preferredRouteId: routeReadiness.communicationRouteId,
      companyId: request.company_id,
      environment,
      messageStandard: 'edifact',
    })

    const intent = await createFacilityLookupIntent({
      actorUserId,
      request,
      routeContext,
      routeProfileId: routeReadiness.routeProfileId,
      operationId,
    })
    intentId = intent.id
    rendered = await renderAndQueueFacilityLookupZ01({
      intentId: intent.id,
      actorUserId,
      request,
      routeContext,
      outboundRequestId: outbound.id,
      operationId,
    })
  } catch (error) {
    // Unexpected error before/after intent creation must still leave a controlled
    // blocked state on the request (never a silent dispatch_status='ready').
    return markDispatchBlocked({
      request,
      actorUserId,
      code: 'facility_lookup_dispatch_unexpected_error',
      message: error instanceof Error ? error.message : String(error),
      details: { intentId, outbound_request_id: outbound.id },
    })
  }
  if (rendered.status === 'blocked') {
    return markDispatchBlocked({
      request,
      actorUserId,
      code: rendered.blockingReasons[0]?.code ?? 'facility_lookup_intent_blocked',
      message: rendered.blockingReasons[0]?.message ?? 'Facility lookup-intent blockerades före rendering.',
      details: { intentId, blockingReasons: rendered.blockingReasons },
    })
  }
  const message = rendered.message

  await safePatch('outbound_requests', {
    companyId: request.company_id,
    id: outbound.id,
    patch: {
      grid_owner_information_request_id: request.id,
      customer_site_id: request.customer_site_id,
      operation_id: operationId,
      ediel_route_profile_id: routeReadiness.routeProfileId,
      response_payload: {
        ...(outbound.response_payload ?? {}),
        edielMessageId: message.id,
        intentId,
        gridOwnerInformationRequestId: request.id,
        operationId,
      },
    },
  })
  await safePatch('ediel_messages', {
    companyId: request.company_id,
    id: message.id,
    patch: {
      grid_owner_information_request_id: request.id,
      operation_id: operationId,
    },
  })

  await patchRequest({
    companyId: request.company_id,
    requestId: request.id,
    patch: {
      status: 'waiting_response',
      channel: 'ediel',
      template_id: 'facility_lookup.prodat_z01',
      communication_route_id: routeContext.route.id,
      ediel_route_profile_id: routeReadiness.routeProfileId,
      outbound_request_id: outbound.id,
      ediel_message_id: message.id,
      operation_id: operationId,
      dispatch_status: 'queued',
      dispatch_attempted_at: new Date().toISOString(),
      dispatch_error_code: null,
      dispatch_error_message: null,
      metadata: {
        ...metadata,
        auto_send_allowed: true,
        communication_route_id: routeContext.route.id,
        ediel_route_profile_id: routeReadiness.routeProfileId,
        outbound_request_id: outbound.id,
        ediel_message_id: message.id,
        operation_id: operationId,
        facility_lookup_edifact_dispatch: {
          status: 'queued',
          queued_at: new Date().toISOString(),
          outbound_request_id: outbound.id,
          ediel_message_id: message.id,
          communication_route_id: routeContext.route.id,
          ediel_route_profile_id: routeReadiness.routeProfileId,
          environment,
        },
      },
    },
  })
  await safePatch('website_customer_applications', {
    companyId: request.company_id,
    id: request.customer_application_id,
    patch: { status: 'waiting_grid_owner_response' },
  })
  await safePatch('customer_sites', {
    companyId: request.company_id,
    id: request.customer_site_id,
    patch: { facility_data_status: 'waiting_grid_owner_response', next_action: 'wait_for_grid_owner' },
  })

  await emitCustomerOperationEvent({
    companyId: request.company_id,
    customerId: request.customer_id,
    customerSiteId: request.customer_site_id,
    actorUserId,
    eventType: 'facility_lookup.edifact_queued',
    title: 'Nätägarbegäran köad via Ediel',
    message: 'Systemet har skapat PRODAT Z01 och köat utskick via den godkända Ediel-routen. Svar inväntas från nätägaren.',
    status: 'waiting_response',
    severity: 'info',
    actionRequired: false,
    source: 'facility_lookup_edifact_dispatch',
    payload: {
      request_id: request.id,
      outbound_request_id: outbound.id,
      ediel_message_id: message.id,
      operation_id: operationId,
      communication_route_id: routeContext.route.id,
      ediel_route_profile_id: routeReadiness.routeProfileId,
    },
    idempotencyKey: `facility-lookup-edifact-queued:${request.id}:${message.id}`,
  })

  return {
    requestId: request.id,
    status: 'queued',
    outboundRequestId: outbound.id,
    edielMessageId: message.id,
    communicationRouteId: routeContext.route.id,
    edielRouteProfileId: routeReadiness.routeProfileId,
    operationId,
    blockerCode: null,
    blockerMessage: null,
  }
}

export async function processReadyFacilityLookupEdifactDispatches(input: {
  companyId?: string | null
  actorUserId?: string | null
  limit?: number
  environment?: EdielEnvironment | null
} = {}) {
  let query = supabaseService
    .from('grid_owner_information_requests')
    .select('*')
    .eq('request_type', 'facility_lookup')
    .in('status', ['ready_to_send', 'waiting_response'])
    .eq('channel', 'ediel')
    .order('updated_at', { ascending: true })
    .limit(Math.min(Math.max(input.limit ?? 10, 1), 50))
  if (input.companyId) query = query.eq('company_id', input.companyId)

  const { data, error } = await query
  if (error) {
    if (missingSchema(error)) return { candidates: 0, queued: 0, blocked: 0, skipped: 0, errors: ['facility_lookup_dispatch_schema_missing'] }
    throw error
  }

  const rows = ((data ?? []) as FacilityLookupRequestRow[]).filter((row) => {
    const metadata = requestMetadata(row)
    const autoAllowed = metadata.auto_send_allowed === true || clean(metadata.route_source) === 'company_operational_routes'
    if (!autoAllowed) return false
    if (row.status === 'ready_to_send') return true
    return row.status === 'waiting_response' && Boolean(row.outbound_request_id) && !row.ediel_message_id
  })
  let queued = 0
  let blocked = 0
  let skipped = 0
  const errors: string[] = []

  for (const row of rows) {
    try {
      const result = await dispatchFacilityLookupEdifact({
        companyId: row.company_id,
        requestId: row.id,
        actorUserId: input.actorUserId ?? row.created_by ?? null,
        environment: input.environment ?? null,
      })
      if (result.status === 'queued' || result.status === 'already_waiting') queued += 1
      else if (result.status === 'blocked' || result.status === 'failed') blocked += 1
      else skipped += 1
    } catch (error) {
      errors.push(`${row.id}: ${error instanceof Error ? error.message : String(error)}`)
      blocked += 1
    }
  }

  return { candidates: rows.length, queued, blocked, skipped, errors }
}
