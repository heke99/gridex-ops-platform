// Extracted from utiltsDataRequest.ts; keep public imports on the facade module.



import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { createEdielMessageEvent, linkEdielMessage, listEdielTestRuns } from '@/lib/ediel/db'
import { createCanonicalAckMessage } from '@/lib/ediel/core/kernel'


import { findOpenOutboundBySource, ingestBillingUnderlay, syncGridOwnerDataRequestFromOutbound, updateOutboundRequestStatus } from '@/lib/cis/db'
import type { GridOwnerDataRequestRow, MeteringValueRow, OutboundRequestRow } from '@/lib/cis/types'
import type { EdielMessageRow } from '@/lib/ediel/types'


import { findMatchingGridOwnerDataRequest, matchMeteringPointForEdielMessage, matchMeteringPointIdByIdentifier, matchSiteAndCustomerForMeteringPoint } from '@/lib/ediel/matching'
import { buildAperakDraft, buildContrlDraft, buildUtiltsErrDraft, getUtiltsAckTransactionTargets, shouldUseTransactionScopedPositiveAperak, type EdielAckScope, type EdielAperakApplicationError } from '@/lib/ediel/ack'
import { updateMeterValueBillingReadiness } from '@/lib/billing/meterValueBillingMatcher'
import { normalizeAndStoreMeteringValue } from '@/lib/metering/normalizeMeteringValues'
import { finalizeUtiltsTransactionAck, resolveUtiltsTransactionId } from '@/lib/ediel/utilts/transactionPersistence'
import type { UtiltsTransactionDisposition } from '@/lib/ediel/utiltsEngine'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'

export type UtiltsProcessResult = {
  message: EdielMessageRow
  matchedDataRequest: GridOwnerDataRequestRow | null
  ackIds: string[]
  outboundRequestId?: string | null
  ingestedMeterValueId?: string | null
  ingestedMeterValueIds?: string[]
  billingUnderlayId?: string | null
}

