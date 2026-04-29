// lib/ediel/ack.ts

import type {
  CreateEdielMessageInput,
  EdielMessageRow,
} from '@/lib/ediel/types'
import { buildDefaultApplicationReference } from '@/lib/ediel/config'
import { buildEdifactEnvelope } from '@/lib/ediel/messages'
import { inferEdielFileName } from '@/lib/ediel/classify'
import { buildCanonicalAckReferences } from '@/lib/ediel/core/referenceRegistry'
import {
  defaultAckStatuses,
  deriveEdielAckDefaults,
  findExistingAckForSource,
  getAutomaticAckPolicy,
  getCanonicalAckState,
  type AckFamily,
  type AckOutcome,
  type AckPolicy,
  type EdielCanonicalAckState,
} from '@/lib/ediel/core/ackPolicy'

export type {
  AckFamily,
  AckOutcome,
  AckPolicy,
  EdielCanonicalAckState,
}

export {
  defaultAckStatuses,
  deriveEdielAckDefaults,
  findExistingAckForSource,
  getAutomaticAckPolicy,
  getCanonicalAckState,
}

function trimOrNull(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function sanitizeSegmentText(value?: string | null): string {
  return (value ?? '').replace(/['+]/g, ' ').trim()
}

function sanitizeEdifactToken(value?: string | null, maxLength = 35): string | null {
  const trimmed = trimOrNull(value)
  if (!trimmed) return null

  const sanitized = trimmed
    .replace(/[ÅÄ]/gi, 'A')
    .replace(/[Ö]/gi, 'O')
    .replace(/[åä]/g, 'a')
    .replace(/[ö]/g, 'o')
    .replace(/[^A-Za-z0-9_.\/-]/g, '')
    .slice(0, maxLength)

  return sanitized.length > 0 ? sanitized : null
}

function escapeEdifactText(value?: string | null, maxLength = 70): string {
  const text = sanitizeSegmentText(value).slice(0, maxLength)
  return text.replace(/\?/g, '??').replace(/:/g, '?:')
}

function swedishDateTime(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${map.year}${map.month}${map.day}${map.hour}${map.minute}`
}

function swedishDateTimeFromEdifactUnb(rawPayload?: string | null): string | null {
  const segments = segmentsFromRawPayload(rawPayload)
  const unb = segments.find((segment) => segment.toUpperCase().startsWith('UNB+'))
  const parts = unb?.split('+') ?? []
  const date = parts[4]?.trim() ?? ''
  const time = parts[5]?.trim() ?? ''

  if (!/^\d{6}$/.test(date) || !/^\d{4}$/.test(time)) {
    return null
  }

  // UNB stores YYMMDD + HHMM. Ediel TGT uses Swedish local time, so keep the
  // inbound interchange timestamp instead of our mailbox processing timestamp.
  // APERAK DTM+178 must describe the referenced PRODAT, not when APERAK was built.
  const yearPrefix = Number(date.slice(0, 2)) >= 70 ? '19' : '20'
  return `${yearPrefix}${date}${time}`
}

type ParsedEdifactRefs = {
  messageReference: string | null
  documentReference: string | null
  interchangeReference: string | null
  lineItemReference: string | null
  meteringPointId: string | null
}

function segmentsFromRawPayload(rawPayload?: string | null): string[] {
  if (!rawPayload) return []

  const normalized = rawPayload
    .replace(/\r\n/g, '')
    .replace(/\n/g, '')
    .replace(/^UNA.{6}'/i, '')

  return normalized
    .split("'")
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function parseEdifactRefs(sourceMessage: EdielMessageRow): ParsedEdifactRefs {
  const parsed = sourceMessage.parsed_payload ?? {}
  const segments = segmentsFromRawPayload(sourceMessage.raw_payload)
  const find = (prefix: string) => segments.find((segment) => segment.startsWith(prefix)) ?? null
  const findAll = (prefix: string) => segments.filter((segment) => segment.startsWith(prefix))
  const unh = find('UNH+')
  const unb = find('UNB+')
  const bgm = find('BGM+')
  const lin = find('LIN+')
  const rffs = findAll('RFF+')

  const messageReference =
    sanitizeEdifactToken(String(parsed.messageReference ?? parsed.message_reference ?? '')) ??
    sanitizeEdifactToken(unh?.split('+')[1] ?? null)

  const bgmDocumentReference = sanitizeEdifactToken(bgm?.split('+')[2] ?? null)

  const documentReference =
    sanitizeEdifactToken(
      String(
        parsed.documentReference ??
          parsed.document_reference ??
          parsed.bgmReference ??
          parsed.bgm_reference ??
          ''
      )
    ) ??
    bgmDocumentReference ??
    sanitizeEdifactToken(sourceMessage.external_reference)

  const unbParts = unb?.split('+') ?? []
  const interchangeReference =
    sanitizeEdifactToken(String(parsed.interchangeReference ?? parsed.interchange_reference ?? '')) ??
    sanitizeEdifactToken(sourceMessage.interchange_reference) ??
    sanitizeEdifactToken(unbParts[5] ?? null)

  const linParts = lin?.split('+') ?? []
  const linItem = linParts[3]?.split(':')[0] ?? null
  const meteringPointId =
    sanitizeEdifactToken(String(parsed.meteringPointId ?? parsed.metering_point_id ?? '')) ??
    sanitizeEdifactToken(linItem)

  const liSegment = rffs.find((segment) => segment.startsWith('RFF+LI:'))
  const lineItemReference =
    sanitizeEdifactToken(String(parsed.lineItemReference ?? parsed.line_item_reference ?? '')) ??
    sanitizeEdifactToken(sourceMessage.transaction_reference) ??
    sanitizeEdifactToken(liSegment?.replace(/^RFF\+LI:/, '') ?? null)

  return { messageReference, documentReference, interchangeReference, lineItemReference, meteringPointId }
}

function ensureInboundEdifactSource(sourceMessage: EdielMessageRow, ackFamily: AckFamily) {
  if (sourceMessage.direction !== 'inbound') {
    throw new Error(
      `Ack-generatorn kräver inbound source. ${sourceMessage.id} är ${sourceMessage.direction}.`
    )
  }

  if (sourceMessage.message_standard !== 'edifact') {
    throw new Error(
      `Ack-generatorn kräver EDIFACT. ${sourceMessage.id} har ${sourceMessage.message_standard}.`
    )
  }

  if (sourceMessage.message_family === 'CONTRL') {
    throw new Error('CONTRL ska registreras och kopplas, inte kvitteras med nytt ack.')
  }

  if (sourceMessage.message_family === 'APERAK' && ackFamily !== 'CONTRL') {
    throw new Error('Inkommande APERAK får endast besvaras med CONTRL, aldrig med APERAK.')
  }

  if (sourceMessage.message_family === 'UTILTS_ERR' && ackFamily !== 'CONTRL') {
    throw new Error('Inkommande UTILTS-ERR får inte besvaras med APERAK.')
  }
}

function sourceParties(sourceMessage: EdielMessageRow) {
  return {
    senderEdielId: trimOrNull(sourceMessage.receiver_ediel_id),
    senderName: trimOrNull(sourceMessage.receiver_name),
    senderSubAddress: trimOrNull(sourceMessage.receiver_sub_address) ?? 'PRODAT',
    receiverEdielId: trimOrNull(sourceMessage.sender_ediel_id),
    receiverName: trimOrNull(sourceMessage.sender_name),
    receiverSubAddress: trimOrNull(sourceMessage.sender_sub_address) ?? 'PRODAT',
    receiverEmail: trimOrNull(sourceMessage.sender_email),
    mailbox: trimOrNull(sourceMessage.mailbox),
  }
}

function buildContrlSegments(params: {
  sourceMessage: EdielMessageRow
  externalReference: string
  transactionReference: string
  outcome: AckOutcome
  messageText?: string | null
}) {
  const resultCode = params.outcome === 'positive' ? '7' : '12'
  const text =
    sanitizeSegmentText(params.messageText) ||
    (params.outcome === 'positive' ? 'Syntax accepted' : 'Syntax error detected')

  const originalMessageType = sanitizeSegmentText(
    `${params.sourceMessage.message_family} ${String(params.sourceMessage.message_code)}`
  )

  return [
    'UNH+1+CONTRL:D:96A:UN:1.0',
    `BGM+CONTRL+${sanitizeSegmentText(params.externalReference)}+9`,
    `RFF+TN:${sanitizeSegmentText(params.transactionReference)}`,
    params.sourceMessage.interchange_reference
      ? `RFF+ACW:${sanitizeSegmentText(params.sourceMessage.interchange_reference)}`
      : null,
    params.sourceMessage.transaction_reference
      ? `RFF+CR:${sanitizeSegmentText(params.sourceMessage.transaction_reference)}`
      : null,
    `FTX+AAI+++${originalMessageType}`,
    `ERC+${resultCode}`,
    `FTX+AAO+++${text}`,
  ].filter(Boolean) as string[]
}

function buildAperakSegments(params: {
  sourceMessage: EdielMessageRow
  externalReference: string
  transactionReference: string
  outcome: AckOutcome
  messageText?: string | null
}) {
  const refs = parseEdifactRefs(params.sourceMessage)
  const bgmFunction = params.outcome === 'positive' ? '34' : '27'
  const ercCode = params.outcome === 'positive' ? '100' : '40'
  const text =
    params.outcome === 'positive'
      ? 'OK'
      : escapeEdifactText(params.messageText || 'Applikationen kunde inte bearbeta meddelandet')

  // For APERAK on inbound PRODAT, Edielportalen matches the acknowledgement
  // against the referenced PRODAT document number (BGM/1004). Do not prefer
  // UNB/0020 here; that is only the interchange reference and can validate
  // syntactically while still failing the portal test-case match.
  const previousMessageReference =
    refs.documentReference ??
    refs.messageReference ??
    sanitizeEdifactToken(params.sourceMessage.external_reference) ??
    refs.interchangeReference ??
    sanitizeEdifactToken(params.sourceMessage.id) ??
    sanitizeEdifactToken(params.transactionReference) ??
    'UNKNOWN'

  const segments = [
    'UNH+1+APERAK:D:96A:UN:E2SE6A',
    `BGM+++${bgmFunction}`,
    `DTM+137:${swedishDateTime()}:203`,
  ]

  const receivedDateTime =
    swedishDateTimeFromEdifactUnb(params.sourceMessage.raw_payload) ??
    (params.sourceMessage.message_received_at
      ? (() => {
          const receivedDate = new Date(params.sourceMessage.message_received_at)
          return Number.isFinite(receivedDate.getTime()) ? swedishDateTime(receivedDate) : null
        })()
      : null)

  if (receivedDateTime) {
    segments.push(`DTM+178:${receivedDateTime}:203`)
  }

  segments.push(
    `RFF+ACW:${previousMessageReference}`,
    `NAD+FR+${sanitizeEdifactToken(params.sourceMessage.receiver_ediel_id) ?? 'UNKNOWN'}:160:SVK+++++++SE`,
    `NAD+DO+${sanitizeEdifactToken(params.sourceMessage.sender_ediel_id) ?? 'UNKNOWN'}:160:SVK+++++++SE`,
    `ERC+${ercCode}::260`,
    params.outcome === 'positive'
      ? 'FTX+AAO+++OK'
      : `FTX+AAO++40::260+${text}`
  )

  if (refs.meteringPointId) {
    segments.push(`RFF+Z07:${refs.meteringPointId}`)
  }

  if (refs.lineItemReference) {
    segments.push(`RFF+LI:${refs.lineItemReference}`)
  }

  return segments
}

function buildUtiltsErrSegments(params: {
  sourceMessage: EdielMessageRow
  externalReference: string
  transactionReference: string
  messageText?: string | null
}) {
  const text =
    sanitizeSegmentText(params.messageText) || 'UTILTS processing failed'

  return [
    'UNH+1+UTILTS:D:01B:UN:1.1',
    `BGM+Z09+${sanitizeSegmentText(params.externalReference)}+9`,
    `RFF+TN:${sanitizeSegmentText(params.transactionReference)}`,
    params.sourceMessage.transaction_reference
      ? `RFF+CR:${sanitizeSegmentText(params.sourceMessage.transaction_reference)}`
      : null,
    params.sourceMessage.external_reference
      ? `RFF+ACE:${sanitizeSegmentText(params.sourceMessage.external_reference)}`
      : null,
    'NAD+MS',
    `FTX+AAO+++${text}`,
  ].filter(Boolean) as string[]
}

function buildAckDraft(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  ackFamily: AckFamily
  outcome?: AckOutcome
  messageText?: string | null
}): CreateEdielMessageInput {
  ensureInboundEdifactSource(params.sourceMessage, params.ackFamily)

  const outcome =
    params.ackFamily === 'UTILTS_ERR' ? 'negative' : params.outcome ?? 'positive'

  const refs = buildCanonicalAckReferences({
    sourceMessage: params.sourceMessage,
    ackFamily: params.ackFamily,
  })

  const parties = sourceParties(params.sourceMessage)

  const applicationReference =
    trimOrNull(params.sourceMessage.application_reference) ??
    buildDefaultApplicationReference({
      actorSubAddress: parties.senderSubAddress,
      process: params.ackFamily,
    })

  const ackStatuses = defaultAckStatuses()

  const segments =
    params.ackFamily === 'CONTRL'
      ? buildContrlSegments({
          sourceMessage: params.sourceMessage,
          externalReference: refs.externalReference ?? params.sourceMessage.id,
          transactionReference: refs.transactionReference ?? params.sourceMessage.id,
          outcome,
          messageText: params.messageText ?? null,
        })
      : params.ackFamily === 'APERAK'
        ? buildAperakSegments({
            sourceMessage: params.sourceMessage,
            externalReference: refs.externalReference ?? params.sourceMessage.id,
            transactionReference: refs.transactionReference ?? params.sourceMessage.id,
            outcome,
            messageText: params.messageText ?? null,
          })
        : buildUtiltsErrSegments({
            sourceMessage: params.sourceMessage,
            externalReference: refs.externalReference ?? params.sourceMessage.id,
            transactionReference: refs.transactionReference ?? params.sourceMessage.id,
            messageText: params.messageText ?? null,
          })

  if (!parties.senderEdielId || !parties.receiverEdielId) {
    throw new Error(
      `Kan inte skapa ${params.ackFamily}: inbound sender/receiver saknas för ${params.sourceMessage.id}.`
    )
  }

  const envelope = buildEdifactEnvelope({
    senderEdielId: parties.senderEdielId,
    receiverEdielId: parties.receiverEdielId,
    messageTypeToken:
      params.ackFamily === 'CONTRL'
        ? 'CONTRL:D:96A:UN:1.0'
        : params.ackFamily === 'APERAK'
          ? 'APERAK:D:96A:UN:E2SE6A'
          : 'UTILTS:D:01B:UN:1.1',
    applicationReference,
    segments,
    senderSubAddress: parties.senderSubAddress ?? undefined,
    receiverSubAddress: parties.receiverSubAddress ?? undefined,
  })

  const fileName = inferEdielFileName({
    family: params.ackFamily,
    code:
      params.ackFamily === 'CONTRL'
        ? 'CONTRL'
        : params.ackFamily === 'APERAK'
          ? 'APERAK'
          : 'UTILTS_ERR',
    direction: 'outbound',
    extension: 'edi',
  })

  return {
    actorUserId: params.actorUserId ?? 'system',
    direction: 'outbound',
    messageStandard: 'edifact',
    messageFamily: params.ackFamily,
    messageCode:
      params.ackFamily === 'CONTRL'
        ? 'CONTRL'
        : params.ackFamily === 'APERAK'
          ? 'APERAK'
          : 'UTILTS_ERR',
    messageVersion:
      params.ackFamily === 'CONTRL'
        ? 'D96A'
        : params.ackFamily === 'APERAK'
           ? 'E2SE6A'
          : 'E5SE5A',
    processType: 'ack',
    environment: params.sourceMessage.environment,
    testFlag: params.sourceMessage.test_flag,
    status: 'draft',
    transportType: 'smtp',
    mailbox: parties.mailbox,
    senderEdielId: parties.senderEdielId,
    senderName: parties.senderName,
    senderSubAddress: parties.senderSubAddress,
    receiverEdielId: parties.receiverEdielId,
    receiverName: parties.receiverName,
    receiverSubAddress: parties.receiverSubAddress,
    receiverEmail: parties.receiverEmail,
    fileName,
    mimeType: 'application/edifact',
    rawPayload: envelope.raw,
    parsedPayload: {
      ackFamily: params.ackFamily,
      ackOutcome: outcome,
      sourceMessageId: params.sourceMessage.id,
    },
    validationReport: {
      generatedBy: 'buildAckDraft',
      sourceMessageId: params.sourceMessage.id,
      sourceFamily: params.sourceMessage.message_family,
      sourceCode: params.sourceMessage.message_code,
    },
    applicationReference,
    interchangeReference:
      refs.originalMessageId ??
      params.sourceMessage.interchange_reference ??
      params.sourceMessage.id,
    externalReference: refs.externalReference,
    correlationReference: refs.correlationReference ?? params.sourceMessage.id,
    transactionReference: refs.transactionReference,
    originalMessageId: refs.originalMessageId,
    originalTransactionId: refs.originalTransactionId,
    originalMessageCode: refs.originalMessageCode,
    relatedMessageId: params.sourceMessage.id,
    communicationRouteId: params.sourceMessage.communication_route_id,
    outboundRequestId: params.sourceMessage.outbound_request_id,
    switchRequestId: params.sourceMessage.switch_request_id,
    gridOwnerDataRequestId: params.sourceMessage.grid_owner_data_request_id,
    partnerExportId: params.sourceMessage.partner_export_id,
    customerId: params.sourceMessage.customer_id,
    siteId: params.sourceMessage.site_id,
    meteringPointId: params.sourceMessage.metering_point_id,
    gridOwnerId: params.sourceMessage.grid_owner_id,
    requiresContrl: false,
    requiresAperak: false,
    contrlStatus: ackStatuses.contrlStatus,
    aperakStatus: ackStatuses.aperakStatus,
    utiltsErrStatus: ackStatuses.utiltsErrStatus,
    ackOutcome: outcome,
    syntaxCheckStatus:
      params.ackFamily === 'CONTRL'
        ? outcome === 'positive'
          ? 'ok'
          : 'failed'
        : 'not_checked',
    functionalCheckStatus:
      params.ackFamily === 'APERAK'
        ? outcome === 'positive'
          ? 'ok'
          : 'failed'
        : params.ackFamily === 'UTILTS_ERR'
          ? 'failed'
          : 'not_checked',
    ackDueAt: ackStatuses.ackDueAt,
    messageCreatedAt: new Date().toISOString(),
  }
}

export function buildContrlDraft(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  outcome?: AckOutcome
  messageText?: string | null
}): CreateEdielMessageInput {
  return buildAckDraft({
    actorUserId: params.actorUserId,
    sourceMessage: params.sourceMessage,
    ackFamily: 'CONTRL',
    outcome: params.outcome ?? 'positive',
    messageText: params.messageText ?? null,
  })
}

export function buildAperakDraft(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  outcome?: AckOutcome
  messageText?: string | null
}): CreateEdielMessageInput {
  return buildAckDraft({
    actorUserId: params.actorUserId,
    sourceMessage: params.sourceMessage,
    ackFamily: 'APERAK',
    outcome: params.outcome ?? 'positive',
    messageText: params.messageText ?? null,
  })
}

export function buildUtiltsErrDraft(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  messageText?: string | null
}): CreateEdielMessageInput {
  return buildAckDraft({
    actorUserId: params.actorUserId,
    sourceMessage: params.sourceMessage,
    ackFamily: 'UTILTS_ERR',
    messageText: params.messageText ?? null,
  })
}

export function buildAckDraftForSource(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  ackFamily: AckFamily
  outcome?: AckOutcome
  messageText?: string | null
}): CreateEdielMessageInput {
  if (params.ackFamily === 'CONTRL') {
    return buildContrlDraft({
      actorUserId: params.actorUserId,
      sourceMessage: params.sourceMessage,
      outcome: params.outcome,
      messageText: params.messageText,
    })
  }

  if (params.ackFamily === 'APERAK') {
    return buildAperakDraft({
      actorUserId: params.actorUserId,
      sourceMessage: params.sourceMessage,
      outcome: params.outcome,
      messageText: params.messageText,
    })
  }

  return buildUtiltsErrDraft({
    actorUserId: params.actorUserId,
    sourceMessage: params.sourceMessage,
    messageText: params.messageText,
  })
}