// lib/ediel/flows/prodatSwitch.ts

import { getGridOwnerById, getMeteringPointById, getCustomerSiteById } from '@/lib/masterdata/db'
import {
  createSupplierSwitchEvent,
  getSupplierSwitchRequestById,
} from '@/lib/operations/db'
import {
  buildProdatZ03FromSwitch,
  buildProdatZ04FromSwitch,
  buildProdatZ05FromSwitch,
  buildProdatZ06FromSwitch,
  buildProdatZ09FromSwitch,
  buildProdatZ10FromSwitch,
  type ProdatSwitchCode,
} from '@/lib/ediel/prodat'
import { linkEdielMessage } from '@/lib/ediel/db'
import { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import type { CreateEdielMessageInput } from '@/lib/ediel/types'
import type { EdielEnvironment } from '@/lib/ediel/types'
import type {
  CustomerSiteRow,
  GridOwnerRow,
  MeteringPointRow,
} from '@/lib/masterdata/types'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'
import {
  ensureActorUserId,
  finalizeOutboundDraft,
  findOrCreateSwitchOutbound,
  makeServerClient,
  queuePreparedEdielMessage,
} from '@/lib/ediel/flows/shared'

type PrepareProdatSwitchParams = {
  actorUserId: string
  switchRequestId: string
  communicationRouteId?: string | null
  environment?: EdielEnvironment
  forceRegenerate?: boolean
}

type RouteContext = Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>

type BuildDraftInput = {
  actorUserId: string
  routeContext: RouteContext
  switchRequest: SupplierSwitchRequestRow
  site: CustomerSiteRow
  meteringPoint: MeteringPointRow
  gridOwner: GridOwnerRow | null
  externalReference?: string | null
}

function defaultExternalReference(code: ProdatSwitchCode, switchRequestId: string): string {
  if (code === 'Z03') return `SWITCH-${switchRequestId}`
  if (code === 'Z04') return `SWITCH-RESP-${switchRequestId}`
  if (code === 'Z05') return `MOVE-IN-${switchRequestId}`
  if (code === 'Z06') return `MOVE-IN-RESP-${switchRequestId}`
  if (code === 'Z09') return `SITE-UPD-${switchRequestId}`
  return `SITE-UPD-RESP-${switchRequestId}`
}

function makeTgtRetryReference(code: ProdatSwitchCode, switchRequestId: string): string {
  const now = new Date()
  const compact = now
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14)
  const random = Math.random().toString(36).slice(2, 7).toUpperCase()
  return `TGT-${code}-${switchRequestId.slice(0, 8).toUpperCase()}-${compact}-${random}`
}

function eventMessage(code: ProdatSwitchCode): string {
  if (code === 'Z03') return 'Ediel PRODAT Z03 förberett från switchärendet via canonical kernel.'
  if (code === 'Z04') return 'Ediel PRODAT Z04 förberett från switchärendet via canonical kernel.'
  if (code === 'Z05') return 'Ediel PRODAT Z05 förberett från switchärendet via canonical kernel.'
  if (code === 'Z06') return 'Ediel PRODAT Z06 förberett från switchärendet via canonical kernel.'
  if (code === 'Z09') return 'Ediel PRODAT Z09 förberett från switchärendet via canonical kernel.'
  return 'Ediel PRODAT Z10 förberett från switchärendet via canonical kernel.'
}

function buildDraftForCode(
  code: ProdatSwitchCode,
  input: BuildDraftInput
): Promise<CreateEdielMessageInput> {
  const base = {
    actorUserId: input.actorUserId,
    senderEdielId: input.routeContext.senderEdielId,
    senderName: input.routeContext.senderName,
    receiverEdielId: input.routeContext.receiverEdielId,
    receiverName: input.routeContext.receiverName,
    receiverEmail: input.routeContext.receiverEmail,
    senderSubAddress: input.routeContext.senderSubAddress,
    receiverSubAddress: input.routeContext.receiverSubAddress,
    communicationRouteId: input.routeContext.route.id,
    mailbox: input.routeContext.mailbox,
    routeDefaultMessageVersion: input.routeContext.defaultMessageVersion,
    applicationReference: input.routeContext.applicationReference,
    switchRequest: input.switchRequest,
    site: input.site,
    meteringPoint: input.meteringPoint,
    gridOwner: input.gridOwner,
    externalReference: input.externalReference ?? null,
  }

  if (code === 'Z03') return buildProdatZ03FromSwitch(base)
  if (code === 'Z04') return buildProdatZ04FromSwitch(base)
  if (code === 'Z05') return buildProdatZ05FromSwitch(base)
  if (code === 'Z06') return buildProdatZ06FromSwitch(base)
  if (code === 'Z09') return buildProdatZ09FromSwitch(base)
  return buildProdatZ10FromSwitch(base)
}

