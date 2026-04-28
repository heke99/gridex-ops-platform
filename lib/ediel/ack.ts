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

type ParsedUnbParties = {
  senderEdielId: string | null
  senderSubAddress: string | null
  receiverEdielId: string | null
  receiverSubAddress: string | null
}

function firstString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function parseUnbComposite(value?: string | null): { edielId: string | null; subAddress: string | null } {
  const parts = String(value ?? '').split(':')
  return {
    edielId: trimOrNull(parts[0]),
    subAddress: trimOrNull(parts[2]),
  }
}

function parseUnbPartiesFromText(value?: string | null): ParsedUnbParties | null {
  const text = String(value ?? '')
  if (!text.includes('UNB+')) return null

  const match = text.match(/UNB\+[^'\r\n]+/i)
  const unb = match?.[0] ?? null
  if (!unb) return null

  const parts = unb.split('+')
  const sender = parseUnbComposite(parts[2])
  const receiver = parseUnbComposite(parts[3])

  if (!sender.edielId && !receiver.edielId) return null

  return {
    senderEdielId: sender.edielId,
    senderSubAddress: sender.subAddress,
    receiverEdielId: receiver.edielId,
    receiverSubAddress: receiver.subAddress,
  }
}

function parsedPayloadString(sourceMessage: EdielMessageRow, key: string): string | null {
  const payload = sourceMessage.parsed_payload ?? {}
  return firstString(payload[key])
}

function ensureAckParties(params: ReturnType<typeof sourceParties>, sourceMessage: EdielMessageRow) {
  if (!params.senderEdielId || !params.receiverEdielId) {
    throw new Error(
      'Kan inte skapa ack för ' +
        sourceMessage.id +
        ': inbound sender/receiver saknas. Kontrollera att inkommande EDIFACT har UNB med avsändare och mottagare.'
    )
  }

  return params as ReturnType<typeof sourceParties> & {
    senderEdielId: string
    receiverEdielId: string
  }
}

function ensureInboundEdifactSource(sourceMessage: EdielMessageRow) {
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

  if (
    sourceMessage.message_family === 'CONTRL' ||
    sourceMessage.message_family === 'APERAK' ||
    sourceMessage.message_family === 'UTILTS_ERR'
  ) {
    throw new Error(
      `Ack får inte genereras på ${sourceMessage.message_family} för ${sourceMessage.id}.`
    )
  }
}

function sourceParties(sourceMessage: EdielMessageRow) {
  const unbFromPayload = parseUnbPartiesFromText(sourceMessage.raw_payload)
  const unbFromSubject = parseUnbPartiesFromText(sourceMessage.subject)
  const unb = unbFromPayload ?? unbFromSubject

  const inboundSenderEdielId =
    trimOrNull(sourceMessage.sender_ediel_id) ??
    parsedPayloadString(sourceMessage, 'senderEdielId') ??
    unb?.senderEdielId ??
    null
  const inboundReceiverEdielId =
    trimOrNull(sourceMessage.receiver_ediel_id) ??
    parsedPayloadString(sourceMessage, 'receiverEdielId') ??
    unb?.receiverEdielId ??
    null
  const inboundSenderSubAddress =
    trimOrNull(sourceMessage.sender_sub_address) ??
    parsedPayloadString(sourceMessage, 'senderSubAddress') ??
    unb?.senderSubAddress ??
    'PRODAT'
  const inboundReceiverSubAddress =
    trimOrNull(sourceMessage.receiver_sub_address) ??
    parsedPayloadString(sourceMessage, 'receiverSubAddress') ??
    unb?.receiverSubAddress ??
    'PRODAT'

  return {
    senderEdielId: inboundReceiverEdielId,
    senderName: trimOrNull(sourceMessage.receiver_name),
    senderSubAddress: inboundReceiverSubAddress,
    receiverEdielId: inboundSenderEdielId,
    receiverName: trimOrNull(sourceMessage.sender_name),
    receiverSubAddress: inboundSenderSubAddress,
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
  const resultCode = params.outcome === 'positive' ? 'A01' : 'A13'
  const text =
    sanitizeSegmentText(params.messageText) ||
    (params.outcome === 'positive'
      ? 'Application accepted'
      : 'Application rejected')

  const originalMessageType = sanitizeSegmentText(
    `${params.sourceMessage.message_family} ${String(params.sourceMessage.message_code)}`
  )

  return [
    'UNH+1+APERAK:D:96A:UN:E2SE6B',
    `BGM+APERAK+${sanitizeSegmentText(params.externalReference)}+9`,
    `RFF+TN:${sanitizeSegmentText(params.transactionReference)}`,
    params.sourceMessage.transaction_reference
      ? `RFF+CR:${sanitizeSegmentText(params.sourceMessage.transaction_reference)}`
      : null,
    params.sourceMessage.external_reference
      ? `RFF+ACE:${sanitizeSegmentText(params.sourceMessage.external_reference)}`
      : null,
    `FTX+AAI+++${originalMessageType}`,
    `ERC+${resultCode}`,
    `FTX+AAO+++${text}`,
  ].filter(Boolean) as string[]
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
  ensureInboundEdifactSource(params.sourceMessage)

  const outcome =
    params.ackFamily === 'UTILTS_ERR' ? 'negative' : params.outcome ?? 'positive'

  const refs = buildCanonicalAckReferences({
    sourceMessage: params.sourceMessage,
    ackFamily: params.ackFamily,
  })

  const parties = ensureAckParties(sourceParties(params.sourceMessage), params.sourceMessage)

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

  const envelope = buildEdifactEnvelope({
    senderEdielId: parties.senderEdielId,
    receiverEdielId: parties.receiverEdielId,
    messageTypeToken:
      params.ackFamily === 'CONTRL'
        ? 'CONTRL:D:96A:UN:1.0'
        : params.ackFamily === 'APERAK'
          ? 'APERAK:D:96A:UN:E2SE6B'
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
           ? 'E2SE6B'
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