import { parseCanonicalMessageRow } from '@/lib/ediel/core/canonicalMessage'
import { decideProdatAperak, decideUtiltsResponse, type EdielEngineDecision } from '@/lib/ediel/decisionEngine'
import { createEdielMessageEvent } from '@/lib/ediel/db'
import { resolveEdielBusinessMatch, type EdielBusinessMatchResult } from '@/lib/ediel/matching/index'
import { createAckTimersForMessage, type EdielAckTimerPlan } from '@/lib/ediel/sla/createAckTimers'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { supabaseService } from '@/lib/supabase/service'

export type EdielPipelineStepStatus = 'completed' | 'blocked' | 'manual_review' | 'skipped' | 'failed'

export type EdielPipelineStep = {
  key: string
  status: EdielPipelineStepStatus
  reason?: string | null
  details?: Record<string, unknown>
}

export type EdielProcessingPipelineResult = {
  runId: string | null
  sourceMessageId: string
  companyId: string | null
  canonical: ReturnType<typeof parseCanonicalMessageRow>
  businessMatch: EdielBusinessMatchResult | null
  decision: EdielEngineDecision | null
  sla: EdielAckTimerPlan | null
  steps: EdielPipelineStep[]
  canAutoSendBusinessAck: boolean
  manualReviewReason: string | null
}

function contextKind(message: EdielMessageRow): 'production' | 'AGT' | 'TGT' | 'unknown' | null {
  const parsed = message.parsed_payload ?? {}
  const report = message.validation_report ?? {}
  const text = JSON.stringify({ parsed, report }).toUpperCase()
  if (message.environment === 'production' && message.test_flag !== 1) return 'production'
  if (text.includes('AGT')) return 'AGT'
  if (text.includes('TGT')) return 'TGT'
  if (message.environment === 'test' || message.test_flag === 1) return 'unknown'
  return null
}

function expectedOutcome(message: EdielMessageRow): 'positive' | 'negative' | null {
  const report = message.validation_report ?? {}
  const value = (report.expectedOutcome ?? report.requestedOutcome ?? report.effectiveOutcome) as unknown
  return value === 'positive' || value === 'negative' ? value : null
}

function expectedFamily(message: EdielMessageRow): 'CONTRL' | 'APERAK' | 'UTILTS_ERR' | null {
  const report = message.validation_report ?? {}
  const value = String(report.expectedFamily ?? report.expectedAckFamily ?? '').toUpperCase()
  if (value === 'CONTRL' || value === 'APERAK' || value === 'UTILTS_ERR') return value
  return null
}

async function createProcessingRun(params: { actorUserId: string; message: EdielMessageRow }): Promise<string | null> {
  const { data, error } = await supabaseService
    .from('ediel_processing_runs')
    .insert({
      company_id: params.message.company_id ?? null,
      source_message_id: params.message.id,
      status: 'running',
      context: contextKind(params.message) ?? 'unknown',
      payload: {
        messageFamily: params.message.message_family,
        messageCode: params.message.message_code,
        environment: params.message.environment,
        testFlag: params.message.test_flag,
      },
      started_at: new Date().toISOString(),
      created_by: params.actorUserId,
      updated_by: params.actorUserId,
    })
    .select('id')
    .single()

  if (error) throw error
  return typeof data?.id === 'string' ? data.id : null
}

async function updateProcessingRun(params: {
  runId: string
  status: 'completed' | 'manual_review' | 'blocked' | 'failed'
  payload: Record<string, unknown>
  actorUserId: string
  onlyWhileRunning?: boolean
}) {
  const now = new Date().toISOString()
  const update = supabaseService
    .from('ediel_processing_runs')
    .update({
      status: params.status,
      payload: params.payload,
      completed_at: now,
      updated_by: params.actorUserId,
      updated_at: now,
    })
    .eq('id', params.runId)
  const { error } = params.onlyWhileRunning ? await update.eq('status', 'running') : await update
  if (error) throw error
}

async function completeProcessingRun(params: {
  runId: string | null
  status: 'completed' | 'manual_review' | 'blocked' | 'failed'
  payload: Record<string, unknown>
  actorUserId: string
}) {
  if (!params.runId) return
  await updateProcessingRun({ ...params, runId: params.runId })
}

