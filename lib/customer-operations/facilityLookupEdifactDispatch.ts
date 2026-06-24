import { randomUUID } from 'node:crypto'
import { createOutboundRequest } from '@/lib/cis/db'
import { getCustomerExportContext, requireContextCompanyId } from '@/lib/cis/db-shared'
import { supabaseService } from '@/lib/supabase/service'
import { evaluateCustomerProcessRouteReadiness } from '@/lib/customer-operations/customerProcessRouteReadiness'
import { emitCustomerOperationEvent } from '@/lib/customers/customerOperationEvents'
import { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import { buildEdifactEnvelope } from '@/lib/ediel/messages'
import { inferEdielFileName } from '@/lib/ediel/classify'
import { renderProdat26A } from '@/lib/ediel/prodatEngine'
import { computeOutboundAckDueAt, deriveEdielAckDefaults } from '@/lib/ediel/references'
import { resolveCanonicalOutboundVersion } from '@/lib/ediel/core/versionRegistry'
import {
  finalizeOutboundDraft,
  queuePreparedEdielMessage,
  resolveOutboundRuntimeEnvironment,
} from '@/lib/ediel/flows/shared'
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

function date102(value?: string | null): string | null {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length >= 8 ? digits.slice(0, 8) : null
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

function customerName(customer: JsonRecord | null | undefined): string {
  const name = sanitize(
    customer?.company_name ??
      customer?.full_name ??
      [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') ??
      customer?.customer_number ??
      'Kund',
  )
  return name || 'Kund'
}

function customerIdentifier(customer: JsonRecord | null | undefined): { id: string | null; qualifier: string | null } {
  const id = sanitize(customer?.personal_number ?? customer?.org_number ?? customer?.customer_number ?? '')
  if (!id) return { id: null, qualifier: null }
  return {
    id,
    qualifier: customer?.org_number ? '1' : id.length === 10 ? 'SE1' : 'SE2',
  }
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
    await emitCustomerOperationEvent({
      companyId: input.request.company_id,
      customerId: input.request.customer_id,
      customerSiteId: input.request.customer_site_id ?? null,
      actorUserId: input.actorUserId,
      eventType: 'facility_lookup.edifact_blocked',
      title: 'Nätägarbegäran kunde inte köas',
      message: input.message,
      status: 'blocked',
      severity: 'error',
      actionRequired: true,
      source: 'facility_lookup_edifact_dispatch',
      payload: { request_id: input.request.id, code: input.code, details: input.details ?? {} },
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

async function buildFacilityLookupDraft(input: {
  actorUserId: string
  request: FacilityLookupRequestRow
  routeContext: Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>
  outboundRequestId: string
  operationId: string
  gridOwner: JsonRecord | null
}) {
  if (!input.request.customer_id || !input.request.customer_site_id) {
    throw new Error('facility_lookup_missing_customer_or_site')
  }

  const context = await getCustomerExportContext({
    customerId: input.request.customer_id,
    siteId: input.request.customer_site_id,
    meteringPointId: null,
  })
  const companyId = requireContextCompanyId(context, 'Bygg facility lookup PRODAT Z01')
  const customer = (context.customer ?? null) as unknown as JsonRecord | null
  const site = (context.site ?? null) as unknown as JsonRecord | null
  const identity = customerIdentifier(customer)
  const externalReference = compactReference(`FLZ01-${input.request.id.slice(0, 8)}`, 'FLZ01', 20)
  const transactionReference = compactReference(`FL-${input.request.id.slice(0, 12)}`, 'FL', 25)
  const messageVersion = (await resolveCanonicalOutboundVersion({
    family: 'PRODAT',
    code: 'Z01',
    standard: 'edifact',
    fallback: '26A',
    routeDefaultMessageVersion: input.routeContext.defaultMessageVersion ?? null,
    environment: input.routeContext.environment,
  })) ?? '26A'
  const messageVersionToken = messageVersion === '26A' ? 'E2SE6A' : messageVersion

  // This dispatcher is intentionally only for the facility-lookup gap: the
  // customer/site/grid-owner are known, but the facility/metering identifier is
  // not. The placeholder is visible in validation_report and parsed_payload so
  // the ordinary supplier-switch Z01 preflight remains strict and unchanged.
  const meterPointPlaceholder = 'UNKNOWN'
  const rendered = renderProdat26A({
    context: {
      code: 'Z01',
      bgmReference: externalReference,
      transactionReference,
      senderEdielId: input.routeContext.senderEdielId,
      receiverEdielId: input.routeContext.receiverEdielId,
      customerName: customerName(customer),
      customerId: identity.id,
      customerIdCodeListQualifier: identity.qualifier,
      meterPointId: meterPointPlaceholder,
      gridAreaId: clean(input.request.grid_area_code) ?? clean(site?.grid_area_code) ?? clean(input.gridOwner?.owner_code),
      startDate: date102(clean(site?.move_in_date)) ?? new Date().toISOString().slice(0, 10).replace(/-/g, ''),
      customerAddress: clean(site?.street),
      customerPostalCode: clean(site?.postal_code),
      customerCity: clean(site?.city),
      customerCountry: clean(site?.country) ?? 'SE',
      siteAddress: clean(site?.street),
      sitePostalCode: clean(site?.postal_code),
      siteCity: clean(site?.city),
      siteCountry: clean(site?.country) ?? 'SE',
      reasonForTransaction: 'Z22',
      powerOfAttorneyReference: externalReference,
    },
  })

  const envelope = buildEdifactEnvelope({
    senderEdielId: input.routeContext.senderEdielId,
    senderSubAddress: input.routeContext.senderSubAddress,
    receiverEdielId: input.routeContext.receiverEdielId,
    receiverSubAddress: input.routeContext.receiverMessageSubAddress ?? input.routeContext.receiverSubAddress,
    applicationReference: input.routeContext.applicationReference,
    testFlag: input.routeContext.environment === 'production' ? 0 : 1,
    messageTypeToken: `PRODAT:D:97A:UN:${messageVersionToken}`,
    segments: rendered.segments,
  })
  const ack = deriveEdielAckDefaults({ family: 'PRODAT', code: 'Z01' })

  return {
    actorUserId: input.actorUserId,
    companyId,
    direction: 'outbound' as const,
    messageStandard: 'edifact' as const,
    messageFamily: 'PRODAT' as const,
    messageCode: 'Z01',
    messageVersion,
    processType: 'facility_lookup_request',
    environment: input.routeContext.environment,
    testFlag: input.routeContext.environment === 'production' ? 0 as const : 1 as const,
    status: 'draft' as const,
    transportType: 'smtp' as const,
    mailbox: input.routeContext.mailbox,
    senderEdielId: input.routeContext.senderEdielId,
    senderName: input.routeContext.senderName,
    receiverEdielId: input.routeContext.receiverEdielId,
    receiverName: input.routeContext.receiverName,
    senderSubAddress: input.routeContext.senderSubAddress,
    receiverSubAddress: input.routeContext.receiverMessageSubAddress ?? input.routeContext.receiverSubAddress,
    receiverEmail: input.routeContext.receiverEmail,
    subject: `PRODAT Z01 facility lookup ${externalReference}`,
    fileName: inferEdielFileName({ family: 'PRODAT', code: 'Z01', direction: 'outbound', extension: 'edi' }),
    mimeType: 'application/edifact',
    interchangeReference: envelope.interchangeReference,
    externalReference,
    transactionReference,
    applicationReference: input.routeContext.applicationReference,
    communicationRouteId: input.routeContext.route.id,
    outboundRequestId: input.outboundRequestId,
    customerId: input.request.customer_id,
    siteId: input.request.customer_site_id,
    meteringPointId: null,
    gridOwnerId: input.request.grid_owner_id,
    rawPayload: envelope.raw,
    parsedPayload: {
      draftType: 'facility_lookup_prodat_z01_outbound',
      processLabel: 'facility_lookup_request',
      grid_owner_information_request_id: input.request.id,
      operation_id: input.operationId,
      lookupMode: 'customer_site_address_without_facility_identifier',
      placeholderMeterPointId: meterPointPlaceholder,
      requestedFields: ['facility_id', 'metering_point_id', 'grid_area_code', 'price_area'],
      expectedResponse: 'CONTRL/APERAK och därefter PRODAT Z02 eller negativ APERAK',
      gridOwnerId: input.request.grid_owner_id,
      gridAreaCode: input.request.grid_area_code,
      priceArea: input.request.price_area,
      prodatEngine: rendered.diagnostics,
      prodatAckExpectation: rendered.ackExpectation ?? null,
    },
    validationReport: {
      status: 'warning',
      checkedAt: new Date().toISOString(),
      facilityLookupDispatch: true,
      placeholderMeterPointId: meterPointPlaceholder,
      reason: 'Facility/metering identifier saknas och begärs från nätägaren.',
      prodatEngine: rendered.diagnostics,
      prodatAckExpectation: rendered.ackExpectation ?? null,
      engineIssues: rendered.issues,
      payloadPreflight: envelope.payloadPreflight,
    },
    requiresContrl: ack.requiresContrl,
    requiresAperak: ack.requiresAperak,
    contrlStatus: ack.contrlStatus,
    aperakStatus: ack.aperakStatus,
    utiltsErrStatus: ack.utiltsErrStatus,
    ackDueAt: computeOutboundAckDueAt({
      requiresContrl: ack.requiresContrl,
      requiresAperak: ack.requiresAperak,
      contrlStatus: ack.contrlStatus,
      aperakStatus: ack.aperakStatus,
      utiltsErrStatus: ack.utiltsErrStatus,
    }),
    syntaxCheckStatus: 'not_checked',
    functionalCheckStatus: 'not_checked',
  }
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
  if (['sent', 'waiting_response'].includes(request.status) && (request.ediel_message_id || request.outbound_request_id)) {
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
  if (existingOutbound?.id) {
    const responsePayload = isRecord(existingOutbound.response_payload) ? existingOutbound.response_payload : {}
    const existingMessageId = clean(responsePayload.edielMessageId) ?? clean(request.ediel_message_id)
    await patchRequest({
      companyId: request.company_id,
      requestId: request.id,
      patch: {
        status: 'waiting_response',
        channel: 'ediel',
        dispatch_status: 'queued',
        communication_route_id: clean(existingOutbound.communication_route_id) ?? routeReadiness.communicationRouteId,
        ediel_route_profile_id: clean(existingOutbound.ediel_route_profile_id) ?? routeReadiness.routeProfileId,
        outbound_request_id: clean(existingOutbound.id),
        ediel_message_id: existingMessageId,
        operation_id: clean(existingOutbound.operation_id) ?? clean(request.operation_id) ?? clean(input.operationId),
        metadata: {
          ...metadata,
          reused_existing_outbound: true,
          outbound_request_id: clean(existingOutbound.id),
          ediel_message_id: existingMessageId,
          facility_lookup_edifact_dispatch: {
            status: 'already_queued',
            reused_at: new Date().toISOString(),
            outbound_request_id: clean(existingOutbound.id),
            ediel_message_id: existingMessageId,
          },
        },
      },
    })
    return {
      requestId: request.id,
      status: 'already_waiting',
      outboundRequestId: clean(existingOutbound.id),
      edielMessageId: existingMessageId,
      communicationRouteId: clean(existingOutbound.communication_route_id) ?? routeReadiness.communicationRouteId,
      edielRouteProfileId: clean(existingOutbound.ediel_route_profile_id) ?? routeReadiness.routeProfileId,
      operationId: clean(existingOutbound.operation_id) ?? clean(request.operation_id) ?? clean(input.operationId),
      blockerCode: null,
      blockerMessage: null,
    }
  }

  const operationId = clean(input.operationId) ?? clean(request.operation_id) ?? randomUUID()
  const environment = input.environment ?? await resolveOutboundRuntimeEnvironment({
    preferredRouteId: routeReadiness.communicationRouteId,
    explicitEnvironment: input.environment ?? null,
  })
  const gridOwner = await readGridOwner(request.grid_owner_id)
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

  const routeContext = await resolveCanonicalOutboundContext({
    requestType: 'customer_masterdata',
    gridOwner: gridOwner as never,
    preferredRouteId: routeReadiness.communicationRouteId,
    companyId: request.company_id,
    environment,
    messageStandard: 'edifact',
  })
  const draft = await buildFacilityLookupDraft({
    actorUserId,
    request,
    routeContext,
    outboundRequestId: outbound.id,
    operationId,
    gridOwner,
  })
  const message = await finalizeOutboundDraft({
    actorUserId,
    requestType: 'customer_masterdata',
    routeContext,
    draft,
    outboundRequestId: outbound.id,
    duplicateCheck: {
      sourceType: 'grid_owner_information_request',
      sourceId: request.id,
      receiverEdielId: routeContext.receiverEdielId,
      messageFamily: 'PRODAT',
      messageCode: 'Z01',
      messageVersion: draft.messageVersion,
    },
  })

  await queuePreparedEdielMessage({
    actorUserId,
    messageId: message.id,
    outboundRequestId: outbound.id,
    externalReference: message.external_reference ?? draft.externalReference,
    payload: {
      gridOwnerInformationRequestId: request.id,
      operationId,
      messageFamily: 'PRODAT',
      messageCode: 'Z01',
      routeId: routeContext.route.id,
      dispatchKind: 'facility_lookup_edifact',
    },
  })

  await safePatch('outbound_requests', {
    companyId: request.company_id,
    id: outbound.id,
    patch: {
      grid_owner_information_request_id: request.id,
      operation_id: operationId,
      ediel_route_profile_id: routeReadiness.routeProfileId,
      response_payload: {
        ...(outbound.response_payload ?? {}),
        edielMessageId: message.id,
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
    .eq('status', 'ready_to_send')
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
    return metadata.auto_send_allowed === true || clean(metadata.route_source) === 'company_operational_routes'
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
