import { getEdielMessageById } from '@/lib/ediel/db'
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport'
import { supabaseService } from '@/lib/supabase/service'

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
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
