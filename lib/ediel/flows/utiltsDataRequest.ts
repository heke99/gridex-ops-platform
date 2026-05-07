// lib/ediel/flows/utiltsDataRequest.ts

import {
  getCustomerSiteById,
  getGridOwnerById,
  getMeteringPointById,
} from '@/lib/masterdata/db'
import { buildUtiltsOutboundDraft } from '@/lib/ediel/utilts'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import {
  createEdielMessageEvent,
  getEdielMessageById,
  linkEdielMessage,
  updateEdielMessageStatus,
} from '@/lib/ediel/db'
import { resolveCanonicalOutboundContext, createCanonicalAckMessage } from '@/lib/ediel/core/kernel'
import {
  ensureActorUserId,
  finalizeOutboundDraft,
  findOrCreateDataRequestOutbound,
  getGridOwnerDataRequestById,
  makeServerClient,
  queuePreparedEdielMessage,
} from '@/lib/ediel/flows/shared'
import {
  findOpenOutboundBySource,
  ingestBillingUnderlay,
  ingestMeteringValue,
  syncGridOwnerDataRequestFromOutbound,
  syncGridOwnerDataRequestReceivedFromEdiel,
  updateGridOwnerDataRequestStatus,
  updateOutboundRequestStatus,
} from '@/lib/cis/db'
import type { GridOwnerDataRequestRow, OutboundRequestRow } from '@/lib/cis/types'
import type { EdielMessageRow } from '@/lib/ediel/types'
import {
  findMatchingGridOwnerDataRequest,
  matchMeteringPointForEdielMessage,
  matchSiteAndCustomerForMeteringPoint,
} from '@/lib/ediel/matching'
import {
  buildAperakDraft,
  buildContrlDraft,
  buildUtiltsErrDraft,
  getAutomaticAckPolicy,
  type EdielAperakApplicationError,
} from '@/lib/ediel/ack'

type UtiltsProcessResult = {
  message: EdielMessageRow
  matchedDataRequest: GridOwnerDataRequestRow | null
  ackIds: string[]
  outboundRequestId?: string | null
  ingestedMeterValueId?: string | null
  billingUnderlayId?: string | null
}

function ensureJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

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

