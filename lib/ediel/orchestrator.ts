import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
import {
  createEdielMessage,
  createEdielMessageEvent,
  getEdielMessageById,
  getEdielRouteProfileByCommunicationRouteId,
  linkEdielMessage,
  updateEdielMessageStatus,
} from '@/lib/ediel/db'
import { getActiveEdielActorSettings } from '@/lib/ediel/config'
import {
  buildAperakDraft,
  buildContrlDraft,
  buildUtiltsErrDraft,
} from '@/lib/ediel/ack'
import {
  buildProdatZ03FromSwitch,
  buildProdatZ05FromSwitch,
  buildProdatZ09FromSwitch,
} from '@/lib/ediel/prodat'
import { buildUtiltsOutboundDraft } from '@/lib/ediel/utilts'
import {
  buildAiListDetailFromSite,
  buildAiListOutboundDraft,
} from '@/lib/ediel/aiList'
import {
  findMatchingGridOwnerDataRequest,
  findMatchingSupplierSwitchRequest,
  matchMeteringPointForEdielMessage,
  matchSiteAndCustomerForMeteringPoint,
} from '@/lib/ediel/matching'
import {
  sendEdielMessageViaSmtp,
  pollEdielMailboxViaImap,
} from '@/lib/ediel/transport'
import {
  getGridOwnerById,
  getMeteringPointById,
  getCustomerSiteById,
} from '@/lib/masterdata/db'
import {
  createSupplierSwitchEvent,
  getSupplierSwitchRequestById,
  updateSupplierSwitchRequestStatus,
} from '@/lib/operations/db'
import {
  createOutboundRequest,
  findOpenOutboundBySource,
  ingestMeteringValue,
  syncGridOwnerDataRequestFromOutbound,
  updateGridOwnerDataRequestStatus,
  updateOutboundRequestStatus,
} from '@/lib/cis/db'
import { findBestCommunicationRoute } from '@/lib/cis/db-routes'
import type {
  CommunicationRouteRow,
  GridOwnerDataRequestRow,
} from '@/lib/cis/types'
import type { EdielMessageRow, EdielRouteProfileRow } from '@/lib/ediel/types'
import type {
  CustomerSiteRow,
  GridOwnerRow,
  MeteringPointRow,
} from '@/lib/masterdata/types'

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

