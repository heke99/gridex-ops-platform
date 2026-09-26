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
  intentId?: string | null
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

function cleanText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function routeProfileIdForOutbox(input: CreateEdielOutboxItemInput): string | null {
  const messageRouteProfileId = cleanText(
    (input.message as EdielMessageRow & { route_profile_id?: string | null }).route_profile_id
  )
  if (messageRouteProfileId) return messageRouteProfileId

  return cleanText(input.payload?.route_profile_id) ?? cleanText(input.payload?.routeProfileId)
}

export async function createOutboxItem(input: CreateEdielOutboxItemInput): Promise<Record<string, unknown> | null> {
  const lockKey = input.lockKey ?? outboxLockKey(input.message, input.sourceMessageId)
  const row = {
    company_id: input.message.company_id ?? null,
    ediel_message_id: input.message.id,
    intent_id: input.intentId ?? input.message.intent_id ?? null,
    source_message_id: input.sourceMessageId ?? input.message.related_message_id ?? null,
    status: input.status ?? 'prepared',
    queued_at: (input.status ?? 'prepared') === 'queued' ? new Date().toISOString() : null,
    priority: input.priority ?? 100,
    lock_key: lockKey,
    message_family: input.message.message_family,
    message_code: String(input.message.message_code ?? ''),
    ack_outcome: input.message.ack_outcome ?? null,
    environment: input.message.environment,
    route_profile_id: routeProfileIdForOutbox(input),
    payload: input.payload ?? {},
    created_by: input.actorUserId,
    updated_by: input.actorUserId,
  }

  // The unique lock is the concurrency arbiter. A retry must never overwrite
  // sending/sent/uncertain state with queued via ON CONFLICT DO UPDATE.
  const { data, error } = await supabaseService
    .from('ediel_outbox')
    .upsert(row, { onConflict: 'lock_key', ignoreDuplicates: true })
    .select('*')
    .maybeSingle()

  if (error) throw error

  let saved = data as Record<string, unknown> | null
  let newlyQueued = Boolean(saved)
  if (!saved) {
    const { data: existing, error: lookupError } = await supabaseService
      .from('ediel_outbox').select('*').eq('lock_key', lockKey).maybeSingle()
    if (lookupError) throw lookupError
    if (!existing) throw new Error('ediel_outbox_lock_conflict_without_row')
    const prior = existing as Record<string, unknown>
    if (prior.company_id !== row.company_id || prior.environment !== row.environment ||
        prior.ediel_message_id !== row.ediel_message_id || prior.source_message_id !== row.source_message_id ||
        prior.route_profile_id !== row.route_profile_id) {
      throw new Error('ediel_outbox_lock_identity_conflict')
    }
    saved = prior
    if (row.status === 'queued' && ['draft', 'prepared', 'failed'].includes(String(prior.status))) {
      const { data: updated, error: updateError } = await supabaseService
        .from('ediel_outbox')
        .update({ status: 'queued', queued_at: row.queued_at, last_error: null, updated_by: input.actorUserId })
        .eq('id', prior.id as string)
        .in('status', ['draft', 'prepared', 'failed'])
        .select('*').maybeSingle()
      if (updateError) throw updateError
      if (updated) { saved = updated as Record<string, unknown>; newlyQueued = true }
      else {
        const { data: current, error: currentError } = await supabaseService
          .from('ediel_outbox').select('*').eq('lock_key', lockKey).maybeSingle()
        if (currentError) throw currentError
        if (!current) throw new Error('ediel_outbox_lock_lost_during_retry')
        saved = current as Record<string, unknown>
      }
    }
  }

  if (newlyQueued) await createEdielMessageEvent({
    actorUserId: input.actorUserId,
    edielMessageId: input.message.id,
    eventType: 'queued',
    eventStatus: 'info',
    message: 'Ediel outbox item prepared by backend automation.',
    payload: {
      outboxItemId: saved?.id ?? null,
      outboxStatus: row.status,
      lockKey,
      sourceMessageId: row.source_message_id,
    },
  })

  return saved
}
