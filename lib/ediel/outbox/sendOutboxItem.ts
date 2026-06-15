import { randomUUID } from 'crypto'
import { getEdielMessageById } from '@/lib/ediel/db'
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport'
import { supabaseService } from '@/lib/supabase/service'
import { getEdielOutboundReadinessBlocker } from '@/lib/ediel/outbox/readinessGuard'

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

  if (error) {
    const code = String((error as { code?: unknown }).code ?? '')
    const message = String(error.message ?? '')
    if (code === '42P01' || /does not exist/i.test(message) || /Could not find/i.test(message)) return null
    throw error
  }

  const lockRows = Array.isArray(data) ? (data as unknown as Array<Record<string, unknown>>) : []
  const activeLock = lockRows.find((row) => lockIsActive(row) && lockMatchesEnvironment(row, params.environment))
  if (!activeLock) return null

  return clean(activeLock.locked_reason) ?? clean(activeLock.lock_key) ?? 'active_ediel_send_lock'
}

function schemaCompatibilityError(error: unknown): boolean {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const code = String(record.code ?? '')
  const message = String(record.message ?? record.details ?? '')
  return code === 'PGRST204' || code === '42703' || /column .* does not exist|schema cache|Could not find/i.test(message)
}

async function claimForDirectSend(params: {
  outboxItemId: string
  workerId: string
  actorUserId: string
}): Promise<{ item: Record<string, unknown> | null; sendAttemptId: string | null; error?: string | null }> {
  const sendAttemptId = randomUUID()
  const now = new Date().toISOString()
  const { data, error } = await supabaseService
    .from('ediel_outbox')
    .update({
      status: 'sending',
      locked_at: now,
      locked_by: params.workerId,
      current_send_attempt_id: sendAttemptId,
      attempts: 1,
      updated_by: params.actorUserId,
      updated_at: now,
    })
    .eq('id', params.outboxItemId)
    .in('status', ['prepared', 'queued'])
    .select('*')
    .maybeSingle()

  if (error) {
    if (!schemaCompatibilityError(error)) throw error
    const { data: fallbackItem, error: fallbackError } = await supabaseService
      .from('ediel_outbox')
      .select('*')
      .eq('id', params.outboxItemId)
      .maybeSingle()
    if (fallbackError) throw fallbackError
    return { item: (fallbackItem as Record<string, unknown> | null) ?? null, sendAttemptId: null }
  }

  if (!data) return { item: null, sendAttemptId, error: 'outbox_item_not_claimed' }
  return { item: data as Record<string, unknown>, sendAttemptId }
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

  const { error } = await query
  if (error) {
    if (!schemaCompatibilityError(error)) throw error
    const compatibilityPayload = { ...params.payload }
    delete compatibilityPayload.locked_at
    delete compatibilityPayload.locked_by
    delete compatibilityPayload.current_send_attempt_id
    delete compatibilityPayload.smtp_message_id
    delete compatibilityPayload.transport_channel
    delete compatibilityPayload.receiver_ediel_id
    delete compatibilityPayload.receiver_subaddress
    delete compatibilityPayload.certificate_fingerprint
    const { error: fallbackError } = await supabaseService
      .from('ediel_outbox')
      .update(compatibilityPayload)
      .eq('id', params.outboxItemId)
    if (fallbackError) throw fallbackError
  }
}

export async function sendOutboxItem(params: {
  actorUserId: string
  outboxItemId: string
  smtpMimeMode?: string | null
  workerId?: string | null
  sendAttemptId?: string | null
  alreadyClaimed?: boolean
}): Promise<{ status: 'sent' | 'failed' | 'blocked'; messageId: string | null; error?: string | null }> {
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
    const claimed = await claimForDirectSend({ outboxItemId: params.outboxItemId, workerId, actorUserId: params.actorUserId })
    if (claimed.error) return { status: 'blocked', messageId: null, error: claimed.error }
    item = claimed.item
    sendAttemptId = claimed.sendAttemptId
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
    const readinessBlocker = await getEdielOutboundReadinessBlocker(message)
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
    const result = await sendEdielMessageViaSmtp(message, { actorUserId: params.actorUserId, smtpMimeMode: params.smtpMimeMode ?? null })
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
