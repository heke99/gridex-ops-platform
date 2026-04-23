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
import { buildCanonicalAckReferences } from '@/lib/ediel/core/referenceRegistry'
import { listAckMessagesForSource } from '@/lib/ediel/db'

export type AckOutcome = 'positive' | 'negative'
export type AckFamily = 'CONTRL' | 'APERAK' | 'UTILTS_ERR'

export type EdielCanonicalAckState =
  | 'awaiting_contrl'
  | 'contrl_received'
  | 'contrl_failed'
  | 'awaiting_aperak'
  | 'aperak_received_positive'
  | 'aperak_received_negative'
  | 'utilts_err_received'
  | 'ack_overdue'
  | 'no_ack_required'
  | 'in_progress'

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
    sourceMessage.message_family !== 'CONTRL' &&
    ruleDefaults.requiresContrl

  const shouldSendPositiveAperak =
    routeAckMode === 'contrl_and_aperak'
      ? true
      : routeAckMode === 'contrl_only' || routeAckMode === 'none'
        ? false
        : ruleDefaults.requiresAperak

  const shouldSendNegativeAperak =
    routeAckMode !== 'none' &&
    sourceMessage.message_family !== 'APERAK' &&
    sourceMessage.message_family !== 'CONTRL' &&
    ruleDefaults.supportsNegativeResponse

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
    (params.outcome === 'positive'
      ? 'Application accepted'
      : 'Application rejected')

  const originalMessageType = sanitizeSegmentText(
    `${params.sourceMessage.message_family} ${String(params.sourceMessage.message_code)}`
  )

  return [
    'UNH+1+APERAK:D:96A:UN:2.0',
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

  const envelope = buildEdifactEnvelope({
    senderEdielId: parties.senderEdielId ?? 'UNKNOWN',
    receiverEdielId: parties.receiverEdielId ?? 'UNKNOWN',
    messageTypeToken:
      params.ackFamily === 'CONTRL'
        ? 'CONTRL:D:96A:UN:1.0'
        : params.ackFamily === 'APERAK'
          ? 'APERAK:D:96A:UN:2.0'
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
          ? 'D96A'
          : 'D01B',
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
    syntaxCheckStatus:
      params.ackFamily === 'CONTRL'
        ? outcome === 'positive'
          ? 'accepted'
          : 'rejected'
        : 'not_checked',
    functionalCheckStatus:
      params.ackFamily === 'APERAK'
        ? outcome === 'positive'
          ? 'accepted'
          : 'rejected'
        : params.ackFamily === 'UTILTS_ERR'
          ? 'rejected'
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
      const payloadOutcome =
        payload.ackOutcome === 'positive' || payload.ackOutcome === 'negative'
          ? payload.ackOutcome
          : null

      if (payloadOutcome) {
        return payloadOutcome === params.outcome
      }

      if (params.ackFamily === 'CONTRL') {
        return params.outcome === 'negative'
          ? row.syntax_check_status === 'rejected' || row.syntax_check_status === 'failed'
          : row.syntax_check_status === 'accepted'
      }

      return params.outcome === 'negative'
        ? row.functional_check_status === 'rejected' ||
            row.functional_check_status === 'failed'
        : row.functional_check_status === 'accepted'
    }) ?? null
  )
}

export function getCanonicalAckState(
  sourceMessage: Pick<
    EdielMessageRow,
    | 'requires_contrl'
    | 'requires_aperak'
    | 'contrl_status'
    | 'aperak_status'
    | 'utilts_err_status'
    | 'ack_due_at'
  >
): EdielCanonicalAckState {
  const contrlStatus = sourceMessage.contrl_status ?? null
  const aperakStatus = sourceMessage.aperak_status ?? null
  const utiltsErrStatus = sourceMessage.utilts_err_status ?? null
  const now = Date.now()
  const dueAt = sourceMessage.ack_due_at
    ? new Date(sourceMessage.ack_due_at).getTime()
    : Number.NaN
  const overdue = Number.isFinite(dueAt) && dueAt < now

  if (contrlStatus === 'failed') return 'contrl_failed'
  if (aperakStatus === 'failed') return 'aperak_received_negative'
  if (utiltsErrStatus === 'received' || utiltsErrStatus === 'sent') {
    return 'utilts_err_received'
  }
  if (contrlStatus === 'received' || contrlStatus === 'sent') {
    return 'contrl_received'
  }
  if (aperakStatus === 'received' || aperakStatus === 'sent') {
    return 'aperak_received_positive'
  }
  if (
    overdue &&
    (contrlStatus === 'pending' ||
      aperakStatus === 'pending' ||
      utiltsErrStatus === 'pending')
  ) {
    return 'ack_overdue'
  }
  if (contrlStatus === 'pending') return 'awaiting_contrl'
  if (aperakStatus === 'pending') return 'awaiting_aperak'
  if (utiltsErrStatus === 'pending') return 'in_progress'
  if (
    sourceMessage.requires_contrl === false &&
    sourceMessage.requires_aperak === false &&
    !utiltsErrStatus
  ) {
    return 'no_ack_required'
  }
  return 'in_progress'
}