export function ensureJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function normalizedIso(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00`
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) return trimmed

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return trimmed
  return parsed.toISOString()
}

export function monthAndYearFromPeriod(periodStart: string | null, periodEnd: string | null): {
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

export type UtiltsMeteringSeriesItem = {
  sourceOrder: number
  quantity: number
  readAt: string
  periodStart: string | null
  periodEnd: string | null
  readingType: unknown
  qualityCode: string | null
  transactionReference: string | null
  externalMeteringPointId: string | null
  externalGridAreaId: string | null
  rawItem: Record<string, unknown>
}

export type UtiltsTransactionMatch = {
  transactionReference: string | null
  externalMeteringPointId: string | null
  externalGridAreaId: string | null
  meteringPointId: string | null
  customerId: string | null
  siteId: string | null
  gridOwnerId: string | null
  matchStatus: 'matched' | 'unmatched' | 'not_applicable'
}

export function arrayFromCandidate(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function extractSeriesCandidates(payload: Record<string, unknown>): unknown[] {
  const keys = [
    'values',
    'meteringValues',
    'metering_values',
    'readings',
    'series',
    'timeSeries',
    'time_series',
    'intervals',
    'intervalValues',
    'interval_values',
  ]

  for (const key of keys) {
    const candidate = arrayFromCandidate(payload[key])
    if (candidate.length > 0) return candidate
  }

  return []
}

export function readSeriesQuantity(item: Record<string, unknown>): number | null {
  return (
    numberOrNull(item.quantity) ??
    numberOrNull(item.valueKwh) ??
    numberOrNull(item.value_kwh) ??
    numberOrNull(item.value) ??
    numberOrNull(item.kwh) ??
    numberOrNull(item.energy)
  )
}

export function readSeriesTimestamp(item: Record<string, unknown>, fallback: Record<string, unknown>, message: EdielMessageRow): string | null {
  return (
    normalizedIso(stringOrNull(item.readAt)) ??
    normalizedIso(stringOrNull(item.read_at)) ??
    normalizedIso(stringOrNull(item.timestamp)) ??
    normalizedIso(stringOrNull(item.time)) ??
    normalizedIso(stringOrNull(item.registrationTime)) ??
    normalizedIso(stringOrNull(item.registration_time)) ??
    normalizedIso(stringOrNull(item.periodEnd)) ??
    normalizedIso(stringOrNull(item.period_end)) ??
    stringOrNull(fallback.readAt) ??
    message.message_received_at ??
    message.created_at
  )
}

export function itemToUtiltsSeriesItem(params: {
  item: unknown
  index: number
  fallback: Record<string, unknown>
  message: EdielMessageRow
}): UtiltsMeteringSeriesItem | null {
  if (!params.item || typeof params.item !== 'object' || Array.isArray(params.item)) return null
  const rawItem = params.item as Record<string, unknown>
  const quantity = readSeriesQuantity(rawItem)
  if (quantity === null) return null

  const periodStart =
    normalizedIso(stringOrNull(rawItem.periodStart)) ??
    normalizedIso(stringOrNull(rawItem.period_start)) ??
    normalizedIso(stringOrNull(rawItem.start)) ??
    stringOrNull(params.fallback.periodStart)

  const periodEnd =
    normalizedIso(stringOrNull(rawItem.periodEnd)) ??
    normalizedIso(stringOrNull(rawItem.period_end)) ??
    normalizedIso(stringOrNull(rawItem.end)) ??
    stringOrNull(params.fallback.periodEnd)

  const readAt = readSeriesTimestamp(rawItem, params.fallback, params.message)
  if (!readAt) return null

  return {
    sourceOrder: numberOrNull(rawItem.sourceOrder) ?? numberOrNull(rawItem.source_order) ?? params.index,
    quantity,
    readAt,
    periodStart,
    periodEnd,
    readingType: rawItem.readingType ?? rawItem.reading_type ?? params.fallback.readingType,
    qualityCode:
      stringOrNull(rawItem.qualityCode) ??
      stringOrNull(rawItem.quality_code) ??
      stringOrNull(params.fallback.qualityCode),
    transactionReference: transactionReferenceFromObject(rawItem) ?? transactionReferenceFromObject(params.fallback),
    externalMeteringPointId: externalMeteringPointFromObject(rawItem) ?? externalMeteringPointFromObject(params.fallback),
    externalGridAreaId: externalGridAreaFromObject(rawItem) ?? externalGridAreaFromObject(params.fallback),
    rawItem,
  }
}

export function dateAddMinutes(value: string | null, minutes: number): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Date(date.getTime() + minutes * 60000).toISOString()
}

export function resolutionMinutes(value: unknown): number | null {
  const raw = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (raw === 'PT15M') return 15
  if (raw === 'PT60M') return 60
  const parsed = numberOrNull(value)
  return parsed && parsed > 0 ? parsed : null
}

export function transactionReferenceFromObject(value: Record<string, unknown>): string | null {
  return (
    stringOrNull(value.transactionReference) ??
    stringOrNull(value.transaction_reference) ??
    stringOrNull(value.transactionId) ??
    stringOrNull(value.transaction_id)
  )
}

export function externalMeteringPointFromObject(value: Record<string, unknown>): string | null {
  return (
    stringOrNull(value.meterPointId) ??
    stringOrNull(value.meteringPointId) ??
    stringOrNull(value.externalMeteringPointId) ??
    stringOrNull(value.external_metering_point_id)
  )
}

export function externalGridAreaFromObject(value: Record<string, unknown>): string | null {
  return (
    stringOrNull(value.gridAreaId) ??
    stringOrNull(value.externalGridAreaId) ??
    stringOrNull(value.external_grid_area_id)
  )
}

export function readTransactionMatches(payload: Record<string, unknown>): UtiltsTransactionMatch[] {
  const value = payload.utiltsTransactionMatches
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const row = item as Record<string, unknown>
    const status = stringOrNull(row.matchStatus)
    return [{
      transactionReference: transactionReferenceFromObject(row),
      externalMeteringPointId: externalMeteringPointFromObject(row),
      externalGridAreaId: externalGridAreaFromObject(row),
      meteringPointId: stringOrNull(row.meteringPointId),
      customerId: stringOrNull(row.customerId),
      siteId: stringOrNull(row.siteId),
      gridOwnerId: stringOrNull(row.gridOwnerId),
      matchStatus: status === 'matched' || status === 'not_applicable' ? status : 'unmatched',
    }]
  })
}

export function matchForSeriesItem(item: UtiltsMeteringSeriesItem, matches: readonly UtiltsTransactionMatch[]): UtiltsTransactionMatch | null {
  if (matches.length === 0) return null
  if (item.transactionReference) {
    const byTransaction = matches.find((match) => match.transactionReference === item.transactionReference)
    if (byTransaction) return byTransaction
  }
  if (item.externalMeteringPointId) {
    const byMeteringPoint = matches.find((match) => match.externalMeteringPointId === item.externalMeteringPointId)
    if (byMeteringPoint) return byMeteringPoint
  }
  return null
}

export function flattenUtiltsTransactionSeries(payload: Record<string, unknown>, message: EdielMessageRow): UtiltsMeteringSeriesItem[] {
  const transactions = arrayFromCandidate(payload.transactions)
  if (transactions.length === 0) return []

  const items: UtiltsMeteringSeriesItem[] = []
  for (const [transactionIndex, transaction] of transactions.entries()) {
    if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) continue
    const rawTransaction = transaction as Record<string, unknown>
    const quantities = arrayFromCandidate(rawTransaction.quantities)
    const transactionReference = transactionReferenceFromObject(rawTransaction)
    const externalMeteringPointId = externalMeteringPointFromObject(rawTransaction)
    const externalGridAreaId = externalGridAreaFromObject(rawTransaction)
    const start = normalizedIso(stringOrNull(rawTransaction.deliveryPeriodStart) ?? stringOrNull(rawTransaction.periodStart)) ?? stringOrNull(payload.periodStart)
    const end = normalizedIso(stringOrNull(rawTransaction.deliveryPeriodEnd) ?? stringOrNull(rawTransaction.periodEnd)) ?? stringOrNull(payload.periodEnd)
    const minutes = resolutionMinutes(rawTransaction.resolution ?? payload.resolution)

    for (const [quantityIndex, quantityCandidate] of quantities.entries()) {
      if (!quantityCandidate || typeof quantityCandidate !== 'object' || Array.isArray(quantityCandidate)) continue
      const rawQuantity = quantityCandidate as Record<string, unknown>
      const quantity = readSeriesQuantity(rawQuantity)
      if (quantity === null) continue

      const periodStart = minutes && start ? dateAddMinutes(start, quantityIndex * minutes) : start
      const periodEnd = minutes && periodStart ? dateAddMinutes(periodStart, minutes) : end
      const readAt = periodEnd ?? normalizedIso(stringOrNull(rawTransaction.registrationTime)) ?? stringOrNull(payload.readAt) ?? message.message_received_at ?? message.created_at
      if (!readAt) continue

      items.push({
        sourceOrder: transactionIndex * 10000 + quantityIndex,
        quantity,
        readAt,
        periodStart,
        periodEnd,
        readingType: rawTransaction.readingType ?? payload.readingType,
        qualityCode: stringOrNull(rawQuantity.qualifier) ?? stringOrNull(rawTransaction.qualityCode) ?? stringOrNull(payload.qualityCode),
        transactionReference,
        externalMeteringPointId,
        externalGridAreaId,
        rawItem: {
          transaction: rawTransaction,
          quantity: rawQuantity,
        },
      })
    }
  }

  return items.sort((a, b) => a.sourceOrder - b.sourceOrder)
}

export function extractUtiltsMeteringSeries(
  normalizedPayload: Record<string, unknown>,
  message: EdielMessageRow
): UtiltsMeteringSeriesItem[] {
  const transactionSeries = flattenUtiltsTransactionSeries(normalizedPayload, message)
  if (transactionSeries.length > 0) return transactionSeries

  const candidates = extractSeriesCandidates(normalizedPayload)
  const series = candidates
    .map((item, index) => itemToUtiltsSeriesItem({ item, index, fallback: normalizedPayload, message }))
    .filter((item): item is UtiltsMeteringSeriesItem => Boolean(item))
    .sort((a, b) => a.sourceOrder - b.sourceOrder)

  if (series.length > 0) return series

  const quantity = numberOrNull(normalizedPayload.quantity)
  const readAt = stringOrNull(normalizedPayload.readAt) ?? message.message_received_at ?? message.created_at
  if (quantity === null || !readAt) return []

  return [
    {
      sourceOrder: 0,
      quantity,
      readAt,
      periodStart: stringOrNull(normalizedPayload.periodStart),
      periodEnd: stringOrNull(normalizedPayload.periodEnd),
      readingType: normalizedPayload.readingType,
      qualityCode: stringOrNull(normalizedPayload.qualityCode),
      transactionReference: stringOrNull(normalizedPayload.transactionReference),
      externalMeteringPointId: stringOrNull(normalizedPayload.meterPointId) ?? stringOrNull(normalizedPayload.meteringPointId),
      externalGridAreaId: stringOrNull(normalizedPayload.gridAreaId),
      rawItem: normalizedPayload,
    },
  ]
}

export function totalQuantityFromMeteringSeries(normalizedPayload: Record<string, unknown>, message: EdielMessageRow): number | null {
  const series = extractUtiltsMeteringSeries(normalizedPayload, message)
  if (series.length === 0) return numberOrNull(normalizedPayload.quantity)
  return series.reduce((sum, item) => sum + item.quantity, 0)
}

export function toMeteringReadingType(
  value: unknown
): 'consumption' | 'production' | 'estimated' | 'adjustment' {
  const normalized = typeof value === 'string' ? value.toLowerCase() : ''

  if (normalized.includes('production')) return 'production'
  if (normalized.includes('estimated')) return 'estimated'
  if (normalized.includes('adjust')) return 'adjustment'

  return 'consumption'
}

export function shouldIngestMeteringValue(message: EdielMessageRow): boolean {
  const code = String(message.message_code).toUpperCase()
  return code === 'E66' || code === 'E30'
}

export function shouldCreateBillingUnderlay(params: {
  dataRequest: GridOwnerDataRequestRow
  billingUnderlayId?: string | null
  quantity: number | null
}): boolean {
  if (params.dataRequest.request_scope !== 'billing_underlay') return false
  if (params.billingUnderlayId) return false
  return params.quantity !== null
}

export async function markDataRequestOutboundAcknowledged(params: {
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

export async function maybeIngestMeteringValue(params: {
  actorUserId: string
  customerId: string | null
  siteId: string | null
  meteringPointId: string | null
  gridOwnerId: string | null
  dataRequestId: string | null
  message: EdielMessageRow
  normalizedPayload: Record<string, unknown>
}): Promise<MeteringValueRow[]> {
  if (!shouldIngestMeteringValue(params.message)) return []

  const companyId = stringOrNull(params.message.company_id)
  if (!companyId) return []

  const series = extractUtiltsMeteringSeries(params.normalizedPayload, params.message)
  if (series.length === 0) return []

  const transactionMatches = readTransactionMatches(params.normalizedPayload)
  const rows: MeteringValueRow[] = []
  const skipped: Array<Record<string, unknown>> = []

  for (const item of series) {
    const transactionMatch = matchForSeriesItem(item, transactionMatches)
    const matchedMeteringPointId = transactionMatch?.meteringPointId ?? null
    let meteringPointId = matchedMeteringPointId ?? params.meteringPointId

    if (item.externalMeteringPointId && !matchedMeteringPointId) {
      meteringPointId = await matchMeteringPointIdByIdentifier({
        companyId,
        identifiers: [item.externalMeteringPointId],
      })
    }

    if (!meteringPointId) {
      skipped.push({
        reason: 'metering_point_not_matched_within_tenant',
        transactionReference: item.transactionReference,
        externalMeteringPointId: item.externalMeteringPointId,
        sourceOrder: item.sourceOrder,
      })
      continue
    }

    const siteAndCustomer = transactionMatch?.customerId
      ? {
          customerId: transactionMatch.customerId,
          siteId: transactionMatch.siteId,
          gridOwnerId: transactionMatch.gridOwnerId,
        }
      : await matchSiteAndCustomerForMeteringPoint({
          meteringPointId,
          companyId,
        })

    const customerId = siteAndCustomer?.customerId ?? params.customerId
    if (!customerId) {
      skipped.push({
        reason: 'customer_not_matched_for_metering_point',
        transactionReference: item.transactionReference,
        externalMeteringPointId: item.externalMeteringPointId,
        meteringPointId,
        sourceOrder: item.sourceOrder,
      })
      continue
    }

    if (!item.periodStart || !item.periodEnd) {
      skipped.push({
        reason: 'metering_period_missing',
        transactionReference: item.transactionReference,
        externalMeteringPointId: item.externalMeteringPointId,
        sourceOrder: item.sourceOrder,
      })
      continue
    }

    const rawTransaction = item.rawItem.transaction && typeof item.rawItem.transaction === 'object'
      ? item.rawItem.transaction as Record<string, unknown>
      : item.rawItem
    const rawQuantity = item.rawItem.quantity && typeof item.rawItem.quantity === 'object'
      ? item.rawItem.quantity as Record<string, unknown>
      : item.rawItem
    const readingType = toMeteringReadingType(item.readingType)
    const stored = await normalizeAndStoreMeteringValue({
      companyId,
      customerId,
      siteId: siteAndCustomer?.siteId ?? params.siteId,
      customerSiteId: siteAndCustomer?.siteId ?? params.siteId,
      meteringPointId,
      facilityId: item.externalMeteringPointId,
      gridOwnerId: siteAndCustomer?.gridOwnerId ?? params.gridOwnerId,
      sourceRequestId: params.dataRequestId,
      periodStart: item.periodStart,
      periodEnd: item.periodEnd,
      readAt: item.readAt,
      resolution: stringOrNull(rawTransaction.resolution) ?? stringOrNull(params.normalizedPayload.resolution),
      quantityKwh: item.quantity,
      qualityStatus: item.qualityCode,
      readingType,
      direction: readingType === 'production' ? 'production' : 'consumption',
      unit: 'kWh',
      registerCode: stringOrNull(rawTransaction.registerCode) ?? stringOrNull(rawTransaction.register_code),
      productCode: stringOrNull(rawTransaction.productCode) ?? stringOrNull(rawTransaction.product_code),
      sourceType: 'ediel_utilts',
      sourceMessageId: params.message.id,
      sourceTransactionReference: item.transactionReference,
      sourceLineReference: item.externalMeteringPointId ?? stringOrNull(rawQuantity.lineReference),
      gridArea: item.externalGridAreaId,
      createdBy: params.actorUserId,
      rawPayload: {
        edielMessageId: params.message.id,
        messageCode: params.message.message_code,
        sourceOrder: item.sourceOrder,
        transactionReference: item.transactionReference,
        externalMeteringPointId: item.externalMeteringPointId,
        externalGridAreaId: item.externalGridAreaId,
        seriesItem: item.rawItem,
        normalizedPayload: params.normalizedPayload,
        parsedPayload: params.message.parsed_payload ?? {},
      },
    })
    if (stored.status !== 'stored') {
      skipped.push({
        reason: stored.reason,
        transactionReference: item.transactionReference,
        externalMeteringPointId: item.externalMeteringPointId,
        sourceOrder: item.sourceOrder,
      })
      continue
    }
    await updateMeterValueBillingReadiness({ meterValue: stored.meteringValue, sourceMessageId: params.message.id })
    rows.push(stored.meteringValue)
  }

  if (skipped.length > 0) {
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.message.id,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message: 'Vissa UTILTS-mätvärden sparades inte eftersom de inte kunde kopplas säkert inom tenant.',
      payload: {
        skipped,
        ingestedCount: rows.length,
        companyId,
      },
    })
  }

  return rows
}

export async function maybeCreateBillingUnderlay(params: {
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
  const quantity = totalQuantityFromMeteringSeries(params.normalizedPayload, params.message)

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

export async function createAckIfMissing(params: {
  actorUserId: string
  sourceMessage: EdielMessageRow
  ackFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  outcome?: 'positive' | 'negative'
  messageText?: string | null
  applicationErrors?: readonly EdielAperakApplicationError[] | null
  ackScope?: EdielAckScope | null
  relatedTransactionReference?: string | null
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
            ackScope: params.ackScope ?? null,
            relatedTransactionReference: params.relatedTransactionReference ?? null,
          })
        : buildUtiltsErrDraft({
            actorUserId: params.actorUserId,
            sourceMessage: params.sourceMessage,
            messageText: params.messageText ?? null,
            relatedTransactionReference: params.relatedTransactionReference ?? null,
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
      ackScope: params.ackScope ?? null,
      relatedTransactionReference: params.relatedTransactionReference ?? null,
    },
  })

  return ackMessage
}

export function normalizeTgtCaseCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return code.length > 0 ? code : null
}

export function readTgtCaseCodeFromObject(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  return (
    normalizeTgtCaseCode(record.testCaseCode) ??
    normalizeTgtCaseCode(record.test_case_code) ??
    normalizeTgtCaseCode(record.requestedTestCaseCode) ??
    normalizeTgtCaseCode(record.requested_test_case_code) ??
    normalizeTgtCaseCode(record.selectedTgtCaseCode) ??
    normalizeTgtCaseCode(record.selected_tgt_case_code) ??
    normalizeTgtCaseCode(record.tgtTestCaseCode) ??
    normalizeTgtCaseCode(record.tgt_test_case_code) ??
    normalizeTgtCaseCode(record.activeTgtCaseCode) ??
    normalizeTgtCaseCode(record.active_tgt_case_code)
  )
}

export function readTgtCaseCodeFromMessageContext(message: EdielMessageRow): string | null {
  return (
    readTgtCaseCodeFromObject(message.parsed_payload) ??
    readTgtCaseCodeFromObject(message.validation_report) ??
    normalizeTgtCaseCode(message.failure_reason)
  )
}

export async function resolveActiveUtiltsTgtCaseCodeFromRuns(companyId: string): Promise<string | null> {
  const runs = await listEdielTestRuns({ scope: 'tenant', companyId })
  const active = runs.find((run) => {
    const suite = String(run.test_suite ?? '').toUpperCase()
    const code = normalizeTgtCaseCode(run.test_case_code)
    const status = String(run.status ?? '').toLowerCase()
    return (
      suite === 'UTILTS' &&
      Boolean(code) &&
      !['completed', 'approved', 'cancelled', 'failed', 'archived'].includes(status)
    )
  })

  return normalizeTgtCaseCode(active?.test_case_code ?? null)
}

export async function resolveUtiltsRuntimeTestCaseCode(params: {
  sourceMessage: EdielMessageRow
  explicitTestCaseCode?: string | null
}): Promise<string | null> {
  const explicit = normalizeTgtCaseCode(params.explicitTestCaseCode)
  if (explicit) return explicit

  const stored = readTgtCaseCodeFromMessageContext(params.sourceMessage)
  if (stored) return stored

  if (String(params.sourceMessage.environment ?? '').toLowerCase() !== 'test') return null
  if (String(params.sourceMessage.message_family ?? '').toUpperCase() !== 'UTILTS') return null

  // In TGT the portal does not put "U2.1.8b" in the EDIFACT payload itself.
  // Therefore the production-safe resolver can only infer b-test behavior from
  // the currently active UTILTS test run stored in our own TGT runner context.
  const companyId = params.sourceMessage.company_id
  if (!companyId) throw new Error('UTILTS testmeddelande saknar tenantkoppling')
  return resolveActiveUtiltsTgtCaseCodeFromRuns(companyId)
}

export function isUtiltsBTestCaseMessage(message: EdielMessageRow): boolean {
  return shouldUseTransactionScopedPositiveAperak({ sourceMessage: message })
}

export function shouldCreatePositiveAperakPerTransaction(params: {
  sourceMessage: EdielMessageRow
  outcome?: string | null
  testCaseCode?: string | null
}): boolean {
  if (params.outcome !== 'positive') return false

  return shouldUseTransactionScopedPositiveAperak({
    sourceMessage: params.sourceMessage,
    testCaseCode: params.testCaseCode ?? null,
  })
}

export function sourceRequestsApplicationAcknowledgement(sourceMessage: EdielMessageRow): boolean {
  const bgm = tokenizeEdifact(sourceMessage.raw_payload).segments.find((segment) => segment.tag === 'BGM')
  return String(bgm?.elements[4] ?? '').trim().toUpperCase() === 'AB'
}

export async function createUtiltsRuntimeAcks(params: {
  actorUserId: string
  sourceMessage: EdielMessageRow
  ackPlan: ReturnType<typeof runUtiltsRuntimeForMessage>['ackPlan']
  transactionDispositions?: readonly UtiltsTransactionDisposition[]
  testCaseCode?: string | null
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

  const transactionDispositions = params.transactionDispositions ?? []
  const hasSyntaxRejection = transactionDispositions.some((item) => item.disposition === 'syntax_rejected')
  if (transactionDispositions.length > 0 && !hasSyntaxRejection) {
    const companyId = stringOrNull(params.sourceMessage.company_id)
    if (!companyId) throw new Error('UTILTS transaktionskvittens saknar tenantkoppling')

    for (const [dispositionIndex, disposition] of transactionDispositions.entries()) {
      const transactionReference = resolveUtiltsTransactionId(
        disposition.transactionId,
        dispositionIndex,
      )

      if (disposition.disposition === 'processability_rejected') {
        // Match disposition attribution: unreferenced functional issues apply to
        // every transaction, so keep those codes on each transaction-scoped ERR.
        const codes = params.ackPlan.utiltsErrDetails
          .filter((detail) => {
            const reference = stringOrNull(detail.referenceNumber ?? detail.lineItemReference)
            return reference === null || reference === transactionReference
          })
          .map((detail) => detail.code)
        const utiltsErr = await createAckIfMissing({
          actorUserId: params.actorUserId,
          sourceMessage: params.sourceMessage,
          ackFamily: 'UTILTS_ERR',
          outcome: 'negative',
          messageText: (codes.length > 0 ? codes : ['E14']).join('|'),
          ackScope: 'transaction',
          relatedTransactionReference: transactionReference,
        })
        createdIds.push(utiltsErr.id)
        await finalizeUtiltsTransactionAck({
          companyId,
          environment: params.sourceMessage.environment,
          sourceMessageId: params.sourceMessage.id,
          transactionId: transactionReference,
          responseType: 'utilts_err',
          responseMessageId: utiltsErr.id,
        })
        continue
      }

      if (disposition.disposition === 'guide_rejected') {
        const applicationErrors = params.ackPlan.aperakApplicationErrors.filter((item) => {
          const reference = stringOrNull(item.referenceNumber ?? item.lineItemReference)
          return reference === null || reference === transactionReference
        })
        const aperak = await createAckIfMissing({
          actorUserId: params.actorUserId,
          sourceMessage: params.sourceMessage,
          ackFamily: 'APERAK',
          outcome: 'negative',
          messageText: params.ackPlan.reason,
          applicationErrors,
          ackScope: 'transaction',
          relatedTransactionReference: transactionReference,
        })
        createdIds.push(aperak.id)
        await finalizeUtiltsTransactionAck({
          companyId,
          environment: params.sourceMessage.environment,
          sourceMessageId: params.sourceMessage.id,
          transactionId: transactionReference,
          responseType: 'negative_aperak',
          responseMessageId: aperak.id,
        })
        continue
      }

      if (params.ackPlan.shouldSendAperak || sourceRequestsApplicationAcknowledgement(params.sourceMessage)) {
        const aperak = await createAckIfMissing({
          actorUserId: params.actorUserId,
          sourceMessage: params.sourceMessage,
          ackFamily: 'APERAK',
          outcome: 'positive',
          messageText: 'OK',
          ackScope: 'transaction',
          relatedTransactionReference: transactionReference,
        })
        createdIds.push(aperak.id)
        await finalizeUtiltsTransactionAck({
          companyId,
          environment: params.sourceMessage.environment,
          sourceMessageId: params.sourceMessage.id,
          transactionId: transactionReference,
          responseType: 'positive_aperak',
          responseMessageId: aperak.id,
        })
      }
    }
    return createdIds
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
    const transactionScoped = shouldCreatePositiveAperakPerTransaction({
      sourceMessage: params.sourceMessage,
      outcome: params.ackPlan.aperakOutcome,
      testCaseCode: params.testCaseCode ?? null,
    })

    if (transactionScoped) {
      for (const target of getUtiltsAckTransactionTargets(params.sourceMessage)) {
        const aperak = await createAckIfMissing({
          actorUserId: params.actorUserId,
          sourceMessage: params.sourceMessage,
          ackFamily: 'APERAK',
          outcome: params.ackPlan.aperakOutcome,
          messageText: params.ackPlan.reason,
          applicationErrors: params.ackPlan.aperakApplicationErrors,
          ackScope: 'transaction',
          relatedTransactionReference: target.reference,
        })
        createdIds.push(aperak.id)
      }
    } else {
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
  }

  return createdIds
}

export async function matchUtiltsTransactionsForTenant(params: {
  message: EdielMessageRow
  facts: ReturnType<typeof runUtiltsRuntimeForMessage>['facts']
}): Promise<UtiltsTransactionMatch[]> {
  const companyId = stringOrNull(params.message.company_id)
  if (!companyId) return []

  const transactions = params.facts.transactions.length > 0
    ? params.facts.transactions
    : [{
        transactionId: params.facts.transactionId,
        meterPointId: params.facts.meterPointId,
        gridAreaId: params.facts.gridAreaId,
      }]

  const matches: UtiltsTransactionMatch[] = []
  for (const [transactionIndex, transaction] of transactions.entries()) {
    const transactionReference = resolveUtiltsTransactionId(
      transaction.transactionId,
      transactionIndex,
    )
    const externalMeteringPointId = stringOrNull(transaction.meterPointId)
    const externalGridAreaId = stringOrNull(transaction.gridAreaId)
    const meteringPointId = externalMeteringPointId
      ? await matchMeteringPointIdByIdentifier({ companyId, identifiers: [externalMeteringPointId] })
      : (transactions.length === 1 ? stringOrNull(params.message.metering_point_id) : null)
    const siteAndCustomer = meteringPointId
      ? await matchSiteAndCustomerForMeteringPoint({ meteringPointId, companyId })
      : null

    matches.push({
      transactionReference,
      externalMeteringPointId,
      externalGridAreaId,
      meteringPointId,
      customerId: siteAndCustomer?.customerId ?? null,
      siteId: siteAndCustomer?.siteId ?? null,
      gridOwnerId: siteAndCustomer?.gridOwnerId ?? null,
      matchStatus: externalMeteringPointId ? (meteringPointId ? 'matched' : 'unmatched') : 'not_applicable',
    })
  }

  return matches
}

export function allUtiltsTransactionMeteringPointsMatched(matches: readonly UtiltsTransactionMatch[]): boolean {
  const relevant = matches.filter((match) => Boolean(match.externalMeteringPointId))
  return relevant.length > 0 && relevant.every((match) => Boolean(match.meteringPointId))
}

export async function linkInboundUtiltsMessageCanonically(params: {
  actorUserId: string
  message: EdielMessageRow
  transactionMatches?: readonly UtiltsTransactionMatch[]
}) {
  const transactionMeteringPointId = params.transactionMatches?.find((match) => match.meteringPointId)?.meteringPointId ?? null
  const meteringPointId = await matchMeteringPointForEdielMessage(params.message) ?? transactionMeteringPointId
  const siteAndCustomer = await matchSiteAndCustomerForMeteringPoint({
    meteringPointId,
    companyId: params.message.company_id ?? null,
  })
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
