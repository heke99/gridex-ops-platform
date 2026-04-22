// lib/ediel/ack.ts

import type {
  CreateEdielMessageInput,
  EdielAckStatus,
  EdielMessageRow,
} from '@/lib/ediel/types'
import {
  buildDefaultApplicationReference,
  getActiveEdielMessageRule,
  getEdielRouteRuntimeByCommunicationRouteId,
} from '@/lib/ediel/config'
import { buildEdifactEnvelope } from '@/lib/ediel/messages'
import { inferEdielFileName } from '@/lib/ediel/classify'
import {
  buildCanonicalAckReferences,
} from '@/lib/ediel/core/referenceRegistry'
import {
  listAckMessagesForSource,
} from '@/lib/ediel/db'

export type AckOutcome = 'positive' | 'negative'
export type AckFamily = 'CONTRL' | 'APERAK' | 'UTILTS_ERR'

export type AckPolicy = {
  shouldSendContrl: boolean
  shouldSendPositiveAperak: boolean
  shouldSendNegativeAperak: boolean
  shouldSendUtiltsErr: boolean
  ackDueAt: string | null
}

function trimOrNull(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function sanitizeSegmentText(value?: string | null): string {
  return (value ?? '').replace(/['+]/g, ' ').trim()
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

function computeAckDueAt(sourceMessage: EdielMessageRow): string | null {
  const base =
    sourceMessage.message_received_at ??
    sourceMessage.created_at ??
    new Date().toISOString()

  const baseMs = new Date(base).getTime()
  if (!Number.isFinite(baseMs)) return null

  return new Date(baseMs + 30 * 60 * 1000).toISOString()
}

async function resolveRouteAckMode(sourceMessage: EdielMessageRow) {
  if (!sourceMessage.communication_route_id) return 'default' as const

  const runtime = await getEdielRouteRuntimeByCommunicationRouteId(
    sourceMessage.communication_route_id
  )

  return runtime?.ack_mode ?? ('default' as const)
}

async function resolveRuleDefaults(sourceMessage: EdielMessageRow) {
  const refDate =
    sourceMessage.message_received_at?.slice(0, 10) ??
    sourceMessage.created_at.slice(0, 10)

  const resolved =
    (await getActiveEdielMessageRule({
      family: sourceMessage.message_family,
      code: String(sourceMessage.message_code),
      standard: sourceMessage.message_standard,
      direction: 'inbound',
      date: refDate,
    })) ??
    (await getActiveEdielMessageRule({
      family: sourceMessage.message_family,
      code: String(sourceMessage.message_code),
      standard: sourceMessage.message_standard,
      direction: 'both',
      date: refDate,
    }))

  return {
    requiresContrl: resolved?.requires_contrl ?? sourceMessage.requires_contrl === true,
    requiresAperak: resolved?.requires_aperak ?? sourceMessage.requires_aperak === true,
    supportsNegativeResponse:
      resolved?.supports_negative_response ?? sourceMessage.message_family === 'UTILTS',
  }
}

export async function getAutomaticAckPolicy(
  sourceMessage: EdielMessageRow
): Promise<AckPolicy> {
  ensureInboundEdifactSource(sourceMessage)

  const routeAckMode = await resolveRouteAckMode(sourceMessage)
  const ruleDefaults = await resolveRuleDefaults(sourceMessage)

  const shouldSendContrl =
    routeAckMode !== 'none' &&
    ruleDefaults.requiresContrl &&
    sourceMessage.message_family !== 'CONTRL'

  const shouldSendPositiveAperak =
    routeAckMode === 'contrl_and_aperak'
      ? true
      : routeAckMode === 'contrl_only' || routeAckMode === 'none'
        ? false
        : ruleDefaults.requiresAperak

  const shouldSendNegativeAperak =
    routeAckMode !== 'none' &&
    ruleDefaults.requiresAperak

  const shouldSendUtiltsErr =
    routeAckMode !== 'none' &&
    sourceMessage.message_family === 'UTILTS' &&
    ruleDefaults.supportsNegativeResponse

  return {
    shouldSendContrl,
    shouldSendPositiveAperak,
    shouldSendNegativeAperak,
    shouldSendUtiltsErr,
    ackDueAt: computeAckDueAt(sourceMessage),
  }
}

function sourceParties(sourceMessage: EdielMessageRow) {
  return {
    senderEdielId: trimOrNull(sourceMessage.receiver_ediel_id),
    senderName: trimOrNull(sourceMessage.receiver_name),
    senderSubAddress: trimOrNull(sourceMessage.receiver_sub_address) ?? 'GRIDEX',
    receiverEdielId: trimOrNull(sourceMessage.sender_ediel_id),
    receiverName: trimOrNull(sourceMessage.sender_name),
    receiverSubAddress: trimOrNull(sourceMessage.sender_sub_address) ?? 'EDIEL',
    receiverEmail: trimOrNull(sourceMessage.sender_email),
    mailbox: trimOrNull(sourceMessage.mailbox),
  }
}

function defaultAckStatuses(): {
  contrlStatus: EdielAckStatus
  aperakStatus: EdielAckStatus
  utiltsErrStatus: EdielAckStatus
  requiresContrl: boolean
  requiresAperak: boolean
  ackDueAt: string | null
} {
  return {
    contrlStatus: 'not_required',
    aperakStatus: 'not_required',
    utiltsErrStatus: 'not_required',
    requiresContrl: false,
    requiresAperak: false,
    ackDueAt: null,
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
    (params.outcome === 'positive' ? 'Application accepted' : 'Application error')

  return [
    'UNH+1+APERAK:D:01B:UN:1.0',
    `BGM+APERAK+${sanitizeSegmentText(params.externalReference)}+9`,
    `RFF+TN:${sanitizeSegmentText(params.transactionReference)}`,
    params.sourceMessage.transaction_reference
      ? `RFF+CR:${sanitizeSegmentText(params.sourceMessage.transaction_reference)}`
      : null,
    params.sourceMessage.external_reference
      ? `RFF+ACE:${sanitizeSegmentText(params.sourceMessage.external_reference)}`
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
  const text =
    sanitizeSegmentText(params.messageText) || 'Functional error in UTILTS message'

  return [
    'UNH+1+UTILTS:D:03A:UN:E5SE5A',
    `BGM+UTILTS_ERR+${sanitizeSegmentText(params.externalReference)}+9`,
    `RFF+TN:${sanitizeSegmentText(params.transactionReference)}`,
    params.sourceMessage.transaction_reference
      ? `RFF+CR:${sanitizeSegmentText(params.sourceMessage.transaction_reference)}`
      : null,
    params.sourceMessage.external_reference
      ? `RFF+ACE:${sanitizeSegmentText(params.sourceMessage.external_reference)}`
      : null,
    `FTX+AAO+++${text}`,
  ].filter(Boolean) as string[]
}

function buildAckEnvelope(params: {
  sourceMessage: EdielMessageRow
  ackFamily: AckFamily
  externalReference: string
  transactionReference: string
  outcome?: AckOutcome
  messageText?: string | null
}) {
  const parties = sourceParties(params.sourceMessage)

  if (!parties.senderEdielId || !parties.receiverEdielId) {
    throw new Error(
      `Källmeddelande ${params.sourceMessage.id} saknar routingidentiteter för ack.`
    )
  }

  const applicationReference =
    trimOrNull(params.sourceMessage.application_reference) ??
    buildDefaultApplicationReference({
      actorSubAddress: parties.senderSubAddress,
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
    senderSubAddress: parties.senderSubAddress,
    receiverEdielId: parties.receiverEdielId,
    receiverSubAddress: parties.receiverSubAddress,
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

function buildAckDraft(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  ackFamily: AckFamily
  outcome?: AckOutcome
  messageText?: string | null
}): CreateEdielMessageInput {
  ensureInboundEdifactSource(params.sourceMessage)

  if (params.ackFamily === 'UTILTS_ERR' && params.sourceMessage.message_family !== 'UTILTS') {
    throw new Error('UTILTS_ERR får bara genereras som svar på UTILTS.')
  }

  const refs = buildCanonicalAckReferences({
    sourceMessage: params.sourceMessage,
    ackFamily: params.ackFamily,
  })

  if (!refs.externalReference || !refs.transactionReference) {
    throw new Error(`Ack-referenser kunde inte byggas för ${params.sourceMessage.id}.`)
  }

  const { envelope, applicationReference, parties } = buildAckEnvelope({
    sourceMessage: params.sourceMessage,
    ackFamily: params.ackFamily,
    externalReference: refs.externalReference,
    transactionReference: refs.transactionReference,
    outcome: params.outcome,
    messageText: params.messageText,
  })

  const defaults = defaultAckStatuses()

  return {
    actorUserId: params.actorUserId ?? 'system',
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
    status: 'prepared',
    transportType: 'smtp',
    mailbox: parties.mailbox,
    senderEdielId: parties.senderEdielId,
    senderName: parties.senderName,
    receiverEdielId: parties.receiverEdielId,
    receiverName: parties.receiverName,
    senderSubAddress: parties.senderSubAddress,
    receiverSubAddress: parties.receiverSubAddress,
    receiverEmail: parties.receiverEmail,
    subject: `${params.ackFamily} ${refs.externalReference}`,
    fileName: inferEdielFileName({
      family: params.ackFamily === 'UTILTS_ERR' ? 'UTILTS_ERR' : params.ackFamily,
      code: params.ackFamily,
      direction: 'outbound',
      extension: 'edi',
    }),
    mimeType: 'application/edifact',
    interchangeReference: envelope.interchangeReference,
    applicationReference,
    externalReference: refs.externalReference,
    correlationReference: refs.correlationReference,
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
    rawPayload: envelope.raw,
    parsedPayload: {
      ackFamily: params.ackFamily,
      ackOutcome: params.outcome ?? 'positive',
      sourceMessageId: params.sourceMessage.id,
      sourceMessageFamily: params.sourceMessage.message_family,
      sourceMessageCode: params.sourceMessage.message_code,
      sourceTransactionReference: params.sourceMessage.transaction_reference,
      sourceExternalReference: params.sourceMessage.external_reference,
      sourceInterchangeReference: params.sourceMessage.interchange_reference,
      messageText: params.messageText ?? null,
      ackDueAt: computeAckDueAt(params.sourceMessage),
    },
    requiresContrl: defaults.requiresContrl,
    requiresAperak: defaults.requiresAperak,
    contrlStatus: defaults.contrlStatus,
    aperakStatus: defaults.aperakStatus,
    utiltsErrStatus: defaults.utiltsErrStatus,
    ackDueAt: defaults.ackDueAt,
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

export async function findExistingAckForSource(params: {
  sourceMessageId: string
  ackFamily: AckFamily
  outcome?: AckOutcome
}): Promise<EdielMessageRow | null> {
  const rows = await listAckMessagesForSource({
    sourceMessageId: params.sourceMessageId,
    ackFamily: params.ackFamily,
  })

  return (
    rows.find((row: EdielMessageRow) => {
      if (params.outcome === undefined) return true
      const payload = row.parsed_payload ?? {}
      return payload.ackOutcome === params.outcome
    }) ?? null
  )
}