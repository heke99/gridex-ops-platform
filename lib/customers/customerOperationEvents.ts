import { emitDomainEvent } from '@/lib/events/domainEvents'
import { supabaseService } from '@/lib/supabase/service'

type OperationEventInput = {
  companyId: string
  customerId: string
  eventType: string
  title: string
  message: string
  actorUserId?: string | null
  aggregateType?: string
  aggregateId?: string | null
  source?: string
  payload?: Record<string, unknown>
  idempotencyKey?: string | null
}

function isMissingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST205', 'PGRST204'].includes(code) || /does not exist|schema cache|column .* does not exist/i.test(message)
}

export async function emitCustomerOperationEvent(input: OperationEventInput) {
  const payload = { title: input.title, message: input.message, ...(input.payload ?? {}) }

  await emitDomainEvent({
    companyId: input.companyId,
    eventType: input.eventType,
    aggregateType: input.aggregateType ?? 'customer',
    aggregateId: input.aggregateId ?? input.customerId,
    subjectCustomerId: input.customerId,
    actorUserId: input.actorUserId ?? null,
    source: input.source ?? 'customer_operations',
    payload,
    idempotencyKey: input.idempotencyKey ?? null,
  }).catch((error) => {
    if (!isMissingSchema(error)) console.warn('[customer-operation-events] domain event skipped', error)
  })

  const row = {
    company_id: input.companyId,
    customer_id: input.customerId,
    event_type: input.eventType,
    source: input.source ?? 'customer_operations',
    payload,
    metadata: { title: input.title, message: input.message, ...(input.payload ?? {}) },
  }

  const { error } = await supabaseService.from('customer_events').insert(row)
  if (error && !isMissingSchema(error)) throw error

  await supabaseService.from('customer_notifications').insert({
    company_id: input.companyId,
    customer_id: input.customerId,
    type: input.eventType,
    title: input.title,
    message: input.message,
    status: 'unread',
    metadata: input.payload ?? {},
  }).then(({ error }) => {
    if (error && !isMissingSchema(error)) console.warn('[customer-operation-events] notification skipped', error)
  })
}

export function blockerText(issues: string[]): string {
  if (issues.length === 0) return 'Inga blockerare hittades.'
  return issues.join(', ')
}
