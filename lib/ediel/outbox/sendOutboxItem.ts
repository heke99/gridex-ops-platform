import type { Database } from '@/supabase/database.types'
import { getEdielMessageById } from '@/lib/ediel/db'
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport'
import { supabaseService } from '@/lib/supabase/service'
import { getEdielOutboundReadinessBlocker } from '@/lib/ediel/outbox/readinessGuard'
import { evaluateEdielRouteContract } from '@/lib/ediel/outbox/routeContract'
import { claimEdielOutboxItem } from '@/lib/ediel/outbox/claimOutboxItems'
import { projectSentEdielSourceState } from '@/lib/ediel/outbox/projectSentSources'
import { getTenantOperationDecision } from '@/lib/tenant/operationPolicy'
import { isSmtpDeliveryUncertain, SmtpDeliveryUncertainError } from '@/lib/ediel/transport/smtpOutcome'
import { readAcceptedEdielTransportProjection } from '@/lib/ediel/transport/acceptedProjection'
import { repairAcceptedEdielMessageProjection } from '@/lib/ediel/transport/acceptedProjectionRepair'
import { CANCELLED_APERAK_TRANSPORT, EDIEL_WORKER_FENCE_LOST, isCancelledAperakTransport, isEdielWorkerFenceLost, LocalTestTransportWaitError, LocalTestTransportWaitUnconfirmedError, SmtpPermanentRejectionError } from '@/lib/ediel/transport/outboundAttempt'

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const OUTBOX_ERROR_MESSAGE_MAX = 500

// Fynd 023: ediel_outbox.last_error is text. Non-Error throwables (PostgREST
// {code,message,details,hint}) previously became "[object Object]". Keep only
// code and a bounded message; details/hint may echo row/payload data and are
// deliberately omitted.
function errorCode(value: unknown): string | null {
  const code = (value as { code?: unknown }).code
  return typeof code === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(code) ? code : null
}

export function describeOutboxError(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) {
    // SmtpDeliveryUncertainError carries its own sanitized, code-bearing message.
    if (error instanceof SmtpDeliveryUncertainError) return error.message
    const code = errorCode(error)
    return code && !error.message.startsWith(code) ? `${code}: ${error.message}` : error.message
  }
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    const code = errorCode(error)
    const text = typeof message === 'string' && message.trim() ? message.trim().slice(0, OUTBOX_ERROR_MESSAGE_MAX) : null
    if (code && text) return `${code}: ${text}`
    if (text) return text
    if (code) return code
  }
  return 'unknown_error'
}

function lockMatchesEnvironment(row: Record<string, unknown>, environment: string | null): boolean {
  const lockEnvironment = clean(row.environment)
  if (!lockEnvironment || !environment) return true
  return lockEnvironment === environment
}

function lockIsActive(row: Record<string, unknown>): boolean {
  const locked = row.locked === true
  const expiresAt = clean(row.expires_at)
  const expired = expiresAt ? Date.parse(expiresAt) <= Date.now() : false
  return locked && !expired
}

async function assertNoActiveSendLock(params: {
  companyId: string | null
  environment: string | null
  outboxItemId: string
}): Promise<string | null> {
  if (!params.companyId) return 'missing_company_scope_for_outbox_send'

  const { data, error } = await supabaseService
    .from('ediel_send_locks')
    .select('*')
    .eq('company_id', params.companyId)
    .limit(50)

  if (error) throw error

  const lockRows = Array.isArray(data) ? (data as unknown as Array<Record<string, unknown>>) : []
  const activeLock = lockRows.find((row) => lockIsActive(row) && lockMatchesEnvironment(row, params.environment))
  if (!activeLock) return null

  return clean(activeLock.locked_reason) ?? clean(activeLock.lock_key) ?? 'active_ediel_send_lock'
}

