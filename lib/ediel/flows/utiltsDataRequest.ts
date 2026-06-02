// lib/ediel/flows/utiltsDataRequest.ts

import {
  getCustomerSiteById,
  getGridOwnerById,
  getMeteringPointById,
} from '@/lib/masterdata/db'
import { buildUtiltsOutboundDraft } from '@/lib/ediel/utilts'
import { applyUtiltsTgtAckPlanOverride, runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import {
  createEdielMessageEvent,
  getEdielMessageById,
  linkEdielMessage,
  listEdielTestRuns,
  updateEdielMessageStatus,
} from '@/lib/ediel/db'
import { createCanonicalAckMessage } from '@/lib/ediel/core/kernel'
import { resolveDecisionBackedOutboundContext } from '@/lib/ediel/flows/routeDecisionContext'
import {
  ensureActorUserId,
  finalizeOutboundDraft,
  findOrCreateDataRequestOutbound,
  getGridOwnerDataRequestById,
  makeServerClient,
  queuePreparedEdielMessage,
  resolveOutboundRuntimeEnvironment,
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
import type { GridOwnerDataRequestRow, MeteringValueRow, OutboundRequestRow } from '@/lib/cis/types'
import type { EdielEnvironment, EdielMessageRow } from '@/lib/ediel/types'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import { findActiveMeteringPermissionForUtiltsMessage } from '@/lib/onboarding/inboundEdielLinking'
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
  getUtiltsAckTransactionTargets,
  shouldUseTransactionScopedPositiveAperak,
  type EdielAckScope,
  type EdielAperakApplicationError,
} from '@/lib/ediel/ack'
import { updateMeterValueBillingReadiness } from '@/lib/billing/meterValueBillingMatcher'

type UtiltsProcessResult = {
  message: EdielMessageRow
  matchedDataRequest: GridOwnerDataRequestRow | null
  ackIds: string[]
  outboundRequestId?: string | null
  ingestedMeterValueId?: string | null
  ingestedMeterValueIds?: string[]
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

type UtiltsMeteringSeriesItem = {
  sourceOrder: number
  quantity: number
  readAt: string
  periodStart: string | null
  periodEnd: string | null
  readingType: unknown
  qualityCode: string | null
  rawItem: Record<string, unknown>
}

function arrayFromCandidate(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function extractSeriesCandidates(payload: Record<string, unknown>): unknown[] {
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

function readSeriesQuantity(item: Record<string, unknown>): number | null {
  return (
    numberOrNull(item.quantity) ??
    numberOrNull(item.valueKwh) ??
    numberOrNull(item.value_kwh) ??
    numberOrNull(item.value) ??
    numberOrNull(item.kwh) ??
    numberOrNull(item.energy)
  )
}

function readSeriesTimestamp(item: Record<string, unknown>, fallback: Record<string, unknown>, message: EdielMessageRow): string | null {
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

function itemToUtiltsSeriesItem(params: {
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
    rawItem,
  }
}

function extractUtiltsMeteringSeries(
  normalizedPayload: Record<string, unknown>,
  message: EdielMessageRow
): UtiltsMeteringSeriesItem[] {
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
      rawItem: normalizedPayload,
    },
  ]
}

function totalQuantityFromMeteringSeries(normalizedPayload: Record<string, unknown>, message: EdielMessageRow): number | null {
  const series = extractUtiltsMeteringSeries(normalizedPayload, message)
  if (series.length === 0) return numberOrNull(normalizedPayload.quantity)
  return series.reduce((sum, item) => sum + item.quantity, 0)
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
}): Promise<MeteringValueRow[]> {
  if (!shouldIngestMeteringValue(params.message)) return []
  if (!params.customerId || !params.meteringPointId) return []

  const series = extractUtiltsMeteringSeries(params.normalizedPayload, params.message)
  if (series.length === 0) return []

  const rows: MeteringValueRow[] = []

  for (const item of series) {
    const row = await ingestMeteringValue({
      actorUserId: params.actorUserId,
      customerId: params.customerId,
      siteId: params.siteId,
      meteringPointId: params.meteringPointId,
      sourceRequestId: params.dataRequestId,
      gridOwnerId: params.gridOwnerId,
      readingType: toMeteringReadingType(item.readingType),
      valueKwh: item.quantity,
      qualityCode: item.qualityCode,
      readAt: item.readAt,
      periodStart: item.periodStart,
      periodEnd: item.periodEnd,
      sourceSystem: 'ediel_utilts',
      rawPayload: {
        edielMessageId: params.message.id,
        messageCode: params.message.message_code,
        sourceOrder: item.sourceOrder,
        seriesItem: item.rawItem,
        normalizedPayload: params.normalizedPayload,
        parsedPayload: params.message.parsed_payload ?? {},
      },
    })
    await updateMeterValueBillingReadiness({
      meterValue: row,
      sourceMessageId: params.message.id,
    })
    rows.push(row)
  }

  return rows
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

async function createAckIfMissing(params: {
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


function normalizeTgtCaseCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return code.length > 0 ? code : null
}

function isTgtBCaseCode(value: unknown): boolean {
  const code = normalizeTgtCaseCode(value)
  return Boolean(code && /U\d+\.\d+\.\d+B/.test(code))
}

function readTgtCaseCodeFromObject(value: unknown): string | null {
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

function readTgtCaseCodeFromMessageContext(message: EdielMessageRow): string | null {
  return (
    readTgtCaseCodeFromObject(message.parsed_payload) ??
    readTgtCaseCodeFromObject(message.validation_report) ??
    normalizeTgtCaseCode(message.failure_reason)
  )
}

async function resolveActiveUtiltsTgtCaseCodeFromRuns(): Promise<string | null> {
  const runs = await listEdielTestRuns()
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

async function resolveUtiltsRuntimeTestCaseCode(params: {
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
  return resolveActiveUtiltsTgtCaseCodeFromRuns()
}

function isUtiltsBTestCaseMessage(message: EdielMessageRow): boolean {
  return shouldUseTransactionScopedPositiveAperak({ sourceMessage: message })
}

function shouldCreatePositiveAperakPerTransaction(params: {
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

async function createUtiltsRuntimeAcks(params: {
  actorUserId: string
  sourceMessage: EdielMessageRow
  ackPlan: ReturnType<typeof runUtiltsRuntimeForMessage>['ackPlan']
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

async function linkInboundUtiltsMessageCanonically(params: {
  actorUserId: string
  message: EdielMessageRow
}) {
  const meteringPointId = await matchMeteringPointForEdielMessage(params.message)
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

export async function prepareAndQueueUtiltsE73(params: {
  actorUserId: string
  gridOwnerDataRequestId: string
  communicationRouteId?: string | null
  environment?: EdielEnvironment | null
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const supabase = await makeServerClient()
  const dataRequest = await getGridOwnerDataRequestById(params.gridOwnerDataRequestId)

  if (!dataRequest) throw new Error('Grid owner data request hittades inte')
  if (dataRequest.company_id) await requireCompanyOperationalForWrites(dataRequest.company_id)

  const site = dataRequest.site_id ? await getCustomerSiteById(supabase, dataRequest.site_id) : null
  const meteringPoint = dataRequest.metering_point_id
    ? await getMeteringPointById(supabase, dataRequest.metering_point_id)
    : null
  const gridOwner = dataRequest.grid_owner_id
    ? await getGridOwnerById(supabase, dataRequest.grid_owner_id)
    : null

  const environment = await resolveOutboundRuntimeEnvironment({
    preferredRouteId: params.communicationRouteId ?? null,
    explicitEnvironment: params.environment ?? null,
  })

  const routeContext = await resolveDecisionBackedOutboundContext({
    requestType: 'meter_values',
    gridOwner,
    preferredRouteId: params.communicationRouteId ?? null,
    companyId: dataRequest.company_id ?? null,
    customerId: dataRequest.customer_id,
    siteId: dataRequest.site_id,
    meteringPointId: dataRequest.metering_point_id,
    dataRequestId: dataRequest.id,
    environment,
    messageFamily: 'UTILTS',
    messageCode: 'E73',
    messageStandard: 'edifact',
    actorUserId,
    payload: {
      requestScope: dataRequest.request_scope,
      requestedPeriodStart: dataRequest.requested_period_start,
      requestedPeriodEnd: dataRequest.requested_period_end,
    },
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
  environment?: EdielEnvironment | null
  quantity?: number | null
  periodStart?: string | null
  periodEnd?: string | null
  registrationTime?: string | null
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const supabase = await makeServerClient()
  const dataRequest = await getGridOwnerDataRequestById(params.gridOwnerDataRequestId)

  if (!dataRequest) throw new Error('Grid owner data request hittades inte')
  if (dataRequest.company_id) await requireCompanyOperationalForWrites(dataRequest.company_id)

  const site = dataRequest.site_id ? await getCustomerSiteById(supabase, dataRequest.site_id) : null
  const meteringPoint = dataRequest.metering_point_id
    ? await getMeteringPointById(supabase, dataRequest.metering_point_id)
    : null
  const gridOwner = dataRequest.grid_owner_id
    ? await getGridOwnerById(supabase, dataRequest.grid_owner_id)
    : null

  const environment = await resolveOutboundRuntimeEnvironment({
    preferredRouteId: params.communicationRouteId ?? null,
    explicitEnvironment: params.environment ?? null,
  })

  const routeContext = await resolveDecisionBackedOutboundContext({
    requestType: 'meter_values',
    gridOwner,
    preferredRouteId: params.communicationRouteId ?? null,
    companyId: dataRequest.company_id ?? null,
    customerId: dataRequest.customer_id,
    siteId: dataRequest.site_id,
    meteringPointId: dataRequest.metering_point_id,
    dataRequestId: dataRequest.id,
    environment,
    messageFamily: 'UTILTS',
    messageCode: 'E66',
    messageStandard: 'edifact',
    actorUserId,
    payload: {
      requestScope: dataRequest.request_scope,
      requestedPeriodStart: dataRequest.requested_period_start,
      requestedPeriodEnd: dataRequest.requested_period_end,
    },
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
  testCaseCode?: string | null
}): Promise<UtiltsProcessResult> {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const message = await getEdielMessageById(params.edielMessageId)

  if (!message) throw new Error('Ediel-meddelande hittades inte')
  if (message.message_family !== 'UTILTS') {
    throw new Error(`Meddelande ${message.id} är inte UTILTS.`)
  }

  const runtimeTestCaseCode = await resolveUtiltsRuntimeTestCaseCode({
    sourceMessage: message,
    explicitTestCaseCode: params.testCaseCode ?? null,
  })

  const runtime = runUtiltsRuntimeForMessage(message)
  const ackPlan = applyUtiltsTgtAckPlanOverride({
    runtime,
    testCaseCode: runtimeTestCaseCode,
  })
  const normalizedPayload = runtime.normalizedPayload
  const forcedPositiveTgtAckPlan =
    runtimeTestCaseCode === 'U3.1.1' || runtimeTestCaseCode === 'U3.1.2'
  const shouldRejectByAckPlan =
    ackPlan.contrlOutcome === 'negative' ||
    ackPlan.shouldSendUtiltsErr ||
    (ackPlan.shouldSendAperak && ackPlan.aperakOutcome === 'negative')
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
      utiltsRuntimeTestCaseCode: runtimeTestCaseCode,
    },
    validationReport: {
      ...(message.validation_report ?? {}),
      utiltsRuntime: {
        validation: runtime.validation,
        ackPlan: ackPlan,
          testCaseCode: runtimeTestCaseCode,
        },
    },
  })

  if ((!runtime.validation.ok && !forcedPositiveTgtAckPlan) || shouldRejectByAckPlan) {
    const ackIds = await createUtiltsRuntimeAcks({
      actorUserId,
      sourceMessage: message,
      ackPlan: ackPlan,
      testCaseCode: runtimeTestCaseCode,
    })

    await updateEdielMessageStatus({
      actorUserId,
      edielMessageId: message.id,
      status: runtime.validation.classification === 'syntax_rejected' ? 'failed' : 'validated',
      failureReason: ackPlan.reason,
      parsedPayload: {
        ...(message.parsed_payload ?? {}),
        normalizedMeteringPayload: normalizedPayload,
        utiltsRuntimeFacts: runtime.facts,
      },
      validationReport: {
        ...(message.validation_report ?? {}),
        utiltsRuntime: {
          validation: runtime.validation,
          ackPlan: ackPlan,
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
        ackPlan: ackPlan,
          testCaseCode: runtimeTestCaseCode,
        },
    })

    return {
      message,
      matchedDataRequest: canonicalLinks.matchedDataRequest,
      ackIds,
      outboundRequestId: null,
      ingestedMeterValueId: null,
      ingestedMeterValueIds: [],
      billingUnderlayId: null,
    }
  }

  if (!canonicalLinks.matchedDataRequest) {
    const matchedPermission = await findActiveMeteringPermissionForUtiltsMessage({
      ...message,
      parsed_payload: {
        ...(message.parsed_payload ?? {}),
        normalizedMeteringPayload: normalizedPayload,
      },
    })

    if (matchedPermission) {
      const permissionCustomerId = canonicalLinks.siteAndCustomer?.customerId ?? matchedPermission.customer_id ?? null
      const permissionSiteId = canonicalLinks.siteAndCustomer?.siteId ?? matchedPermission.site_id ?? null
      const permissionMeteringPointId = canonicalLinks.meteringPointId ?? matchedPermission.metering_point_id ?? null
      const permissionGridOwnerId = canonicalLinks.siteAndCustomer?.gridOwnerId ?? matchedPermission.grid_owner_id ?? null

      await linkEdielMessage({
        actorUserId,
        edielMessageId: message.id,
        customerId: permissionCustomerId,
        siteId: permissionSiteId,
        meteringPointId: permissionMeteringPointId,
        gridOwnerId: permissionGridOwnerId,
        relatedMessageId: message.related_message_id,
      })

      const ingestedMeterValues = await maybeIngestMeteringValue({
        actorUserId,
        customerId: permissionCustomerId,
        siteId: permissionSiteId,
        meteringPointId: permissionMeteringPointId,
        gridOwnerId: permissionGridOwnerId,
        dataRequestId: null,
        message,
        normalizedPayload,
      })

      const ingestedMeterValueIds = ingestedMeterValues.map((row) => row.id)
      const ackIds = await createUtiltsRuntimeAcks({
        actorUserId,
        sourceMessage: message,
        ackPlan: ackPlan,
        testCaseCode: runtimeTestCaseCode,
      })

      await updateEdielMessageStatus({
        actorUserId,
        edielMessageId: message.id,
        status: 'validated',
        parsedPayload: {
          ...(message.parsed_payload ?? {}),
          normalizedMeteringPayload: normalizedPayload,
          utiltsRuntimeFacts: runtime.facts,
          matchedMeteringPermissionId: matchedPermission.id,
          ingestedMeterValueId: ingestedMeterValueIds[0] ?? null,
          ingestedMeterValueIds,
        },
        validationReport: {
          ...(message.validation_report ?? {}),
          utiltsRuntime: {
            validation: runtime.validation,
            ackPlan: ackPlan,
            createdAckMessageIds: ackIds,
          },
        },
      })

      await createEdielMessageEvent({
        actorUserId,
        edielMessageId: message.id,
        eventType: 'validated',
        eventStatus: 'success',
        message: 'Inbound UTILTS matchades mot aktivt mätvärdestillstånd och mätvärden sparades utan att kräva separat data request.',
        payload: {
          matchedMeteringPermissionId: matchedPermission.id,
          ingestedMeterValueIds,
          normalizedMeteringPayload: normalizedPayload,
          validation: runtime.validation,
          ackPlan: ackPlan,
          testCaseCode: runtimeTestCaseCode,
        },
      })

      return {
        message,
        matchedDataRequest: null,
        ackIds,
        outboundRequestId: null,
        ingestedMeterValueId: ingestedMeterValueIds[0] ?? null,
        ingestedMeterValueIds,
        billingUnderlayId: null,
      }
    }

    const ackIds = await createUtiltsRuntimeAcks({
      actorUserId,
      sourceMessage: message,
      ackPlan: ackPlan,
      testCaseCode: runtimeTestCaseCode,
    })

    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: 'validated',
      eventStatus: 'warning',
      message:
        'Inbound UTILTS accepterades och kvitterades av produktionsruntime men saknar stark data request- eller mätvärdestillståndskoppling.',
      payload: {
        createdAckMessageIds: ackIds,
        normalizedMeteringPayload: normalizedPayload,
        validation: runtime.validation,
        ackPlan: ackPlan,
          testCaseCode: runtimeTestCaseCode,
        },
    })

    return {
      message,
      matchedDataRequest: null,
      ackIds,
      outboundRequestId: null,
      ingestedMeterValueId: null,
      ingestedMeterValueIds: [],
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

  const ingestedMeterValues = await maybeIngestMeteringValue({
    actorUserId,
    customerId,
    siteId,
    meteringPointId,
    gridOwnerId,
    dataRequestId: dataRequest.id,
    message,
    normalizedPayload,
  })

  const ingestedMeterValue = ingestedMeterValues[0] ?? null
  const ingestedMeterValueIds = ingestedMeterValues.map((row) => row.id)

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
      ingestedMeterValueIds,
      utiltsRuntime: {
        validation: runtime.validation,
        ackPlan: ackPlan,
          testCaseCode: runtimeTestCaseCode,
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
    ackPlan: ackPlan,
    testCaseCode: runtimeTestCaseCode,
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
      ingestedMeterValueIds,
      billingUnderlayId: billingUnderlay?.id ?? null,
    },
    validationReport: {
      ...(message.validation_report ?? {}),
      utiltsRuntime: {
        validation: runtime.validation,
        ackPlan: ackPlan,
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
      ingestedMeterValueIds,
      billingUnderlayId: billingUnderlay?.id ?? null,
      normalizedMeteringPayload: normalizedPayload,
      validation: runtime.validation,
      ackPlan: ackPlan,
    },
  })

  return {
    message,
    matchedDataRequest: dataRequest,
    ackIds,
    outboundRequestId: acknowledgedOutbound?.id ?? null,
    ingestedMeterValueId: ingestedMeterValue?.id ?? null,
    ingestedMeterValueIds,
    billingUnderlayId: billingUnderlay?.id ?? null,
  }
}
