import {requireDataRequestStructure} from '@/lib/ediel/sources/dataRequestStructure'
import {dataRequestLegalParties} from '@/lib/ediel/sources/dataRequestLegalParties'
import { supabaseService } from '@/lib/supabase/service'
import { getCustomerSiteById, getGridOwnerById, getMeteringPointById } from '@/lib/masterdata/db'
import { buildUtiltsOutboundDraft } from '@/lib/ediel/utilts'
import { buildEdielInterchangeReference } from '@/lib/ediel/references'
import { createEdielMessageIntent } from '@/lib/ediel/intent/intentEngine'
import { prodatDate203 } from '@/lib/ediel/prodat/render/dates'
import { resolveDecisionBackedOutboundContext } from '@/lib/ediel/flows/routeDecisionContext'
import {
  ensureActorUserId,
  finalizeOutboundDraft,
  findOrCreateDataRequestOutbound,
  getGridOwnerDataRequestById,
  makeServerClient,
  resolveOutboundRuntimeEnvironment,
} from '@/lib/ediel/flows/shared'
import type { EdielEnvironment, EdielMessageRow } from '@/lib/ediel/types'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import {
  assertCanonicalSupplierUtiltsOutboundAllowed,
  canonicalSupplierUtiltsApplicationReference,
  type UtiltsRequestedMessageCode,
} from '@/lib/ediel/rulebook/canonicalEdielFacade'
import type { GridOwnerDataRequestRow } from '@/lib/cis/types'
import { normalizeMeteringResolution } from '@/lib/metering/contractMeteringResolution'
import { stockholmMonthBounds } from '@/lib/time/stockholm'
import { CUSTOMER_CALENDAR_E73_ORIGIN, customerCalendarE73Period } from '@/lib/ediel/flows/e73CustomerCalendar'
import { assertEdielTenantActor } from '@/lib/ediel/services/authorization'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function requestedMessageForDataRequest(input: {
  requestScope: string
  requestPayload: Record<string, unknown>
}): UtiltsRequestedMessageCode {
  const explicit = String(
    input.requestPayload.requestedMessageCode
      ?? input.requestPayload.requested_message_code
      ?? input.requestPayload.requestedApplication
      ?? '',
  ).trim().toUpperCase()

  if (explicit === 'S02' || explicit === 'E66') return explicit
  if (explicit) throw new Error(`utilts_e73_requested_message_unsupported:${explicit}`)

  // The current CIS scope `meter_values` represents missing validated metering
  // values. Forecast/planning requests must explicitly state S02 in request_payload.
  if (input.requestScope === 'meter_values') return 'E66'
  throw new Error('utilts_e73_requested_message_required')
}

function requestedDeliveryPeriod(request: GridOwnerDataRequestRow, requestedCode: UtiltsRequestedMessageCode) {
  if (request.automation_origin === CUSTOMER_CALENDAR_E73_ORIGIN) {
    const period = customerCalendarE73Period(request.requested_period_start, request.requested_period_end)
    const payload = record(request.request_payload)
    if (requestedCode !== 'E66' || request.request_scope !== 'meter_values' || !request.authorization_document_id
      || period.start !== payload.delivery_period_start || period.end !== payload.delivery_period_end) {
      throw new Error('utilts_e73_customer_period_source_mismatch')
    }
    return period
  }
  if (request.automation_origin !== 'metering_market_data_autopilot_v1'
    && request.automation_origin !== 'staff_bulk_metering_v1') {
    return { start: request.requested_period_start, end: request.requested_period_end }
  }

  // The monthly producer saves its original UTC instants in request_payload.
  // The sibling DATE columns keep their existing lookup and duplicate keys.
  const payload = record(request.request_payload)
  const month = typeof payload.billing_month === 'string' ? payload.billing_month : ''
  const sourceMismatch = 'utilts_e73_monthly_period_source_mismatch'
  if (requestedCode !== 'E66' || request.request_scope !== 'meter_values' || !request.metering_point_id
    || request.automation_key !== `meter-values:${request.company_id}:${request.metering_point_id}:${month}`) {
    throw new Error(sourceMismatch)
  }

  let bounds: ReturnType<typeof stockholmMonthBounds>
  try {
    bounds = stockholmMonthBounds(month)
  } catch {
    throw new Error(sourceMismatch)
  }

  if (payload.time_zone !== bounds.timeZone || payload.requested_period_start !== bounds.start
    || payload.requested_period_end !== bounds.end
    || request.requested_period_start !== bounds.start.slice(0, 10)
    || request.requested_period_end !== bounds.end.slice(0, 10)) {
    throw new Error(sourceMismatch)
  }

  return { start: payload.requested_period_start, end: payload.requested_period_end }
}

