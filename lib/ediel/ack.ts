// lib/ediel/ack.ts

import type {
  CreateEdielMessageInput,
  EdielMessageFamily,
  EdielMessageRow,
} from '@/lib/ediel/types'
import { inferEdielFileName } from '@/lib/ediel/classify'

export type AckOutcome = 'positive' | 'negative'

function reverseDirectionSenderReceiver(message: EdielMessageRow) {
  return {
    senderEdielId: message.receiver_ediel_id,
    receiverEdielId: message.sender_ediel_id,
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

function renderContrlRaw(
  source: EdielMessageRow,
  outcome: AckOutcome,
  messageText?: string | null
): string {
  return [
    `UNB+UNOC:3+${source.receiver_ediel_id ?? '00000'}:${source.receiver_sub_address ?? 'GRIDEX'}+${source.sender_ediel_id ?? '00000'}:${source.sender_sub_address ?? 'PRODAT'}+${new Date()
      .toISOString()
      .slice(2, 16)
      .replace(/[-:T]/g, '')}`,
    `UNH+1+CONTRL:D:96A:UN`,
    `BGM+${outcome === 'positive' ? '7' : '27'}+${source.external_reference ?? source.id}+9`,
    `FTX+AAO+++${messageText ?? (outcome === 'positive' ? 'OK' : 'Syntax error or transport issue')}`,
    `UNT+4+1`,
    `UNZ+1+${source.external_reference ?? source.id}`,
    '',
  ].join("'")
}

function renderAperakRaw(
  source: EdielMessageRow,
  outcome: AckOutcome,
  code: string,
  messageText?: string | null
): string {
  const bgm1225 = outcome === 'positive' ? '34' : '27'
  const erc9321 = outcome === 'positive' ? '100' : '40'

  return [
    `UNB+UNOC:3+${source.receiver_ediel_id ?? '00000'}:${source.receiver_sub_address ?? 'GRIDEX'}+${source.sender_ediel_id ?? '00000'}:${source.sender_sub_address ?? 'PRODAT'}+${new Date()
      .toISOString()
      .slice(2, 16)
      .replace(/[-:T]/g, '')}`,
    `UNH+1+APERAK:D:96A:UN`,
    `BGM+${bgm1225}+${source.external_reference ?? source.id}+9`,
    `ERC+${erc9321}`,
    `FTX+AAO+++${messageText ?? (outcome === 'positive' ? 'OK' : `Rejected ${code}`)}`,
    `RFF+ACW:${source.transaction_reference ?? source.external_reference ?? source.id}`,
    `UNT+6+1`,
    `UNZ+1+${source.external_reference ?? source.id}`,
    '',
  ].join("'")
}

function renderUtiltsErrRaw(
  source: EdielMessageRow,
  messageText?: string | null
): string {
  return [
    `UNB+UNOC:3+${source.receiver_ediel_id ?? '00000'}:${source.receiver_sub_address ?? 'GRIDEX'}+${source.sender_ediel_id ?? '00000'}:${source.sender_sub_address ?? 'UTILTS'}+${new Date()
      .toISOString()
      .slice(2, 16)
      .replace(/[-:T]/g, '')}`,
    `UNH+1+UTILTS-ERR:D:96A:UN`,
    `BGM+27+${source.external_reference ?? source.id}+9`,
    `FTX+AAO+++${messageText ?? 'Functional or process error'}`,
    `RFF+ACW:${source.transaction_reference ?? source.external_reference ?? source.id}`,
    `UNT+5+1`,
    `UNZ+1+${source.external_reference ?? source.id}`,
    '',
  ].join("'")
}

export function buildContrlDraft(input: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  outcome?: AckOutcome
  messageText?: string | null
}): CreateEdielMessageInput {
  const reversed = reverseDirectionSenderReceiver(input.sourceMessage)
  const outcome = input.outcome ?? 'positive'

  return {
    actorUserId: input.actorUserId ?? null,
    direction: 'outbound',
    messageFamily: 'CONTRL',
    messageCode: 'CONTRL',
    status: 'draft',
    transportType: 'smtp',
    senderEdielId: reversed.senderEdielId ?? null,
    receiverEdielId: reversed.receiverEdielId ?? null,
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
    applicationReference: input.sourceMessage.application_reference,
    rawPayload: renderContrlRaw(input.sourceMessage, outcome, input.messageText),
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

  return {
    actorUserId: input.actorUserId ?? null,
    direction: 'outbound',
    messageFamily: 'APERAK',
    messageCode: 'APERAK',
    status: 'draft',
    transportType: 'smtp',
    senderEdielId: reversed.senderEdielId ?? null,
    receiverEdielId: reversed.receiverEdielId ?? null,
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
    applicationReference: input.sourceMessage.application_reference,
    rawPayload: renderAperakRaw(
      input.sourceMessage,
      outcome,
      String(input.sourceMessage.message_code),
      input.messageText
    ),
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

  return {
    actorUserId: input.actorUserId ?? null,
    direction: 'outbound',
    messageFamily: 'UTILTS_ERR',
    messageCode: 'UTILTS_ERR',
    status: 'draft',
    transportType: 'smtp',
    senderEdielId: reversed.senderEdielId ?? null,
    receiverEdielId: reversed.receiverEdielId ?? null,
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
    applicationReference: input.sourceMessage.application_reference,
    rawPayload: renderUtiltsErrRaw(input.sourceMessage, input.messageText),
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

export function ackFamilyForSourceMessage(
  family: EdielMessageFamily
): 'CONTRL' | 'APERAK' | 'UTILTS_ERR' | null {
  if (family === 'PRODAT') return 'APERAK'
  if (family === 'UTILTS') return 'APERAK'
  if (family === 'APERAK') return 'CONTRL'
  if (family === 'CONTRL') return null
  if (family === 'UTILTS_ERR') return 'CONTRL'
  return null
}