async function loadSwitchContext(switchRequestId: string) {
  const supabase = await makeServerClient()
  const switchRequest = await getSupplierSwitchRequestById(supabase, switchRequestId)

  if (!switchRequest) throw new Error('Switch request hittades inte')

  const site = await getCustomerSiteById(supabase, switchRequest.site_id)
  if (!site) throw new Error('Anläggning saknas för switchärendet')

  const meteringPoint = await getMeteringPointById(supabase, switchRequest.metering_point_id)
  if (!meteringPoint) throw new Error('Mätpunkt saknas för switchärendet')

  const gridOwner = switchRequest.grid_owner_id
    ? await getGridOwnerById(supabase, switchRequest.grid_owner_id)
    : null

  return {
    supabase,
    switchRequest,
    site,
    meteringPoint,
    gridOwner,
  }
}

export async function prepareAndQueueProdatSwitch(params: PrepareProdatSwitchParams & {
  messageCode: ProdatSwitchCode
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const { supabase, switchRequest, site, meteringPoint, gridOwner } = await loadSwitchContext(
    params.switchRequestId
  )

  const routeContext = await resolveCanonicalOutboundContext({
    requestType: 'supplier_switch',
    gridOwner,
    preferredRouteId: params.communicationRouteId ?? null,
    environment: params.environment ?? 'test',
    messageStandard: 'edifact',
  })

  const forceCreateNewAttempt =
    Boolean(params.forceRegenerate) && routeContext.receiverEdielId === '91100'

  const externalReference = forceCreateNewAttempt
    ? makeTgtRetryReference(params.messageCode, switchRequest.id)
    : switchRequest.external_reference ?? defaultExternalReference(params.messageCode, switchRequest.id)

  const outbound = await findOrCreateSwitchOutbound({
    actorUserId,
    switchRequestId: switchRequest.id,
    customerId: switchRequest.customer_id,
    siteId: switchRequest.site_id,
    meteringPointId: switchRequest.metering_point_id,
    gridOwnerId: switchRequest.grid_owner_id,
    communicationRouteId: routeContext.route.id,
    externalReference,
    forceCreateNewAttempt,
    payload: {
      edielCode: params.messageCode,
      queuedFrom: `prepare_switch_${params.messageCode.toLowerCase()}`,
      requestType: switchRequest.request_type,
      requestedStartDate: switchRequest.requested_start_date,
      communicationRouteId: routeContext.route.id,
      forceRegenerate: Boolean(params.forceRegenerate),
      forceCreateNewAttempt,
    },
  })

  const draft = await buildDraftForCode(params.messageCode, {
    actorUserId,
    routeContext,
    switchRequest,
    site,
    meteringPoint,
    gridOwner,
    externalReference,
  })

  const message = await finalizeOutboundDraft({
    actorUserId,
    requestType: 'supplier_switch',
    routeContext,
    draft,
    outboundRequestId: outbound.id,
    duplicateCheck: {
      sourceType: 'supplier_switch_request',
      sourceId: switchRequest.id,
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
    externalReference,
    payload: {
      edielCode: params.messageCode,
      routeId: routeContext.route.id,
      messageFamily: draft.messageFamily,
      messageCode: draft.messageCode,
      messageVersion: draft.messageVersion ?? null,
    },
  })

  await createSupplierSwitchEvent(supabase, {
    switchRequestId: switchRequest.id,
    eventType: 'ediel_prepared',
    eventStatus: 'queued',
    message: eventMessage(params.messageCode),
    payload: {
      edielMessageId: message.id,
      outboundRequestId: outbound.id,
      routeId: routeContext.route.id,
      edielCode: params.messageCode,
      messageVersion: draft.messageVersion ?? null,
    },
  })

  return message
}

export async function prepareAndQueueEdielZ03(params: PrepareProdatSwitchParams) {
  return prepareAndQueueProdatSwitch({ ...params, messageCode: 'Z03' })
}

export async function prepareAndQueueEdielZ04(params: PrepareProdatSwitchParams) {
  return prepareAndQueueProdatSwitch({ ...params, messageCode: 'Z04' })
}

export async function prepareAndQueueEdielZ05(params: PrepareProdatSwitchParams) {
  return prepareAndQueueProdatSwitch({ ...params, messageCode: 'Z05' })
}

export async function prepareAndQueueEdielZ06(params: PrepareProdatSwitchParams) {
  return prepareAndQueueProdatSwitch({ ...params, messageCode: 'Z06' })
}

export async function prepareAndQueueEdielZ09(params: PrepareProdatSwitchParams) {
  return prepareAndQueueProdatSwitch({ ...params, messageCode: 'Z09' })
}

export async function prepareAndQueueEdielZ10(params: PrepareProdatSwitchParams) {
  return prepareAndQueueProdatSwitch({ ...params, messageCode: 'Z10' })
}