function describeProcessingRunError(error: unknown): { code: string | null; message: string } {
  const record = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : null
  const code = typeof record?.code === 'string' && record.code ? record.code : null
  const message = error instanceof Error ? error.message : typeof record?.message === 'string' ? record.message : String(error)
  return { code, message: message.slice(0, 500) }
}

/**
 * Closes a run whose pipeline threw (simulation finding track4/10). Best
 * effort: it only moves a still-running row to 'failed' and never replaces the
 * original error, which the caller rethrows.
 */
async function failProcessingRun(params: {
  runId: string | null
  actorUserId: string
  sourceMessageId: string
  failedStep: string
  steps: EdielPipelineStep[]
  error: unknown
}) {
  if (!params.runId) return
  try {
    await updateProcessingRun({
      runId: params.runId,
      status: 'failed',
      actorUserId: params.actorUserId,
      onlyWhileRunning: true,
      payload: {
        sourceMessageId: params.sourceMessageId,
        failedStep: params.failedStep,
        error: describeProcessingRunError(params.error),
        steps: params.steps,
      },
    })
  } catch {
    /* the original pipeline error stays authoritative */
  }
}

export async function recordDecisionTrace(params: {
  actorUserId: string
  message: EdielMessageRow
  runId?: string | null
  decision: EdielEngineDecision | null
  businessMatch?: EdielBusinessMatchResult | null
  steps?: EdielPipelineStep[]
}) {
  const decision = params.decision
  const { error } = await supabaseService
    .from('ediel_decision_traces')
    .insert({
      company_id: params.message.company_id ?? null,
      source_message_id: params.message.id,
      processing_run_id: params.runId ?? null,
      decision: decision?.kind ?? 'no_decision',
      ack_family: decision?.ackFamily ?? null,
      outcome: decision?.outcome ?? null,
      confidence: params.businessMatch?.confidence ?? null,
      can_auto_send: decision?.kind === 'ack' && params.businessMatch?.confidence === 'high',
      rule_profile: decision?.classification?.ruleProfileId ?? null,
      rule_profile_version: decision?.classification?.ruleProfileVersion ?? null,
      backend_rule_keys: decision?.ruleKeys ?? [],
      reasons: decision?.reason ? [decision.reason] : [],
      warnings: params.businessMatch?.warnings ?? [],
      errors: [],
      application_errors: decision?.applicationErrors ?? [],
      ack_payload_intent: decision
        ? {
            ackFamily: decision.ackFamily,
            outcome: decision.outcome,
            messageText: decision.messageText,
            applicationErrors: decision.applicationErrors,
          }
        : {},
      business_match: params.businessMatch ?? null,
      steps: params.steps ?? [],
      created_by: params.actorUserId,
    })

  if (error) throw error
}

function decideForMessage(message: EdielMessageRow): EdielEngineDecision | null {
  if (message.message_family === 'PRODAT') {
    return decideProdatAperak({
      message,
      testKind: contextKind(message),
      expectedOutcome: expectedOutcome(message),
    })
  }

  if (message.message_family === 'UTILTS') {
    return decideUtiltsResponse({
      message,
      testKind: contextKind(message),
      expectedFamily: expectedFamily(message),
      expectedOutcome: expectedOutcome(message),
    })
  }

  return null
}

