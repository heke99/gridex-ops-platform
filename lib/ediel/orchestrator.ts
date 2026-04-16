import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
import {
  createEdielMessage,
  createEdielMessageEvent,
  getEdielMessageById,
  linkEdielMessage,
  updateEdielMessageStatus,
} from '@/lib/ediel/db'
import {
  buildAperakDraft,
  buildContrlDraft,
  buildUtiltsErrDraft,
} from '@/lib/ediel/ack'
import {
  buildProdatZ03FromSwitch,
  buildProdatZ09FromSwitch,
} from '@/lib/ediel/prodat'
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
import type { EdielMessageRow } from '@/lib/ediel/types'

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

export async function prepareAndQueueEdielZ03(params: {
  actorUserId: string
  senderEdielId: string
  receiverEdielId: string
  receiverEmail?: string | null
  switchRequestId: string
  communicationRouteId?: string | null
  mailbox?: string | null
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
    },
  })

  const draft = buildProdatZ03FromSwitch({
    actorUserId: params.actorUserId,
    senderEdielId: params.senderEdielId,
    receiverEdielId: params.receiverEdielId,
    receiverEmail: params.receiverEmail ?? null,
    communicationRouteId:
      params.communicationRouteId ?? outbound.communication_route_id,
    mailbox: params.mailbox ?? null,
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
    communicationRouteId:
      params.communicationRouteId ?? outbound.communication_route_id,
  })

  await updateEdielMessageStatus({
    actorUserId: params.actorUserId,
    id: message.id,
    status: 'queued',
  })

  await updateOutboundRequestStatus({
    actorUserId: params.actorUserId,
    outboundRequestId: outbound.id,
    status: 'prepared',
    externalReference:
      switchRequest.external_reference ?? `SWITCH-${switchRequest.id}`,
    responsePayload: {
      edielMessageId: message.id,
      edielCode: 'Z03',
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
    },
  })

  return message
}

export async function prepareAndQueueEdielZ09(params: {
  actorUserId: string
  senderEdielId: string
  receiverEdielId: string
  receiverEmail?: string | null
  switchRequestId: string
  communicationRouteId?: string | null
  mailbox?: string | null
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
    },
  })

  const draft = buildProdatZ09FromSwitch({
    actorUserId: params.actorUserId,
    senderEdielId: params.senderEdielId,
    receiverEdielId: params.receiverEdielId,
    receiverEmail: params.receiverEmail ?? null,
    communicationRouteId:
      params.communicationRouteId ?? outbound.communication_route_id,
    mailbox: params.mailbox ?? null,
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
    communicationRouteId:
      params.communicationRouteId ?? outbound.communication_route_id,
  })

  await updateEdielMessageStatus({
    actorUserId: params.actorUserId,
    id: message.id,
    status: 'queued',
  })

  await updateOutboundRequestStatus({
    actorUserId: params.actorUserId,
    outboundRequestId: outbound.id,
    status: 'prepared',
    externalReference:
      switchRequest.external_reference ?? `MASTERDATA-${switchRequest.id}`,
    responsePayload: {
      edielMessageId: message.id,
      edielCode: 'Z09',
    },
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