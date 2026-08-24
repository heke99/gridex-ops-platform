import { supabaseService } from '@/lib/supabase/service'
import { enqueueWebhookDeliveriesForEvent } from '@/lib/integrations/webhooks'

export type DomainEventPayload = Record<string, unknown>

export type DomainEventInput = {
  companyId: string
  eventType: string
  aggregateType: string
  aggregateId: string
  subjectCustomerId?: string | null
  actorUserId?: string | null
  source?: string
  payload?: DomainEventPayload
  idempotencyKey?: string | null
}

export type DomainEventRow = {
  id: string
  company_id: string | null
  event_type: string
  aggregate_type: string
  aggregate_id: string
  subject_customer_id: string | null
  actor_user_id: string | null
  source: string
  event_version: number
  idempotency_key: string | null
  payload: DomainEventPayload
  occurred_at: string
  created_at: string
}

function isMissingReadinessSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST205', '42P10'].includes(code) || /schema cache|does not exist|column .* does not exist|no unique or exclusion constraint/i.test(message)
}

async function attemptWebhookFanoutFastPath(eventId: string) {
  try {
    await processDomainEventWebhookFanout({ eventId, limit: 1 })
  } catch (error) {
    // The durable event_outbox row is already present and records the retry
    // state. A transient fan-out failure must not roll back or misclassify the
    // business operation that emitted the domain event.
    console.error('[domain-events] webhook fan-out deferred to cron', {
      eventId,
      error,
    })
  }
}

async function reuseExistingDomainEvent(idempotencyKey: string): Promise<DomainEventRow | null> {
  const { data, error } = await supabaseService
    .from('domain_events')
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  if (error) throw error
  const existingEvent = data as DomainEventRow | null
  if (existingEvent) {
    await ensureWebhookFanoutJob(existingEvent)
    await attemptWebhookFanoutFastPath(existingEvent.id)
  }
  return existingEvent
}

export async function emitDomainEvent(input: DomainEventInput): Promise<DomainEventRow | null> {
  const payload = {
    company_id: input.companyId,
    event_type: input.eventType,
    aggregate_type: input.aggregateType,
    aggregate_id: input.aggregateId,
    subject_customer_id: input.subjectCustomerId ?? null,
    actor_user_id: input.actorUserId ?? null,
    source: input.source ?? 'application',
    payload: input.payload ?? {},
    idempotency_key: input.idempotencyKey ?? null,
  }

  // Normal durable replays are expected to reuse the same event. Resolve the
  // existing row first so a healthy retry does not intentionally generate a
  // PostgreSQL 23505 error. The insert still handles 23505 below for the rare
  // concurrent race between this lookup and the write.
  if (input.idempotencyKey) {
    const existingEvent = await reuseExistingDomainEvent(input.idempotencyKey)
    if (existingEvent) return existingEvent
  }

  const { data, error } = await supabaseService
    .from('domain_events')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    if (input.idempotencyKey && error.code === '23505') {
      return reuseExistingDomainEvent(input.idempotencyKey)
    }

    if (isMissingReadinessSchema(error)) {
      throw new Error('domain_event_schema_not_ready')
    }
    throw error
  }

  const event = data as DomainEventRow
  await ensureWebhookFanoutJob(event)
  // Fast-path the fan-out for low latency. The durable event_outbox row remains
  // queued/failed until the cron confirms that webhook_deliveries were created.
  await attemptWebhookFanoutFastPath(event.id)
  return event
}

type FanoutJobRow = {
  id: string
  company_id: string | null
  domain_event_id: string
  status: string
  attempts: number
  max_attempts: number
  available_at: string
}

async function ensureWebhookFanoutJob(event: DomainEventRow) {
  const destinationKey = 'webhook_fanout_v1'
  // Replays should reuse the durable fan-out job instead of deliberately
  // colliding with event_outbox_unique_destination_idx. The insert below still
  // treats 23505 as a safe concurrent-race outcome.
  const existing = await supabaseService
    .from('event_outbox')
    .select('id')
    .eq('domain_event_id', event.id)
    .eq('destination_type', 'webhook')
    .eq('destination_key', destinationKey)
    .maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data?.id) return String(existing.data.id)

  const { data, error } = await supabaseService
    .from('event_outbox')
    .insert({
      company_id: event.company_id,
      domain_event_id: event.id,
      destination_type: 'webhook',
      destination_key: destinationKey,
      status: 'queued',
      attempts: 0,
      max_attempts: 12,
      available_at: new Date().toISOString(),
      payload: { event_type: event.event_type, aggregate_type: event.aggregate_type, aggregate_id: event.aggregate_id },
    })
    .select('id')
    .single()
  if (error?.code === '23505') return null
  if (error) throw error
  return String(data.id)
}

