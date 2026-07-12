// lib/ediel/core/ackPolicy.ts

import type { EdielAckStatus, EdielMessageRow } from '@/lib/ediel/types'
import {
  getActiveEdielMessageRule,
  getEdielRouteRuntimeByCommunicationRouteId,
} from '@/lib/ediel/config'
import { listAckMessagesForSource } from '@/lib/ediel/db'
import { EDIEL_ACK_DEADLINE_MINUTES } from '@/lib/ediel/specRegistry'
import { canonicalAckRequirements } from '@/lib/ediel/ack/canonicalAckEngine'
import { loadCanonicalAckRulePack } from '@/lib/ediel/ack/ackRulePackRegistry'

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

type AckDueBaseInput = Pick<
  EdielMessageRow,
  'message_received_at' | 'message_sent_at' | 'created_at'
>

type OutboundAckDueInput = Partial<AckDueBaseInput> & {
  baseTime?: string | null
  requiresContrl?: boolean | null
  requiresAperak?: boolean | null
  contrlStatus?: EdielAckStatus | null
  aperakStatus?: EdielAckStatus | null
  utiltsErrStatus?: EdielAckStatus | null
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

  if (sourceMessage.message_family === 'CONTRL') {
    throw new Error('CONTRL ska registreras och kopplas, inte kvitteras med nytt ack.')
  }

}

function addAckDeadlineMinutes(baseTime?: string | null): string | null {
  const base = baseTime ?? new Date().toISOString()
  const baseMs = new Date(base).getTime()

  if (!Number.isFinite(baseMs)) return null

  return new Date(baseMs + EDIEL_ACK_DEADLINE_MINUTES * 60 * 1000).toISOString()
}

export function computeCanonicalAckDueAt(
  sourceMessage?: AckDueBaseInput | string | null
): string | null {
  if (typeof sourceMessage === 'string') {
    return addAckDeadlineMinutes(sourceMessage)
  }

  const base =
    sourceMessage?.message_received_at ??
    sourceMessage?.message_sent_at ??
    sourceMessage?.created_at ??
    null

  return addAckDeadlineMinutes(base)
}

export function computeOutboundAckDueAt(params?: OutboundAckDueInput | string | null): string | null {
  if (typeof params === 'string') {
    return addAckDeadlineMinutes(params)
  }

  const requiresAnyAck =
    params?.requiresContrl === true ||
    params?.requiresAperak === true ||
    params?.contrlStatus === 'pending' ||
    params?.aperakStatus === 'pending' ||
    params?.utiltsErrStatus === 'pending'

  if (!requiresAnyAck) return null

  const base =
    params?.baseTime ??
    params?.message_sent_at ??
    params?.message_received_at ??
    params?.created_at ??
    null

  return addAckDeadlineMinutes(base)
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

  const ackRulePack = await loadCanonicalAckRulePack({
    family: sourceMessage.message_family,
    code: sourceMessage.message_code,
    companyId: sourceMessage.company_id,
    environment: sourceMessage.environment,
    version: sourceMessage.message_version,
  })
  const canonical = {
    requiresContrl: ackRulePack.rule.technicalAck === 'CONTRL',
    requiresAperak: ackRulePack.rule.applicationAck === 'APERAK' || ackRulePack.rule.applicationAck === 'transactional',
    supportsNegativeAperak: ackRulePack.rule.negativeApplicationResponse === 'APERAK' || ackRulePack.rule.negativeApplicationResponse === 'APERAK_OR_UTILTS_ERR',
    supportsUtiltsErr: ackRulePack.rule.negativeApplicationResponse === 'UTILTS_ERR' || ackRulePack.rule.negativeApplicationResponse === 'APERAK_OR_UTILTS_ERR',
  }

  return {
    requiresContrl: canonical.requiresContrl,
    requiresAperak: canonical.requiresAperak,
    supportsNegativeResponse: canonical.supportsNegativeAperak || canonical.supportsUtiltsErr,
    supportsNegativeAperak: canonical.supportsNegativeAperak,
    supportsUtiltsErr: canonical.supportsUtiltsErr,
    ruleId: ackRulePack.snapshot.ruleId ?? resolved?.id ?? null,
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
    (ruleDefaults.requiresContrl || sourceMessage.message_family === 'APERAK')

  const canSendAperak =
    sourceMessage.message_family !== 'APERAK' &&
    sourceMessage.message_family !== 'CONTRL'

  const shouldSendPositiveAperak =
    canSendAperak &&
    (routeAckMode === 'contrl_and_aperak'
      ? true
      : routeAckMode === 'contrl_only' || routeAckMode === 'none'
        ? false
        : ruleDefaults.requiresAperak)

  const shouldSendNegativeAperak =
    canSendAperak &&
    routeAckMode !== 'none' &&
    ruleDefaults.supportsNegativeAperak

  const shouldSendUtiltsErr =
    routeAckMode !== 'none' &&
    sourceMessage.message_family === 'UTILTS' &&
    ruleDefaults.supportsUtiltsErr

  return {
    shouldSendContrl,
    shouldSendPositiveAperak,
    shouldSendNegativeAperak,
    shouldSendUtiltsErr,
    ackDueAt: computeCanonicalAckDueAt(sourceMessage),
  }
}

function inferAckOutcomeFromRow(row: EdielMessageRow): AckOutcome | null {
  if (row.ack_outcome === 'positive' || row.ack_outcome === 'negative') {
    return row.ack_outcome
  }

  const payload = row.parsed_payload ?? {}
  const payloadOutcome =
    payload.ackOutcome === 'positive' || payload.ackOutcome === 'negative'
      ? payload.ackOutcome
      : null

  if (payloadOutcome) return payloadOutcome

  if (row.message_family === 'CONTRL') {
    if (row.syntax_check_status === 'ok' || row.syntax_check_status === 'warning') return 'positive'
    if (row.syntax_check_status === 'failed') {
      return 'negative'
    }
    return null
  }

  if (row.message_family === 'APERAK' || row.message_family === 'UTILTS_ERR') {
    if (row.functional_check_status === 'ok' || row.functional_check_status === 'warning') return 'positive'
    if (
      row.functional_check_status === 'failed'
    ) {
      return 'negative'
    }
  }

  return null
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
      const status = String(row.status ?? '').trim().toLowerCase()
      if (status === 'cancelled' || status === 'failed') return false
      if (params.outcome === undefined) return true
      return inferAckOutcomeFromRow(row) === params.outcome
    }) ?? null
  )
}

