// lib/ediel/ack.ts

import type {
  CreateEdielMessageInput,
  EdielMessageRow,
} from '@/lib/ediel/types'
import { buildDefaultApplicationReference } from '@/lib/ediel/config'
import { buildEdifactEnvelope } from '@/lib/ediel/messages'
import { renderContrl2Ediel2 } from '@/lib/ediel/contrlEngine'
import { renderAperakEdiel } from '@/lib/ediel/aperakEngine'
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

export type EdielAperakApplicationError = {
  ercCode: string
  fieldCode?: string | null
  text: string
  /**
   * Optional object/transaction reference for this exact APERAK row.
   * Multi-object PRODAT TGT responses must repeat ERC/FTX/RFF per object;
   * otherwise Edielportalen treats all errors as belonging to the first LIN.
   */
  referenceQualifier?: string | null
  referenceNumber?: string | null
  lineItemReference?: string | null
}

function normalizeAperakErrors(errors?: readonly EdielAperakApplicationError[] | null, fallbackText?: string | null): EdielAperakApplicationError[] {
  const normalized = (errors ?? [])
    .map((error) => ({
      ercCode: sanitizeEdifactToken(error.ercCode, 12) ?? '',
      fieldCode: sanitizeEdifactToken(error.fieldCode ?? null, 12),
      text: escapeEdifactText(error.text, 140),
      referenceQualifier: sanitizeEdifactToken(error.referenceQualifier ?? null, 12),
      referenceNumber: sanitizeEdifactToken(error.referenceNumber ?? null, 35),
      lineItemReference: sanitizeEdifactToken(error.lineItemReference ?? null, 35),
    }))
    .filter((error) => error.ercCode.length > 0 && error.text.length > 0)

  if (normalized.length > 0) return normalized
  return [
    {
      ercCode: '40',
      fieldCode: '40',
      text: escapeEdifactText(fallbackText || 'Applikationen kunde inte bearbeta meddelandet', 140),
      referenceQualifier: null,
      referenceNumber: null,
      lineItemReference: null,
    },
  ]
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

function edielPartyCompositeFromUnb(value?: string | null): string | null {
  const trimmed = trimOrNull(value)
  if (!trimmed) return null

  const parts = trimmed
    .split(':')
    .map((part) => sanitizeEdifactToken(part))
    .filter(Boolean)

  return parts.length > 0 ? parts.join(':') : null
}

function fallbackPartyComposite(params: {
  edielId?: string | null
  subAddress?: string | null
}): string | null {
  const edielId = sanitizeEdifactToken(params.edielId)
  if (!edielId) return null

  const subAddress = sanitizeEdifactToken(params.subAddress)
  if (!subAddress) return edielId

  return `${edielId}:ZZ:${subAddress}`
}

function buildContrlSegments(params: {
  sourceMessage: EdielMessageRow
  outcome: AckOutcome
}) {
  const refs = parseEdifactRefs(params.sourceMessage)
  const rendered = renderContrl2Ediel2({
    outcome: params.outcome,
    parsedInterchangeReference: refs.interchangeReference,
    source: {
      rawPayload: params.sourceMessage.raw_payload,
      interchangeReference: params.sourceMessage.interchange_reference,
      externalReference: params.sourceMessage.external_reference,
      id: params.sourceMessage.id,
      senderEdielId: params.sourceMessage.sender_ediel_id,
      senderSubAddress: params.sourceMessage.sender_sub_address,
      receiverEdielId: params.sourceMessage.receiver_ediel_id,
      receiverSubAddress: params.sourceMessage.receiver_sub_address,
    },
  })

  return rendered.segments
}


function buildAperakSegments(params: {
  sourceMessage: EdielMessageRow
  externalReference: string
  transactionReference: string
  outcome: AckOutcome
  messageText?: string | null
  applicationErrors?: readonly EdielAperakApplicationError[] | null
}) {
  const refs = parseEdifactRefs(params.sourceMessage)
  const rendered = renderAperakEdiel({
    source: {
      id: params.sourceMessage.id,
      rawPayload: params.sourceMessage.raw_payload,
      messageFamily: params.sourceMessage.message_family,
      messageCode: String(params.sourceMessage.message_code),
      senderEdielId: params.sourceMessage.sender_ediel_id,
      receiverEdielId: params.sourceMessage.receiver_ediel_id,
      externalReference: params.sourceMessage.external_reference,
      messageReceivedAt: params.sourceMessage.message_received_at,
    },
    refs,
    externalReference: params.externalReference,
    transactionReference: params.transactionReference,
    outcome: params.outcome,
    messageText: params.messageText ?? null,
    applicationErrors: params.applicationErrors ?? null,
  })

  return rendered.segments
}

function buildUtiltsErrSegments(params: {
  sourceMessage: EdielMessageRow
  externalReference: string
  transactionReference: string
  messageText?: string | null
}) {
  const refs = parseEdifactRefs(params.sourceMessage)
  const rawCodes = sanitizeSegmentText(params.messageText) || 'E14'
  const codes = rawCodes
    .split(/[|,;\s]+/)
    .map((code) => sanitizeEdifactToken(code.toUpperCase(), 8))
    .filter((code): code is string => Boolean(code && /^E[0-9A-Z]+$/.test(code)))

  const uniqueCodes = Array.from(new Set(codes.length > 0 ? codes : ['E14']))
  const segments: Array<string | null> = [
    'UNH+1+UTILTS:D:01B:UN:1.1',
    `BGM+Z09+${sanitizeEdifactToken(params.externalReference) ?? 'UTILTSERR'}+9`,
    `DTM+137:${swedishDateTime()}:203`,
    `RFF+TN:${sanitizeEdifactToken(params.transactionReference) ?? 'TN'}`,
    refs.documentReference ? `RFF+ACE:${refs.documentReference}` : null,
    `NAD+MS+${sanitizeEdifactToken(params.sourceMessage.receiver_ediel_id) ?? 'UNKNOWN'}:SVK:260`,
    `NAD+MR+${sanitizeEdifactToken(params.sourceMessage.sender_ediel_id) ?? 'UNKNOWN'}:SVK:260`,
    'NAD+DDQ',
  ]

  for (const code of uniqueCodes) {
    segments.push(`STS+E01::260+41+${code}::260`)
  }

  return segments.filter(Boolean) as string[]
}

function buildAckDraft(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  ackFamily: AckFamily
  outcome?: AckOutcome
  messageText?: string | null
  applicationErrors?: readonly EdielAperakApplicationError[] | null
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
          outcome,
        })
      : params.ackFamily === 'APERAK'
        ? buildAperakSegments({
            sourceMessage: params.sourceMessage,
            externalReference: refs.externalReference ?? params.sourceMessage.id,
            transactionReference: refs.transactionReference ?? params.sourceMessage.id,
            outcome,
            messageText: params.messageText ?? null,
            applicationErrors: params.applicationErrors ?? null,
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
        ? 'CONTRL:2:2:UN:EDIEL2'
        : params.ackFamily === 'APERAK'
          ? params.sourceMessage.message_family === 'UTILTS'
            ? 'APERAK:D:04A:UN:E5SE5A'
            : 'APERAK:D:96A:UN:E2SE6A'
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
        ? 'EDIEL2'
        : params.ackFamily === 'APERAK'
          ? params.sourceMessage.message_family === 'UTILTS'
            ? 'E5SE5A'
            : 'E2SE6A'
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
      applicationErrors: params.applicationErrors ?? null,
    },
    validationReport: {
      generatedBy: 'buildAckDraft',
      sourceMessageId: params.sourceMessage.id,
      sourceFamily: params.sourceMessage.message_family,
      sourceCode: params.sourceMessage.message_code,
      applicationErrors: params.applicationErrors ?? null,
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
  applicationErrors?: readonly EdielAperakApplicationError[] | null
}): CreateEdielMessageInput {
  return buildAckDraft({
    actorUserId: params.actorUserId,
    sourceMessage: params.sourceMessage,
    ackFamily: 'APERAK',
    outcome: params.outcome ?? 'positive',
    messageText: params.messageText ?? null,
    applicationErrors: params.applicationErrors ?? null,
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
  applicationErrors?: readonly EdielAperakApplicationError[] | null
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
      applicationErrors: params.applicationErrors ?? null,
    })
  }

  return buildUtiltsErrDraft({
    actorUserId: params.actorUserId,
    sourceMessage: params.sourceMessage,
    messageText: params.messageText,
  })
}