async function updateOutboxStatus(params: {
  outboxItemId: string
  sendAttemptId?: string | null
  workerId?: string | null
  requireActiveLease?: boolean
  payload: Database['public']['Tables']['ediel_outbox']['Update']
}): Promise<void> {
  let query = supabaseService
    .from('ediel_outbox')
    .update(params.payload)
    .eq('id', params.outboxItemId)

  if (params.requireActiveLease && params.workerId) {
    query = query.eq('status', 'sending').eq('locked_by', params.workerId)
  }
  if (params.sendAttemptId) query = query.eq('current_send_attempt_id', params.sendAttemptId)
  else if (params.workerId) query = query.eq('locked_by', params.workerId)
  else throw new Error('ediel_outbox_status_update_requires_claim_identity')

  const { data, error } = await query.select('id').maybeSingle()
  if (error) throw error
  if (!data) throw new Error('ediel_outbox_claim_lost_before_status_update')
}

export class EdielOutboxPreTransportProjectionError extends Error {
  constructor() { super('ediel_outbox_local_projection_held') }
}

export async function sendOutboxItem(params: {
  actorUserId: string
  outboxItemId: string
  smtpMimeMode?: string | null
  workerId?: string | null
  sendAttemptId?: string | null
  alreadyClaimed?: boolean
}): Promise<
  | { status: 'sent'; messageId: string | null; delivery: 'new_acceptance' | 'repaired_projection' }
  | { status: 'failed' | 'blocked' | 'delivery_uncertain'; messageId: string | null; error?: string | null; persistenceFailed?: boolean }
