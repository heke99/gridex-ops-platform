// lib/ediel/flows/utiltsDataRequest.ts

import { getGridOwnerById, getMeteringPointById, getCustomerSiteById } from '@/lib/masterdata/db'
import { buildUtiltsOutboundDraft } from '@/lib/ediel/utilts'
import { linkEdielMessage, updateEdielMessageStatus, getEdielMessageById, createEdielMessageEvent } from '@/lib/ediel/db'
import { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import {
  ensureActorUserId,
  finalizeOutboundDraft,
  findOrCreateDataRequestOutbound,
  getGridOwnerDataRequestById,
  makeServerClient,
  queuePreparedEdielMessage,
} from '@/lib/ediel/flows/shared'
import {
  syncGridOwnerDataRequestFromOutbound,
  updateGridOwnerDataRequestStatus,
  updateOutboundRequestStatus,
  findOpenOutboundBySource,
  ingestMeteringValue,
} from '@/lib/cis/db'
import type { GridOwnerDataRequestRow } from '@/lib/cis/types'
import type { EdielMessageRow } from '@/lib/ediel/types'
import {
  findMatchingGridOwnerDataRequest,
  matchMeteringPointForEdielMessage,
  matchSiteAndCustomerForMeteringPoint,
} from '@/lib/ediel/matching'
import { getAutomaticAckPolicy, buildAperakDraft, buildContrlDraft, buildUtiltsErrDraft } from '@/lib/ediel/ack'
import { createCanonicalAckMessage } from '@/lib/ediel/core/kernel'

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

export async function prepareAndQueueUtiltsE73(params: {
  actorUserId: string
  gridOwnerDataRequestId: string
  communicationRouteId?: string | null
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const supabase = await makeServerClient()
  const dataRequest = await getGridOwnerDataRequestById(params.gridOwnerDataRequestId)

  if (!dataRequest) throw new Error('Grid owner data request hittades inte')

  const site = dataRequest.site_id ? await getCustomerSiteById(supabase, dataRequest.site_id) : null
  const meteringPoint = dataRequest.metering_point_id
    ? await getMeteringPointById(supabase, dataRequest.metering_point_id)
    : null
  const gridOwner = dataRequest.grid_owner_id
    ? await getGridOwnerById(supabase, dataRequest.grid_owner_id)
    : null

  const routeContext = await resolveCanonicalOutboundContext({
    requestType: 'meter_values',
    gridOwner,
    preferredRouteId: params.communicationRouteId ?? null,
    environment: 'test',
    messageStandard: 'edifact',
  })

  const outbound = await findOrCreateDataRequestOutbound({
    actorUserId,
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
    actorUserId,
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

  const message = await finalizeOutboundDraft({
    actorUserId,
    requestType: 'meter_values',
    routeContext,
    draft,
    outboundRequestId: outbound.id,
    duplicateCheck: {
      receiverEdielId: routeContext.receiverEdielId,
      messageFamily: draft.messageFamily,
      messageCode: String(draft.messageCode),
      messageVersion: draft.messageVersion ?? null,
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
    externalReference: dataRequest.external_reference,
    payload: { edielCode: 'E73', routeId: routeContext.route.id },
  })

  await updateGridOwnerDataRequestStatus({
    actorUserId,
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
  const actorUserId = ensureActorUserId(params.actorUserId)
  const supabase = await makeServerClient()
  const dataRequest = await getGridOwnerDataRequestById(params.gridOwnerDataRequestId)

  if (!dataRequest) throw new Error('Grid owner data request hittades inte')

  const site = dataRequest.site_id ? await getCustomerSiteById(supabase, dataRequest.site_id) : null
  const meteringPoint = dataRequest.metering_point_id
    ? await getMeteringPointById(supabase, dataRequest.metering_point_id)
    : null
  const gridOwner = dataRequest.grid_owner_id
    ? await getGridOwnerById(supabase, dataRequest.grid_owner_id)
    : null

  const routeContext = await resolveCanonicalOutboundContext({
    requestType: 'meter_values',
    gridOwner,
    preferredRouteId: params.communicationRouteId ?? null,
    environment: 'test',
    messageStandard: 'edifact',
  })

  const outbound = await findOrCreateDataRequestOutbound({
    actorUserId,
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
    actorUserId,
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
          ? '1440'
          : meteringPoint?.reading_frequency === 'daily'
            ? '1440'
            : '15',
      siteType: site?.site_type ?? 'consumption',
    },
  })

  const message = await finalizeOutboundDraft({
    actorUserId,
    requestType: 'meter_values',
    routeContext,
    draft,
    outboundRequestId: outbound.id,
    duplicateCheck: {
      receiverEdielId: routeContext.receiverEdielId,
      messageFamily: draft.messageFamily,
      messageCode: String(draft.messageCode),
      messageVersion: draft.messageVersion ?? null,
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
    externalReference: dataRequest.external_reference,
    payload: { edielCode: 'E66', routeId: routeContext.route.id },
  })

  return message
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
  if (!outbound) return null

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
    stringOrNull(parsed.meterPointId) ?? stringOrNull(parsed.meteringPointId)

  const edielReference = stringOrNull(parsed.edielReference) ?? meterPointIdentifier
  const currentSupplierName = stringOrNull(parsed.currentSupplierName)

  if (params.siteId) {
    const siteUpdate: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (facilityId) siteUpdate.facility_id = facilityId
    if (currentSupplierName) siteUpdate.current_supplier_name = currentSupplierName

    if (Object.keys(siteUpdate).length > 1) {
      const { error } = await (await import('@/lib/supabase/service')).supabaseService
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

    if (meterPointIdentifier) pointUpdate.meter_point_id = meterPointIdentifier
    if (edielReference) pointUpdate.ediel_reference = edielReference
    if (facilityId) pointUpdate.site_facility_id = facilityId

    if (Object.keys(pointUpdate).length > 1) {
      const { error } = await (await import('@/lib/supabase/service')).supabaseService
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

async function createAckIfMissing(params: {
  actorUserId: string
  sourceMessage: EdielMessageRow
  ackFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  outcome?: 'positive' | 'negative'
  messageText?: string | null
}) {
  const draft =
    params.ackFamily === 'CONTRL'
      ? buildContrlDraft({
        actorUserId: params.actorUserId,
        sourceMessage: params.sourceMessage,
        outcome: params.outcome ?? 'positive',
        messageText: params.messageText ?? null,
      })
      : params.ackFamily === 'APERAK'
        ? buildAperakDraft({
          actorUserId: params.actorUserId,
          sourceMessage: params.sourceMessage,
          outcome: params.outcome ?? 'positive',
          messageText: params.messageText ?? null,
        })
        : buildUtiltsErrDraft({
          actorUserId: params.actorUserId,
          sourceMessage: params.sourceMessage,
          messageText: params.messageText ?? null,
        })

  const ackMessage = await createCanonicalAckMessage({
    actorUserId: params.actorUserId,
    sourceMessage: params.sourceMessage,
    ackFamily: params.ackFamily,
    outcome: params.outcome,
    draft,
  })

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.sourceMessage.id,
    eventType:
      params.ackFamily === 'CONTRL'
        ? 'contrl_sent'
        : params.ackFamily === 'APERAK'
          ? 'aperak_sent'
          : 'utilts_err_sent',
    eventStatus: 'success',
    message: `${params.ackFamily} hanterad via canonical kernel.`,
    payload: {
      ackMessageId: ackMessage.id,
      outcome: params.outcome ?? null,
    },
  })

  return ackMessage
}

async function createAutomaticPositiveAcks(params: {
  actorUserId: string
  sourceMessage: EdielMessageRow
}) {
  const createdIds: string[] = []
  const policy = await getAutomaticAckPolicy(params.sourceMessage)

  if (policy.shouldSendContrl) {
    const contrl = await createAckIfMissing({
      actorUserId: params.actorUserId,
      sourceMessage: params.sourceMessage,
      ackFamily: 'CONTRL',
      outcome: 'positive',
      messageText: 'Automatiskt CONTRL.',
    })
    createdIds.push(contrl.id)
  }

  if (policy.shouldSendPositiveAperak) {
    const aperak = await createAckIfMissing({
      actorUserId: params.actorUserId,
      sourceMessage: params.sourceMessage,
      ackFamily: 'APERAK',
      outcome: 'positive',
      messageText: 'Automatiskt APERAK.',
    })
    createdIds.push(aperak.id)
  }

  return createdIds
}

async function linkInboundUtiltsMessageCanonically(params: {
  actorUserId: string
  message: EdielMessageRow
}) {
  const meteringPointId = await matchMeteringPointForEdielMessage(params.message)
  const siteAndCustomer = await matchSiteAndCustomerForMeteringPoint({ meteringPointId })
  const matchedDataRequest = await findMatchingGridOwnerDataRequest(params.message)

  await linkEdielMessage({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    gridOwnerDataRequestId: matchedDataRequest?.id ?? null,
    customerId: siteAndCustomer?.customerId ?? null,
    siteId: siteAndCustomer?.siteId ?? null,
    meteringPointId,
    gridOwnerId: siteAndCustomer?.gridOwnerId ?? null,
    relatedMessageId: null,
  })

  return {
    meteringPointId,
    siteAndCustomer,
    matchedDataRequest,
  }
}

export async function processInboundUtiltsMessage(params: {
  actorUserId: string
  edielMessageId: string
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const message = await getEdielMessageById(params.edielMessageId)

  if (!message) throw new Error('Ediel-meddelande hittades inte')
  if (message.message_family !== 'UTILTS') {
    throw new Error(`Meddelande ${message.id} är inte UTILTS.`)
  }

  const canonicalLinks = await linkInboundUtiltsMessageCanonically({
    actorUserId,
    message,
  })

  await updateEdielMessageStatus({
    actorUserId,
    edielMessageId: message.id,
    status: 'parsed',
    parsedPayload: message.parsed_payload ?? {},
  })

  if (!canonicalLinks.matchedDataRequest) {
    const ackIds = await createAutomaticPositiveAcks({
      actorUserId,
      sourceMessage: message,
    })

    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: 'validated',
      eventStatus: 'warning',
      message:
        'Inbound UTILTS kvitterades automatiskt men saknar ännu stark data request-koppling.',
      payload: {
        createdAckMessageIds: ackIds,
      },
    })

    return {
      message,
      matchedDataRequest: null,
      ackIds,
    }
  }

  await updateGridOwnerDataRequestStatus({
    actorUserId,
    requestId: canonicalLinks.matchedDataRequest.id,
    status: 'received',
    externalReference:
      message.external_reference ?? canonicalLinks.matchedDataRequest.external_reference ?? null,
    responsePayload: {
      edielMessageId: message.id,
      parsedPayload: message.parsed_payload ?? {},
    },
    notes: null,
  })

  const acknowledgedOutbound = await markDataRequestOutboundAcknowledged({
    actorUserId,
    dataRequestId: canonicalLinks.matchedDataRequest.id,
    externalReference: message.external_reference ?? null,
    edielMessageId: message.id,
  })

  await autoFillMasterdataFromUtilts({
    actorUserId,
    customerId:
      canonicalLinks.siteAndCustomer?.customerId ??
      canonicalLinks.matchedDataRequest.customer_id ??
      null,
    siteId:
      canonicalLinks.siteAndCustomer?.siteId ??
      canonicalLinks.matchedDataRequest.site_id ??
      null,
    meteringPointId:
      canonicalLinks.meteringPointId ??
      canonicalLinks.matchedDataRequest.metering_point_id ??
      null,
    message,
  })

  const ingestedMeterValue = await autoIngestMeteringValueFromUtilts({
    actorUserId,
    customerId:
      canonicalLinks.siteAndCustomer?.customerId ??
      canonicalLinks.matchedDataRequest.customer_id ??
      null,
    siteId:
      canonicalLinks.siteAndCustomer?.siteId ??
      canonicalLinks.matchedDataRequest.site_id ??
      null,
    meteringPointId:
      canonicalLinks.meteringPointId ??
      canonicalLinks.matchedDataRequest.metering_point_id ??
      null,
    gridOwnerId:
      canonicalLinks.siteAndCustomer?.gridOwnerId ??
      canonicalLinks.matchedDataRequest.grid_owner_id ??
      null,
    dataRequestId: canonicalLinks.matchedDataRequest.id,
    message,
  })

  if (acknowledgedOutbound) {
    await syncGridOwnerDataRequestFromOutbound({
      actorUserId,
      outboundRequest: acknowledgedOutbound,
      extraResponsePayload: {
        edielMessageId: message.id,
        parsedPayload: message.parsed_payload ?? {},
        ingestedMeterValueId: ingestedMeterValue?.id ?? null,
      },
    })
  } else {
    await updateGridOwnerDataRequestStatus({
      actorUserId,
      requestId: canonicalLinks.matchedDataRequest.id,
      status: 'received',
      externalReference:
        message.external_reference ??
        canonicalLinks.matchedDataRequest.external_reference ??
        null,
      responsePayload: {
        ...(canonicalLinks.matchedDataRequest.response_payload ?? {}),
        edielMessageId: message.id,
        parsedPayload: message.parsed_payload ?? {},
        ingestedMeterValueId: ingestedMeterValue?.id ?? null,
        acknowledgedVia: 'inbound_ediel_without_outbound',
      },
      notes: canonicalLinks.matchedDataRequest.notes ?? null,
    })
  }

  const ackIds = await createAutomaticPositiveAcks({
    actorUserId,
    sourceMessage: message,
  })

  await createEdielMessageEvent({
    actorUserId,
    edielMessageId: message.id,
    eventType: 'validated',
    eventStatus: 'success',
    message:
      'Inbound UTILTS matchat mot data request, outbound kvitterat och masterdata uppdaterad via canonical motor.',
    payload: {
      matchedGridOwnerDataRequestId: canonicalLinks.matchedDataRequest.id,
      createdAckMessageIds: ackIds,
      outboundRequestId: acknowledgedOutbound?.id ?? null,
      ingestedMeterValueId: ingestedMeterValue?.id ?? null,
    },
  })

  return {
    message,
    matchedDataRequest: canonicalLinks.matchedDataRequest,
    ackIds,
    outboundRequestId: acknowledgedOutbound?.id ?? null,
    ingestedMeterValueId: ingestedMeterValue?.id ?? null,
  }
}