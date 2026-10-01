// lib/ediel/core/ackPolicy.ts

import type { EdielAckStatus, EdielMessageRow } from '@/lib/ediel/types'
import { getEdielRouteRuntimeByCommunicationRouteId } from '@/lib/ediel/config'
import {readOutboundAckOriginals} from './outboundAckOriginals'
import type {ProdatAckObjectScope} from '@/lib/ediel/ack/sourceCorrelation'
import { EDIEL_ACK_DEADLINE_MINUTES } from '@/lib/ediel/specRegistry'
import {
  canonicalAckRequirementsForFamilyCode,
  type CanonicalAckMatrixRule,
  type ProdatBusinessContext,
} from '@/lib/ediel/rulebook/canonicalEdielFacade'
import { parseCanonicalMessageRow } from '@/lib/ediel/core/canonicalMessage'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'

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

export async function findExistingAckForSource(params: {
  sourceMessageId: string
  ackFamily: AckFamily
  outcome?: AckOutcome
  ackScope?: 'interchange'|'message'|'transaction'|'object'
  transactionReference?: string
  acknowledgedReferences?: readonly string[]
  acknowledgedProdatObjects?:readonly ProdatAckObjectScope[]
  expectedSource?: EdielMessageRow
  expectedTechnicalCompanyId?: string
}): Promise<EdielMessageRow | null> {
  const originals=await readOutboundAckOriginals(params.sourceMessageId,params.ackFamily,params.expectedSource,params.expectedTechnicalCompanyId)
  const references=[...new Set([...(params.acknowledgedReferences??[]),...(params.transactionReference?[params.transactionReference]:[])])]
  const objects=params.acknowledgedProdatObjects??[]
  if(objects.length&&(!params.expectedSource||params.ackFamily!=='APERAK'||params.ackScope!=='object'))throw new Error('ediel_existing_ack_original_object_scope_unavailable')
  if(params.ackScope==='object'&&!references.length&&!objects.length)throw new Error('ediel_existing_ack_original_object_scope_unavailable')
  for(const original of originals){
    const {correlation}=original
    const wholeCoverage=correlation.wholeSourceOutcome!==undefined && ['message','interchange'].includes(correlation.scope)
    if(params.ackScope && correlation.scope!==params.ackScope && !wholeCoverage)continue
    if(references.length && ['transaction','object'].includes(correlation.scope)
      && !references.every(reference=>correlation.acknowledgedReferences.includes(reference)))continue
    if(references.length && !['transaction','object'].includes(correlation.scope) && !wholeCoverage)continue
    const matchesObject=(own:ProdatAckObjectScope)=>correlation.prodatObjectOutcomes?.find(result=>result.objectId===own.objectId&&result.identityAgency===own.identityAgency
      &&result.firstLineIndex===own.firstLineIndex&&result.lineItemReference===own.lineItemReference)
    if(objects.length&&!wholeCoverage&&(correlation.scope!=='object'||!objects.every(own=>matchesObject(own))))continue
    if(original.status==='held')throw new Error('ediel_existing_ack_original_basis_unavailable')
    const outcomes=objects.length&&!wholeCoverage?objects.map(own=>matchesObject(own)?.outcome):references.length && correlation.scope==='object'
      ? references.map(reference=>correlation.scopedOutcomes?.find(result=>result.reference===reference)?.outcome)
      : [wholeCoverage?correlation.wholeSourceOutcome:correlation.classification.outcome]
    if(outcomes.some(outcome=>outcome!=='positive'&&outcome!=='negative'))throw new Error('ediel_existing_ack_original_outcome_unavailable')
    if(params.outcome!==undefined && !outcomes.every(outcome=>outcome===params.outcome))continue
    // This is only an aggregate of the requested own groups. The caller keeps
    // their separate physical scoped results when checking immutable conflicts.
    const outcome=outcomes.some(value=>value==='negative')?'negative':'positive'
    if(outcome!=='positive'&&outcome!=='negative')throw new Error('ediel_existing_ack_original_outcome_unavailable')
    if(params.outcome!==undefined&&outcome!==params.outcome)continue
    // A read projection only. The returned actual original keeps status/raw/ID;
    // mutable public outcome/cache fields cannot reinterpret its response.
    return {...original.message,ack_outcome:outcome,parsed_payload:{...original.message.parsed_payload,ackOutcome:outcome}}
  }
  return null
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
  if (!contrlRequired && !aperakRequired && (utiltsErrStatus === null || utiltsErrStatus === 'not_required') && contrlStatus !== 'pending' && aperakStatus !== 'pending') {
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
  const requirements = canonicalAckRequirementsForFamilyCode(params)
  return {
    requiresContrl: requirements.requiresContrl,
    requiresAperak: requirements.requiresAperak,
    contrlStatus: requirements.requiresContrl ? 'pending' : 'not_required',
    aperakStatus: requirements.requiresAperak ? 'pending' : 'not_required',
    utiltsErrStatus: 'not_required',
  }
}