async function enqueueSealedE73(input: {
  companyId: string
  actorUserId: string
  environment: EdielEnvironment
  requestId: string
  messageId?: string
}): Promise<EdielMessageRow> {
  const { data, error } = await supabaseService.rpc('gridex_queue_prepared_supplier_e73_v1', {
    p_company_id: input.companyId,
    p_actor_user_id: input.actorUserId,
    p_request_id: input.requestId,
    p_environment: input.environment,
    p_message_id: input.messageId ?? null,
  })
  if (error) throw error
  const receipt = data as { message?: EdielMessageRow } | null
  if (!receipt?.message?.id || (input.messageId && receipt.message.id !== input.messageId)) {
    throw new Error('supplier_e73_queue_receipt_required')
  }
  return receipt.message
}

async function readCustomerCalendarOriginal(input: {
  companyId: string
  actorUserId: string
  environment: EdielEnvironment
  dataRequest: GridOwnerDataRequestRow
  routeId: string | null
  period: { start: string; end: string }
}): Promise<EdielMessageRow | null> {
  await assertEdielTenantActor({ companyId: input.companyId, actorUserId: input.actorUserId, permission: 'communication.write' })
  const { data, error } = await supabaseService.rpc('gridex_read_customer_calendar_e73_original_v1', {
    p_company_id: input.companyId,
    p_actor_user_id: input.actorUserId,
    p_request_id: input.dataRequest.id,
    p_environment: input.environment,
    p_expected_route_id: input.routeId,
  })
  if (error?.code === 'PT409' && error.message === 'utilts_e73_original_queue_recovery_required') {
    return enqueueSealedE73({
      companyId: input.companyId, actorUserId: input.actorUserId, environment: input.environment,
      requestId: input.dataRequest.id,
    })
  }
  if (error) throw error
  if (!data) return null
  const message = data as EdielMessageRow
  if (!message.raw_payload) throw new Error('utilts_e73_original_scope_mismatch')

  const wire = tokenizeEdifact(message.raw_payload)
  const timestamps = wire.segments.filter(segment => segment.tag === 'DTM').map(segment => segmentComposite(segment, 1, wire.una))
  const periods = timestamps.filter(parts => parts[0] === '324')
  const offsets = timestamps.filter(parts => parts[0] === '735')
  const documentCode = wire.segments.find(segment => segment.tag === 'BGM')
  const start = prodatDate203(input.period.start)
  const end = prodatDate203(input.period.end)
  if (!documentCode || segmentComposite(documentCode, 1, wire.una)[0] !== 'E73'
    || !start || !end || periods.length !== 1 || periods[0][1] !== start + end || periods[0][2] !== '719'
    || offsets.length !== 1 || offsets[0][1] !== '+0100' || offsets[0][2] !== '406') {
    throw new Error('utilts_e73_original_period_mismatch')
  }

  return message
}

async function requireBilateralE73Capability(input: {
  companyId: string
  environment: EdielEnvironment
}): Promise<string> {
  const now = new Date().toISOString()
  const { data, error } = await supabaseService
    .from('tenant_message_capabilities')
    .select('id,valid_from,valid_to,metadata')
    .eq('company_id', input.companyId)
    .eq('environment', input.environment)
    .eq('message_family', 'UTILTS')
    .eq('message_code', 'E73')
    .eq('direction', 'outbound')
    .eq('is_enabled', true)
    .eq('bilateral', true)
    .limit(20)

  if (error) throw error
  const active = (data ?? []).filter((row) => {
    const validFrom = text((row as { valid_from?: string | null }).valid_from)
    const validTo = text((row as { valid_to?: string | null }).valid_to)
    return (!validFrom || validFrom <= now) && (!validTo || validTo > now)
  })

  if (active.length !== 1) {
    throw new Error(
      active.length === 0
        ? `utilts_e73_bilateral_capability_missing:${input.environment}`
        : `utilts_e73_bilateral_capability_ambiguous:${active.length}`,
    )
  }
  return String(active[0].id)
}

