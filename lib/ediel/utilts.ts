// lib/ediel/utilts.ts
import type {
  CreateEdielMessageInput,
  EdielKnownMessageCode,
  EdielMessageFamily,
} from '@/lib/ediel/types'
import { buildDefaultApplicationReference } from '@/lib/ediel/config'
import { buildEdifactEnvelope } from '@/lib/ediel/messages'
import { deriveEdielAckDefaults } from '@/lib/ediel/references'
import {
  inferEdielFamilyAndCodeFromRawPayload,
  inferEdielFileName,
} from '@/lib/ediel/classify'
import { buildCanonicalOutboundReferences } from '@/lib/ediel/core/referenceRegistry'
import { resolveCanonicalOutboundVersion } from '@/lib/ediel/core/versionRegistry'

export type UtiltsMessageCode =
  | 'S01'
  | 'S02'
  | 'S03'
  | 'S04'
  | 'E31'
  | 'E66'
  | 'E73'

export type ParsedUtiltsMessage = {
  messageFamily: Extract<EdielMessageFamily, 'UTILTS'>
  messageCode: UtiltsMessageCode | EdielKnownMessageCode | null
  transactionReference: string | null
  externalReference: string | null
  applicationReference: string | null
  senderEdielId: string | null
  receiverEdielId: string | null
  rawSegments: string[]
  parsedPayload: Record<string, unknown>
}

export type UtiltsInboundDraftInput = {
  actorUserId?: string | null
  code: UtiltsMessageCode
  communicationRouteId?: string | null
  customerId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  gridOwnerId?: string | null
  gridOwnerDataRequestId?: string | null
  mailbox?: string | null
  mailboxMessageId?: string | null
  senderEdielId?: string | null
  receiverEdielId?: string | null
  senderEmail?: string | null
  receiverEmail?: string | null
  externalReference?: string | null
  transactionReference?: string | null
  rawPayload: string
  quantity?: number | null
  periodStart?: string | null
  periodEnd?: string | null
  registrationTime?: string | null
  unit?: string | null
}

export type UtiltsOutboundDraftInput = {
  actorUserId?: string | null
  code: 'E66' | 'E73'
  communicationRouteId?: string | null
  customerId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  gridOwnerId?: string | null
  outboundRequestId?: string | null
  gridOwnerDataRequestId?: string | null
  partnerExportId?: string | null

  senderEdielId?: string | null
  senderName?: string | null
  receiverEdielId?: string | null
  receiverName?: string | null
  senderSubAddress?: string | null
  receiverSubAddress?: string | null
  mailbox?: string | null
  receiverEmail?: string | null
  subject?: string | null

  applicationReference?: string | null
  externalReference?: string | null
  correlationReference?: string | null
  transactionReference?: string | null
  routeDefaultMessageVersion?: string | null

  payload?: Record<string, unknown>
}

function splitEdifactSegments(rawPayload: string): string[] {
  return rawPayload
    .split("'")
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function firstSegmentValue(segments: string[], prefix: string): string | null {
  const hit = segments.find((segment) => segment.startsWith(prefix))
  return hit ?? null
}

function extractUnbEdielIds(unb: string | null): {
  senderEdielId: string | null
  receiverEdielId: string | null
} {
  if (!unb) {
    return { senderEdielId: null, receiverEdielId: null }
  }

  const parts = unb.split('+')
  const senderRaw = parts[2] ?? ''
  const receiverRaw = parts[3] ?? ''

  return {
    senderEdielId: senderRaw.split(':')[0]?.trim() || null,
    receiverEdielId: receiverRaw.split(':')[0]?.trim() || null,
  }
}

function extractApplicationReference(rawPayload: string): string | null {
  const unb = rawPayload
    .split("'")
    .map((segment) => segment.trim())
    .find((segment) => segment.startsWith('UNB+'))

  if (!unb) return null

  const parts = unb.split('+')
  return parts[7]?.trim() || null
}

function extractReference(rawPayload: string, qualifier: string): string | null {
  const regex = new RegExp(`RFF\\+${qualifier}:([A-Za-z0-9\\-_/.:]+)`, 'i')
  return rawPayload.match(regex)?.[1] ?? null
}

function extractDateFromDtm(segment: string | null): string | null {
  if (!segment) return null
  const match = segment.match(/:(\d{8,12})/)
  if (!match) return null
  const raw = match[1]
  if (raw.length >= 8) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  }
  return null
}