async function getGridOwnerDataRequestById(
  id: string
): Promise<GridOwnerDataRequestRow | null> {
  const { data, error } = await supabaseService
    .from('grid_owner_data_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return (data as GridOwnerDataRequestRow | null) ?? null
}

async function getCommunicationRouteById(
  id: string
): Promise<CommunicationRouteRow | null> {
  const { data, error } = await supabaseService
    .from('communication_routes')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return (data as CommunicationRouteRow | null) ?? null
}

async function resolveCommunicationRoute(params: {
  requestType: 'supplier_switch' | 'meter_values' | 'billing_underlay'
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

async function resolveEdielRouteContext(params: {
  requestType: 'supplier_switch' | 'meter_values' | 'billing_underlay'
  gridOwner?: GridOwnerRow | null
  preferredRouteId?: string | null
}) {
  const actor = await getActiveEdielActorSettings('test')
  if (!actor) {
    throw new Error(
      'Ingen aktiv ediel_actor_settings hittades för testmiljön. Batch 1 config saknas eller är inte aktiv.'
    )
  }

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

  const routeProfile = await getEdielRouteProfileByCommunicationRouteId(route.id)

  const senderEdielId =
    routeProfile?.sender_ediel_id ??
    actor.actor_ediel_id ??
    null

  const senderName =
    routeProfile?.sender_name ??
    actor.sender_name ??
    actor.actor_name ??
    null

  const senderSubAddress =
    routeProfile?.sender_sub_address ??
    actor.sender_sub_address ??
    'GRIDEX'

  const receiverEdielId =
    routeProfile?.receiver_ediel_id ??
    params.gridOwner?.ediel_id ??
    null

  const receiverName =
    routeProfile?.receiver_name ??
    params.gridOwner?.name ??
    null

  const receiverSubAddress =
    routeProfile?.receiver_sub_address ??
    'EDIEL'

  const receiverEmail = route.target_email ?? null
  const mailbox = routeProfile?.mailbox ?? actor.mailbox ?? null

  if (!senderEdielId) {
    throw new Error('Avsändarens Ediel-id saknas i ediel_actor_settings / route profile.')
  }

  if (!receiverEdielId) {
    throw new Error(
      `Mottagarens Ediel-id saknas för route ${route.route_name}. Lägg receiver_ediel_id på profile eller ediel_id på grid owner.`
    )
  }

  return {
    actor,
    route,
    routeProfile,
    senderEdielId,
    senderName,
    senderSubAddress,
    receiverEdielId,
    receiverName,
    receiverSubAddress,
    receiverEmail,
    mailbox,
  }
}

async function findOrCreateSwitchOutbound(params: {
  actorUserId: string
  switchRequestId: string
  customerId: string
  siteId: string
  meteringPointId: string
  gridOwnerId: string | null
  externalReference: string | null
  payload: Record<string, unknown>
}) {
  const existing = await findOpenOutboundBySource({
    sourceType: 'supplier_switch_request',
    sourceId: params.switchRequestId,
    requestType: 'supplier_switch',
  })

  if (existing) {
    return existing
  }

  return createOutboundRequest({
    actorUserId: params.actorUserId,
    customerId: params.customerId,
    siteId: params.siteId,
    meteringPointId: params.meteringPointId,
    gridOwnerId: params.gridOwnerId,
    requestType: 'supplier_switch',
    sourceType: 'supplier_switch_request',
    sourceId: params.switchRequestId,
    externalReference: params.externalReference,
    payload: params.payload,
  })
}

async function findOrCreateDataRequestOutbound(params: {
  actorUserId: string
  requestType: 'meter_values' | 'billing_underlay'
  dataRequest: GridOwnerDataRequestRow
  payload: Record<string, unknown>
}) {
  const existing = await findOpenOutboundBySource({
    sourceType: 'grid_owner_data_request',
    sourceId: params.dataRequest.id,
    requestType: params.requestType,
  })

  if (existing) {
    return existing
  }

  return createOutboundRequest({
    actorUserId: params.actorUserId,
    customerId: params.dataRequest.customer_id,
    siteId: params.dataRequest.site_id,
    meteringPointId: params.dataRequest.metering_point_id,
    gridOwnerId: params.dataRequest.grid_owner_id,
    requestType: params.requestType,
    sourceType: 'grid_owner_data_request',
    sourceId: params.dataRequest.id,
    periodStart: params.dataRequest.requested_period_start,
    periodEnd: params.dataRequest.requested_period_end,
    externalReference: params.dataRequest.external_reference,
    payload: params.payload,
  })
}

async function markDataRequestOutboundAcknowledged(params: {
  actorUserId: string
  dataRequestId: string
  externalReference: string | null
  edielMessageId: string
}) {
  const candidates = await Promise.all([
    findOpenOutboundBySource({
      sourceType: 'grid_owner_data_request',
      sourceId: params.dataRequestId,
      requestType: 'meter_values',
    }),
    findOpenOutboundBySource({
      sourceType: 'grid_owner_data_request',
      sourceId: params.dataRequestId,
      requestType: 'billing_underlay',
    }),
  ])

  const outbound = candidates.find(Boolean)

  if (!outbound) {
    return null
  }

  const updatedOutbound = await updateOutboundRequestStatus({
    actorUserId: params.actorUserId,
    outboundRequestId: outbound.id,
    status: 'acknowledged',
    externalReference: params.externalReference ?? outbound.external_reference ?? null,
    responsePayload: {
      edielMessageId: params.edielMessageId,
      acknowledgedVia: 'inbound_ediel',
    },
  })

  await syncGridOwnerDataRequestFromOutbound({
    actorUserId: params.actorUserId,
    outboundRequest: updatedOutbound,
    extraResponsePayload: {
      edielMessageId: params.edielMessageId,
      acknowledgedVia: 'inbound_ediel',
    },
  })

  return updatedOutbound
}

async function autoFillMasterdataFromUtilts(params: {
  actorUserId: string
  customerId: string | null
  siteId: string | null
  meteringPointId: string | null
  message: EdielMessageRow
}) {
  const parsed = params.message.parsed_payload ?? {}

  const facilityId =
    stringOrNull(parsed.facilityId) ??
    stringOrNull(parsed.installationId) ??
    stringOrNull(parsed.siteFacilityId)

  const meterPointIdentifier =
    stringOrNull(parsed.meterPointId) ??
    stringOrNull(parsed.meteringPointId)

  const edielReference =
    stringOrNull(parsed.edielReference) ??
    meterPointIdentifier

  const currentSupplierName = stringOrNull(parsed.currentSupplierName)

  if (params.siteId) {
    const siteUpdate: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (facilityId) {
      siteUpdate.facility_id = facilityId
    }

    if (currentSupplierName) {
      siteUpdate.current_supplier_name = currentSupplierName
    }

    if (Object.keys(siteUpdate).length > 1) {
      const { error } = await supabaseService
        .from('customer_sites')
        .update(siteUpdate)
        .eq('id', params.siteId)

      if (error) throw error
    }
  }

  if (params.meteringPointId) {
    const pointUpdate: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (meterPointIdentifier) {
      pointUpdate.meter_point_id = meterPointIdentifier
      pointUpdate.metering_point_id = meterPointIdentifier
    }

    if (edielReference) {
      pointUpdate.ediel_reference = edielReference
    }

    if (facilityId) {
      pointUpdate.site_facility_id = facilityId
    }

    if (Object.keys(pointUpdate).length > 1) {
      const { error } = await supabaseService
        .from('metering_points')
        .update(pointUpdate)
        .eq('id', params.meteringPointId)

      if (error) throw error
    }
  }
}

async function autoIngestMeteringValueFromUtilts(params: {
  actorUserId: string
  customerId: string | null
  siteId: string | null
  meteringPointId: string | null
  gridOwnerId: string | null
  dataRequestId: string | null
  message: EdielMessageRow
}) {
  const parsed = params.message.parsed_payload ?? {}

  const quantity = numberOrNull(parsed.quantity)
  if (!params.customerId || !params.meteringPointId || quantity === null) {
    return null
  }

  const readAt =
    stringOrNull(parsed.periodEnd) ??
    stringOrNull(parsed.periodStart) ??
    params.message.message_received_at ??
    new Date().toISOString()

  return ingestMeteringValue({
    actorUserId: params.actorUserId,
    customerId: params.customerId,
    siteId: params.siteId,
    meteringPointId: params.meteringPointId,
    sourceRequestId: params.dataRequestId,
    gridOwnerId: params.gridOwnerId,
    readingType: 'consumption',
    valueKwh: quantity,
    qualityCode: stringOrNull(parsed.readingType),
    readAt,
    periodStart: stringOrNull(parsed.periodStart),
    periodEnd: stringOrNull(parsed.periodEnd),
    sourceSystem: 'ediel_utilts',
    rawPayload: {
      edielMessageId: params.message.id,
      parsedPayload: parsed,
    },
  })
}

async function queuePreparedEdielMessage(params: {
  actorUserId: string
  messageId: string
  outboundRequestId?: string | null
  externalReference?: string | null
  payload?: Record<string, unknown>
}) {
  await updateEdielMessageStatus({
    actorUserId: params.actorUserId,
    id: params.messageId,
    status: 'queued',
  })

  if (params.outboundRequestId) {
    await updateOutboundRequestStatus({
      actorUserId: params.actorUserId,
      outboundRequestId: params.outboundRequestId,
      status: 'prepared',
      externalReference: params.externalReference ?? null,
      responsePayload: {
        edielMessageId: params.messageId,
        ...(params.payload ?? {}),
      },
    })
  }
}

export async function prepareAndQueueEdielZ03(params: {
  actorUserId: string
  switchRequestId: string
  communicationRouteId?: string | null
}) {
  const supabase = await createSupabaseServerClient()
  const switchRequest = await getSupplierSwitchRequestById(
    supabase,
    params.switchRequestId
  )

  if (!switchRequest) {
    throw new Error('Switch request hittades inte')
  }

  const site = await getCustomerSiteById(supabase, switchRequest.site_id)
  if (!site) throw new Error('Anläggning saknas för switchärendet')

  const meteringPoint = await getMeteringPointById(
    supabase,
    switchRequest.metering_point_id
  )
  if (!meteringPoint) throw new Error('Mätpunkt saknas för switchärendet')

  const gridOwner = switchRequest.grid_owner_id
    ? await getGridOwnerById(supabase, switchRequest.grid_owner_id)
    : null

  const routeContext = await resolveEdielRouteContext({
    requestType: 'supplier_switch',
    gridOwner,
    preferredRouteId: params.communicationRouteId ?? null,
  })

  const outbound = await findOrCreateSwitchOutbound({
    actorUserId: params.actorUserId,
    switchRequestId: switchRequest.id,
    customerId: switchRequest.customer_id,
    siteId: switchRequest.site_id,
    meteringPointId: switchRequest.metering_point_id,
    gridOwnerId: switchRequest.grid_owner_id,
    externalReference:
      switchRequest.external_reference ?? `SWITCH-${switchRequest.id}`,
    payload: {
      edielCode: 'Z03',
      queuedFrom: 'prepare_switch_z03',
      requestType: switchRequest.request_type,
      requestedStartDate: switchRequest.requested_start_date,
      communicationRouteId: routeContext.route.id,
    },
  })

  const draft = await buildProdatZ03FromSwitch({
    actorUserId: params.actorUserId,
    senderEdielId: routeContext.senderEdielId,
    senderName: routeContext.senderName,
    receiverEdielId: routeContext.receiverEdielId,
    receiverName: routeContext.receiverName,
    receiverEmail: routeContext.receiverEmail,
    communicationRouteId: routeContext.route.id,
    mailbox: routeContext.mailbox,
    switchRequest,
    site,
    meteringPoint,
    gridOwner,
  })

  const message = await createEdielMessage(draft)

  await linkEdielMessage({
    actorUserId: params.actorUserId,
    edielMessageId: message.id,
    outboundRequestId: outbound.id,
    switchRequestId: switchRequest.id,
    customerId: switchRequest.customer_id,
    siteId: switchRequest.site_id,
    meteringPointId: switchRequest.metering_point_id,
    gridOwnerId: switchRequest.grid_owner_id,
    communicationRouteId: routeContext.route.id,
  })

  await queuePreparedEdielMessage({
    actorUserId: params.actorUserId,
    messageId: message.id,
    outboundRequestId: outbound.id,
    externalReference:
      switchRequest.external_reference ?? `SWITCH-${switchRequest.id}`,
    payload: {
      edielCode: 'Z03',
      routeId: routeContext.route.id,
    },
  })

  await createSupplierSwitchEvent(supabase, {
    switchRequestId: switchRequest.id,
    eventType: 'ediel_prepared',
    eventStatus: 'queued',
    message: 'Ediel Z03 förberett från switchärendet.',
    payload: {
      edielMessageId: message.id,
      outboundRequestId: outbound.id,
      routeId: routeContext.route.id,
    },
  })

  return message
}

export async function prepareAndQueueEdielZ05(params: {
  actorUserId: string
  switchRequestId: string
  communicationRouteId?: string | null
}) {
  const supabase = await createSupabaseServerClient()
  const switchRequest = await getSupplierSwitchRequestById(
    supabase,
    params.switchRequestId
  )

  if (!switchRequest) {
    throw new Error('Switch request hittades inte')
  }

  const site = await getCustomerSiteById(supabase, switchRequest.site_id)
  if (!site) throw new Error('Anläggning saknas för switchärendet')

  const meteringPoint = await getMeteringPointById(
    supabase,
    switchRequest.metering_point_id
  )
  if (!meteringPoint) throw new Error('Mätpunkt saknas för switchärendet')

  const gridOwner = switchRequest.grid_owner_id
    ? await getGridOwnerById(supabase, switchRequest.grid_owner_id)
    : null

  const routeContext = await resolveEdielRouteContext({
    requestType: 'supplier_switch',
    gridOwner,
    preferredRouteId: params.communicationRouteId ?? null,
  })

  const outbound = await findOrCreateSwitchOutbound({
    actorUserId: params.actorUserId,
    switchRequestId: switchRequest.id,
    customerId: switchRequest.customer_id,
    siteId: switchRequest.site_id,
    meteringPointId: switchRequest.metering_point_id,
    gridOwnerId: switchRequest.grid_owner_id,
    externalReference:
      switchRequest.external_reference ?? `SWITCH-DONE-${switchRequest.id}`,
    payload: {
      edielCode: 'Z05',
      queuedFrom: 'prepare_switch_z05',
      requestType: switchRequest.request_type,
      requestedStartDate: switchRequest.requested_start_date,
      communicationRouteId: routeContext.route.id,
    },
  })

  const draft = await buildProdatZ05FromSwitch({
    actorUserId: params.actorUserId,
    senderEdielId: routeContext.senderEdielId,
    senderName: routeContext.senderName,
    receiverEdielId: routeContext.receiverEdielId,
    receiverName: routeContext.receiverName,
    receiverEmail: routeContext.receiverEmail,
    communicationRouteId: routeContext.route.id,
    mailbox: routeContext.mailbox,
    switchRequest,
    site,
    meteringPoint,
    gridOwner,
  })

  const message = await createEdielMessage(draft)

  await linkEdielMessage({
    actorUserId: params.actorUserId,
    edielMessageId: message.id,
    outboundRequestId: outbound.id,
    switchRequestId: switchRequest.id,
    customerId: switchRequest.customer_id,
    siteId: switchRequest.site_id,
    meteringPointId: switchRequest.metering_point_id,
    gridOwnerId: switchRequest.grid_owner_id,
    communicationRouteId: routeContext.route.id,
  })

  await queuePreparedEdielMessage({
    actorUserId: params.actorUserId,
    messageId: message.id,
    outboundRequestId: outbound.id,
    externalReference:
      switchRequest.external_reference ?? `SWITCH-DONE-${switchRequest.id}`,
    payload: {
      edielCode: 'Z05',
      routeId: routeContext.route.id,
    },
  })

  await createSupplierSwitchEvent(supabase, {
    switchRequestId: switchRequest.id,
    eventType: 'ediel_prepared',
    eventStatus: 'queued',
    message: 'Ediel Z05 förberett från switchärendet.',
    payload: {
      edielMessageId: message.id,
      outboundRequestId: outbound.id,
      routeId: routeContext.route.id,
    },
  })

  return message
}

export async function prepareAndQueueEdielZ09(params: {
  actorUserId: string
  switchRequestId: string
  communicationRouteId?: string | null
}) {
  const supabase = await createSupabaseServerClient()
  const switchRequest = await getSupplierSwitchRequestById(
    supabase,
    params.switchRequestId
  )

  if (!switchRequest) {
    throw new Error('Switch request hittades inte')
  }

  const site = await getCustomerSiteById(supabase, switchRequest.site_id)
  if (!site) throw new Error('Anläggning saknas för switchärendet')

  const meteringPoint = await getMeteringPointById(
    supabase,
    switchRequest.metering_point_id
  )
  if (!meteringPoint) throw new Error('Mätpunkt saknas för switchärendet')

  const gridOwner = switchRequest.grid_owner_id
    ? await getGridOwnerById(supabase, switchRequest.grid_owner_id)
    : null

  const routeContext = await resolveEdielRouteContext({
    requestType: 'supplier_switch',
    gridOwner,
    preferredRouteId: params.communicationRouteId ?? null,
  })

  const outbound = await findOrCreateSwitchOutbound({
    actorUserId: params.actorUserId,
    switchRequestId: switchRequest.id,
    customerId: switchRequest.customer_id,
    siteId: switchRequest.site_id,
    meteringPointId: switchRequest.metering_point_id,
    gridOwnerId: switchRequest.grid_owner_id,
    externalReference:
      switchRequest.external_reference ?? `MASTERDATA-${switchRequest.id}`,
    payload: {
      edielCode: 'Z09',
      queuedFrom: 'prepare_switch_z09',
      requestType: switchRequest.request_type,
      requestedStartDate: switchRequest.requested_start_date,
      communicationRouteId: routeContext.route.id,
    },
  })

  const draft = await buildProdatZ09FromSwitch({
    actorUserId: params.actorUserId,
    senderEdielId: routeContext.senderEdielId,
    senderName: routeContext.senderName,
    receiverEdielId: routeContext.receiverEdielId,
    receiverName: routeContext.receiverName,
    receiverEmail: routeContext.receiverEmail,
    communicationRouteId: routeContext.route.id,
    mailbox: routeContext.mailbox,
    switchRequest,
    site,
    meteringPoint,
    gridOwner,
  })

  const message = await createEdielMessage(draft)

  await linkEdielMessage({
    actorUserId: params.actorUserId,
    edielMessageId: message.id,
    outboundRequestId: outbound.id,
    switchRequestId: switchRequest.id,
    customerId: switchRequest.customer_id,
    siteId: switchRequest.site_id,
    meteringPointId: switchRequest.metering_point_id,
    gridOwnerId: switchRequest.grid_owner_id,
    communicationRouteId: routeContext.route.id,
  })

  await queuePreparedEdielMessage({
    actorUserId: params.actorUserId,
    messageId: message.id,
    outboundRequestId: outbound.id,
    externalReference:
      switchRequest.external_reference ?? `MASTERDATA-${switchRequest.id}`,
    payload: {
      edielCode: 'Z09',
      routeId: routeContext.route.id,
    },
  })

  return message
}

export async function prepareAndQueueUtiltsE73(params: {
  actorUserId: string
  gridOwnerDataRequestId: string
  communicationRouteId?: string | null
}) {
  const supabase = await createSupabaseServerClient()
  const dataRequest = await getGridOwnerDataRequestById(params.gridOwnerDataRequestId)

  if (!dataRequest) {
    throw new Error('Grid owner data request hittades inte')
  }

  const site = dataRequest.site_id
    ? await getCustomerSiteById(supabase, dataRequest.site_id)
    : null
  const meteringPoint = dataRequest.metering_point_id
    ? await getMeteringPointById(supabase, dataRequest.metering_point_id)
    : null
  const gridOwner = dataRequest.grid_owner_id
    ? await getGridOwnerById(supabase, dataRequest.grid_owner_id)
    : null

  const routeContext = await resolveEdielRouteContext({
    requestType: 'meter_values',
    gridOwner,
    preferredRouteId: params.communicationRouteId ?? null,
  })

  const outbound = await findOrCreateDataRequestOutbound({
    actorUserId: params.actorUserId,
    requestType: 'meter_values',
    dataRequest,
    payload: {
      edielCode: 'E73',
      queuedFrom: 'prepare_utilts_e73',
      requestScope: dataRequest.request_scope,
      requestedPeriodStart: dataRequest.requested_period_start,
      requestedPeriodEnd: dataRequest.requested_period_end,
      communicationRouteId: routeContext.route.id,
    },
  })

  const draft = await buildUtiltsOutboundDraft({
    actorUserId: params.actorUserId,
    code: 'E73',
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
    payload: {
      meterPointId: meteringPoint?.meter_point_id ?? null,
      gridAreaId: gridOwner?.owner_code ?? gridOwner?.ediel_id ?? null,
      requestedPeriodStart: dataRequest.requested_period_start,
      requestedPeriodEnd: dataRequest.requested_period_end,
      periodStart: dataRequest.requested_period_start,
      periodEnd: dataRequest.requested_period_end,
      transactionReason: 'Request missing validated meter data',
      quantity: null,
      siteType: site?.site_type ?? 'consumption',
    },
  })

  const message = await createEdielMessage(draft)

  await linkEdielMessage({
    actorUserId: params.actorUserId,
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
    actorUserId: params.actorUserId,
    messageId: message.id,
    outboundRequestId: outbound.id,
    externalReference: dataRequest.external_reference,
    payload: {
      edielCode: 'E73',
      routeId: routeContext.route.id,
    },
  })

  await updateGridOwnerDataRequestStatus({
    actorUserId: params.actorUserId,
    requestId: dataRequest.id,
    status: 'sent',
    externalReference: message.external_reference ?? dataRequest.external_reference,
    responsePayload: {
      ...(dataRequest.response_payload ?? {}),
      edielMessageId: message.id,
      preparedVia: 'prepareAndQueueUtiltsE73',
    },
    notes: dataRequest.notes ?? null,
  })

  return message
}

export async function prepareAndQueueUtiltsE66(params: {
  actorUserId: string
  gridOwnerDataRequestId: string
  communicationRouteId?: string | null
  quantity?: number | null
  periodStart?: string | null
  periodEnd?: string | null
  registrationTime?: string | null
}) {
  const supabase = await createSupabaseServerClient()
  const dataRequest = await getGridOwnerDataRequestById(params.gridOwnerDataRequestId)

  if (!dataRequest) {
    throw new Error('Grid owner data request hittades inte')
  }

  const site = dataRequest.site_id
    ? await getCustomerSiteById(supabase, dataRequest.site_id)
    : null
  const meteringPoint = dataRequest.metering_point_id
    ? await getMeteringPointById(supabase, dataRequest.metering_point_id)
    : null
  const gridOwner = dataRequest.grid_owner_id
    ? await getGridOwnerById(supabase, dataRequest.grid_owner_id)
    : null

  const routeContext = await resolveEdielRouteContext({
    requestType: 'meter_values',
    gridOwner,
    preferredRouteId: params.communicationRouteId ?? null,
  })

  const outbound = await findOrCreateDataRequestOutbound({
    actorUserId: params.actorUserId,
    requestType: 'meter_values',
    dataRequest,
    payload: {
      edielCode: 'E66',
      queuedFrom: 'prepare_utilts_e66',
      requestScope: dataRequest.request_scope,
      requestedPeriodStart: dataRequest.requested_period_start,
      requestedPeriodEnd: dataRequest.requested_period_end,
      communicationRouteId: routeContext.route.id,
    },
  })

  const draft = await buildUtiltsOutboundDraft({
    actorUserId: params.actorUserId,
    code: 'E66',
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
    payload: {
      meterPointId: meteringPoint?.meter_point_id ?? null,
      gridAreaId: gridOwner?.owner_code ?? gridOwner?.ediel_id ?? null,
      periodStart: params.periodStart ?? dataRequest.requested_period_start,
      periodEnd: params.periodEnd ?? dataRequest.requested_period_end,
      registrationTime: params.registrationTime ?? new Date().toISOString(),
      quantity: params.quantity ?? 0,
      unit: 'KWH',
      resolution:
        meteringPoint?.reading_frequency === 'monthly'
          ? '1'
          : meteringPoint?.reading_frequency === 'daily'
            ? '1'
            : '15',
      siteType: site?.site_type ?? 'consumption',
    },
  })

  const message = await createEdielMessage(draft)

  await linkEdielMessage({
    actorUserId: params.actorUserId,
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
    actorUserId: params.actorUserId,
    messageId: message.id,
    outboundRequestId: outbound.id,
    externalReference: dataRequest.external_reference,
    payload: {
      edielCode: 'E66',
      routeId: routeContext.route.id,
    },
  })

  return message
}

export async function prepareAndQueueAiList(params: {
  actorUserId: string
  listType: 'AI' | 'BI'
  customerId: string
  siteId: string
  meteringPointId?: string | null
  supplierEdielId?: string | null
  balanceResponsibleEdielId?: string | null
  receiverEdielId: string
  receiverEmail?: string | null
  fromDate: string
  toDate: string
  communicationRouteId?: string | null
}) {
  const supabase = await createSupabaseServerClient()
  const site = await getCustomerSiteById(supabase, params.siteId)

  if (!site) {
    throw new Error('Anläggning hittades inte för AI-list export')
  }

  const meteringPoint = params.meteringPointId
    ? await getMeteringPointById(supabase, params.meteringPointId)
    : null

  const gridOwner = site.grid_owner_id
    ? await getGridOwnerById(supabase, site.grid_owner_id)
    : null

  const routeContext = await resolveEdielRouteContext({
    requestType: 'meter_values',
    gridOwner,
    preferredRouteId: params.communicationRouteId ?? null,
  })

  const detail = buildAiListDetailFromSite({
    site,
    meteringPoint,
    gridOwner,
    supplierEdielId: params.supplierEdielId ?? routeContext.senderEdielId,
    balanceResponsibleEdielId: params.balanceResponsibleEdielId ?? null,
  })

  const draft = await buildAiListOutboundDraft({
    actorUserId: params.actorUserId,
    listType: params.listType,
    senderEdielId: routeContext.senderEdielId,
    senderName: routeContext.senderName,
    receiverEdielId: params.receiverEdielId,
    receiverName: routeContext.receiverName,
    receiverEmail: params.receiverEmail ?? routeContext.receiverEmail,
    communicationRouteId: routeContext.route.id,
    customerId: params.customerId,
    siteId: params.siteId,
    meteringPointId: params.meteringPointId ?? null,
    gridOwnerId: site.grid_owner_id,
    fromDate: params.fromDate,
    toDate: params.toDate,
    details: [detail],
    mailbox: routeContext.mailbox,
  })

  const message = await createEdielMessage(draft)

  await linkEdielMessage({
    actorUserId: params.actorUserId,
    edielMessageId: message.id,
    customerId: params.customerId,
    siteId: params.siteId,
    meteringPointId: params.meteringPointId ?? null,
    gridOwnerId: site.grid_owner_id,
    communicationRouteId: routeContext.route.id,
  })

  await updateEdielMessageStatus({
    actorUserId: params.actorUserId,
    id: message.id,
    status: 'queued',
  })

  return message
}

export async function sendQueuedEdielMessage(params: {
  actorUserId: string
  edielMessageId: string
}) {
  const message = await getEdielMessageById(params.edielMessageId)
  if (!message) throw new Error('Ediel-meddelande hittades inte')

  const result = await sendEdielMessageViaSmtp(message)

  await updateEdielMessageStatus({
    actorUserId: params.actorUserId,
    id: message.id,
    status: 'sent',
  })

  if (message.outbound_request_id) {
    await updateOutboundRequestStatus({
      actorUserId: params.actorUserId,
      outboundRequestId: message.outbound_request_id,
      status: 'sent',
      externalReference: message.external_reference,
      responsePayload: {
        smtpMessageId: result.messageId,
        accepted: result.accepted,
        rejected: result.rejected,
      },
    })
  }

  if (message.switch_request_id) {
    const supabase = await createSupabaseServerClient()
    await updateSupplierSwitchRequestStatus(supabase, {
      requestId: message.switch_request_id,
      status: 'submitted',
      externalReference: message.external_reference,
    })
  }

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: message.id,
    eventType: 'sent',
    eventStatus: 'success',
    message: 'Ediel-meddelande skickat via SMTP.',
    payload: result,
  })

  return result
}

export async function pollAndIngestEdielMailbox(params: {
  actorUserId: string
  mailbox?: string | null
  communicationRouteId?: string | null
  limit?: number
}) {
  const incoming = await pollEdielMailboxViaImap({
    mailbox: params.mailbox ?? null,
    communicationRouteId: params.communicationRouteId ?? null,
    limit: params.limit ?? 10,
  })

  for (const message of incoming) {
    const meteringPointId = await matchMeteringPointForEdielMessage(message)
    const siteAndCustomer = await matchSiteAndCustomerForMeteringPoint({
      meteringPointId,
    })

    const matchedSwitch = await findMatchingSupplierSwitchRequest(message)
    const matchedDataRequest = await findMatchingGridOwnerDataRequest(message)

    await linkEdielMessage({
      actorUserId: params.actorUserId,
      edielMessageId: message.id,
      switchRequestId: matchedSwitch?.id ?? null,
      gridOwnerDataRequestId: matchedDataRequest?.id ?? null,
      customerId: siteAndCustomer?.customerId ?? null,
      siteId: siteAndCustomer?.siteId ?? null,
      meteringPointId,
      gridOwnerId: siteAndCustomer?.gridOwnerId ?? null,
      relatedMessageId: null,
    })

    await updateEdielMessageStatus({
      actorUserId: params.actorUserId,
      id: message.id,
      status: 'parsed',
      parsedPayload: message.parsed_payload,
    })

    if (matchedSwitch && message.message_family === 'PRODAT') {
      const supabase = await createSupabaseServerClient()

      if (message.message_code === 'Z04') {
        await updateSupplierSwitchRequestStatus(supabase, {
          requestId: matchedSwitch.id,
          status: 'accepted',
          externalReference:
            message.external_reference ?? matchedSwitch.external_reference,
        })
      }

      if (message.message_code === 'Z05') {
        await updateSupplierSwitchRequestStatus(supabase, {
          requestId: matchedSwitch.id,
          status: 'completed',
          externalReference:
            message.external_reference ?? matchedSwitch.external_reference,
        })
      }

      if (message.message_code === 'Z04' || message.message_code === 'Z05') {
        const aperak = await createEdielMessage(
          buildAperakDraft({
            actorUserId: params.actorUserId,
            sourceMessage: message,
            outcome: 'positive',
            messageText: 'Automatiskt APERAK från inbound PRODAT.',
          })
        )

        await createEdielMessageEvent({
          actorUserId: params.actorUserId,
          edielMessageId: message.id,
          eventType: 'aperak_sent',
          eventStatus: 'success',
          message: 'APERAK-utkast skapat automatiskt.',
          payload: {
            aperakMessageId: aperak.id,
          },
        })
      }
    }

    if (matchedDataRequest && message.message_family === 'UTILTS') {
      await updateGridOwnerDataRequestStatus({
        actorUserId: params.actorUserId,
        requestId: matchedDataRequest.id,
        status: 'received',
        externalReference:
          message.external_reference ?? matchedDataRequest.external_reference ?? null,
        responsePayload: {
          edielMessageId: message.id,
          parsedPayload: message.parsed_payload,
        },
        notes: null,
      })

      const acknowledgedOutbound = await markDataRequestOutboundAcknowledged({
        actorUserId: params.actorUserId,
        dataRequestId: matchedDataRequest.id,
        externalReference: message.external_reference ?? null,
        edielMessageId: message.id,
      })

      await autoFillMasterdataFromUtilts({
        actorUserId: params.actorUserId,
        customerId: siteAndCustomer?.customerId ?? matchedDataRequest.customer_id ?? null,
        siteId: siteAndCustomer?.siteId ?? matchedDataRequest.site_id ?? null,
        meteringPointId:
          meteringPointId ?? matchedDataRequest.metering_point_id ?? null,
        message,
      })

      const ingestedMeterValue = await autoIngestMeteringValueFromUtilts({
        actorUserId: params.actorUserId,
        customerId: siteAndCustomer?.customerId ?? matchedDataRequest.customer_id ?? null,
        siteId: siteAndCustomer?.siteId ?? matchedDataRequest.site_id ?? null,
        meteringPointId:
          meteringPointId ?? matchedDataRequest.metering_point_id ?? null,
        gridOwnerId:
          siteAndCustomer?.gridOwnerId ?? matchedDataRequest.grid_owner_id ?? null,
        dataRequestId: matchedDataRequest.id,
        message,
      })

      if (acknowledgedOutbound) {
        await syncGridOwnerDataRequestFromOutbound({
          actorUserId: params.actorUserId,
          outboundRequest: acknowledgedOutbound,
          extraResponsePayload: {
            edielMessageId: message.id,
            parsedPayload: message.parsed_payload ?? {},
            ingestedMeterValueId: ingestedMeterValue?.id ?? null,
          },
        })
      } else {
        await updateGridOwnerDataRequestStatus({
          actorUserId: params.actorUserId,
          requestId: matchedDataRequest.id,
          status: 'received',
          externalReference:
            message.external_reference ?? matchedDataRequest.external_reference ?? null,
          responsePayload: {
            ...(matchedDataRequest.response_payload ?? {}),
            edielMessageId: message.id,
            parsedPayload: message.parsed_payload ?? {},
            ingestedMeterValueId: ingestedMeterValue?.id ?? null,
            acknowledgedVia: 'inbound_ediel_without_outbound',
          },
          notes: matchedDataRequest.notes ?? null,
        })
      }

      const contrl = await createEdielMessage(
        buildContrlDraft({
          actorUserId: params.actorUserId,
          sourceMessage: message,
          outcome: 'positive',
          messageText: 'Automatiskt CONTRL på inbound UTILTS.',
        })
      )

      const aperak = await createEdielMessage(
        buildAperakDraft({
          actorUserId: params.actorUserId,
          sourceMessage: message,
          outcome: 'positive',
          messageText: 'Automatiskt APERAK på inbound UTILTS.',
        })
      )

      await createEdielMessageEvent({
        actorUserId: params.actorUserId,
        edielMessageId: message.id,
        eventType: 'validated',
        eventStatus: 'success',
        message:
          'Inbound UTILTS matchat mot data request, outbound kvitterat och masterdata uppdaterad.',
        payload: {
          contrlMessageId: contrl.id,
          aperakMessageId: aperak.id,
          outboundRequestId: acknowledgedOutbound?.id ?? null,
          ingestedMeterValueId: ingestedMeterValue?.id ?? null,
        },
      })
    }
  }

  return incoming
}

export async function createNegativeUtiltsResponse(params: {
  actorUserId: string
  edielMessageId: string
  messageText: string
}) {
  const source = await getEdielMessageById(params.edielMessageId)
  if (!source) throw new Error('Källmeddelande hittades inte')

  const utiltsErr = await createEdielMessage(
    buildUtiltsErrDraft({
      actorUserId: params.actorUserId,
      sourceMessage: source,
      messageText: params.messageText,
    })
  )

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: source.id,
    eventType: 'utilts_err_sent',
    eventStatus: 'warning',
    message: 'UTILTS-ERR-utkast skapat.',
    payload: {
      utiltsErrMessageId: utiltsErr.id,
    },
  })

  return utiltsErr
}