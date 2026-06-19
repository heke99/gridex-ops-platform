import { emitDomainEvent } from '@/lib/events/domainEvents'
import { supabaseService } from '@/lib/supabase/service'
import { normalizeUuidOrNull } from '@/lib/validation/uuid'

type JsonRecord = Record<string, unknown>

export type CustomerOperationEventStatus =
  | 'queued'
  | 'in_progress'
  | 'waiting_response'
  | 'response_received'
  | 'completed'
  | 'needs_review'
  | 'failed'
  | 'blocked'
  | 'skipped'
  | 'cancelled'

export type CustomerOperationEventSeverity = 'info' | 'warning' | 'error' | 'critical'

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
  payload?: JsonRecord
  idempotencyKey?: string | null
  customerSiteId?: string | null
  meteringPointId?: string | null
  customerOperationJobId?: string | null
  operationId?: string | null
  status?: CustomerOperationEventStatus
  severity?: CustomerOperationEventSeverity
  actionRequired?: boolean
  actionUrl?: string | null
  visibility?: 'tenant' | 'platform'
}

function isMissingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST205', 'PGRST204'].includes(code) || /does not exist|schema cache|column .* does not exist/i.test(message)
}

function uuidOrNull(value: unknown): string | null {
  try {
    return normalizeUuidOrNull(value)
  } catch {
    return null
  }
}

function deriveStatus(eventCode: string): CustomerOperationEventStatus {
  if (/\.(cancelled|canceled)$/.test(eventCode)) return 'cancelled'
  if (/\.(failed|error)$/.test(eventCode)) return 'failed'
  if (/\.(blocked)$/.test(eventCode)) return 'blocked'
  if (/(needs_review|incomplete|missing|suggested)/.test(eventCode)) return 'needs_review'
  if (/(waiting|requested|prepared)/.test(eventCode)) return 'waiting_response'
  if (/(received|response)/.test(eventCode)) return 'response_received'
  if (/(completed|verified|applied)/.test(eventCode)) return 'completed'
  if (/(started|queued)/.test(eventCode)) return 'queued'
  return 'in_progress'
}

function deriveSeverity(status: CustomerOperationEventStatus): CustomerOperationEventSeverity {
  if (status === 'failed') return 'error'
  if (status === 'blocked') return 'error'
  if (status === 'needs_review') return 'warning'
  return 'info'
}

/**
 * Writes the tenant operational timeline. This is deliberately separate from
 * customer_events, which is reserved for customer portal / website events.
 * Timeline writes are best-effort so telemetry can never fail an automation job.
 */
export async function emitCustomerOperationEvent(input: OperationEventInput): Promise<void> {
  const payload = input.payload ?? {}
  const customerSiteId = input.customerSiteId ?? uuidOrNull(payload.site_id) ?? uuidOrNull(payload.customer_site_id)
  const meteringPointId = input.meteringPointId ?? uuidOrNull(payload.metering_point_id)
  const customerOperationJobId = input.customerOperationJobId ?? uuidOrNull(payload.customer_operation_job_id)
  const operationId = input.operationId ?? uuidOrNull(payload.operation_id)
  const status = input.status ?? deriveStatus(input.eventType)
  const actionRequired = input.actionRequired ?? ['needs_review', 'failed', 'blocked'].includes(status)

  await emitDomainEvent({
    companyId: input.companyId,
    eventType: input.eventType,
    aggregateType: input.aggregateType ?? (customerSiteId ? 'customer_site' : 'customer'),
    aggregateId: input.aggregateId ?? customerSiteId ?? input.customerId,
    subjectCustomerId: input.customerId,
    actorUserId: input.actorUserId ?? null,
    source: input.source ?? 'customer_operations',
    payload: { title: input.title, message: input.message, operation_id: operationId, ...payload },
    idempotencyKey: input.idempotencyKey ?? null,
  }).catch((error) => {
    console.warn('[customer-operation-events] domain event skipped', error)
  })

  const { error } = await supabaseService
    .from('customer_operation_events')
    .insert({
      company_id: input.companyId,
      customer_id: input.customerId,
      customer_site_id: customerSiteId,
      metering_point_id: meteringPointId,
      customer_operation_job_id: customerOperationJobId,
      operation_id: operationId,
      event_code: input.eventType,
      title: input.title,
      message: input.message,
      status,
      severity: input.severity ?? deriveSeverity(status),
      action_required: actionRequired,
      action_url: input.actionUrl ?? null,
      source: input.source ?? 'customer_operations',
      visibility: input.visibility ?? 'tenant',
      payload: { ...payload, operation_id: operationId },
      idempotency_key: input.idempotencyKey ?? null,
    })

  if (!error || (error as { code?: string }).code === '23505') return
  if (isMissingSchema(error)) {
    console.warn('[customer-operation-events] timeline schema is not applied yet')
    return
  }

  // The operational path must remain available even if a non-critical event write fails.
  console.warn('[customer-operation-events] timeline write skipped', error)
}

export function blockerText(issues: string[]): string {
  if (issues.length === 0) return 'Inga blockerare hittades.'
  return issues.join(', ')
}
