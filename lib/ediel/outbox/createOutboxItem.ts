import type { EdielMessageRow } from '@/lib/ediel/types'
import { createEdielMessageEvent } from '@/lib/ediel/db'
import { supabaseService } from '@/lib/supabase/service'

export type EdielOutboxStatus = 'draft' | 'prepared' | 'queued' | 'sending' | 'sent' | 'failed' | 'superseded' | 'blocked'

export type CreateEdielOutboxItemInput = {
  actorUserId: string
  message: EdielMessageRow
  sourceMessageId?: string | null
  status?: EdielOutboxStatus
  priority?: number
  lockKey?: string | null
  payload?: Record<string, unknown> | null
}

function outboxLockKey(message: EdielMessageRow, sourceMessageId?: string | null): string {
  return [
    message.company_id ?? 'platform',
    message.environment,
    sourceMessageId ?? message.related_message_id ?? message.id,
    message.message_family,
    message.ack_outcome ?? message.message_code,
  ].join(':')
}

export async function createOutboxItem(input: CreateEdielOutboxItemInput): Promise<Record<string, unknown> | null> {
  const lockKey = input.lockKey ?? outboxLockKey(input.message, input.sourceMessageId)
  const row = {
    company_id: input.message.company_id ?? null,
    ediel_message_id: input.message.id,
    source_message_id: input.sourceMessageId ?? input.message.related_message_id ?? null,
    status: input.status ?? 'prepared',
    queued_at: (input.status ?? 'prepared') === 'queued' ? new Date().toISOString() : null,
    priority: input.priority ?? 100,
    lock_key: lockKey,
    message_family: input.message.message_family,
    message_code: String(input.message.message_code ?? ''),
    ack_outcome: input.message.ack_outcome ?? null,
    environment: input.message.environment,
    route_profile_id: input.message.communication_route_id ?? null,
    payload: input.payload ?? {},
    created_by: input.actorUserId,
    updated_by: input.actorUserId,
  }

  const { data, error } = await supabaseService
    .from('ediel_outbox')
    .upsert(row, { onConflict: 'lock_key' })
    .select('*')
    .single()

  if (error) throw error

  await createEdielMessageEvent({
    actorUserId: input.actorUserId,
    edielMessageId: input.message.id,
    eventType: 'queued',
    eventStatus: 'info',
    message: 'Ediel outbox item prepared by backend automation.',
    payload: {
      outboxItemId: (data as { id?: unknown } | null)?.id ?? null,
      outboxStatus: row.status,
      lockKey,
      sourceMessageId: row.source_message_id,
    },
  })

  return (data ?? null) as Record<string, unknown> | null
}
