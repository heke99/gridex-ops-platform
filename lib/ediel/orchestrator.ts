// lib/ediel/orchestrator.ts

import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  createEdielMessage,
  createEdielMessageEvent,
  getEdielMessageById,
  linkEdielMessage,
  updateEdielMessageStatus,
} from '@/lib/ediel/db'
import { buildAperakDraft, buildContrlDraft, buildUtiltsErrDraft } from '@/lib/ediel/ack'
import { buildProdatZ03FromSwitch, buildProdatZ09FromSwitch } from '@/lib/ediel/prodat'
import {
  findMatchingGridOwnerDataRequest,
  findMatchingSupplierSwitchRequest,
  matchMeteringPointForEdielMessage,
  matchSiteAndCustomerForMeteringPoint,
} from '@/lib/ediel/matching'
import { sendEdielMessageViaSmtp, pollEdielMailboxViaImap } from '@/lib/ediel/transport'
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
  getOutboundRequestById,
  updateGridOwnerDataRequestStatus,
  updateOutboundRequestStatus,
} from '@/lib/cis/db'

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

  let outbound = switchRequest.external_reference
    ? await getOutboundRequestById(switchRequest.external_reference)
    : null

  if (!outbound) {
    outbound = await createOutboundRequest({
      actorUserId: params.actorUserId,
      customerId: switchRequest.customer_id,
      siteId: switchRequest.site_id,
      meteringPointId: switchRequest.metering_point_id,
      gridOwnerId: switchRequest.grid_owner_id,
      requestType: 'supplier_switch',
      sourceType: 'supplier_switch_request',
      sourceId: switchRequest.id,
      externalReference:
        switchRequest.external_reference ?? `SWITCH-${switchRequest.id}`,
      payload: {
        edielCode: 'Z03',
      },
    })
  }

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

  const outbound = await createOutboundRequest({
    actorUserId: params.actorUserId,
    customerId: switchRequest.customer_id,
    siteId: switchRequest.site_id,
    meteringPointId: switchRequest.metering_point_id,
    gridOwnerId: switchRequest.grid_owner_id,
    requestType: 'supplier_switch',
    sourceType: 'supplier_switch_request',
    sourceId: switchRequest.id,
    externalReference:
      switchRequest.external_reference ?? `MASTERDATA-${switchRequest.id}`,
    payload: {
      edielCode: 'Z09',
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
        responsePayload: {
          edielMessageId: message.id,
          parsedPayload: message.parsed_payload,
        },
      })

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
          'Inbound UTILTS matchat mot data request och kvittenser skapade.',
        payload: {
          contrlMessageId: contrl.id,
          aperakMessageId: aperak.id,
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