> {
  const workerId = clean(params.workerId) ?? `ediel-outbox-direct-${params.actorUserId}`
  let sendAttemptId = clean(params.sendAttemptId)
  let item: Record<string, unknown> | null = null

  if (params.alreadyClaimed) {
    const { data, error } = await supabaseService
      .from('ediel_outbox')
      .select('*')
      .eq('id', params.outboxItemId)
      .maybeSingle()
    if (error) throw error
    item = (data as Record<string, unknown> | null) ?? null
    if (!item) return { status: 'blocked', messageId: null, error: 'outbox_item_not_found' }
    const status = clean(item.status)
    const lockedBy = clean(item.locked_by)
    const lockedAt = Date.parse(clean(item.locked_at) ?? '')
    sendAttemptId = sendAttemptId ?? clean(item.current_send_attempt_id)
    if (status !== 'sending' || (lockedBy && lockedBy !== workerId)) {
      return { status: 'blocked', messageId: null, error: 'outbox_item_not_claimed_by_worker' }
    }
    // Internal lease bound matches claim_ediel_outbox_items' ten-minute
    // default. The SQL owner rechecks its own clock at prepare and entry.
    const observedAt = Date.now()
    if (!Number.isFinite(lockedAt) || lockedAt > observedAt || observedAt - lockedAt >= 10 * 60 * 1000) {
      return {status:'blocked',messageId:null,error:'ediel_outbox_worker_lease_expired'}
    }
  } else {
    const claimed = await claimEdielOutboxItem({
      outboxItemId: params.outboxItemId,
      workerId,
      actorUserId: params.actorUserId,
    })
    item = claimed as Record<string, unknown> | null
    sendAttemptId = clean(claimed?.current_send_attempt_id)
    if (!item) return { status: 'blocked', messageId: null, error: 'outbox_item_not_found_or_already_processing' }
  }

  const edielMessageId = clean(item.ediel_message_id)
  if (!edielMessageId) {
    await updateOutboxStatus({
      outboxItemId: params.outboxItemId,
      sendAttemptId,
      workerId,
      payload: {
        status: 'blocked',
        last_error: 'outbox_item_missing_message',
        locked_at: null,
        locked_by: null,
        updated_by: params.actorUserId,
        updated_at: new Date().toISOString(),
      },
    })
    return { status: 'blocked', messageId: null, error: 'outbox_item_missing_message' }
  }

  const companyId = clean(item.company_id)
  const environment = clean(item.environment)
  if (!companyId) {
    await updateOutboxStatus({
      outboxItemId: params.outboxItemId, sendAttemptId, workerId,
      payload: { status: 'blocked_tenant_state', blocked_reason: 'missing_company_scope', blocked_at: new Date().toISOString(), locked_at: null, locked_by: null, updated_at: new Date().toISOString() },
    })
    return { status: 'blocked', messageId: null, error: 'missing_company_scope' }
  }
  const operation = environment === 'production' ? 'ediel.production.send' : 'ediel.test.process'
  let missingCanonicalMessage = false
  let providerAccepted = false
  let providerMessageId: string | null = null

  try {
    const message = await getEdielMessageById(edielMessageId, { companyId })
    if (!message) {
      missingCanonicalMessage = true
      throw new Error('ediel_message_not_found')
    }
    if (message.company_id !== companyId || message.environment !== environment || !['test','production'].includes(String(environment))) {
      throw new Error('ediel_outbox_message_scope_mismatch')
    }
    const established = await readAcceptedEdielTransportProjection({ companyId, environment: message.environment,
      actorUserId: params.actorUserId, messageId: message.id })

    if (established) {
      providerAccepted = true
      providerMessageId = established.providerReceipt.messageId
      const repaired = await repairAcceptedEdielMessageProjection({ message, actorUserId: params.actorUserId, projection: established })
      const technicalSentAt = repaired.observedAt
      await projectSentEdielSourceState({
        message,
        sentAt: technicalSentAt,
        actorUserId: params.actorUserId,
      })
      await updateOutboxStatus({
        outboxItemId: params.outboxItemId,
        sendAttemptId,
        workerId,
        payload: {
          status: 'superseded',
          sent_at: technicalSentAt,
          last_error: 'Superseded: Ediel-meddelandet har redan tekniskt skickats.',
          locked_at: null,
          locked_by: null,
          updated_by: params.actorUserId,
          updated_at: new Date().toISOString(),
        },
      })
      return { status: 'sent', messageId: providerMessageId, delivery: 'repaired_projection' }
    }
    if (['provider_accepted','sent','delivered','acknowledged'].includes(String(message.status))) {
      await updateOutboxStatus({ outboxItemId: params.outboxItemId, sendAttemptId, workerId,
        payload: { status: 'blocked', last_error: 'ediel_historical_transport_receipt_unavailable', locked_at: null,
          locked_by: null, updated_by: params.actorUserId, updated_at: new Date().toISOString() } })
      return { status: 'blocked', messageId: null, error: 'ediel_historical_transport_receipt_unavailable' }
    }

    const tenantDecision = await getTenantOperationDecision(companyId, operation)
    if (!tenantDecision.allowed) {
      await updateOutboxStatus({ outboxItemId: params.outboxItemId, sendAttemptId, workerId,
        payload: { status: 'blocked_tenant_state', blocked_reason: tenantDecision.reason_code, blocked_at: new Date().toISOString(),
          company_status_snapshot: tenantDecision.company_status, operation_decision_snapshot: tenantDecision,
          locked_at: null, locked_by: null, updated_at: new Date().toISOString() } })
      return { status: 'blocked', messageId: null, error: tenantDecision.reason_code }
    }
    const sendLockReason = await assertNoActiveSendLock({ companyId, environment, outboxItemId: params.outboxItemId })
    if (sendLockReason) {
      await updateOutboxStatus({ outboxItemId: params.outboxItemId, sendAttemptId, workerId,
        payload: { status: 'blocked', last_error: sendLockReason, locked_at: null, locked_by: null,
          updated_by: params.actorUserId, updated_at: new Date().toISOString() } })
      return { status: 'blocked', messageId: null, error: sendLockReason }
    }

    const routeContract = await evaluateEdielRouteContract(message)
    const readinessBlocker = routeContract.blocker ?? await getEdielOutboundReadinessBlocker(message)
    if (readinessBlocker) {
      await updateOutboxStatus({
        outboxItemId: params.outboxItemId,
        sendAttemptId,
        workerId,
        payload: {
          status: 'blocked',
          last_error: readinessBlocker,
          locked_at: null,
          locked_by: null,
          updated_by: params.actorUserId,
          updated_at: new Date().toISOString(),
        },
      })
      return { status: 'blocked', messageId: null, error: readinessBlocker }
    }
    await updateOutboxStatus({
      outboxItemId: params.outboxItemId,
      sendAttemptId,
      workerId,
      payload: {
        route_contract_fingerprint: routeContract.fingerprint,
        route_contract_snapshot: {
          route_id: routeContract.routeId,
          receiver_ediel_id: routeContract.receiverEdielId,
          receiver_subaddress: routeContract.receiverSubaddress,
          receiver_email: routeContract.receiverEmail,
          receiver_certificate_id: routeContract.certificateId,
          receiver_certificate_fingerprint: routeContract.certificateFingerprint,
          checks: routeContract.checks,
          evaluated_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      },
    })

    const transportDecision = await getTenantOperationDecision(companyId, operation)
    if (!transportDecision.allowed) {
      await updateOutboxStatus({
        outboxItemId: params.outboxItemId,
        sendAttemptId,
        workerId,
        payload: {
          status: 'blocked_tenant_state',
          blocked_reason: transportDecision.reason_code,
          blocked_at: new Date().toISOString(),
          company_status_snapshot: transportDecision.company_status,
          operation_decision_snapshot: transportDecision,
          locked_at: null,
          locked_by: null,
          updated_at: new Date().toISOString(),
        },
      })
      return { status: 'blocked', messageId: null, error: transportDecision.reason_code }
    }

    if (!sendAttemptId) throw new Error('outbound_dispatch_worker_attempt_missing')
    const result = await sendEdielMessageViaSmtp(message, {
      actorUserId: params.actorUserId,
      smtpMimeMode: params.smtpMimeMode ?? null,
      dispatchOwner: { kind: 'worker', outboxId: params.outboxItemId, sendAttemptId, workerId },
    })
    providerAccepted = true
    providerMessageId = result.messageId ?? null

    const persistedMessage = await getEdielMessageById(edielMessageId, { companyId })
    if (!persistedMessage || !['provider_accepted', 'sent', 'delivered', 'acknowledged'].includes(String(persistedMessage.status))) {
      throw new Error('ediel_post_send_canonical_message_not_persisted')
    }
    const technicalSentAt = result.dispatchObservedAt
    if (!technicalSentAt || !Number.isFinite(Date.parse(technicalSentAt))
      || !persistedMessage.message_sent_at || Date.parse(persistedMessage.message_sent_at) !== Date.parse(technicalSentAt)) {
      throw new Error('ediel_post_send_frozen_observation_clock_required')
    }
    await projectSentEdielSourceState({
      message: persistedMessage,
      sentAt: technicalSentAt,
      actorUserId: params.actorUserId,
    })

    await updateOutboxStatus({
      outboxItemId: params.outboxItemId,
      sendAttemptId,
      workerId,
      payload: {
        status: 'sent',
        sent_at: technicalSentAt,
        receiver_ediel_id: persistedMessage.receiver_ediel_id ?? null,
        receiver_subaddress: persistedMessage.receiver_sub_address ?? null,
        last_error: null,
        locked_at: null,
        locked_by: null,
        updated_by: params.actorUserId,
        updated_at: new Date().toISOString(),
      },
    })
    return { status: 'sent', messageId: providerMessageId, delivery: result.delivery }
  } catch (error) {
    if (!providerAccepted && isEdielWorkerFenceLost(error)) {
      // The journal rejected this claimant before SMTP. Leave the newer queue state intact.
      return { status: 'blocked', messageId: null, error: EDIEL_WORKER_FENCE_LOST }
    }
    if (!providerAccepted && error instanceof LocalTestTransportWaitError) {
      return { status: 'blocked', messageId: null, error: error.code }
    }
    const errorMessage = describeOutboxError(error)

    const cancelled = isCancelledAperakTransport(error)
    const permanentRejection = error instanceof SmtpPermanentRejectionError
    if (!providerAccepted && sendAttemptId && environment && (cancelled || permanentRejection)) {
      const finalStatus = cancelled ? 'superseded' : 'failed'
      const lastError = cancelled ? CANCELLED_APERAK_TRANSPORT : errorMessage
      const updatedAt = new Date().toISOString()
      const { data: updated, error: updateError, status } = await supabaseService.from('ediel_outbox').update({
        status: finalStatus, last_error: lastError,
        locked_at: null, locked_by: null, updated_by: params.actorUserId, updated_at: updatedAt,
      }).eq('id', params.outboxItemId)
        .eq('company_id', companyId).eq('environment', environment).eq('ediel_message_id', edielMessageId)
        .eq('status', 'sending').eq('current_send_attempt_id', sendAttemptId).eq('locked_by', workerId)
        .is('sent_at', null).select('id').maybeSingle()
      const commitUncertain = status === 0 || (!updateError?.code && [502, 503, 504].includes(status))
      if (updateError && !commitUncertain) throw updateError

      if (updateError || !updated) {
        // A lost response can leave the exact disposition committed.
        // Match the old attempt and full outcome before acknowledging it.
        const { data: saved, error: readError } = await supabaseService
          .from('ediel_outbox').select('id')
          .eq('id', params.outboxItemId)
          .eq('company_id', companyId).eq('environment', environment).eq('ediel_message_id', edielMessageId)
          .eq('status', finalStatus).eq('current_send_attempt_id', sendAttemptId)
          .eq('last_error', lastError).is('sent_at', null)
          .is('locked_at', null).is('locked_by', null).maybeSingle()
        if (readError || !saved) throw updateError ?? readError ?? new Error('ediel_outbox_claim_lost_before_status_update')
      }
      return { status: cancelled ? 'blocked' : 'failed', messageId: null, error: lastError }
    }

    if (providerAccepted || isSmtpDeliveryUncertain(error)) {
      if (error instanceof SmtpDeliveryUncertainError) providerMessageId = error.smtpMessageId ?? providerMessageId
      try {
        await updateOutboxStatus({
          outboxItemId: params.outboxItemId,
          sendAttemptId,
          workerId,
          requireActiveLease: error instanceof LocalTestTransportWaitUnconfirmedError,
          payload: {
            status: 'delivery_uncertain',
            last_error: `delivery_uncertain_after_smtp_send: ${errorMessage}`,
            locked_at: null,
            locked_by: null,
            updated_by: params.actorUserId,
            updated_at: new Date().toISOString(),
          },
        })
      } catch (uncertainError) {
        // The native wait can commit while its response is lost. Recover its
        // exact settled row without writing over the released or newer lease.
        if (error instanceof LocalTestTransportWaitUnconfirmedError && sendAttemptId && environment === 'test') {
          const waitCode = 'ediel_local_test_retry_wait'
          try {
            const { data, error: readError } = await supabaseService.from('ediel_outbox').select('id')
              .eq('id', params.outboxItemId).eq('company_id', companyId).eq('environment', 'test')
              .eq('ediel_message_id', edielMessageId).eq('current_send_attempt_id', sendAttemptId)
              .eq('status', 'queued').eq('last_error', waitCode).is('sent_at', null)
              .is('locked_at', null).is('locked_by', null).maybeSingle()
            if (!readError && data) return { status: 'blocked', messageId: null, error: waitCode }
          } catch { /* Preserve uncertainty when the read also fails. */ }
        }
        const uncertainMessage = describeOutboxError(uncertainError)
        return {
          status: 'delivery_uncertain',
          messageId: providerMessageId,
          persistenceFailed: true,
          error: `${errorMessage}; delivery_uncertain_persistence_failed: ${uncertainMessage}`,
        }
      }
      return { status: 'delivery_uncertain', messageId: providerMessageId, error: errorMessage }
    }

    try {
      await updateOutboxStatus({
        outboxItemId: params.outboxItemId,
        sendAttemptId,
        workerId,
        payload: {
          status: 'failed',
          last_error: errorMessage,
          locked_at: null,
          locked_by: null,
          updated_by: params.actorUserId,
          updated_at: new Date().toISOString(),
        },
      })
    } catch (projectionError) {
      const rowConstraint = typeof projectionError === 'object' && projectionError !== null
        && 'code' in projectionError && projectionError.code === '23514'
      // Only a positive row-local defect before entry qualifies continuation.
      // The existing lease and any prior send evidence remain untouched.
      if (missingCanonicalMessage && rowConstraint) throw new EdielOutboxPreTransportProjectionError()
      throw projectionError
    }
    return { status: 'failed', messageId: null, error: errorMessage }
  }
}
