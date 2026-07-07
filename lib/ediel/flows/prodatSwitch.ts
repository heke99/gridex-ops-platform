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
  buildProdatZ13FromSwitch,
  buildProdatZ14FromSwitch,
  buildProdatZ15FromSwitch,
  buildProdatZ18FromSwitch,
  type ProdatSwitchCode,
} from '@/lib/ediel/prodat'
import { linkEdielMessage } from '@/lib/ediel/db'
import { resolveAuthorizationDocumentIdForPowerOfAttorney } from '@/lib/legal/authorizationChain'
import { isEdielPortalParty } from '@/lib/ediel/core/productionGuards'
import { resolveDecisionBackedOutboundContext } from '@/lib/ediel/flows/routeDecisionContext'
import { createEdielMessageIntent } from '@/lib/ediel/intent/intentEngine'
import type { EdielIntentBusinessProcess } from '@/lib/ediel/intent/types'
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

type RouteContext = Awaited<ReturnType<typeof resolveDecisionBackedOutboundContext>>

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
  if (code === 'Z10') return `SITE-UPD-RESP-${switchRequestId}`
  if (code === 'Z13') return `METERING-ACCESS-${switchRequestId}`
  if (code === 'Z14') return `METERING-ACCESS-RESP-${switchRequestId}`
  if (code === 'Z15') return `METERING-ACCESS-END-${switchRequestId}`
  return `METERING-ACCESS-END-REQ-${switchRequestId}`
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
  if (code === 'Z10') return 'Ediel PRODAT Z10 förberett från switchärendet via canonical kernel.'
  if (code === 'Z13') return 'Ediel PRODAT Z13 för mätvärdesåtkomst förberett via canonical kernel.'
  if (code === 'Z14') return 'Ediel PRODAT Z14 svar på mätvärdesåtkomst förberett via canonical kernel.'
  if (code === 'Z15') return 'Ediel PRODAT Z15 avslut av tillstånd förberett via canonical kernel.'
  return 'Ediel PRODAT Z18 begäran om avslut av rapportering förberett via canonical kernel.'
}

