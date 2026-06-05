import { getEdielMessageById } from '@/lib/ediel/db'
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport'
import { supabaseService } from '@/lib/supabase/service'

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

export async function sendOutboxItem(params: {
  actorUserId: string
  outboxItemId: string
  smtpMimeMode?: string | null
}): Promise<{ status: 'sent' | 'failed' | 'blocked'; messageId: string | null; error?: string | null }> {
  const { data: item, error: itemError } = await supabaseService
    .from('ediel_outbox')
    .select('*')
    .eq('id', params.outboxItemId)
    .maybeSingle()

  if (itemError) throw itemError
  if (!item) return { status: 'blocked', messageId: null, error: 'outbox_item_not_found' }

  const edielMessageId = clean((item as Record<string, unknown>).ediel_message_id)
  if (!edielMessageId) return { status: 'blocked', messageId: null, error: 'outbox_item_missing_message' }

  const companyId = clean((item as Record<string, unknown>).company_id)
  const environment = clean((item as Record<string, unknown>).environment)
  const sendLockReason = await assertNoActiveSendLock({ companyId, environment, outboxItemId: params.outboxItemId })
  if (sendLockReason) {
    await supabaseService
      .from('ediel_outbox')
      .update({ status: 'blocked', last_error: sendLockReason, updated_by: params.actorUserId, updated_at: new Date().toISOString() })
      .eq('id', params.outboxItemId)
    return { status: 'blocked', messageId: null, error: sendLockReason }
  }

  await supabaseService
    .from('ediel_outbox')
    .update({ status: 'sending', attempts: ((item as { attempts?: number }).attempts ?? 0) + 1, updated_by: params.actorUserId, updated_at: new Date().toISOString() })
    .eq('id', params.outboxItemId)

  try {
    const message = await getEdielMessageById(edielMessageId)
    if (!message) throw new Error('ediel_message_not_found')
    const result = await sendEdielMessageViaSmtp(message, { actorUserId: params.actorUserId, smtpMimeMode: params.smtpMimeMode ?? null })
    await supabaseService
      .from('ediel_outbox')
      .update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null, updated_by: params.actorUserId, updated_at: new Date().toISOString() })
      .eq('id', params.outboxItemId)
    return { status: 'sent', messageId: result.messageId ?? null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await supabaseService
      .from('ediel_outbox')
      .update({ status: 'failed', last_error: message, updated_by: params.actorUserId, updated_at: new Date().toISOString() })
      .eq('id', params.outboxItemId)
    return { status: 'failed', messageId: null, error: message }
  }
}
