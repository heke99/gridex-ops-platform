// lib/ediel/core/ackPolicy.ts

import type { EdielAckStatus, EdielMessageRow } from '@/lib/ediel/types'
import { getEdielRouteRuntimeByCommunicationRouteId } from '@/lib/ediel/config'
import { listAckMessagesForSource } from '@/lib/ediel/db'
import { EDIEL_ACK_DEADLINE_MINUTES } from '@/lib/ediel/specRegistry'
import { canonicalAckRequirements, type CanonicalAckMatrixRule } from '@/lib/ediel/ack/canonicalAckEngine'
import { parseCanonicalMessageRow } from '@/lib/ediel/core/canonicalMessage'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import type { ProdatBusinessContext } from '@/lib/ediel/rulebook/prodatSubtypeRegistry'

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

type AckDueBaseInput = Pick<EdielMessageRow, 'message_received_at' | 'message_sent_at' | 'created_at'>

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
    throw new Error(`Ack-generatorn kräver inbound source. ${sourceMessage.id} är ${sourceMessage.direction}.`)
  }
  if (sourceMessage.message_standard !== 'edifact') {
    throw new Error(`Ack-generatorn kräver EDIFACT. ${sourceMessage.id} har ${sourceMessage.message_standard}.`)
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

export function computeCanonicalAckDueAt(sourceMessage?: AckDueBaseInput | string | null): string | null {
  if (typeof sourceMessage === 'string') return addAckDeadlineMinutes(sourceMessage)
  const base = sourceMessage?.message_received_at ?? sourceMessage?.message_sent_at ?? sourceMessage?.created_at ?? null
  return addAckDeadlineMinutes(base)
}

export function computeOutboundAckDueAt(params?: OutboundAckDueInput | string | null): string | null {
  if (typeof params === 'string') return addAckDeadlineMinutes(params)
  const requiresAnyAck =
    params?.requiresContrl === true ||
    params?.requiresAperak === true ||
    params?.contrlStatus === 'pending' ||
    params?.aperakStatus === 'pending' ||
    params?.utiltsErrStatus === 'pending'
  if (!requiresAnyAck) return null
  const base = params?.baseTime ?? params?.message_sent_at ?? params?.message_received_at ?? params?.created_at ?? null
  return addAckDeadlineMinutes(base)
}

async function resolveRouteAckMode(sourceMessage: EdielMessageRow) {
  if (!sourceMessage.communication_route_id) return 'default' as const
  const runtime = await getEdielRouteRuntimeByCommunicationRouteId(sourceMessage.communication_route_id)
  return runtime?.ack_mode ?? ('default' as const)
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function validAckRule(value: unknown): CanonicalAckMatrixRule | null {
  const candidate = record(value)
  if (!candidate) return null
  const technicalAck = candidate.technicalAck
  const applicationAck = candidate.applicationAck
  const negative = candidate.negativeApplicationResponse
  if (technicalAck !== 'CONTRL' && technicalAck !== 'none') return null
  if (applicationAck !== 'APERAK' && applicationAck !== 'transactional' && applicationAck !== 'none') return null
  if (!['APERAK', 'UTILTS_ERR', 'APERAK_OR_UTILTS_ERR', 'none'].includes(String(negative))) return null
  return candidate as unknown as CanonicalAckMatrixRule
}

function policyAckRuleFromPersistedRuntime(sourceMessage: EdielMessageRow): CanonicalAckMatrixRule | null {
  const report = record(sourceMessage.validation_report)
  const canonicalRuntime = record(report?.canonicalRuntime)
  const directPolicy = record(report?.canonicalPolicy)
  const nestedPolicy = record(canonicalRuntime?.canonicalPolicy)
  return validAckRule(nestedPolicy?.ackRule ?? directPolicy?.ackRule)
}

function referenceDate(sourceMessage: EdielMessageRow): string {
  const value = String(sourceMessage.message_received_at ?? sourceMessage.created_at ?? '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`canonical_ack_reference_date_missing:${sourceMessage.id}`)
  return value
}

function booleanPayloadFact(sourceMessage: EdielMessageRow, key: string): boolean | undefined {
  const parsed = record(sourceMessage.parsed_payload)
  const direct = parsed?.[key]
  const dependent = record(parsed?.prodatDependentFacts)?.[key]
  return typeof direct === 'boolean' ? direct : typeof dependent === 'boolean' ? dependent : undefined
}

function businessContextFact(sourceMessage: EdielMessageRow): ProdatBusinessContext | null {
  const parsed = record(sourceMessage.parsed_payload)
  const value = String(parsed?.businessContext ?? record(parsed?.prodatDependentFacts)?.businessContext ?? '').trim().toLowerCase()
  return ['death', 'bankruptcy', 'identity_change', 'other_masterdata', 'unknown'].includes(value)
    ? value as ProdatBusinessContext
    : null
}

/**
 * ACK semantics are taken from the canonical policy snapshot produced by the
 * inbound runtime. Manual/compatibility callers without that snapshot must
 * resolve the same canonical policy from the message; DB/config rule rows never
 * become protocol authority. Route ack_mode remains transport configuration and
 * can only add an optional positive APERAK, never suppress canonical responses.
 */
function resolveCanonicalAckRuleForSource(sourceMessage: EdielMessageRow): CanonicalAckMatrixRule {
  const persisted = policyAckRuleFromPersistedRuntime(sourceMessage)
  if (persisted) return persisted

  const canonical = parseCanonicalMessageRow(sourceMessage)
  if (!canonical.messageCode) throw new Error(`canonical_ack_message_code_missing:${sourceMessage.id}`)
  const policy = resolveCanonicalEdielPolicy({
    family: String(canonical.family),
    messageCode: canonical.messageCode,
    subtypeOrReasonCode: canonical.subtype,
    direction: 'inbound',
    referenceDate: referenceDate(sourceMessage),
    associationAssignedCode: canonical.version ?? sourceMessage.message_version,
    applicationReference: canonical.applicationReference ?? sourceMessage.application_reference,
    businessContext: businessContextFact(sourceMessage),
    bilateralCapabilityVerified: booleanPayloadFact(sourceMessage, 'bilateralCapabilityVerified'),
    mode: 'parse',
  })
  return policy.ackRule
}

function resolveRuleDefaults(sourceMessage: EdielMessageRow) {
  const rule = resolveCanonicalAckRuleForSource(sourceMessage)
  return {
    requiresContrl: rule.technicalAck === 'CONTRL',
    requiresAperak: rule.applicationAck === 'APERAK' || rule.applicationAck === 'transactional',
    supportsNegativeResponse: rule.negativeApplicationResponse !== 'none',
    supportsNegativeAperak: rule.negativeApplicationResponse === 'APERAK' || rule.negativeApplicationResponse === 'APERAK_OR_UTILTS_ERR',
    supportsUtiltsErr: rule.negativeApplicationResponse === 'UTILTS_ERR' || rule.negativeApplicationResponse === 'APERAK_OR_UTILTS_ERR',
  }
}

export async function getAutomaticAckPolicy(sourceMessage: EdielMessageRow): Promise<AckPolicy> {
  ensureInboundEdifactSource(sourceMessage)

  const routeAckMode = await resolveRouteAckMode(sourceMessage)
  const ruleDefaults = resolveRuleDefaults(sourceMessage)

  const shouldSendContrl =
    sourceMessage.message_family !== 'CONTRL' &&
    (ruleDefaults.requiresContrl || routeAckMode === 'contrl_only' || routeAckMode === 'contrl_and_aperak')

  const canSendAperak = sourceMessage.message_family !== 'APERAK' && sourceMessage.message_family !== 'CONTRL'
  const shouldSendPositiveAperak =
    canSendAperak &&
    (ruleDefaults.requiresAperak || routeAckMode === 'contrl_and_aperak')

  const shouldSendNegativeAperak = canSendAperak && ruleDefaults.supportsNegativeAperak
  const shouldSendUtiltsErr = sourceMessage.message_family === 'UTILTS' && ruleDefaults.supportsUtiltsErr

  return {
    shouldSendContrl,
    shouldSendPositiveAperak,
    shouldSendNegativeAperak,
    shouldSendUtiltsErr,
    ackDueAt: computeCanonicalAckDueAt(sourceMessage),
  }
}

function inferAckOutcomeFromRow(row: EdielMessageRow): AckOutcome | null {
  if (row.ack_outcome === 'positive' || row.ack_outcome === 'negative') return row.ack_outcome
  const payload = row.parsed_payload ?? {}
  const payloadOutcome = payload.ackOutcome === 'positive' || payload.ackOutcome === 'negative' ? payload.ackOutcome : null
  if (payloadOutcome) return payloadOutcome

  if (row.message_family === 'CONTRL') {
    if (row.syntax_check_status === 'ok' || row.syntax_check_status === 'warning') return 'positive'
    if (row.syntax_check_status === 'failed') return 'negative'
    return null
  }
  if (row.message_family === 'APERAK' || row.message_family === 'UTILTS_ERR') {
    if (row.functional_check_status === 'ok' || row.functional_check_status === 'warning') return 'positive'
    if (row.functional_check_status === 'failed') return 'negative'
  }
  return null
}

export async function findExistingAckForSource(params: {
  sourceMessageId: string
  ackFamily: AckFamily
  outcome?: AckOutcome
}): Promise<EdielMessageRow | null> {
  const rows = await listAckMessagesForSource({ sourceMessageId: params.sourceMessageId, ackFamily: params.ackFamily })
  return rows.find((row: EdielMessageRow) => {
    const status = String(row.status ?? '').trim().toLowerCase()
    if (status === 'cancelled' || status === 'failed') return false
    if (params.outcome === undefined) return true
    return inferAckOutcomeFromRow(row) === params.outcome
  }) ?? null
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
    'requires_contrl' | 'requires_aperak' | 'contrl_status' | 'aperak_status' | 'utilts_err_status' | 'ack_due_at'
  >,
): EdielCanonicalAckState {
  const contrlStatus = sourceMessage.contrl_status ?? null
  const aperakStatus = sourceMessage.aperak_status ?? null
  const utiltsErrStatus = sourceMessage.utilts_err_status ?? null
  const dueAtMs = sourceMessage.ack_due_at ? new Date(sourceMessage.ack_due_at).getTime() : Number.NaN
  const overdue = Number.isFinite(dueAtMs) && dueAtMs < Date.now()

  if (isFailed(contrlStatus)) return 'contrl_failed'
  if (isFailed(aperakStatus)) return 'aperak_received_negative'
  if (isReceivedOrSent(utiltsErrStatus)) return 'utilts_err_received'

  const contrlRequired = sourceMessage.requires_contrl === true
  const aperakRequired = sourceMessage.requires_aperak === true

  if (contrlRequired) {
    if (isPending(contrlStatus)) return overdue ? 'ack_overdue' : 'awaiting_contrl'
    if (!isReceivedOrSent(contrlStatus)) return overdue ? 'ack_overdue' : 'in_progress'
  }
  if (aperakRequired) {
    if (isPending(aperakStatus)) return overdue ? 'ack_overdue' : 'awaiting_aperak'
    if (isReceivedOrSent(aperakStatus)) return 'aperak_received_positive'
    if (!contrlRequired && !isReceivedOrSent(aperakStatus)) return overdue ? 'ack_overdue' : 'in_progress'
  }
  if (contrlRequired && isReceivedOrSent(contrlStatus)) return 'contrl_received'
  if (!contrlRequired && !aperakRequired && !utiltsErrStatus && contrlStatus !== 'pending' && aperakStatus !== 'pending') {
    return 'no_ack_required'
  }
  if (overdue && (isPending(contrlStatus) || isPending(aperakStatus) || isPending(utiltsErrStatus))) return 'ack_overdue'
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

/** Compatibility projection for callers that only need stored ACK defaults.
 * Active runtime decisions resolve a full CanonicalEdielPolicy and consume its
 * ackRule; this helper does not own a second ACK matrix. */
export function deriveEdielAckDefaults(params: { family: string; code: string }): {
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
