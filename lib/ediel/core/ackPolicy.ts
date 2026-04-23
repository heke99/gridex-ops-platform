// lib/ediel/core/ackPolicy.ts

import type {
  EdielAckStatus,
  EdielMessageRow,
} from '@/lib/ediel/types'
import {
  getActiveEdielMessageRule,
  getEdielRouteRuntimeByCommunicationRouteId,
} from '@/lib/ediel/config'
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

export function defaultAckStatuses(): {
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

export function deriveEdielAckDefaults(params: {
  family: string
  code: string
}): {
  requiresContrl: boolean
  requiresAperak: boolean
  contrlStatus: 'pending' | 'not_required'
  aperakStatus: 'pending' | 'not_required'
  utiltsErrStatus: 'not_required'
} {
  const family = params.family.toUpperCase()
  const code = params.code.toUpperCase()

  if (family === 'AI_LIST') {
    return {
      requiresContrl: false,
      requiresAperak: false,
      contrlStatus: 'not_required',
      aperakStatus: 'not_required',
      utiltsErrStatus: 'not_required',
    }
  }

  if (family === 'CONTRL' || family === 'APERAK' || family === 'UTILTS_ERR') {
    return {
      requiresContrl: false,
      requiresAperak: false,
      contrlStatus: 'not_required',
      aperakStatus: 'not_required',
      utiltsErrStatus: 'not_required',
    }
  }

  if (family === 'UTILTS') {
    return {
      requiresContrl: true,
      requiresAperak:
        code === 'E66' ||
        code === 'E73' ||
        code === 'S01' ||
        code === 'S02' ||
        code === 'S03' ||
        code === 'S04',
      contrlStatus: 'pending',
      aperakStatus:
        code === 'E66' ||
        code === 'E73' ||
        code === 'S01' ||
        code === 'S02' ||
        code === 'S03' ||
        code === 'S04'
          ? 'pending'
          : 'not_required',
      utiltsErrStatus: 'not_required',
    }
  }

  if (family === 'PRODAT') {
    return {
      requiresContrl: true,
      requiresAperak: true,
      contrlStatus: 'pending',
      aperakStatus: 'pending',
      utiltsErrStatus: 'not_required',
    }
  }

  return {
    requiresContrl: true,
    requiresAperak: false,
    contrlStatus: 'pending',
    aperakStatus: 'not_required',
    utiltsErrStatus: 'not_required',
  }
}