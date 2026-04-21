// lib/ediel/ack.ts

import type {
  CreateEdielMessageInput,
  EdielMessageRow,
} from '@/lib/ediel/types'
import { inferEdielFileName } from '@/lib/ediel/classify'
import { buildAperakTransactionReference } from '@/lib/ediel/references'
import { buildEdifactEnvelope } from '@/lib/ediel/messages'

export type AckOutcome = 'positive' | 'negative'

function reverseDirectionSenderReceiver(message: EdielMessageRow) {
  return {
    senderEdielId: message.receiver_ediel_id,
    senderName: message.receiver_name,
    receiverEdielId: message.sender_ediel_id,
    receiverName: message.sender_name,
    senderSubAddress: message.receiver_sub_address,
    receiverSubAddress: message.sender_sub_address,
    senderEmail: message.receiver_email,
    receiverEmail: message.sender_email,
  }
}

function buildAckSubject(
  family: 'CONTRL' | 'APERAK' | 'UTILTS_ERR',
  source: EdielMessageRow,
  outcome: AckOutcome
): string {
  return `${family} ${outcome.toUpperCase()} ${source.message_family} ${source.message_code} ${source.external_reference ?? source.id}`
}

function safeEdielId(value?: string | null): string {
  const cleaned = (value ?? '').trim()
  return cleaned.length > 0 ? cleaned : '00000'
}

function buildContrlPayload(
  source: EdielMessageRow,
  outcome: AckOutcome,
  messageText?: string | null
) {
  const reversed = reverseDirectionSenderReceiver(source)
  const bgmCode = outcome === 'positive' ? '7' : '27'

  return buildEdifactEnvelope({
    senderEdielId: safeEdielId(reversed.senderEdielId),
    senderSubAddress: reversed.senderSubAddress ?? 'GRIDEX',
    receiverEdielId: safeEdielId(reversed.receiverEdielId),
    receiverSubAddress: reversed.receiverSubAddress ?? 'GRIDEX',
    applicationReference: source.application_reference ?? '23-GRIDEX-CONTRL',
    testFlag: source.test_flag ?? 1,
    messageTypeToken: 'CONTRL:D:96A:UN',
    segments: [
      `BGM+${bgmCode}+${source.external_reference ?? source.id}+9`,
      `FTX+AAO+++${messageText ?? (outcome === 'positive' ? 'OK' : 'Syntax error or transport issue')}`,
    ],
  })
}

function buildAperakPayload(
  source: EdielMessageRow,
  outcome: AckOutcome,
  messageText?: string | null
) {
  const reversed = reverseDirectionSenderReceiver(source)
  const transactionReference = buildAperakTransactionReference()

  const bgmCode = outcome === 'positive' ? '312' : '313'
  const ercCode = outcome === 'positive' ? '100::260' : '41::260'
  const ftxText =
    messageText ?? (outcome === 'positive' ? 'OK' : 'MANDATORY FIELD MISSING')

  return buildEdifactEnvelope({
    senderEdielId: safeEdielId(reversed.senderEdielId),
    senderSubAddress: reversed.senderSubAddress ?? 'GRIDEX',
    receiverEdielId: safeEdielId(reversed.receiverEdielId),
    receiverSubAddress: reversed.receiverSubAddress ?? 'GRIDEX',
    applicationReference: source.application_reference ?? '23-GRIDEX-APERAK',
    testFlag: source.test_flag ?? 1,
    messageTypeToken: `APERAK:D:04A:UN:${source.message_version ?? 'E5SE5A'}`,
    segments: [
      `BGM+${bgmCode}+${source.external_reference ?? source.id}+9`,
      `DTM+137:${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12)}:203`,
      `DTM+735:?+0100:406`,
      `DOC+${String(source.message_code)}::260+${source.original_message_id ?? source.external_reference ?? source.id}`,
      `NAD+MS+${safeEdielId(reversed.senderEdielId)}:SVK:260`,
      `NAD+MR+${safeEdielId(reversed.receiverEdielId)}:SVK:260`,
      `NAD+DDQ`,
      `ERC+${ercCode}`,
      outcome === 'positive'
        ? `FTX+AAO+++OK`
        : `FTX+AAO++223::260+${ftxText}`,
      `RFF+DM:${transactionReference}`,
      `RFF+ACW:${source.transaction_reference ?? source.original_transaction_id ?? source.external_reference ?? source.id}`,
    ],
  })
}

