// lib/ediel/flows/prodatSwitch.ts

import { getGridOwnerById, getMeteringPointById, getCustomerSiteById } from '@/lib/masterdata/db'
import {
  createSupplierSwitchEvent,
  getSupplierSwitchRequestById,
} from '@/lib/operations/db'
import { buildProdatZ03FromSwitch, buildProdatZ05FromSwitch, buildProdatZ09FromSwitch } from '@/lib/ediel/prodat'
import { linkEdielMessage } from '@/lib/ediel/db'
import { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import {
  ensureActorUserId,
  finalizeOutboundDraft,
  findOrCreateSwitchOutbound,
  makeServerClient,
  queuePreparedEdielMessage,
} from '@/lib/ediel/flows/shared'

export async function prepareAndQueueEdielZ03(params: {
  actorUserId: string
  switchRequestId: string
  communicationRouteId?: string | null
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const supabase = await makeServerClient()
  const switchRequest = await getSupplierSwitchRequestById(supabase, params.switchRequestId)

  if (!switchRequest) throw new Error('Switch request hittades inte')

  const site = await getCustomerSiteById(supabase, switchRequest.site_id)
  if (!site) throw new Error('Anläggning saknas för switchärendet')

  const meteringPoint = await getMeteringPointById(supabase, switchRequest.metering_point_id)
  if (!meteringPoint) throw new Error('Mätpunkt saknas för switchärendet')

  const gridOwner = switchRequest.grid_owner_id
    ? await getGridOwnerById(supabase, switchRequest.grid_owner_id)
    : null

  const routeContext = await resolveCanonicalOutboundContext({
    requestType: 'supplier_switch',
    gridOwner,
    preferredRouteId: params.communicationRouteId ?? null,
    environment: 'test',
    messageStandard: 'edifact',
  })

  const outbound = await findOrCreateSwitchOutbound({
    actorUserId,
    switchRequestId: switchRequest.id,
    customerId: switchRequest.customer_id,
    siteId: switchRequest.site_id,
    meteringPointId: switchRequest.metering_point_id,
    gridOwnerId: switchRequest.grid_owner_id,
    externalReference: switchRequest.external_reference ?? `SWITCH-${switchRequest.id}`,
    payload: {
      edielCode: 'Z03',
      queuedFrom: 'prepare_switch_z03',
      requestType: switchRequest.request_type,
      requestedStartDate: switchRequest.requested_start_date,
      communicationRouteId: routeContext.route.id,
    },
  })

  const draft = await buildProdatZ03FromSwitch({
    actorUserId,
    senderEdielId: routeContext.senderEdielId,
    senderName: routeContext.senderName,
    receiverEdielId: routeContext.receiverEdielId,
    receiverName: routeContext.receiverName,
    receiverEmail: routeContext.receiverEmail,
    senderSubAddress: routeContext.senderSubAddress,
    receiverSubAddress: routeContext.receiverSubAddress,
    communicationRouteId: routeContext.route.id,
    mailbox: routeContext.mailbox,
    switchRequest,
    site,
    meteringPoint,
    gridOwner,
  })

  const message = await finalizeOutboundDraft({
    actorUserId,
    requestType: 'supplier_switch',
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
    switchRequestId: switchRequest.id,
    customerId: switchRequest.customer_id,
    siteId: switchRequest.site_id,
    meteringPointId: switchRequest.metering_point_id,
    gridOwnerId: switchRequest.grid_owner_id,
    communicationRouteId: routeContext.route.id,
  })

  await queuePreparedEdielMessage({
    actorUserId,
    messageId: message.id,
    outboundRequestId: outbound.id,
    externalReference: switchRequest.external_reference ?? `SWITCH-${switchRequest.id}`,
    payload: { edielCode: 'Z03', routeId: routeContext.route.id },
  })

  await createSupplierSwitchEvent(supabase, {
    switchRequestId: switchRequest.id,
    eventType: 'ediel_prepared',
    eventStatus: 'queued',
    message: 'Ediel Z03 förberett från switchärendet via canonical kernel.',
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
  const actorUserId = ensureActorUserId(params.actorUserId)
  const supabase = await makeServerClient()
  const switchRequest = await getSupplierSwitchRequestById(supabase, params.switchRequestId)

  if (!switchRequest) throw new Error('Switch request hittades inte')

  const site = await getCustomerSiteById(supabase, switchRequest.site_id)
  if (!site) throw new Error('Anläggning saknas för switchärendet')

  const meteringPoint = await getMeteringPointById(supabase, switchRequest.metering_point_id)
  if (!meteringPoint) throw new Error('Mätpunkt saknas för switchärendet')

  const gridOwner = switchRequest.grid_owner_id
    ? await getGridOwnerById(supabase, switchRequest.grid_owner_id)
    : null

  const routeContext = await resolveCanonicalOutboundContext({
    requestType: 'supplier_switch',
    gridOwner,
    preferredRouteId: params.communicationRouteId ?? null,
    environment: 'test',
    messageStandard: 'edifact',
  })

  const outbound = await findOrCreateSwitchOutbound({
    actorUserId,
    switchRequestId: switchRequest.id,
    customerId: switchRequest.customer_id,
    siteId: switchRequest.site_id,
    meteringPointId: switchRequest.metering_point_id,
    gridOwnerId: switchRequest.grid_owner_id,
    externalReference: switchRequest.external_reference ?? `SWITCH-DONE-${switchRequest.id}`,
    payload: {
      edielCode: 'Z05',
      queuedFrom: 'prepare_switch_z05',
      requestType: switchRequest.request_type,
      requestedStartDate: switchRequest.requested_start_date,
      communicationRouteId: routeContext.route.id,
    },
  })

  const draft = await buildProdatZ05FromSwitch({
    actorUserId,
    senderEdielId: routeContext.senderEdielId,
    senderName: routeContext.senderName,
    receiverEdielId: routeContext.receiverEdielId,
    receiverName: routeContext.receiverName,
    receiverEmail: routeContext.receiverEmail,
    senderSubAddress: routeContext.senderSubAddress,
    receiverSubAddress: routeContext.receiverSubAddress,
    communicationRouteId: routeContext.route.id,
    mailbox: routeContext.mailbox,
    switchRequest,
    site,
    meteringPoint,
    gridOwner,
  })

  const message = await finalizeOutboundDraft({
    actorUserId,
    requestType: 'supplier_switch',
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
    switchRequestId: switchRequest.id,
    customerId: switchRequest.customer_id,
    siteId: switchRequest.site_id,
    meteringPointId: switchRequest.metering_point_id,
    gridOwnerId: switchRequest.grid_owner_id,
    communicationRouteId: routeContext.route.id,
  })

  await queuePreparedEdielMessage({
    actorUserId,
    messageId: message.id,
    outboundRequestId: outbound.id,
    externalReference:
      switchRequest.external_reference ?? `SWITCH-DONE-${switchRequest.id}`,
    payload: { edielCode: 'Z05', routeId: routeContext.route.id },
  })

  await createSupplierSwitchEvent(supabase, {
    switchRequestId: switchRequest.id,
    eventType: 'ediel_prepared',
    eventStatus: 'queued',
    message: 'Ediel Z05 förberett från switchärendet via canonical kernel.',
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
  const actorUserId = ensureActorUserId(params.actorUserId)
  const supabase = await makeServerClient()
  const switchRequest = await getSupplierSwitchRequestById(supabase, params.switchRequestId)

  if (!switchRequest) throw new Error('Switch request hittades inte')

  const site = await getCustomerSiteById(supabase, switchRequest.site_id)
  if (!site) throw new Error('Anläggning saknas för switchärendet')

  const meteringPoint = await getMeteringPointById(supabase, switchRequest.metering_point_id)
  if (!meteringPoint) throw new Error('Mätpunkt saknas för switchärendet')

  const gridOwner = switchRequest.grid_owner_id
    ? await getGridOwnerById(supabase, switchRequest.grid_owner_id)
    : null

  const routeContext = await resolveCanonicalOutboundContext({
    requestType: 'supplier_switch',
    gridOwner,
    preferredRouteId: params.communicationRouteId ?? null,
    environment: 'test',
    messageStandard: 'edifact',
  })

  const outbound = await findOrCreateSwitchOutbound({
    actorUserId,
    switchRequestId: switchRequest.id,
    customerId: switchRequest.customer_id,
    siteId: switchRequest.site_id,
    meteringPointId: switchRequest.metering_point_id,
    gridOwnerId: switchRequest.grid_owner_id,
    externalReference: switchRequest.external_reference ?? `MASTERDATA-${switchRequest.id}`,
    payload: {
      edielCode: 'Z09',
      queuedFrom: 'prepare_switch_z09',
      requestType: switchRequest.request_type,
      requestedStartDate: switchRequest.requested_start_date,
      communicationRouteId: routeContext.route.id,
    },
  })

  const draft = await buildProdatZ09FromSwitch({
    actorUserId,
    senderEdielId: routeContext.senderEdielId,
    senderName: routeContext.senderName,
    receiverEdielId: routeContext.receiverEdielId,
    receiverName: routeContext.receiverName,
    receiverEmail: routeContext.receiverEmail,
    senderSubAddress: routeContext.senderSubAddress,
    receiverSubAddress: routeContext.receiverSubAddress,
    communicationRouteId: routeContext.route.id,
    mailbox: routeContext.mailbox,
    switchRequest,
    site,
    meteringPoint,
    gridOwner,
  })

  const message = await finalizeOutboundDraft({
    actorUserId,
    requestType: 'supplier_switch',
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
    switchRequestId: switchRequest.id,
    customerId: switchRequest.customer_id,
    siteId: switchRequest.site_id,
    meteringPointId: switchRequest.metering_point_id,
    gridOwnerId: switchRequest.grid_owner_id,
    communicationRouteId: routeContext.route.id,
  })

  await queuePreparedEdielMessage({
    actorUserId,
    messageId: message.id,
    outboundRequestId: outbound.id,
    externalReference: switchRequest.external_reference ?? `MASTERDATA-${switchRequest.id}`,
    payload: { edielCode: 'Z09', routeId: routeContext.route.id },
  })

  return message
}