function fanoutRetryAt(attempts: number) {
  const seconds = Math.min(3600, Math.max(30, 30 * Math.max(1, attempts) ** 2))
  return new Date(Date.now() + seconds * 1000).toISOString()
}

async function recoverStaleWebhookFanoutJobs() {
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString()
  const now = new Date().toISOString()
  const { error } = await supabaseService
    .from('event_outbox')
    .update({
      status: 'failed',
      available_at: now,
      last_error: 'webhook_fanout_recovered_after_stale_processing_lock',
      locked_at: null,
      locked_by: null,
      updated_at: now,
    })
    .eq('destination_type', 'webhook')
    .eq('destination_key', 'webhook_fanout_v1')
    .eq('status', 'processing')
    .lt('locked_at', staleBefore)
  if (error) throw error
}

export async function processDomainEventWebhookFanout(input: {
  eventId?: string | null
  limit?: number
} = {}) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)
  await recoverStaleWebhookFanoutJobs()
  let query = supabaseService
    .from('event_outbox')
    .select('id,company_id,domain_event_id,status,attempts,max_attempts,available_at')
    .eq('destination_type', 'webhook')
    .eq('destination_key', 'webhook_fanout_v1')
    .in('status', ['queued', 'failed'])
    .lte('available_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(limit)
  if (input.eventId) query = query.eq('domain_event_id', input.eventId)
  const { data, error } = await query
  if (error) throw error

  let processed = 0
  let completed = 0
  let failed = 0
  for (const candidate of (data ?? []) as FanoutJobRow[]) {
    const { data: claimed, error: claimError } = await supabaseService
      .from('event_outbox')
      .update({
        status: 'processing',
        locked_at: new Date().toISOString(),
        locked_by: 'webhook_dispatch',
        updated_at: new Date().toISOString(),
      })
      .eq('id', candidate.id)
      .in('status', ['queued', 'failed'])
      .select('id')
      .maybeSingle()
    if (claimError) throw claimError
    if (!claimed?.id) continue
    processed += 1
    const attempts = Number(candidate.attempts ?? 0) + 1
    try {
      const eventResult = await supabaseService
        .from('domain_events')
        .select('*')
        .eq('id', candidate.domain_event_id)
        .single()
      if (eventResult.error) throw eventResult.error
      const deliveryCount = await enqueueWebhookDeliveriesForEvent(eventResult.data as DomainEventRow, { strict: true })
      const { error: completeError } = await supabaseService
        .from('event_outbox')
        .update({
          status: 'sent',
          attempts,
          sent_at: new Date().toISOString(),
          last_error: null,
          locked_at: null,
          locked_by: null,
          payload: { delivery_count: deliveryCount },
          updated_at: new Date().toISOString(),
        })
        .eq('id', candidate.id)
      if (completeError) throw completeError
      completed += 1
    } catch (fanoutError) {
      const terminal = attempts >= Number(candidate.max_attempts ?? 12)
      const message = fanoutError instanceof Error ? fanoutError.message : 'webhook_fanout_failed'
      const { error: failError } = await supabaseService
        .from('event_outbox')
        .update({
          status: terminal ? 'dead_letter' : 'failed',
          attempts,
          available_at: terminal ? new Date().toISOString() : fanoutRetryAt(attempts),
          failed_at: terminal ? new Date().toISOString() : null,
          last_error: message,
          locked_at: null,
          locked_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', candidate.id)
      if (failError) throw failError
      failed += 1
      if (input.eventId) throw fanoutError
    }
  }
  return { processed, completed, failed }
}

export async function listDomainEventsForCompany(input: {
  companyId: string
  eventType?: string | null
  customerId?: string | null
  limit?: number
  cursorOccurredBefore?: string | null
}): Promise<DomainEventRow[]> {
  let query = supabaseService
    .from('domain_events')
    .select('*')
    .eq('company_id', input.companyId)
    .order('occurred_at', { ascending: false })
    .limit(Math.min(Math.max(input.limit ?? 100, 1), 100))

  if (input.eventType) query = query.eq('event_type', input.eventType)
  if (input.customerId) query = query.eq('subject_customer_id', input.customerId)
  if (input.cursorOccurredBefore) query = query.lt('occurred_at', input.cursorOccurredBefore)

  const { data, error } = await query
  if (error) {
    if (isMissingReadinessSchema(error)) return []
    throw error
  }

  return (data ?? []) as DomainEventRow[]
}
