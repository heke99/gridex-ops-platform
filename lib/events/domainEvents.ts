import { supabaseService } from '@/lib/supabase/service'

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
  return ['42P01', '42703', 'PGRST205'].includes(code) || /schema cache|does not exist/i.test(message)
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

  const { data, error } = await supabaseService
    .from('domain_events')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    if (input.idempotencyKey && error.code === '23505') {
      const { data: existing, error: existingError } = await supabaseService
        .from('domain_events')
        .select('*')
        .eq('idempotency_key', input.idempotencyKey)
        .maybeSingle()

      if (existingError) throw existingError
      return existing as DomainEventRow | null
    }

    if (isMissingReadinessSchema(error)) return null
    throw error
  }

  const event = data as DomainEventRow
  await supabaseService
    .from('event_outbox')
    .upsert({
      company_id: input.companyId,
      domain_event_id: event.id,
      destination_type: 'webhook',
      destination_key: 'all_active_webhooks',
      payload: { event_id: event.id, event_type: event.event_type },
    }, { onConflict: 'domain_event_id,destination_type,destination_key' })
    .then(({ error: outboxError }) => {
      if (outboxError && !isMissingReadinessSchema(outboxError)) throw outboxError
    })

  return event
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
