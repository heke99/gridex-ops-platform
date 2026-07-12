import { getEdielMessageById } from '@/lib/ediel/db'
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport'
import { supabaseService } from '@/lib/supabase/service'
import { getEdielOutboundReadinessBlocker } from '@/lib/ediel/outbox/readinessGuard'
import { evaluateEdielRouteContract } from '@/lib/ediel/outbox/routeContract'
import { claimEdielOutboxItem } from '@/lib/ediel/outbox/claimOutboxItems'

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function lockMatchesEnvironment(row: Record<string, unknown>, environment: string | null): boolean {
  const lockEnvironment = clean(row.environment)
  if (!lockEnvironment || !environment) return true
  return lockEnvironment === environment
}

function lockIsActive(row: Record<string, unknown>): boolean {
  const status = clean(row.status)
  const locked = row.locked === true
  const expiresAt = clean(row.expires_at)
  const expired = expiresAt ? Date.parse(expiresAt) <= Date.now() : false
  return !expired && (locked || status === 'active')
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
  payload: Record<string, unknown>
}): Promise<void> {
  let query = supabaseService
    .from('ediel_outbox')
    .update(params.payload)
    .eq('id', params.outboxItemId)

  if (params.sendAttemptId) query = query.eq('current_send_attempt_id', params.sendAttemptId)
  else if (params.workerId) query = query.eq('locked_by', params.workerId)
  else throw new Error('ediel_outbox_status_update_requires_claim_identity')

  const { data, error } = await query.select('id').maybeSingle()
  if (error) throw error
  if (!data) throw new Error('ediel_outbox_claim_lost_before_status_update')
}


export async function sendOutboxItem(params: {
  actorUserId: string
  outboxItemId: string
  smtpMimeMode?: string | null
  workerId?: string | null
  sendAttemptId?: string | null
  alreadyClaimed?: boolean
}): Promise<{ status: 'sent' | 'failed' | 'blocked' | 'delivery_uncertain'; messageId: string | null; error?: string | null }> {
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
    sendAttemptId = sendAttemptId ?? clean(item.current_send_attempt_id)
    if (status !== 'sending' || (lockedBy && lockedBy !== workerId)) {
      return { status: 'blocked', messageId: null, error: 'outbox_item_not_claimed_by_worker' }
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
  if (!edielMessageId) return { status: 'blocked', messageId: null, error: 'outbox_item_missing_message' }

  const companyId = clean(item.company_id)
  const environment = clean(item.environment)
  const sendLockReason = await assertNoActiveSendLock({ companyId, environment, outboxItemId: params.outboxItemId })
  if (sendLockReason) {
    await updateOutboxStatus({
      outboxItemId: params.outboxItemId,
      sendAttemptId,
      workerId,
      payload: {
        status: 'blocked',
        last_error: sendLockReason,
        locked_at: null,
        locked_by: null,
        updated_by: params.actorUserId,
        updated_at: new Date().toISOString(),
      },
    })
    return { status: 'blocked', messageId: null, error: sendLockReason }
  }

  try {
    const message = await getEdielMessageById(edielMessageId, { companyId })
    if (!message) throw new Error('ediel_message_not_found')
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
          receiver_certificate_id: routeContract.certificateId,
          receiver_certificate_fingerprint: routeContract.certificateFingerprint,
          checks: routeContract.checks,
          evaluated_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      },
    })
    const result = await sendEdielMessageViaSmtp(message, { actorUserId: params.actorUserId, smtpMimeMode: params.smtpMimeMode ?? null })
    try {
      await updateOutboxStatus({
        outboxItemId: params.outboxItemId,
        sendAttemptId,
        workerId,
        payload: {
          status: 'sent',
          sent_at: new Date().toISOString(),
          smtp_message_id: result.messageId ?? null,
          transport_channel: 'smtp',
          receiver_ediel_id: message.receiver_ediel_id ?? null,
          receiver_subaddress: message.receiver_sub_address ?? null,
          last_error: null,
          locked_at: null,
          locked_by: null,
          updated_by: params.actorUserId,
          updated_at: new Date().toISOString(),
        },
      })
    } catch (statusError) {
      const statusMessage = statusError instanceof Error ? statusError.message : String(statusError)
      await updateOutboxStatus({
        outboxItemId: params.outboxItemId,
        workerId,
        payload: {
          status: 'delivery_uncertain',
          smtp_message_id: result.messageId ?? null,
          last_error: `delivery_uncertain_after_smtp_send: ${statusMessage}`,
          locked_at: null,
          locked_by: null,
          updated_by: params.actorUserId,
          updated_at: new Date().toISOString(),
        },
      }).catch(() => undefined)
      return { status: 'delivery_uncertain', messageId: result.messageId ?? null, error: statusMessage }
    }
    return { status: 'sent', messageId: result.messageId ?? null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await updateOutboxStatus({
      outboxItemId: params.outboxItemId,
      sendAttemptId,
      workerId,
      payload: {
        status: 'failed',
        last_error: message,
        locked_at: null,
        locked_by: null,
        updated_by: params.actorUserId,
        updated_at: new Date().toISOString(),
      },
    })
    return { status: 'failed', messageId: null, error: message }
  }
}