function buildUtiltsErrPayload(source: EdielMessageRow, messageText?: string | null) {
  const reversed = reverseDirectionSenderReceiver(source)

  return buildEdifactEnvelope({
    senderEdielId: safeEdielId(reversed.senderEdielId),
    senderSubAddress: reversed.senderSubAddress ?? 'GRIDEX',
    receiverEdielId: safeEdielId(reversed.receiverEdielId),
    receiverSubAddress: reversed.receiverSubAddress ?? 'GRIDEX',
    applicationReference: source.application_reference ?? '23-GRIDEX-UTILTS',
    testFlag: source.test_flag ?? 1,
    messageTypeToken: 'UTILTS:D:02B:UN:E5SE5A',
    segments: [
      `BGM+E01::260+${source.external_reference ?? source.id}+9`,
      `DTM+137:${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12)}:203`,
      `MKS+23+E02::260`,
      `NAD+MS+${safeEdielId(reversed.senderEdielId)}:SVK:260`,
      `NAD+MR+${safeEdielId(reversed.receiverEdielId)}:SVK:260`,
      `NAD+DDQ`,
      `STS+E01::260+41+E50::260`,
      `RFF+TN:${source.transaction_reference ?? source.original_transaction_id ?? source.id}`,
      `RFF+E66:${source.original_message_id ?? source.external_reference ?? source.id}`,
      `FTX+AAO+++${messageText ?? 'Functional or process error'}`,
    ],
  })
}

export function buildContrlDraft(input: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  outcome?: AckOutcome
  messageText?: string | null
}): CreateEdielMessageInput {
  const reversed = reverseDirectionSenderReceiver(input.sourceMessage)
  const outcome = input.outcome ?? 'positive'
  const envelope = buildContrlPayload(input.sourceMessage, outcome, input.messageText)

  return {
    actorUserId: input.actorUserId ?? null,
    direction: 'outbound',
    messageStandard: 'edifact',
    messageFamily: 'CONTRL',
    messageCode: 'CONTRL',
    messageVersion: 'D96A',
    environment: input.sourceMessage.environment ?? 'test',
    testFlag: input.sourceMessage.test_flag ?? 1,
    status: 'draft',
    transportType: 'smtp',
    senderEdielId: reversed.senderEdielId ?? null,
    senderName: reversed.senderName ?? null,
    receiverEdielId: reversed.receiverEdielId ?? null,
    receiverName: reversed.receiverName ?? null,
    senderSubAddress: reversed.senderSubAddress ?? null,
    receiverSubAddress: reversed.receiverSubAddress ?? null,
    senderEmail: reversed.senderEmail ?? null,
    receiverEmail: reversed.receiverEmail ?? null,
    subject: buildAckSubject('CONTRL', input.sourceMessage, outcome),
    fileName: inferEdielFileName({
      family: 'CONTRL',
      code: 'CONTRL',
      direction: 'outbound',
      extension: 'edi',
    }),
    mimeType: 'application/edifact',
    relatedMessageId: input.sourceMessage.id,
    customerId: input.sourceMessage.customer_id,
    siteId: input.sourceMessage.site_id,
    meteringPointId: input.sourceMessage.metering_point_id,
    gridOwnerId: input.sourceMessage.grid_owner_id,
    communicationRouteId: input.sourceMessage.communication_route_id,
    outboundRequestId: input.sourceMessage.outbound_request_id,
    switchRequestId: input.sourceMessage.switch_request_id,
    gridOwnerDataRequestId: input.sourceMessage.grid_owner_data_request_id,
    partnerExportId: input.sourceMessage.partner_export_id,
    externalReference: input.sourceMessage.external_reference,
    correlationReference: input.sourceMessage.correlation_reference,
    transactionReference: input.sourceMessage.transaction_reference,
    interchangeReference: envelope.interchangeReference,
    applicationReference: input.sourceMessage.application_reference,
    originalMessageId: input.sourceMessage.external_reference,
    originalTransactionId: input.sourceMessage.transaction_reference,
    originalMessageCode: String(input.sourceMessage.message_code),
    rawPayload: envelope.raw,
    parsedPayload: {
      sourceMessageId: input.sourceMessage.id,
      sourceFamily: input.sourceMessage.message_family,
      sourceCode: input.sourceMessage.message_code,
      outcome,
    },
    requiresContrl: false,
    requiresAperak: false,
    contrlStatus: 'not_required',
    aperakStatus: 'not_required',
    utiltsErrStatus: 'not_required',
  }
}