function extractQty(segment: string | null): number | null {
  if (!segment) return null
  const parts = segment.split(':')
  const value = Number(parts[1] ?? '')
  return Number.isFinite(value) ? value : null
}

function getPayloadString(payload: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return ''
}

function getPayloadNumber(payload: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.replace(',', '.'))
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

function sanitize(value?: string | null): string {
  return (value ?? '').replace(/['+]/g, ' ').trim()
}

function normalizeDate(value?: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00`
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) {
    return trimmed
  }
  return trimmed
}

function formatDateTime203(value?: string | null): string | null {
  const normalized = normalizeDate(value)
  if (!normalized) return null
  return normalized.replace(/[-:T]/g, '').replace(/Z$/, '').slice(0, 12)
}

function formatPeriod719(start?: string | null, end?: string | null): string | null {
  const start203 = formatDateTime203(start)
  const end203 = formatDateTime203(end)
  if (!start203 || !end203) return null
  return `${start203}${end203}`
}

function inferUtiltsResolution(payload: Record<string, unknown>): '15' | '60' | '1440' {
  const resolution = getPayloadString(payload, 'resolution')
  const frequency = getPayloadString(payload, 'readingFrequency')

  if (resolution === '15' || resolution === 'PT15M') return '15'
  if (resolution === '60' || resolution === 'PT60M' || frequency === 'hourly') return '60'
  if (resolution === '1440' || frequency === 'daily' || frequency === 'monthly') return '1440'

  return '15'
}

function inferUtiltsReadingType(payload: Record<string, unknown>): string {
  const readingType = getPayloadString(payload, 'readingType')
  if (readingType) return sanitize(readingType)

  const siteType = getPayloadString(payload, 'siteType')
  if (/production/i.test(siteType)) return 'PRODUCTION'
  return 'CONSUMPTION'
}

export function parseInboundUtilts(rawPayload: string): ParsedUtiltsMessage {
  const rawSegments = splitEdifactSegments(rawPayload)
  const inferred = inferEdielFamilyAndCodeFromRawPayload(rawPayload)
  const unb = firstSegmentValue(rawSegments, 'UNB+')
  const unh = firstSegmentValue(rawSegments, 'UNH+')
  const bgm = firstSegmentValue(rawSegments, 'BGM+')
  const loc172 = firstSegmentValue(rawSegments, 'LOC+172')
  const loc239 = firstSegmentValue(rawSegments, 'LOC+239')
  const dtm137 = firstSegmentValue(rawSegments, 'DTM+137')
  const dtm324 = firstSegmentValue(rawSegments, 'DTM+324')
  const dtm597 = firstSegmentValue(rawSegments, 'DTM+597')
  const qty = firstSegmentValue(rawSegments, 'QTY+')
  const cci = firstSegmentValue(rawSegments, 'CCI+')
  const ids = extractUnbEdielIds(unb)

  const bgmParts = bgm?.split('+') ?? []
  const bgmCode = (bgmParts[1]?.split(':')[0]?.trim() || inferred.messageCode || null) as
    | UtiltsMessageCode
    | EdielKnownMessageCode
    | null

  const meterPointId = loc172?.split('+')[2]?.split(':')[0]?.trim() || null
  const gridAreaId = loc239?.split('+')[2]?.split(':')[0]?.trim() || null
  const quantity = extractQty(qty)

  return {
    messageFamily: 'UTILTS',
    messageCode: bgmCode,
    transactionReference:
      extractReference(rawPayload, 'TN') ||
      extractReference(rawPayload, 'CR') ||
      extractReference(rawPayload, 'E66'),
    externalReference:
      bgmParts[2]?.trim() ||
      extractReference(rawPayload, 'ON') ||
      extractReference(rawPayload, 'AAS') ||
      extractReference(rawPayload, 'ACE'),
    applicationReference: extractApplicationReference(rawPayload),
    senderEdielId: ids.senderEdielId,
    receiverEdielId: ids.receiverEdielId,
    rawSegments,
    parsedPayload: {
      unb,
      unh,
      bgm,
      meterPointId,
      meteringPointId: meterPointId,
      gridAreaId,
      periodStart: extractDateFromDtm(dtm137),
      deliveryPeriod: dtm324 ?? null,
      registrationTime: extractDateFromDtm(dtm597),
      quantity,
      readingType: cci ?? null,
      segmentCount: rawSegments.length,
      inferredFamily: inferred.messageFamily,
      inferredCode: inferred.messageCode,
      hasUtiltsErrPattern:
        rawPayload.toUpperCase().includes('UTILTS-ERR') ||
        rawPayload.toUpperCase().includes('UTILTS_ERR'),
    },
  }
}

export function buildInboundUtiltsMessageInput(
  input: UtiltsInboundDraftInput
): CreateEdielMessageInput {
  const ack = deriveEdielAckDefaults({
    family: 'UTILTS',
    code: input.code,
  })

  const parsed = parseInboundUtilts(input.rawPayload)

  const parsedPayload = {
    ...parsed.parsedPayload,
    quantity: parsed.parsedPayload.quantity ?? input.quantity ?? null,
    periodStart: parsed.parsedPayload.periodStart ?? input.periodStart ?? null,
    periodEnd: parsed.parsedPayload.deliveryPeriod ?? input.periodEnd ?? null,
    registrationTime:
      parsed.parsedPayload.registrationTime ?? input.registrationTime ?? null,
    unit: input.unit ?? 'KWH',
  }

  return {
    actorUserId: input.actorUserId ?? 'system',
    direction: 'inbound',
    messageStandard: 'edifact',
    messageFamily: 'UTILTS',
    messageCode: parsed.messageCode ?? input.code,
    status: 'received',
    transportType: 'imap',
    mailbox: input.mailbox ?? null,
    mailboxMessageId: input.mailboxMessageId ?? null,
    senderEdielId: parsed.senderEdielId ?? input.senderEdielId ?? null,
    receiverEdielId: parsed.receiverEdielId ?? input.receiverEdielId ?? null,
    senderEmail: input.senderEmail ?? null,
    receiverEmail: input.receiverEmail ?? null,
    fileName: inferEdielFileName({
      family: 'UTILTS',
      code: parsed.messageCode ?? input.code,
      direction: 'inbound',
      extension: 'edi',
    }),
    mimeType: 'application/edifact',
    externalReference: parsed.externalReference,
    transactionReference: parsed.transactionReference,
    applicationReference: parsed.applicationReference,
    communicationRouteId: input.communicationRouteId ?? null,
    customerId: input.customerId ?? null,
    siteId: input.siteId ?? null,
    meteringPointId: input.meteringPointId ?? null,
    gridOwnerId: input.gridOwnerId ?? null,
    gridOwnerDataRequestId: input.gridOwnerDataRequestId ?? null,
    rawPayload: input.rawPayload,
    parsedPayload,
    requiresContrl: ack.requiresContrl,
    requiresAperak: ack.requiresAperak,
    contrlStatus: ack.contrlStatus,
    aperakStatus: ack.aperakStatus,
    utiltsErrStatus: ack.utiltsErrStatus,
    messageReceivedAt: new Date().toISOString(),
    syntaxCheckStatus: 'pending',
    functionalCheckStatus: 'pending',
  }
}

function renderUtiltsSegments(input: {
  code: 'E66' | 'E73'
  bgmReference: string
  transactionReference: string
  payload: Record<string, unknown>
}): string[] {
  const payload = input.payload
  const meterPointId = sanitize(getPayloadString(payload, 'meterPointId', 'meteringPointId'))
  const gridAreaId = sanitize(getPayloadString(payload, 'gridAreaId', 'gridOwnerEdielId'))
  const periodStart = getPayloadString(payload, 'periodStart', 'requestedPeriodStart')
  const periodEnd = getPayloadString(payload, 'periodEnd', 'requestedPeriodEnd')
  const registrationTime =
    getPayloadString(payload, 'registrationTime') || new Date().toISOString()
  const quantity = getPayloadNumber(payload, 'quantity', 'valueKwh', 'requestedQuantity')
  const unit = sanitize(getPayloadString(payload, 'unit') || 'KWH')
  const transactionReason = sanitize(
    getPayloadString(payload, 'transactionReason') ||
      (input.code === 'E73'
        ? 'Request missing validated meter data'
        : 'Validated metering values')
  )
  const siteType = sanitize(getPayloadString(payload, 'siteType') || 'Consumption')
  const resolution = inferUtiltsResolution(payload)
  const readingType = inferUtiltsReadingType(payload)

  const segments: string[] = []

  segments.push(`BGM+${input.code}::260+${sanitize(input.bgmReference)}+9+AB`)
  segments.push(`DTM+137:${formatDateTime203(new Date().toISOString())}:203`)
  segments.push(`DTM+735:?+0100:406`)
  segments.push(`MKS+23+E02::260`)
  segments.push(`RFF+TN:${sanitize(input.transactionReference)}`)

  if (meterPointId) {
    segments.push(`IDE+24+${sanitize(input.transactionReference)}`)
    segments.push(`LOC+172+${meterPointId}::9`)
  }

  if (gridAreaId) {
    segments.push(`LOC+239+${gridAreaId}:SVK:260`)
  }

  const deliveryPeriod = formatPeriod719(periodStart, periodEnd)
  if (deliveryPeriod) {
    segments.push(`DTM+324:${deliveryPeriod}:719`)
  }

  const registration203 = formatDateTime203(registrationTime)
  if (registration203) {
    segments.push(`DTM+597:${registration203}:203`)
  }

  if (input.code === 'E66') {
    segments.push(`DTM+354:${resolution}:802`)
    segments.push(`STS+7++E88::260`)
    segments.push(`MEA+AAZ++${unit}`)
    segments.push(`CCI+++${readingType}`)
    segments.push(`CAV+E17::260`)

    if (quantity !== null) {
      segments.push(`SEQ++1`)
      segments.push(`QTY+136:${String(quantity)}`)
    }
  }

  if (input.code === 'E73') {
    segments.push(`STS+7++E73::260`)
    segments.push(`FTX+AAO+++${transactionReason}`)
    if (quantity !== null) {
      segments.push(`QTY+47:${String(quantity)}`)
    }
  }

  if (siteType) {
    segments.push(`FTX+ZZZ+++${siteType}`)
  }

  return segments
}

export async function buildUtiltsOutboundDraft(
  input: UtiltsOutboundDraftInput
): Promise<CreateEdielMessageInput> {
  const refs = buildCanonicalOutboundReferences({
    family: 'UTILTS',
    code: input.code,
    relatedMessageId: input.gridOwnerDataRequestId ?? input.outboundRequestId ?? null,
    preferredExternalReference: input.externalReference ?? null,
    preferredTransactionReference: input.transactionReference ?? null,
    correlationReference: input.correlationReference ?? null,
  })

  const externalReference = refs.externalReference ?? `UTILTS-${input.code}`
  const transactionReference = refs.transactionReference ?? `UTILTS-${input.code}`

  const messageVersion =
    (await resolveCanonicalOutboundVersion({
      family: 'UTILTS',
      code: input.code,
      fallback: 'E5SE5A',
      standard: 'edifact',
      routeDefaultMessageVersion: input.routeDefaultMessageVersion ?? null,
      environment: 'test',
    })) ?? 'E5SE5A'

  const applicationReference =
    input.applicationReference ??
    buildDefaultApplicationReference({
      actorSubAddress: input.senderSubAddress ?? 'GRIDEX',
      process: 'UTILTS',
    })

  const parsedPayload = {
    ...(input.payload ?? {}),
    draftType: 'utilts_outbound',
    utiltsCode: input.code,
    resolution: inferUtiltsResolution(input.payload ?? {}),
    readingType: inferUtiltsReadingType(input.payload ?? {}),
  }

  const envelope = buildEdifactEnvelope({
    senderEdielId: input.senderEdielId ?? '00000',
    senderSubAddress: input.senderSubAddress ?? 'GRIDEX',
    receiverEdielId: input.receiverEdielId ?? '00000',
    receiverSubAddress: input.receiverSubAddress ?? 'DDQ',
    applicationReference,
    testFlag: 1,
    messageTypeToken: `UTILTS:D:02B:UN:${messageVersion}`,
    segments: renderUtiltsSegments({
      code: input.code,
      bgmReference: externalReference,
      transactionReference,
      payload: parsedPayload,
    }),
  })

  const ack = deriveEdielAckDefaults({
    family: 'UTILTS',
    code: input.code,
  })

  return {
    actorUserId: input.actorUserId ?? 'system',
    direction: 'outbound',
    messageStandard: 'edifact',
    messageFamily: 'UTILTS',
    messageCode: input.code,
    messageVersion,
    processType: input.code === 'E73' ? 'meter_values_request' : 'meter_values_export',
    environment: 'test',
    testFlag: 1,
    status: 'draft',
    transportType: 'smtp',
    mailbox: input.mailbox ?? null,
    senderEdielId: input.senderEdielId ?? null,
    senderName: input.senderName ?? null,
    receiverEdielId: input.receiverEdielId ?? null,
    receiverName: input.receiverName ?? null,
    senderSubAddress: input.senderSubAddress ?? 'GRIDEX',
    receiverSubAddress: input.receiverSubAddress ?? 'DDQ',
    receiverEmail: input.receiverEmail ?? null,
    subject: input.subject ?? `UTILTS ${input.code} ${externalReference}`.trim(),
    fileName: inferEdielFileName({
      family: 'UTILTS',
      code: input.code,
      direction: 'outbound',
      extension: 'edi',
    }),
    mimeType: 'application/edifact',
    interchangeReference: envelope.interchangeReference,
    applicationReference,
    externalReference,
    correlationReference: refs.correlationReference ?? input.correlationReference ?? null,
    transactionReference,
    communicationRouteId: input.communicationRouteId ?? null,
    outboundRequestId: input.outboundRequestId ?? null,
    gridOwnerDataRequestId: input.gridOwnerDataRequestId ?? null,
    partnerExportId: input.partnerExportId ?? null,
    customerId: input.customerId ?? null,
    siteId: input.siteId ?? null,
    meteringPointId: input.meteringPointId ?? null,
    gridOwnerId: input.gridOwnerId ?? null,
    rawPayload: envelope.raw,
    parsedPayload,
    requiresContrl: ack.requiresContrl,
    requiresAperak: ack.requiresAperak,
    contrlStatus: ack.contrlStatus,
    aperakStatus: ack.aperakStatus,
    utiltsErrStatus: ack.utiltsErrStatus,
    ackDueAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    syntaxCheckStatus: 'not_checked',
    functionalCheckStatus: 'not_checked',
  }
}