export async function analyzeEdielProcessingPipeline(params: {
  actorUserId: string
  message: EdielMessageRow
  createSlaTimers?: boolean
  createDecisionTrace?: boolean
}): Promise<EdielProcessingPipelineResult> {
  const steps: EdielPipelineStep[] = []
  const runId = await createProcessingRun({ actorUserId: params.actorUserId, message: params.message })
  let currentStep = 'parse_canonical'
  try {
    const canonical = parseCanonicalMessageRow(params.message)
    steps.push({ key: 'parse_canonical', status: 'completed', details: { family: canonical.family, messageCode: canonical.messageCode } })

    let sla: EdielAckTimerPlan | null = null
    if (params.createSlaTimers !== false) {
      currentStep = 'sla_timers'
      sla = await createAckTimersForMessage({ actorUserId: params.actorUserId, message: params.message })
      steps.push({ key: 'sla_timers', status: sla ? 'completed' : 'skipped', details: sla ?? undefined })
    }

    const tenantResolved = Boolean(params.message.company_id)
    steps.push({
      key: 'tenant_resolution',
      status: tenantResolved ? 'completed' : 'blocked',
      reason: tenantResolved ? null : 'unknown_tenant',
      details: { companyId: params.message.company_id ?? null, tenantResolutionStatus: params.message.tenant_resolution_status ?? null },
    })

    let businessMatch: EdielBusinessMatchResult | null = null
    if (tenantResolved) {
      currentStep = 'business_match'
      businessMatch = await resolveEdielBusinessMatch({ message: params.message })
      steps.push({
        key: 'business_match',
        status: businessMatch.confidence === 'high' ? 'completed' : 'manual_review',
        reason: businessMatch.manualReviewReason,
        details: {
          confidence: businessMatch.confidence,
          customerId: businessMatch.customerId,
          siteId: businessMatch.siteId,
          meteringPointId: businessMatch.meteringPointId,
          processId: businessMatch.processId,
          permissionId: businessMatch.permissionId,
          candidateCount: businessMatch.candidates.length,
        },
      })
    }

    currentStep = 'decision_engine'
    const decision = decideForMessage(params.message)
    if (decision) {
      steps.push({
        key: 'decision_engine',
        status: decision.kind === 'manual_review' ? 'manual_review' : decision.kind === 'ack' ? 'completed' : 'skipped',
        reason: decision.reason,
        details: {
          kind: decision.kind,
          ackFamily: decision.ackFamily,
          outcome: decision.outcome,
          ruleKeys: decision.ruleKeys,
        },
      })
    }

    const canAutoSendBusinessAck = Boolean(decision?.kind === 'ack' && tenantResolved && businessMatch?.confidence === 'high')
    const manualReviewReason =
      !tenantResolved ? 'unknown_tenant' :
      businessMatch?.manualReviewReason ??
      (decision?.kind === 'manual_review' ? 'backend_decision_manual_review' : null)

    if (params.createDecisionTrace !== false) {
      currentStep = 'decision_trace'
      await recordDecisionTrace({
        actorUserId: params.actorUserId,
        message: params.message,
        runId,
        decision,
        businessMatch,
        steps,
      })
    }

    const finalStatus = manualReviewReason ? 'manual_review' : 'completed'
    currentStep = 'complete_run'
    await completeProcessingRun({
      runId,
      status: finalStatus,
      actorUserId: params.actorUserId,
      payload: {
        sourceMessageId: params.message.id,
        canAutoSendBusinessAck,
        manualReviewReason,
        steps,
        decision: decision
          ? { kind: decision.kind, ackFamily: decision.ackFamily, outcome: decision.outcome, ruleKeys: decision.ruleKeys, reason: decision.reason }
          : null,
        businessMatch,
      },
    })

    currentStep = 'validated_event'
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.message.id,
      eventType: 'validated',
      eventStatus: manualReviewReason ? 'warning' : 'success',
      message: manualReviewReason
        ? 'Backend automation pipeline prepared trace and requires manual review before business ACK autosend.'
        : 'Backend automation pipeline prepared trace and marked message safe for backend-controlled ACK flow.',
      payload: {
        runId,
        canAutoSendBusinessAck,
        manualReviewReason,
        decision: decision
          ? { kind: decision.kind, ackFamily: decision.ackFamily, outcome: decision.outcome, ruleKeys: decision.ruleKeys, reason: decision.reason }
          : null,
        businessMatch,
        steps,
      },
    })

    return {
      runId,
      sourceMessageId: params.message.id,
      companyId: params.message.company_id ?? null,
      canonical,
      businessMatch,
      decision,
      sla,
      steps,
      canAutoSendBusinessAck,
      manualReviewReason,
    }
  } catch (error) {
    await failProcessingRun({
      runId,
      actorUserId: params.actorUserId,
      sourceMessageId: params.message.id,
      failedStep: currentStep,
      steps,
      error,
    })
    throw error
  }
}