export function buildAperakDraft(input: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  outcome?: AckOutcome
  messageText?: string | null
}): CreateEdielMessageInput {
  const reversed = reverseDirectionSenderReceiver(input.sourceMessage)
  const outcome = input.outcome ?? 'positive'
  const envelope = buildAperakPayload(input.sourceMessage, outcome, input.messageText)

  return {
    actorUserId: input.actorUserId ?? null,
    direction: 'outbound',
    messageStandard: 'edifact',
    messageFamily: 'APERAK',
    messageCode: 'APERAK',
    messageVersion: input.sourceMessage.message_version ?? 'E5SE5A',
    environment: input.sourceMessage.environment ?? 'test',
    testFlag: input.sourceMessage.test_flag ?? 1,
    status: 'draft',
    transportType: 'smtp',
    senderEdielId: reversed.senderEdielId ?? null,
    senderName: reversed.senderName ?? null,
    receiverEdielId: reversed.receiverEdielId ?? null,
    receiverName: reversed.receiverName ?? null,
    senderSubAddress: reversed.senderSubAddress ?? null,
    receiverSubAddress: reversed.receiverSubAddress ?? null,
    senderEmail: reversed.senderEmail ?? null,
    receiverEmail: reversed.receiverEmail ?? null,
    subject: buildAckSubject('APERAK', input.sourceMessage, outcome),
    fileName: inferEdielFileName({
      family: 'APERAK',
      code: 'APERAK',
      direction: 'outbound',
      extension: 'edi',
    }),
    mimeType: 'application/edifact',
    relatedMessageId: input.sourceMessage.id,
    customerId: input.sourceMessage.customer_id,
    siteId: input.sourceMessage.site_id,
    meteringPointId: input.sourceMessage.metering_point_id,
    gridOwnerId: input.sourceMessage.grid_owner_id,
    communicationRouteId: input.sourceMessage.communication_route_id,
    outboundRequestId: input.sourceMessage.outbound_request_id,
    switchRequestId: input.sourceMessage.switch_request_id,
    gridOwnerDataRequestId: input.sourceMessage.grid_owner_data_request_id,
    partnerExportId: input.sourceMessage.partner_export_id,
    externalReference: input.sourceMessage.external_reference,
    correlationReference: input.sourceMessage.correlation_reference,
    transactionReference: input.sourceMessage.transaction_reference,
    interchangeReference: envelope.interchangeReference,
    applicationReference: input.sourceMessage.application_reference,
    originalMessageId: input.sourceMessage.external_reference,
    originalTransactionId: input.sourceMessage.transaction_reference,
    originalMessageCode: String(input.sourceMessage.message_code),
    rawPayload: envelope.raw,
    parsedPayload: {
      sourceMessageId: input.sourceMessage.id,
      sourceFamily: input.sourceMessage.message_family,
      sourceCode: input.sourceMessage.message_code,
      outcome,
    },
    requiresContrl: true,
    requiresAperak: false,
    contrlStatus: 'pending',
    aperakStatus: 'not_required',
    utiltsErrStatus: 'not_required',
  }
}

export function buildUtiltsErrDraft(input: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  messageText?: string | null
}): CreateEdielMessageInput {
  const reversed = reverseDirectionSenderReceiver(input.sourceMessage)
  const envelope = buildUtiltsErrPayload(input.sourceMessage, input.messageText)

  return {
    actorUserId: input.actorUserId ?? null,
    direction: 'outbound',
    messageStandard: 'edifact',
    messageFamily: 'UTILTS_ERR',
    messageCode: 'UTILTS_ERR',
    messageVersion: 'E5SE5A',
    environment: input.sourceMessage.environment ?? 'test',
    testFlag: input.sourceMessage.test_flag ?? 1,
    status: 'draft',
    transportType: 'smtp',
    senderEdielId: reversed.senderEdielId ?? null,
    senderName: reversed.senderName ?? null,
    receiverEdielId: reversed.receiverEdielId ?? null,
    receiverName: reversed.receiverName ?? null,
    senderSubAddress: reversed.senderSubAddress ?? null,
    receiverSubAddress: reversed.receiverSubAddress ?? null,
    senderEmail: reversed.senderEmail ?? null,
    receiverEmail: reversed.receiverEmail ?? null,
    subject: buildAckSubject('UTILTS_ERR', input.sourceMessage, 'negative'),
    fileName: inferEdielFileName({
      family: 'UTILTS_ERR',
      code: 'UTILTS_ERR',
      direction: 'outbound',
      extension: 'edi',
    }),
    mimeType: 'application/edifact',
    relatedMessageId: input.sourceMessage.id,
    customerId: input.sourceMessage.customer_id,
    siteId: input.sourceMessage.site_id,
    meteringPointId: input.sourceMessage.metering_point_id,
    gridOwnerId: input.sourceMessage.grid_owner_id,
    communicationRouteId: input.sourceMessage.communication_route_id,
    outboundRequestId: input.sourceMessage.outbound_request_id,
    switchRequestId: input.sourceMessage.switch_request_id,
    gridOwnerDataRequestId: input.sourceMessage.grid_owner_data_request_id,
    partnerExportId: input.sourceMessage.partner_export_id,
    externalReference: input.sourceMessage.external_reference,
    correlationReference: input.sourceMessage.correlation_reference,
    transactionReference: input.sourceMessage.transaction_reference,
    interchangeReference: envelope.interchangeReference,
    applicationReference: input.sourceMessage.application_reference,
    originalMessageId: input.sourceMessage.external_reference,
    originalTransactionId: input.sourceMessage.transaction_reference,
    originalMessageCode: String(input.sourceMessage.message_code),
    rawPayload: envelope.raw,
    parsedPayload: {
      sourceMessageId: input.sourceMessage.id,
      sourceFamily: input.sourceMessage.message_family,
      sourceCode: input.sourceMessage.message_code,
      outcome: 'negative',
    },
    requiresContrl: true,
    requiresAperak: false,
    contrlStatus: 'pending',
    aperakStatus: 'not_required',
    utiltsErrStatus: 'not_required',
  }
}