function normalizedIso(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00`
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) return trimmed

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return trimmed
  return parsed.toISOString()
}

function monthAndYearFromPeriod(periodStart: string | null, periodEnd: string | null): {
  month: number | null
  year: number | null
} {
  const value = periodEnd ?? periodStart
  if (!value) return { month: null, year: null }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { month: null, year: null }

  return {
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear(),
  }
}

function normalizeMeteringPayload(message: EdielMessageRow): Record<string, unknown> {
  const parsed = ensureJson(message.parsed_payload)
  const quantity = numberOrNull(parsed.quantity)
  const periodStart = normalizedIso(stringOrNull(parsed.periodStart))
  const periodEnd = normalizedIso(stringOrNull(parsed.periodEnd))
  const readAt =
    normalizedIso(stringOrNull(parsed.readAt)) ??
    normalizedIso(stringOrNull(parsed.registrationTime)) ??
    periodEnd ??
    periodStart ??
    message.message_received_at ??
    message.created_at

  return {
    ...parsed,
    quantity,
    valueKwh: quantity,
    periodStart,
    periodEnd,
    readAt,
    meterPointId: stringOrNull(parsed.meterPointId) ?? stringOrNull(parsed.meteringPointId),
    meteringPointId: stringOrNull(parsed.meteringPointId) ?? stringOrNull(parsed.meterPointId),
    gridAreaId: stringOrNull(parsed.gridAreaId),
    readingType: stringOrNull(parsed.readingType) ?? 'consumption',
    qualityCode: stringOrNull(parsed.qualityCode),
    unit: stringOrNull(parsed.unit) ?? 'KWH',
    source: 'ediel_utilts',
  }
}

function toMeteringReadingType(
  value: unknown
): 'consumption' | 'production' | 'estimated' | 'adjustment' {
  const normalized = typeof value === 'string' ? value.toLowerCase() : ''

  if (normalized.includes('production')) return 'production'
  if (normalized.includes('estimated')) return 'estimated'
  if (normalized.includes('adjust')) return 'adjustment'

  return 'consumption'
}

function shouldIngestMeteringValue(message: EdielMessageRow): boolean {
  const code = String(message.message_code).toUpperCase()
  return code === 'E66' || code === 'E30'
}

function shouldCreateBillingUnderlay(params: {
  dataRequest: GridOwnerDataRequestRow
  billingUnderlayId?: string | null
  quantity: number | null
}): boolean {
  if (params.dataRequest.request_scope !== 'billing_underlay') return false
  if (params.billingUnderlayId) return false
  return params.quantity !== null
}

async function markDataRequestOutboundAcknowledged(params: {
  actorUserId: string
  dataRequestId: string
  externalReference: string | null
  edielMessageId: string
  normalizedPayload: Record<string, unknown>
}): Promise<OutboundRequestRow | null> {
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
      ...(ensureJson(outbound.response_payload)),
      edielMessageId: params.edielMessageId,
      acknowledgedVia: 'inbound_utilts',
      normalizedMeteringPayload: params.normalizedPayload,
    },
  })

  await syncGridOwnerDataRequestFromOutbound({
    actorUserId: params.actorUserId,
    outboundRequest: updatedOutbound,
    extraResponsePayload: {
      edielMessageId: params.edielMessageId,
      acknowledgedVia: 'inbound_utilts',
      normalizedMeteringPayload: params.normalizedPayload,
    },
  })

  return updatedOutbound
}

async function maybeIngestMeteringValue(params: {
  actorUserId: string
  customerId: string | null
  siteId: string | null
  meteringPointId: string | null
  gridOwnerId: string | null
  dataRequestId: string | null
  message: EdielMessageRow
  normalizedPayload: Record<string, unknown>
}) {
  const quantity = numberOrNull(params.normalizedPayload.quantity)

  if (!shouldIngestMeteringValue(params.message)) return null
  if (!params.customerId || !params.meteringPointId || quantity === null) return null

  return ingestMeteringValue({
    actorUserId: params.actorUserId,
    customerId: params.customerId,
    siteId: params.siteId,
    meteringPointId: params.meteringPointId,
    sourceRequestId: params.dataRequestId,
    gridOwnerId: params.gridOwnerId,
    readingType: toMeteringReadingType(params.normalizedPayload.readingType),
    valueKwh: quantity,
    qualityCode: stringOrNull(params.normalizedPayload.qualityCode),
    readAt:
      stringOrNull(params.normalizedPayload.readAt) ??
      params.message.message_received_at ??
      params.message.created_at,
    periodStart: stringOrNull(params.normalizedPayload.periodStart),
    periodEnd: stringOrNull(params.normalizedPayload.periodEnd),
    sourceSystem: 'ediel_utilts',
    rawPayload: {
      edielMessageId: params.message.id,
      messageCode: params.message.message_code,
      normalizedPayload: params.normalizedPayload,
      parsedPayload: params.message.parsed_payload ?? {},
    },
  })
}

async function maybeCreateBillingUnderlay(params: {
  actorUserId: string
  dataRequest: GridOwnerDataRequestRow
  customerId: string | null
  siteId: string | null
  meteringPointId: string | null
  gridOwnerId: string | null
  message: EdielMessageRow
  normalizedPayload: Record<string, unknown>
}) {
  const currentResponse = ensureJson(params.dataRequest.response_payload)
  const existingBillingUnderlayId = stringOrNull(currentResponse.billingUnderlayId)
  const quantity = numberOrNull(params.normalizedPayload.quantity)

  if (
    !shouldCreateBillingUnderlay({
      dataRequest: params.dataRequest,
      billingUnderlayId: existingBillingUnderlayId,
      quantity,
    })
  ) {
    return null
  }

  if (!params.customerId) return null

  const { month, year } = monthAndYearFromPeriod(
    stringOrNull(params.normalizedPayload.periodStart),
    stringOrNull(params.normalizedPayload.periodEnd)
  )

  return ingestBillingUnderlay({
    actorUserId: params.actorUserId,
    customerId: params.customerId,
    siteId: params.siteId,
    meteringPointId: params.meteringPointId,
    sourceRequestId: params.dataRequest.id,
    gridOwnerId: params.gridOwnerId,
    underlayMonth: month,
    underlayYear: year,
    status: 'received',
    totalKwh: quantity,
    sourceSystem: 'ediel_utilts',
    payload: {
      edielMessageId: params.message.id,
      messageCode: params.message.message_code,
      normalizedPayload: params.normalizedPayload,
      parsedPayload: params.message.parsed_payload ?? {},
    },
  })
}

async function createAckIfMissing(params: {
  actorUserId: string
  sourceMessage: EdielMessageRow
  ackFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  outcome?: 'positive' | 'negative'
  messageText?: string | null
  applicationErrors?: readonly EdielAperakApplicationError[] | null
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
            applicationErrors: params.applicationErrors ?? null,
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
      messageText: 'Automatiskt CONTRL för mottaget UTILTS.',
    })
    createdIds.push(contrl.id)
  }

  if (policy.shouldSendPositiveAperak) {
    const aperak = await createAckIfMissing({
      actorUserId: params.actorUserId,
      sourceMessage: params.sourceMessage,
      ackFamily: 'APERAK',
      outcome: 'positive',
      messageText: 'Automatiskt APERAK för mottaget UTILTS.',
    })
    createdIds.push(aperak.id)
  }

  return createdIds
}

function isUtiltsBTestCaseMessage(message: EdielMessageRow): boolean {
  const text = JSON.stringify({
    parsedPayload: message.parsed_payload,
    validationReport: message.validation_report,
    failureReason: message.failure_reason,
    subject: message.subject,
    fileName: message.file_name,
  }).toUpperCase()

  return /U2\.2\.(3|4)B/.test(text)
}

async function createUtiltsRuntimeAcks(params: {
  actorUserId: string
  sourceMessage: EdielMessageRow
  ackPlan: ReturnType<typeof runUtiltsRuntimeForMessage>['ackPlan']
}) {
  const createdIds: string[] = []

  if (params.ackPlan.shouldSendContrl && params.ackPlan.contrlOutcome) {
    const contrl = await createAckIfMissing({
      actorUserId: params.actorUserId,
      sourceMessage: params.sourceMessage,
      ackFamily: 'CONTRL',
      outcome: params.ackPlan.contrlOutcome,
      messageText: params.ackPlan.reason,
    })
    createdIds.push(contrl.id)
  }

  if (params.ackPlan.shouldSendUtiltsErr) {
    const codes = params.ackPlan.utiltsErrCodes.length > 0 ? params.ackPlan.utiltsErrCodes : ['E14']
    const utiltsErrMessages = isUtiltsBTestCaseMessage(params.sourceMessage) ? codes : [codes.join('|')]

    for (const messageText of utiltsErrMessages) {
      const utiltsErr = await createAckIfMissing({
        actorUserId: params.actorUserId,
        sourceMessage: params.sourceMessage,
        ackFamily: 'UTILTS_ERR',
        outcome: 'negative',
        messageText,
      })
      createdIds.push(utiltsErr.id)
    }
  }

  if (params.ackPlan.shouldSendAperak && params.ackPlan.aperakOutcome) {
    const aperak = await createAckIfMissing({
      actorUserId: params.actorUserId,
      sourceMessage: params.sourceMessage,
      ackFamily: 'APERAK',
      outcome: params.ackPlan.aperakOutcome,
      messageText: params.ackPlan.reason,
      applicationErrors: params.ackPlan.aperakApplicationErrors,
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
    customerId: siteAndCustomer?.customerId ?? matchedDataRequest?.customer_id ?? null,
    siteId: siteAndCustomer?.siteId ?? matchedDataRequest?.site_id ?? null,
    meteringPointId: meteringPointId ?? matchedDataRequest?.metering_point_id ?? null,
    gridOwnerId: siteAndCustomer?.gridOwnerId ?? matchedDataRequest?.grid_owner_id ?? null,
    relatedMessageId: null,
  })

  return {
    meteringPointId,
    siteAndCustomer,
    matchedDataRequest,
  }
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
    communicationRouteId: routeContext.route.id,
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
    routeDefaultMessageVersion: routeContext.defaultMessageVersion,
    payload: {
      meterPointId: meteringPoint?.meter_point_id ?? null,
      meteringPointId: meteringPoint?.meter_point_id ?? null,
      gridAreaId: gridOwner?.owner_code ?? gridOwner?.ediel_id ?? null,
      requestedPeriodStart: dataRequest.requested_period_start,
      requestedPeriodEnd: dataRequest.requested_period_end,
      periodStart: dataRequest.requested_period_start,
      periodEnd: dataRequest.requested_period_end,
      transactionReason: 'Begäran om saknade validerade mätvärden',
      requestScope: dataRequest.request_scope,
      siteType: site?.site_type ?? 'consumption',
      readingFrequency: meteringPoint?.reading_frequency ?? null,
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
      ...(ensureJson(dataRequest.response_payload)),
      edielMessageId: message.id,
      outboundRequestId: outbound.id,
      preparedVia: 'prepareAndQueueUtiltsE73',
      requestedVia: 'UTILTS_E73',
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
    communicationRouteId: routeContext.route.id,
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
    routeDefaultMessageVersion: routeContext.defaultMessageVersion,
    payload: {
      meterPointId: meteringPoint?.meter_point_id ?? null,
      meteringPointId: meteringPoint?.meter_point_id ?? null,
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
      sourceType: 'grid_owner_data_request',
      sourceId: dataRequest.id,
      receiverEdielId: routeContext.receiverEdielId,
      messageFamily: draft.messageFamily,
      messageCode: String(draft.messageCode),
      messageVersion: draft.messageVersion ?? null,
      periodStart: params.periodStart ?? dataRequest.requested_period_start,
      periodEnd: params.periodEnd ?? dataRequest.requested_period_end,
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
      edielCode: 'E66',
      routeId: routeContext.route.id,
      gridOwnerDataRequestId: dataRequest.id,
    },
  })

  return message
}

export async function processInboundUtiltsMessage(params: {
  actorUserId: string
  edielMessageId: string
}): Promise<UtiltsProcessResult> {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const message = await getEdielMessageById(params.edielMessageId)

  if (!message) throw new Error('Ediel-meddelande hittades inte')
  if (message.message_family !== 'UTILTS') {
    throw new Error(`Meddelande ${message.id} är inte UTILTS.`)
  }

  const runtime = runUtiltsRuntimeForMessage(message)
  const normalizedPayload = runtime.normalizedPayload
  const canonicalLinks = await linkInboundUtiltsMessageCanonically({
    actorUserId,
    message,
  })

  await updateEdielMessageStatus({
    actorUserId,
    edielMessageId: message.id,
    status: 'parsed',
    parsedPayload: {
      ...(message.parsed_payload ?? {}),
      normalizedMeteringPayload: normalizedPayload,
      utiltsRuntimeFacts: runtime.facts,
    },
    validationReport: {
      ...(message.validation_report ?? {}),
      utiltsRuntime: {
        validation: runtime.validation,
        ackPlan: runtime.ackPlan,
      },
    },
  })

  if (!runtime.validation.ok) {
    const ackIds = await createUtiltsRuntimeAcks({
      actorUserId,
      sourceMessage: message,
      ackPlan: runtime.ackPlan,
    })

    await updateEdielMessageStatus({
      actorUserId,
      edielMessageId: message.id,
      status: runtime.validation.classification === 'syntax_rejected' ? 'failed' : 'validated',
      failureReason: runtime.ackPlan.reason,
      parsedPayload: {
        ...(message.parsed_payload ?? {}),
        normalizedMeteringPayload: normalizedPayload,
        utiltsRuntimeFacts: runtime.facts,
      },
      validationReport: {
        ...(message.validation_report ?? {}),
        utiltsRuntime: {
          validation: runtime.validation,
          ackPlan: runtime.ackPlan,
          createdAckMessageIds: ackIds,
        },
      },
    })

    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: 'validated',
      eventStatus: 'warning',
      message: 'Inbound UTILTS avvisades av produktionsruntime och korrekt kvittensflöde skapades.',
      payload: {
        createdAckMessageIds: ackIds,
        normalizedMeteringPayload: normalizedPayload,
        validation: runtime.validation,
        ackPlan: runtime.ackPlan,
      },
    })

    return {
      message,
      matchedDataRequest: canonicalLinks.matchedDataRequest,
      ackIds,
      outboundRequestId: null,
      ingestedMeterValueId: null,
      billingUnderlayId: null,
    }
  }

  if (!canonicalLinks.matchedDataRequest) {
    const ackIds = await createUtiltsRuntimeAcks({
      actorUserId,
      sourceMessage: message,
      ackPlan: runtime.ackPlan,
    })

    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: 'validated',
      eventStatus: 'warning',
      message:
        'Inbound UTILTS accepterades och kvitterades av produktionsruntime men saknar stark data request-koppling.',
      payload: {
        createdAckMessageIds: ackIds,
        normalizedMeteringPayload: normalizedPayload,
        validation: runtime.validation,
        ackPlan: runtime.ackPlan,
      },
    })

    return {
      message,
      matchedDataRequest: null,
      ackIds,
      outboundRequestId: null,
      ingestedMeterValueId: null,
      billingUnderlayId: null,
    }
  }

  const dataRequest = canonicalLinks.matchedDataRequest
  const customerId = canonicalLinks.siteAndCustomer?.customerId ?? dataRequest.customer_id ?? null
  const siteId = canonicalLinks.siteAndCustomer?.siteId ?? dataRequest.site_id ?? null
  const meteringPointId = canonicalLinks.meteringPointId ?? dataRequest.metering_point_id ?? null
  const gridOwnerId = canonicalLinks.siteAndCustomer?.gridOwnerId ?? dataRequest.grid_owner_id ?? null

  const acknowledgedOutbound = await markDataRequestOutboundAcknowledged({
    actorUserId,
    dataRequestId: dataRequest.id,
    externalReference: message.external_reference ?? null,
    edielMessageId: message.id,
    normalizedPayload,
  })

  const ingestedMeterValue = await maybeIngestMeteringValue({
    actorUserId,
    customerId,
    siteId,
    meteringPointId,
    gridOwnerId,
    dataRequestId: dataRequest.id,
    message,
    normalizedPayload,
  })

  const billingUnderlay = await maybeCreateBillingUnderlay({
    actorUserId,
    dataRequest,
    customerId,
    siteId,
    meteringPointId,
    gridOwnerId,
    message,
    normalizedPayload,
  })

  await syncGridOwnerDataRequestReceivedFromEdiel({
    actorUserId,
    requestId: dataRequest.id,
    edielMessageId: message.id,
    externalReference: message.external_reference ?? dataRequest.external_reference ?? null,
    parsedPayload: message.parsed_payload ?? {},
    ingestedMeterValueId: ingestedMeterValue?.id ?? null,
    notes: dataRequest.notes ?? null,
    extraResponsePayload: {
      normalizedMeteringPayload: normalizedPayload,
      utiltsRuntime: {
        validation: runtime.validation,
        ackPlan: runtime.ackPlan,
      },
      outboundRequestId: acknowledgedOutbound?.id ?? null,
      billingUnderlayId: billingUnderlay?.id ?? null,
      billingUnderlayCandidate:
        dataRequest.request_scope === 'billing_underlay'
          ? {
              status: billingUnderlay ? 'created' : 'not_created',
              reason: billingUnderlay
                ? 'billing_underlay_created_from_inbound_utilts'
                : 'missing_customer_or_quantity_or_existing_underlay',
            }
          : null,
    },
  })

  const ackIds = await createUtiltsRuntimeAcks({
    actorUserId,
    sourceMessage: message,
    ackPlan: runtime.ackPlan,
  })

  await updateEdielMessageStatus({
    actorUserId,
    edielMessageId: message.id,
    status: 'validated',
    parsedPayload: {
      ...(message.parsed_payload ?? {}),
      normalizedMeteringPayload: normalizedPayload,
      utiltsRuntimeFacts: runtime.facts,
      ingestedMeterValueId: ingestedMeterValue?.id ?? null,
      billingUnderlayId: billingUnderlay?.id ?? null,
    },
    validationReport: {
      ...(message.validation_report ?? {}),
      utiltsRuntime: {
        validation: runtime.validation,
        ackPlan: runtime.ackPlan,
        createdAckMessageIds: ackIds,
      },
    },
  })

  await createEdielMessageEvent({
    actorUserId,
    edielMessageId: message.id,
    eventType: 'validated',
    eventStatus: 'success',
    message:
      'Inbound UTILTS matchat mot data request, mätvärde/fakturaunderlag hanterat och kvitterat av produktionsruntime.',
    payload: {
      matchedGridOwnerDataRequestId: dataRequest.id,
      createdAckMessageIds: ackIds,
      outboundRequestId: acknowledgedOutbound?.id ?? null,
      ingestedMeterValueId: ingestedMeterValue?.id ?? null,
      billingUnderlayId: billingUnderlay?.id ?? null,
      normalizedMeteringPayload: normalizedPayload,
      validation: runtime.validation,
      ackPlan: runtime.ackPlan,
    },
  })

  return {
    message,
    matchedDataRequest: dataRequest,
    ackIds,
    outboundRequestId: acknowledgedOutbound?.id ?? null,
    ingestedMeterValueId: ingestedMeterValue?.id ?? null,
    billingUnderlayId: billingUnderlay?.id ?? null,
  }
}
