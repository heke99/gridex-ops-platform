// lib/ediel/ack.ts

import type {
  CreateEdielMessageInput,
  EdielAckStatus,
  EdielMessageRow,
} from '@/lib/ediel/types'
import { buildDefaultApplicationReference } from '@/lib/ediel/config'
import { buildEdifactEnvelope } from '@/lib/ediel/messages'
import {
  buildEdielExternalReference,
  buildEdielTransactionReference,
} from '@/lib/ediel/references'
import {
  inferEdielFileName,
  inferEdielFamilyAndCodeFromRawPayload,
} from '@/lib/ediel/classify'
import { isActiveEdielMessageFamily } from '@/lib/ediel/types'

type AckOutcome = 'positive' | 'negative'

function sanitize(value?: string | null): string {
  return (value ?? '').replace(/['+]/g, ' ').trim()
}

function normalizeAckFamily(sourceMessage: EdielMessageRow) {
  if (!isActiveEdielMessageFamily(sourceMessage.message_family)) {
    throw new Error(
      `Källmeddelandet ${sourceMessage.id} ligger utanför aktiv release och får inte generera automatisk ack här.`
    )
  }

  if (sourceMessage.message_standard !== 'edifact') {
    throw new Error(
      `Ack-generatorn stöder bara EDIFACT i aktiv release. Meddelande ${sourceMessage.id} har standard ${sourceMessage.message_standard}.`
    )
  }

  if (sourceMessage.direction !== 'inbound') {
    throw new Error(
      `Ack-generatorn ska svara på inbound meddelanden. Meddelande ${sourceMessage.id} är ${sourceMessage.direction}.`
    )
  }

  if (sourceMessage.message_family === 'CONTRL') {
    throw new Error('APERAK eller CONTRL ska inte genereras som svar på CONTRL.')
  }

  if (sourceMessage.message_family === 'APERAK') {
    throw new Error('APERAK eller CONTRL ska inte genereras som svar på APERAK.')
  }
}

function sourceAckReceiver(sourceMessage: EdielMessageRow) {
  return {
    senderEdielId: sourceMessage.receiver_ediel_id ?? null,
    senderName: sourceMessage.receiver_name ?? null,
    senderSubAddress: sourceMessage.receiver_sub_address ?? 'GRIDEX',
    receiverEdielId: sourceMessage.sender_ediel_id ?? null,
    receiverName: sourceMessage.sender_name ?? null,
    receiverSubAddress: sourceMessage.sender_sub_address ?? 'EDIEL',
    receiverEmail: sourceMessage.sender_email ?? null,
    mailbox: sourceMessage.mailbox ?? null,
  }
}

function defaultAckStatuses(ackType: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'): {
  contrlStatus: EdielAckStatus
  aperakStatus: EdielAckStatus
  utiltsErrStatus: EdielAckStatus
  requiresContrl: boolean
  requiresAperak: boolean
} {
  if (ackType === 'CONTRL') {
    return {
      contrlStatus: 'not_required',
      aperakStatus: 'not_required',
      utiltsErrStatus: 'not_required',
      requiresContrl: false,
      requiresAperak: false,
    }
  }

  if (ackType === 'APERAK') {
    return {
      contrlStatus: 'not_required',
      aperakStatus: 'not_required',
      utiltsErrStatus: 'not_required',
      requiresContrl: false,
      requiresAperak: false,
    }
  }

  return {
    contrlStatus: 'not_required',
    aperakStatus: 'not_required',
    utiltsErrStatus: 'not_required',
    requiresContrl: false,
    requiresAperak: false,
  }
}

function buildAckExternalReference(params: {
  sourceMessage: EdielMessageRow
  ackFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
}) {
  return buildEdielExternalReference({
    family: params.ackFamily === 'UTILTS_ERR' ? 'UTILTS_ERR' : params.ackFamily,
    code: params.ackFamily,
    relatedMessageId: params.sourceMessage.id,
  })
}

function buildAckTransactionReference(params: {
  sourceMessage: EdielMessageRow
  ackFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
}) {
  return buildEdielTransactionReference({
    family: params.ackFamily === 'UTILTS_ERR' ? 'UTILTS_ERR' : params.ackFamily,
    code: params.ackFamily,
  })
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
    sanitize(params.messageText) ||
    (params.outcome === 'positive'
      ? 'Syntax accepted'
      : 'Syntax error detected')

  const originalMessageType =
    sanitize(`${params.sourceMessage.message_family} ${String(params.sourceMessage.message_code)}`)

  return [
    `UNH+1+CONTRL:D:96A:UN:1.0`,
    `BGM+CONTRL+${sanitize(params.externalReference)}+9`,
    `RFF+TN:${sanitize(params.transactionReference)}`,
    params.sourceMessage.interchange_reference
      ? `RFF+ACW:${sanitize(params.sourceMessage.interchange_reference)}`
      : null,
    params.sourceMessage.transaction_reference
      ? `RFF+CR:${sanitize(params.sourceMessage.transaction_reference)}`
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
    sanitize(params.messageText) ||
    (params.outcome === 'positive'
      ? 'Application accepted'
      : 'Application error')

  return [
    `UNH+1+APERAK:D:01B:UN:1.0`,
    `BGM+APERAK+${sanitize(params.externalReference)}+9`,
    `RFF+TN:${sanitize(params.transactionReference)}`,
    params.sourceMessage.transaction_reference
      ? `RFF+CR:${sanitize(params.sourceMessage.transaction_reference)}`
      : null,
    params.sourceMessage.external_reference
      ? `RFF+ACE:${sanitize(params.sourceMessage.external_reference)}`
      : null,
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
  const text = sanitize(params.messageText) || 'Functional error in UTILTS message'

  return [
    `UNH+1+UTILTS:D:03A:UN:1.0`,
    `BGM+UTILTS_ERR+${sanitize(params.externalReference)}+9`,
    `RFF+TN:${sanitize(params.transactionReference)}`,
    params.sourceMessage.transaction_reference
      ? `RFF+CR:${sanitize(params.sourceMessage.transaction_reference)}`
      : null,
    params.sourceMessage.external_reference
      ? `RFF+ACE:${sanitize(params.sourceMessage.external_reference)}`
      : null,
    `FTX+AAO+++${text}`,
  ].filter(Boolean) as string[]
}

function buildAckEnvelope(params: {
  sourceMessage: EdielMessageRow
  ackFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  externalReference: string
  transactionReference: string
  outcome?: AckOutcome
  messageText?: string | null
}) {
  const parties = sourceAckReceiver(params.sourceMessage)

  if (!parties.senderEdielId || !parties.receiverEdielId) {
    throw new Error(
      `Källmeddelande ${params.sourceMessage.id} saknar avsändare eller mottagare för ack-routing.`
    )
  }

  const applicationReference =
    params.sourceMessage.application_reference ??
    buildDefaultApplicationReference({
      actorSubAddress: parties.senderSubAddress ?? 'GRIDEX',
      process: params.ackFamily === 'UTILTS_ERR' ? 'UTILTS' : params.ackFamily,
    })

  const messageTypeToken =
    params.ackFamily === 'CONTRL'
      ? 'CONTRL:D:96A:UN:1.0'
      : params.ackFamily === 'APERAK'
        ? 'APERAK:D:01B:UN:1.0'
        : 'UTILTS:D:03A:UN:E5SE5A'

  const segments =
    params.ackFamily === 'CONTRL'
      ? buildContrlSegments({
          sourceMessage: params.sourceMessage,
          externalReference: params.externalReference,
          transactionReference: params.transactionReference,
          outcome: params.outcome ?? 'positive',
          messageText: params.messageText,
        })
      : params.ackFamily === 'APERAK'
        ? buildAperakSegments({
            sourceMessage: params.sourceMessage,
            externalReference: params.externalReference,
            transactionReference: params.transactionReference,
            outcome: params.outcome ?? 'positive',
            messageText: params.messageText,
          })
        : buildUtiltsErrSegments({
            sourceMessage: params.sourceMessage,
            externalReference: params.externalReference,
            transactionReference: params.transactionReference,
            messageText: params.messageText,
          })

  const envelope = buildEdifactEnvelope({
    senderEdielId: parties.senderEdielId,
    senderSubAddress: parties.senderSubAddress ?? 'GRIDEX',
    receiverEdielId: parties.receiverEdielId,
    receiverSubAddress: parties.receiverSubAddress ?? 'EDIEL',
    applicationReference,
    testFlag: params.sourceMessage.test_flag ?? 1,
    messageTypeToken,
    segments,
  })

  return {
    envelope,
    applicationReference,
    parties,
  }
}

function buildAckInput(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  ackFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  outcome?: AckOutcome
  messageText?: string | null
}): CreateEdielMessageInput {
  normalizeAckFamily(params.sourceMessage)

  const externalReference = buildAckExternalReference({
    sourceMessage: params.sourceMessage,
    ackFamily: params.ackFamily,
  })

  const transactionReference = buildAckTransactionReference({
    sourceMessage: params.sourceMessage,
    ackFamily: params.ackFamily,
  })

  const { envelope, applicationReference, parties } = buildAckEnvelope({
    sourceMessage: params.sourceMessage,
    ackFamily: params.ackFamily,
    externalReference,
    transactionReference,
    outcome: params.outcome,
    messageText: params.messageText,
  })

  const defaults = defaultAckStatuses(params.ackFamily)

  return {
    actorUserId: params.actorUserId ?? null,
    direction: 'outbound',
    messageStandard: 'edifact',
    messageFamily: params.ackFamily === 'UTILTS_ERR' ? 'UTILTS_ERR' : params.ackFamily,
    messageCode: params.ackFamily,
    messageVersion:
      params.ackFamily === 'CONTRL'
        ? 'D:96A:UN:1.0'
        : params.ackFamily === 'APERAK'
          ? 'D:01B:UN:1.0'
          : 'E5SE5A',
    processType:
      params.ackFamily === 'CONTRL'
        ? 'syntax_ack'
        : params.ackFamily === 'APERAK'
          ? 'application_ack'
          : 'functional_error',
    environment: params.sourceMessage.environment,
    testFlag: params.sourceMessage.test_flag,
    status: 'draft',
    transportType: 'smtp',
    mailbox: parties.mailbox,
    senderEdielId: parties.senderEdielId,
    senderName: parties.senderName,
    receiverEdielId: parties.receiverEdielId,
    receiverName: parties.receiverName,
    senderSubAddress: parties.senderSubAddress,
    receiverSubAddress: parties.receiverSubAddress,
    receiverEmail: parties.receiverEmail,
    subject: `${params.ackFamily} ${externalReference}`,
    fileName: inferEdielFileName({
      family: params.ackFamily === 'UTILTS_ERR' ? 'UTILTS_ERR' : params.ackFamily,
      code: params.ackFamily,
      direction: 'outbound',
      extension: 'edi',
    }),
    mimeType: 'application/edifact',
    interchangeReference: envelope.interchangeReference,
    applicationReference,
    externalReference,
    correlationReference: params.sourceMessage.correlation_reference ?? params.sourceMessage.id,
    transactionReference,
    originalMessageId:
      params.sourceMessage.external_reference ??
      params.sourceMessage.interchange_reference ??
      params.sourceMessage.id,
    originalTransactionId: params.sourceMessage.transaction_reference ?? null,
    originalMessageCode: String(params.sourceMessage.message_code),
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
    rawPayload: envelope.raw,
    parsedPayload: {
      ackFamily: params.ackFamily,
      ackOutcome: params.outcome ?? 'positive',
      sourceMessageId: params.sourceMessage.id,
      sourceMessageFamily: params.sourceMessage.message_family,
      sourceMessageCode: params.sourceMessage.message_code,
      sourceTransactionReference: params.sourceMessage.transaction_reference,
      sourceExternalReference: params.sourceMessage.external_reference,
      messageText: params.messageText ?? null,
      inferred: inferEdielFamilyAndCodeFromRawPayload(envelope.raw),
    },
    requiresContrl: defaults.requiresContrl,
    requiresAperak: defaults.requiresAperak,
    contrlStatus: defaults.contrlStatus,
    aperakStatus: defaults.aperakStatus,
    utiltsErrStatus: defaults.utiltsErrStatus,
    syntaxCheckStatus: 'not_checked',
    functionalCheckStatus: 'not_checked',
  }
}

export function buildContrlDraft(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  outcome?: AckOutcome
  messageText?: string | null
}): CreateEdielMessageInput {
  return buildAckInput({
    actorUserId: params.actorUserId ?? null,
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
  return buildAckInput({
    actorUserId: params.actorUserId ?? null,
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
  if (params.sourceMessage.message_family !== 'UTILTS') {
    throw new Error('UTILTS_ERR ska bara skapas som svar på UTILTS i aktiv release.')
  }

  return buildAckInput({
    actorUserId: params.actorUserId ?? null,
    sourceMessage: params.sourceMessage,
    ackFamily: 'UTILTS_ERR',
    messageText: params.messageText ?? null,
  })
}