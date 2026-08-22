import { supabaseService } from '@/lib/supabase/service'
import { getCustomerSiteById, getGridOwnerById, getMeteringPointById } from '@/lib/masterdata/db'
import { buildUtiltsOutboundDraft } from '@/lib/ediel/utilts'
import { createEdielMessageEvent, linkEdielMessage } from '@/lib/ediel/db'
import { resolveDecisionBackedOutboundContext } from '@/lib/ediel/flows/routeDecisionContext'
import {
  ensureActorUserId,
  finalizeOutboundDraft,
  findOrCreateDataRequestOutbound,
  getGridOwnerDataRequestById,
  makeServerClient,
  queuePreparedEdielMessage,
  resolveOutboundRuntimeEnvironment,
} from '@/lib/ediel/flows/shared'
import { updateGridOwnerDataRequestStatus } from '@/lib/cis/db'
import type { EdielEnvironment } from '@/lib/ediel/types'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import {
  assertSupplierUtiltsOutboundAllowed,
  normalizeUtiltsResolutionClass,
  resolveCanonicalUtiltsApplicationReference,
  type UtiltsRequestedMessageCode,
} from '@/lib/ediel/rulebook/utiltsMarketEngine'

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
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const supabase = await makeServerClient()
  const dataRequest = await getGridOwnerDataRequestById(params.gridOwnerDataRequestId)
  if (!dataRequest) throw new Error('Grid owner data request hittades inte')

  const companyId = dataRequest.company_id
  if (!companyId) throw new Error('UTILTS E73 stoppades: nätägarbegäran saknar company_id.')
  await requireCompanyOperationalForWrites(companyId)

  const environment = await resolveOutboundRuntimeEnvironment({
    preferredRouteId: params.communicationRouteId ?? null,
    explicitEnvironment: params.environment ?? null,
  })
  const bilateralCapabilityId = await requireBilateralE73Capability({ companyId, environment })
  const requestedMessageCode = requestedMessageForDataRequest({
    requestScope: dataRequest.request_scope,
    requestPayload: record(dataRequest.request_payload),
  })

  assertSupplierUtiltsOutboundAllowed({
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

  const resolution = normalizeUtiltsResolutionClass(meteringPoint?.reading_frequency ?? null)
  const applicationReference = resolveCanonicalUtiltsApplicationReference({
    code: 'E73',
    actorRole: 'supplier',
    requestedMessageCode,
    resolution,
  })

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
      applicationReference,
    },
  })

  const outbound = await findOrCreateDataRequestOutbound({
    actorUserId,
    requestType: 'meter_values',
    communicationRouteId: routeContext.route.id,
    dataRequest,
    payload: {
      edielCode: 'E73',
      queuedFrom: 'prepare_supplier_utilts_e73',
      requestedMessageCode,
      bilateralCapabilityVerified: true,
      bilateralCapabilityId,
      applicationReference,
      requestScope: dataRequest.request_scope,
      requestedPeriodStart: dataRequest.requested_period_start,
      requestedPeriodEnd: dataRequest.requested_period_end,
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
    payload: {
      meterPointId: meteringPoint?.meter_point_id ?? null,
      meteringPointId: meteringPoint?.meter_point_id ?? null,
      gridAreaId: gridOwner?.owner_code ?? gridOwner?.ediel_id ?? null,
      requestedMessageCode,
      bilateralCapabilityVerified: true,
      bilateralCapabilityId,
      applicationReferencePolicyKey: applicationReference,
      marketSemanticVersion: 'swedish-utilts-central-2026-08-22',
      requestedPeriodStart: dataRequest.requested_period_start,
      requestedPeriodEnd: dataRequest.requested_period_end,
      periodStart: dataRequest.requested_period_start,
      periodEnd: dataRequest.requested_period_end,
      transactionReason: `Request missing ${requestedMessageCode}`,
      requestScope: dataRequest.request_scope,
      siteType: site?.site_type ?? 'consumption',
      readingFrequency: meteringPoint?.reading_frequency ?? null,
      resolution,
    },
  })

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

  await linkEdielMessage({
    actorUserId,
    edielMessageId: message.id,
    outboundRequestId: outbound.id,
    gridOwnerDataRequestId: dataRequest.id,
    customerId: dataRequest.customer_id,
    siteId: dataRequest.site_id,
    meteringPointId: dataRequest.metering_point_id,
    gridOwnerId: dataRequest.grid_owner_id,
    communicationRouteId: routeContext.route.id,
  })

  await queuePreparedEdielMessage({
    actorUserId,
    messageId: message.id,
    outboundRequestId: outbound.id,
    externalReference: message.external_reference ?? dataRequest.external_reference,
    payload: {
      edielCode: 'E73',
      requestedMessageCode,
      bilateralCapabilityVerified: true,
      bilateralCapabilityId,
      applicationReference,
      routeId: routeContext.route.id,
      gridOwnerDataRequestId: dataRequest.id,
    },
  })

  await updateGridOwnerDataRequestStatus({
    actorUserId,
    requestId: dataRequest.id,
    status: 'sent',
    externalReference: message.external_reference ?? dataRequest.external_reference,
    responsePayload: {
      ...record(dataRequest.response_payload),
      edielMessageId: message.id,
      outboundRequestId: outbound.id,
      preparedVia: 'prepareAndQueueUtiltsE73',
      requestedVia: 'UTILTS_E73',
      requestedMessageCode,
      bilateralCapabilityId,
      applicationReference,
    },
    notes: dataRequest.notes ?? null,
  })

  await createEdielMessageEvent({
    actorUserId,
    edielMessageId: message.id,
    eventType: 'validated',
    eventStatus: 'success',
    message: 'UTILTS E73 skapades via central supplier-market engine med verifierad bilateral capability.',
    payload: {
      requestedMessageCode,
      bilateralCapabilityId,
      applicationReference,
      marketSemanticVersion: 'swedish-utilts-central-2026-08-22',
    },
  })

  return message
}

export async function prepareAndQueueUtiltsE66(): Promise<never> {
  // E66 is grid-owner-originated validated metering data. Gridex in supplier
  // role must never originate it from a data-request workflow.
  throw new Error('utilts_e66_supplier_outbound_not_allowed')
}