function routeProcessForCode(code: ProdatSwitchCode): 'supplier_switch' | 'metering_access' {
  return code === 'Z13' || code === 'Z14' || code === 'Z15' || code === 'Z18'
    ? 'metering_access'
    : 'supplier_switch'
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
    environment: input.routeContext.environment,
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
  if (code === 'Z10') return buildProdatZ10FromSwitch(base)
  if (code === 'Z13') return buildProdatZ13FromSwitch(base)
  if (code === 'Z14') return buildProdatZ14FromSwitch(base)
  if (code === 'Z15') return buildProdatZ15FromSwitch(base)
  return buildProdatZ18FromSwitch(base)
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

  const routeProcess = routeProcessForCode(params.messageCode)
  const routeContext = await resolveDecisionBackedOutboundContext({
    requestType: routeProcess,
    gridOwner,
    preferredRouteId: params.communicationRouteId ?? null,
    companyId: switchRequest.company_id ?? site.company_id ?? null,
    customerId: switchRequest.customer_id,
    siteId: switchRequest.site_id,
    meteringPointId: switchRequest.metering_point_id,
    supplierSwitchRequestId: switchRequest.id,
    environment: params.environment ?? 'test',
    messageFamily: 'PRODAT',
    messageCode: params.messageCode,
    messageStandard: 'edifact',
    actorUserId,
    payload: {
      requestType: switchRequest.request_type,
      cancellation_requested: switchRequest.status === 'cancellation_requested',
      move_in: switchRequest.request_type === 'move_in',
    },
  })

  const forceCreateNewAttempt =
    Boolean(params.forceRegenerate) && isEdielPortalParty(routeContext.receiverEdielId)

  const externalReference = forceCreateNewAttempt
    ? makeTgtRetryReference(params.messageCode, switchRequest.id)
    : switchRequest.external_reference ?? defaultExternalReference(params.messageCode, switchRequest.id)

  // Propagate the legal authorization chain through the switch outbound and
  // intent. Older switch rows may predate authorization_document_id, so fall
  // back to resolving it from the POA.
  const switchCompanyId = switchRequest.company_id ?? site.company_id ?? null
  const authorizationDocumentId =
    switchRequest.authorization_document_id ??
    (switchRequest.power_of_attorney_id && switchCompanyId
      ? await resolveAuthorizationDocumentIdForPowerOfAttorney({
          companyId: switchCompanyId,
          powerOfAttorneyId: switchRequest.power_of_attorney_id,
        }).catch(() => null)
      : null)

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
      authorization_document_id: authorizationDocumentId,
      power_of_attorney_id: switchRequest.power_of_attorney_id ?? null,
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
  // Keep the legal chain traceable on the rendered message itself.
  draft.parsedPayload = {
    ...(draft.parsedPayload ?? {}),
    authorization_document_id: authorizationDocumentId,
    power_of_attorney_id: switchRequest.power_of_attorney_id ?? null,
  }

  // Mandatory intent in front of rendering. The intent records the validated
  // business decision and links the resulting message/outbox via intent_id.
  const businessProcess: EdielIntentBusinessProcess =
    routeProcess === 'metering_access' ? 'metering_permission' : 'supplier_switch'
  const meteringPointIdentifier =
    String(meteringPoint.ediel_reference || meteringPoint.meter_point_id || '').trim() || null
  const intent = await createEdielMessageIntent({
    actorUserId,
    companyId: switchRequest.company_id ?? site.company_id ?? '',
    environment: routeContext.environment,
    market: 'electricity',
    messageFamily: 'PRODAT',
    messageCode: params.messageCode,
    businessProcess,
    direction: 'outbound',
    senderEdielId: routeContext.senderEdielId,
    senderSubaddress: routeContext.senderSubAddress ?? null,
    receiverEdielId: routeContext.receiverEdielId,
    receiverSubaddress: routeContext.receiverSubAddress ?? null,
    applicationReference: routeContext.applicationReference ?? '',
    routeProfileId: routeContext.route.id,
    communicationRouteId: routeContext.route.id,
    customerId: switchRequest.customer_id,
    customerSiteId: switchRequest.site_id,
    supplierSwitchRequestId: switchRequest.id,
    meteringPointId: meteringPointIdentifier,
    gridAreaCode: String(site.grid_area_code ?? gridOwner?.owner_code ?? '').trim() || null,
    requestedEffectiveDate: switchRequest.requested_start_date ?? null,
    interchangeReference: externalReference,
    messageReference: externalReference,
    transactionReference: draft.transactionReference ?? externalReference,
    idempotencyKey: `prodat-${params.messageCode}:${switchRequest.id}:${externalReference}`,
    payload: {
      edielCode: params.messageCode,
      requestType: switchRequest.request_type,
      authorization_document_id: authorizationDocumentId,
      power_of_attorney_id: switchRequest.power_of_attorney_id ?? null,
      forceRegenerate: Boolean(params.forceRegenerate),
    },
  })
  draft.intentId = intent.id

  const message = await finalizeOutboundDraft({
    actorUserId,
    requestType: routeProcess,
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
    intentId: intent.id,
    payload: {
      edielCode: params.messageCode,
      routeId: routeContext.route.id,
      intentId: intent.id,
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

export async function prepareAndQueueEdielZ13(params: PrepareProdatSwitchParams) {
  return prepareAndQueueProdatSwitch({ ...params, messageCode: 'Z13' })
}

export async function prepareAndQueueEdielZ14(params: PrepareProdatSwitchParams) {
  return prepareAndQueueProdatSwitch({ ...params, messageCode: 'Z14' })
}

export async function prepareAndQueueEdielZ15(params: PrepareProdatSwitchParams) {
  return prepareAndQueueProdatSwitch({ ...params, messageCode: 'Z15' })
}

export async function prepareAndQueueEdielZ18(params: PrepareProdatSwitchParams) {
  return prepareAndQueueProdatSwitch({ ...params, messageCode: 'Z18' })
}
