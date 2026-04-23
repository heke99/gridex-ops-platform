// lib/ediel/flows/aiListFlow.ts

import { getGridOwnerById, getMeteringPointById, getCustomerSiteById } from '@/lib/masterdata/db'
import { buildAiListDetailFromSite, buildAiListOutboundDraft } from '@/lib/ediel/aiList'
import { linkEdielMessage, updateEdielMessageStatus } from '@/lib/ediel/db'
import { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import {
  ensureActorUserId,
  finalizeOutboundDraft,
  makeServerClient,
} from '@/lib/ediel/flows/shared'

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
  const actorUserId = ensureActorUserId(params.actorUserId)
  const supabase = await makeServerClient()
  const site = await getCustomerSiteById(supabase, params.siteId)

  if (!site) throw new Error('Anläggning hittades inte för AI-list export')

  const meteringPoint = params.meteringPointId
    ? await getMeteringPointById(supabase, params.meteringPointId)
    : null

  const gridOwner = site.grid_owner_id
    ? await getGridOwnerById(supabase, site.grid_owner_id)
    : null

  const routeContext = await resolveCanonicalOutboundContext({
    requestType: 'meter_values',
    gridOwner,
    preferredRouteId: params.communicationRouteId ?? null,
    environment: 'test',
    messageStandard: 'ai_list',
  })

  const detail = buildAiListDetailFromSite({
    site,
    meteringPoint,
    gridOwner,
    supplierEdielId: params.supplierEdielId ?? routeContext.senderEdielId,
    balanceResponsibleEdielId: params.balanceResponsibleEdielId ?? null,
  })

  const draft = await buildAiListOutboundDraft({
    actorUserId,
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
    routeDefaultMessageVersion: routeContext.defaultMessageVersion,
  })

  const message = await finalizeOutboundDraft({
    actorUserId,
    requestType: 'meter_values',
    routeContext,
    draft,
    duplicateCheck: {
      receiverEdielId: params.receiverEdielId,
      messageFamily: draft.messageFamily,
      messageCode: String(draft.messageCode),
      messageVersion: draft.messageVersion ?? null,
    },
  })

  await linkEdielMessage({
    actorUserId,
    edielMessageId: message.id,
    customerId: params.customerId,
    siteId: params.siteId,
    meteringPointId: params.meteringPointId ?? null,
    gridOwnerId: site.grid_owner_id,
    communicationRouteId: routeContext.route.id,
  })

  await updateEdielMessageStatus({
    actorUserId,
    edielMessageId: message.id,
    status: 'queued',
  })

  return message
}