function isPending(status: EdielAckStatus | null | undefined): boolean {
  return status === 'pending'
}

function isReceivedOrSent(status: EdielAckStatus | null | undefined): boolean {
  return status === 'received' || status === 'sent'
}

function isFailed(status: EdielAckStatus | null | undefined): boolean {
  return status === 'failed'
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

  const dueAtMs = sourceMessage.ack_due_at
    ? new Date(sourceMessage.ack_due_at).getTime()
    : Number.NaN
  const overdue = Number.isFinite(dueAtMs) && dueAtMs < Date.now()

  if (isFailed(contrlStatus)) return 'contrl_failed'
  if (isFailed(aperakStatus)) return 'aperak_received_negative'
  if (isReceivedOrSent(utiltsErrStatus)) return 'utilts_err_received'

  const contrlRequired = sourceMessage.requires_contrl === true
  const aperakRequired = sourceMessage.requires_aperak === true

  if (contrlRequired) {
    if (isPending(contrlStatus)) {
      return overdue ? 'ack_overdue' : 'awaiting_contrl'
    }

    if (!isReceivedOrSent(contrlStatus)) {
      return overdue ? 'ack_overdue' : 'in_progress'
    }
  }

  if (aperakRequired) {
    if (isPending(aperakStatus)) {
      return overdue ? 'ack_overdue' : 'awaiting_aperak'
    }

    if (isReceivedOrSent(aperakStatus)) {
      return 'aperak_received_positive'
    }

    if (!contrlRequired && !isReceivedOrSent(aperakStatus)) {
      return overdue ? 'ack_overdue' : 'in_progress'
    }
  }

  if (contrlRequired && isReceivedOrSent(contrlStatus)) {
    return 'contrl_received'
  }

  if (
    !contrlRequired &&
    !aperakRequired &&
    !utiltsErrStatus &&
    contrlStatus !== 'pending' &&
    aperakStatus !== 'pending'
  ) {
    return 'no_ack_required'
  }

  if (overdue && (isPending(contrlStatus) || isPending(aperakStatus) || isPending(utiltsErrStatus))) {
    return 'ack_overdue'
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
  const requirements = canonicalAckRequirements(params)
  return {
    requiresContrl: requirements.requiresContrl,
    requiresAperak: requirements.requiresAperak,
    contrlStatus: requirements.requiresContrl ? 'pending' : 'not_required',
    aperakStatus: requirements.requiresAperak ? 'pending' : 'not_required',
    utiltsErrStatus: 'not_required',
  }
}