export async function prepareAndQueueUtiltsE73(params: {
  actorUserId: string
  gridOwnerDataRequestId: string
  communicationRouteId?: string | null
  environment?: EdielEnvironment | null
  staffBulkDispatchToken?: string | null
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const supabase = await makeServerClient()
  const dataRequest = await getGridOwnerDataRequestById(params.gridOwnerDataRequestId)
  if (!dataRequest) throw new Error('Grid owner data request hittades inte')

  const companyId = dataRequest.company_id
  if (!companyId) throw new Error('UTILTS E73 stoppades: nätägarbegäran saknar company_id.')
  await requireCompanyOperationalForWrites(companyId)

  const environment = await resolveOutboundRuntimeEnvironment({
    companyId,
    preferredRouteId: params.communicationRouteId ?? null,
    explicitEnvironment: params.environment ?? null,
  })
  const customerCalendar = dataRequest.automation_origin === CUSTOMER_CALENDAR_E73_ORIGIN
  if (customerCalendar) {
    if (params.environment !== environment || record(dataRequest.request_payload).ediel_environment !== environment) {
      throw new Error('utilts_e73_customer_environment_source_mismatch')
    }
    const { start, end } = requestedDeliveryPeriod(dataRequest, 'E66')
    if (!start || !end) throw new Error('utilts_e73_customer_period_source_mismatch')
    const original = await readCustomerCalendarOriginal({
      companyId, actorUserId, environment, dataRequest, period: { start, end }, routeId: params.communicationRouteId ?? null,
    })
    if (original) return original
  }
  if (dataRequest.automation_origin === 'staff_bulk_metering_v1') {
    if (record(dataRequest.request_payload).ediel_environment !== environment) {
      throw new Error('utilts_e73_staff_environment_source_mismatch')
    }
    if (!params.staffBulkDispatchToken) throw new Error('utilts_e73_staff_dispatch_claim_required')
    const claim = await supabaseService.rpc('gridex_check_staff_bulk_metering_e73_claim_v1', {
      p_company_id: companyId,
      p_actor_user_id: actorUserId,
      p_request_id: dataRequest.id,
      p_environment: environment,
      p_token: params.staffBulkDispatchToken,
    })
    if (claim.error) throw claim.error
    if (claim.data !== true) throw new Error('utilts_e73_staff_dispatch_claim_required')
  }
  const bilateralCapabilityId = await requireBilateralE73Capability({ companyId, environment })
  const requestedMessageCode = requestedMessageForDataRequest({
    requestScope: dataRequest.request_scope,
    requestPayload: record(dataRequest.request_payload),
  })

  assertCanonicalSupplierUtiltsOutboundAllowed({
    code: 'E73',
    bilateralCapabilityVerified: true,
    requestedMessageCode,
  })

  const site = dataRequest.site_id ? await getCustomerSiteById(supabase, dataRequest.site_id) : null
  const meteringPoint = dataRequest.metering_point_id
    ? await getMeteringPointById(supabase, dataRequest.metering_point_id)
    : null
  const gridOwner = dataRequest.grid_owner_id
    ? await getGridOwnerById(supabase, dataRequest.grid_owner_id)
    : null

  // The contract's requested resolution (set when the data request was created)
  // travels with the request; the wire resolution stays bound to the qualified
  // dated meter structure below.
  const contractRequestedResolution = normalizeMeteringResolution(
    record(dataRequest.request_payload).requested_resolution,
  )

  // Route/actor selection happens first. The selected route may carry an exact
  // field-311 Application Reference, but it is NOT authoritative by itself: the
  // canonical 25-A-3 registry below validates it against the requested message.
  // This intentionally removes the old `quarter_hour => T, otherwise S`
  // heuristic. For multi-valued E66 an exact configured candidate is required.
  const routeContext = await resolveDecisionBackedOutboundContext({
    requestType: 'meter_values',
    gridOwner,
    preferredRouteId: params.communicationRouteId ?? null,
    companyId,
    customerId: dataRequest.customer_id,
    siteId: dataRequest.site_id,
    meteringPointId: dataRequest.metering_point_id,
    dataRequestId: dataRequest.id,
    environment,
    messageFamily: 'UTILTS',
    messageCode: 'E73',
    messageStandard: 'edifact',
    actorUserId,
    payload: {
      requestScope: dataRequest.request_scope,
      requestedMessageCode,
      bilateralCapabilityVerified: true,
      bilateralCapabilityId,
      requestedPeriodStart: dataRequest.requested_period_start,
      requestedPeriodEnd: dataRequest.requested_period_end,
    },
  })

  const applicationReference = canonicalSupplierUtiltsApplicationReference({
    code: 'E73',
    requestedMessageCode,
    applicationReference: routeContext.applicationReference,
  })

  const legalParties = dataRequestLegalParties({ companyId, environment, route: routeContext, networkEdielId: gridOwner?.ediel_id })
  const period = requestedDeliveryPeriod(dataRequest, requestedMessageCode)
  // Validate at the minute precision the builder uses for DTM+324/719.
  // Distinct input instants can still render as the same market minute.
  const startMinute = prodatDate203(period.start)
  const endMinute = prodatDate203(period.end)
  if (!startMinute || !endMinute || startMinute >= endMinute) {
    throw new Error('utilts_e73_delivery_period_invalid')
  }

  const sourceStructure=await requireDataRequestStructure({companyId,actorUserId,environment,customerId:dataRequest.customer_id,siteId:dataRequest.site_id,meteringPointId:dataRequest.metering_point_id,
    periodStart:period.start,periodEnd:period.end,...legalParties})
  const operationId = dataRequest.operation_id ?? dataRequest.id
  const requestReference = `E73${dataRequest.id.replaceAll('-', '').toUpperCase()}`
  const routeProfileId = text(routeContext.routeRuntime?.route_profile_id)
  const facilityId = text(site?.facility_id)
  const meterIdentifier = text(meteringPoint?.meter_point_id)
  const createdAt = new Date(dataRequest.requested_at)
  if (!routeProfileId || !meterIdentifier || !dataRequest.site_id || !Number.isFinite(createdAt.getTime())) {
    throw new Error('utilts_e73_intent_source_required')
  }
  const intent = await createEdielMessageIntent({
    supplierE73InsertOnly: true,
    actorUserId, companyId, environment, market: 'electricity', messageFamily: 'UTILTS', messageCode: 'E73',
    businessProcess: 'metering_values', direction: 'outbound',
    senderEdielId: routeContext.senderEdielId, senderSubaddress: routeContext.senderSubAddress,
    receiverEdielId: routeContext.receiverEdielId, receiverSubaddress: routeContext.receiverSubAddress,
    applicationReference, routeProfileId, communicationRouteId: routeContext.route.id,
    customerId: dataRequest.customer_id, customerSiteId: dataRequest.site_id, operationId,
    facilityId, meteringPointId: meterIdentifier, interchangeReference: buildEdielInterchangeReference(),
    messageReference: '1', transactionReference: requestReference, idempotencyKey: `utilts-e73:${dataRequest.id}`,
    payload: {
      grid_owner_data_request_id: dataRequest.id,
      authorization_document_id: dataRequest.authorization_document_id ?? null,
      requestedMessageCode,
      periodStart: period.start,
      periodEnd: period.end,
    },
  })
  if (intent.validationStatus !== 'validated') throw new Error(intent.blockingReasons?.[0]?.code ?? 'utilts_e73_intent_not_validated')

  const outbound = await findOrCreateDataRequestOutbound({
    actorUserId,
    requestType: 'meter_values',
    communicationRouteId: routeContext.route.id,
    environment,
    failOnMissingEnvironment: true,
    operationId,
    dataRequest,
    payload: {
      edielCode: 'E73',
      queuedFrom: 'prepare_supplier_utilts_e73',
      requestedMessageCode,
      bilateralCapabilityVerified: true,
      bilateralCapabilityId,
      applicationReference,
      requestScope: dataRequest.request_scope,
      requestedPeriodStart: period.start,
      requestedPeriodEnd: period.end,
      communicationRouteId: routeContext.route.id,
    },
  })

  const draft = await buildUtiltsOutboundDraft({
    actorUserId,
    code: 'E73',
    environment,
    communicationRouteId: routeContext.route.id,
    customerId: dataRequest.customer_id,
    siteId: dataRequest.site_id,
    meteringPointId: dataRequest.metering_point_id,
    gridOwnerId: dataRequest.grid_owner_id,
    outboundRequestId: outbound.id,
    gridOwnerDataRequestId: dataRequest.id,
    senderEdielId: routeContext.senderEdielId,
    senderName: routeContext.senderName,
    receiverEdielId: routeContext.receiverEdielId,
    receiverName: routeContext.receiverName,
    senderSubAddress: routeContext.senderSubAddress,
    receiverSubAddress: routeContext.receiverSubAddress,
    mailbox: routeContext.mailbox,
    receiverEmail: routeContext.receiverEmail,
    routeDefaultMessageVersion: routeContext.defaultMessageVersion,
    applicationReference,
    externalReference: requestReference,
    transactionReference: requestReference,
    interchangeReference: intent.interchangeReference,
    messageReference: intent.messageReference,
    createdAt,
    payload: {
      legalSenderEdielId: sourceStructure.legalSupplier,
      legalReceiverEdielId: sourceStructure.legalNetwork,
      meterPointId: meteringPoint?.meter_point_id ?? null,
      meteringPointId: meteringPoint?.meter_point_id ?? null,
      gridAreaId: gridOwner?.owner_code ?? gridOwner?.ediel_id ?? null,
      requestedMessageCode,
      bilateralCapabilityVerified: true,
      bilateralCapabilityId,
      applicationReferencePolicyKey: applicationReference,
      marketSemanticVersion: 'swedish-utilts-canonical-25-a-3',
      requestedPeriodStart: period.start,
      requestedPeriodEnd: period.end,
      periodStart: period.start,
      periodEnd: period.end,
      transactionReason: `Request missing ${requestedMessageCode}`,
      requestScope: dataRequest.request_scope,
      siteType: site?.site_type ?? 'consumption',
      readingFrequency: sourceStructure.fields.reportingFrequency,
      measurementMethod:sourceStructure.fields.measurementMethod,
      timeSeriesProduct:sourceStructure.fields.productCode,
      structuralSource:{snapshotId:sourceStructure.snapshotId,readsetHash:sourceStructure.readsetHash,selection:sourceStructure.selection},
      resolution:sourceStructure.resolution,
      requestedResolution: contractRequestedResolution,
    },
  })

  draft.sourceOperationId = operationId
  draft.intentId = intent.id

  const message = await finalizeOutboundDraft({
    actorUserId,
    requestType: 'meter_values',
    routeContext,
    draft,
    outboundRequestId: outbound.id,
    duplicateCheck: {
      sourceType: 'grid_owner_data_request',
      sourceId: dataRequest.id,
      receiverEdielId: routeContext.receiverEdielId,
      messageFamily: draft.messageFamily,
      messageCode: String(draft.messageCode),
      messageVersion: draft.messageVersion ?? null,
      periodStart: dataRequest.requested_period_start,
      periodEnd: dataRequest.requested_period_end,
    },
  })

  return enqueueSealedE73({
    actorUserId, companyId, environment, requestId: dataRequest.id, messageId: message.id,
  })
}

type BlockedSupplierE66Params = {
  actorUserId: string
  gridOwnerDataRequestId: string
  communicationRouteId?: string | null
  environment?: EdielEnvironment | null
  quantity?: number | null
  periodStart?: string | null
  periodEnd?: string | null
  registrationTime?: string | null
}

export async function prepareAndQueueUtiltsE66(
  _params?: BlockedSupplierE66Params,
): Promise<Awaited<ReturnType<typeof prepareAndQueueUtiltsE73>>> {
  // E66 is grid-owner-originated validated metering data. Gridex in supplier
  // role must never originate it from a data-request workflow. The compatibility
  // signature keeps legacy call sites compilable while the runtime remains fail-closed.
  throw new Error('utilts_e66_supplier_outbound_not_allowed')
}
