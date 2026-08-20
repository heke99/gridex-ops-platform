import { after } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'

export type AdminActionLogInput = {
  companyId?: string | null
  actorUserId: string
  customerId?: string | null
  entityType: string
  entityId: string
  action: string
  label?: string | null
  oldValues?: unknown
  newValues?: unknown
  metadata?: Record<string, unknown> | null
  billable?: boolean
  billingUnit?: string | null
  billableQuantity?: number | null
  source?: string | null
}

export type UsageEventInput = {
  companyId?: string | null
  actorUserId?: string | null
  apiClientId?: string | null
  customerId?: string | null
  entityType: string
  entityId?: string | null
  eventKey: string
  actionLabel?: string | null
  source?: string | null
  billable?: boolean
  billableQuantity?: number | null
  billingUnit?: string | null
  metadata?: Record<string, unknown> | null
}

export type UsageEventResult =
  | { ok: true }
  | { ok: false; errorCode: string | null; errorMessage: string }

function isMissingRelationError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return Boolean(
    maybe &&
      (maybe.code === '42P01' ||
        maybe.code === '42703' ||
        maybe.code === 'PGRST205' ||
        /does not exist|schema cache|relation .* does not exist/i.test(maybe.message ?? ''))
  )
}

function databaseError(error: unknown): {
  code: string | null
  message: string
} {
  if (error && typeof error === 'object') {
    const value = error as { code?: unknown; message?: unknown }
    return {
      code: typeof value.code === 'string' ? value.code : null,
      message:
        typeof value.message === 'string' && value.message.trim()
          ? value.message
          : 'unknown_usage_event_error',
    }
  }
  return {
    code: null,
    message:
      error instanceof Error && error.message
        ? error.message
        : String(error ?? 'unknown_usage_event_error'),
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function safeUuid(value: string | null | undefined): string | null {
  const candidate = value?.trim() ?? ''
  return UUID_PATTERN.test(candidate) ? candidate : null
}

function usageRow(input: UsageEventInput) {
  return {
    company_id: input.companyId ?? null,
    actor_user_id: input.actorUserId ?? null,
    api_client_id: input.apiClientId ?? null,
    customer_id: input.customerId ?? null,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    event_key: input.eventKey,
    action_label: input.actionLabel ?? null,
    source: input.source ?? 'system',
    billable_quantity: input.billableQuantity ?? 1,
    billing_unit:
      input.billingUnit ?? (input.billable ? 'api_request' : 'audit_only'),
    is_billable: input.billable === true,
    metadata: input.metadata ?? {},
  }
}

async function persistUsageEventFailure(input: {
  usage: UsageEventInput
  row: ReturnType<typeof usageRow>
  errorCode: string | null
  errorMessage: string
}): Promise<void> {
  try {
    await supabaseService.from('platform_usage_event_failures').insert({
      company_id: safeUuid(input.usage.companyId),
      api_client_id: safeUuid(input.usage.apiClientId),
      actor_user_id: safeUuid(input.usage.actorUserId),
      customer_id: safeUuid(input.usage.customerId),
      event_key: input.usage.eventKey,
      entity_type: input.usage.entityType,
      entity_id: input.usage.entityId ?? null,
      source: input.usage.source ?? 'system',
      event_payload: input.row,
      database_code: input.errorCode,
      database_message: input.errorMessage,
    })
  } catch {
    // Usage telemetry is secondary observability. A failure queue outage must
    // never turn a completed customer, quote or contract operation into a 500.
  }
}

export async function logAdminActionAndUsage(
  input: AdminActionLogInput,
): Promise<void> {
  const metadata = {
    ...(input.metadata ?? {}),
    action_label: input.label ?? null,
    source: input.source ?? 'admin_ui',
    billable: input.billable === true,
  }

  // audit_logs is the legal/revision trace and remains fail-closed.
  const { error: auditError } = await supabaseService.from('audit_logs').insert({
    actor_user_id: input.actorUserId,
    company_id: input.companyId ?? null,
    entity_type: input.entityType,
    entity_id: input.entityId,
    action: input.action,
    old_values: input.oldValues ?? null,
    new_values: input.newValues ?? null,
    metadata,
  })

  if (auditError) throw auditError

  await logUsageEvent({
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    customerId:
      input.customerId ??
      (input.entityType === 'customer' ? input.entityId : null),
    entityType: input.entityType,
    entityId: input.entityId,
    eventKey: input.action,
    actionLabel: input.label,
    source: input.source ?? 'admin_ui',
    billable: input.billable,
    billableQuantity: input.billableQuantity,
    billingUnit:
      input.billingUnit ?? (input.billable ? 'action' : 'audit_only'),
    metadata,
  })
}

/**
 * Records SaaS usage/statistics without owning the success of the business
 * operation that produced the event. The caller may inspect the result for
 * diagnostics, but this function intentionally never throws.
 */
export async function logUsageEvent(
  input: UsageEventInput,
): Promise<UsageEventResult> {
  const row = usageRow(input)

  try {
    const { error } = await supabaseService
      .from('platform_usage_events')
      .insert(row)

    if (!error) return { ok: true }

    const normalized = databaseError(error)
    if (!isMissingRelationError(error)) {
      console.error('[platform-usage-event] insert_failed', {
        companyId: input.companyId ?? null,
        apiClientId: input.apiClientId ?? null,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        eventKey: input.eventKey,
        errorCode: normalized.code,
        error: normalized.message,
      })
      await persistUsageEventFailure({
        usage: input,
        row,
        errorCode: normalized.code,
        errorMessage: normalized.message,
      })
    }
    return {
      ok: false,
      errorCode: normalized.code,
      errorMessage: normalized.message,
    }
  } catch (error) {
    const normalized = databaseError(error)
    console.error('[platform-usage-event] unavailable', {
      companyId: input.companyId ?? null,
      apiClientId: input.apiClientId ?? null,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      eventKey: input.eventKey,
      errorCode: normalized.code,
      error: normalized.message,
    })
    await persistUsageEventFailure({
      usage: input,
      row,
      errorCode: normalized.code,
      errorMessage: normalized.message,
    })
    return {
      ok: false,
      errorCode: normalized.code,
      errorMessage: normalized.message,
    }
  }
}

/**
 * Defers secondary API telemetry until after the response has been produced.
 * The fallback keeps scripts and tests outside a Next.js request context
 * deterministic without changing the fail-open telemetry contract.
 */
export async function scheduleUsageEvent(
  input: UsageEventInput,
): Promise<void> {
  const persist = async () => {
    await logUsageEvent(input)
  }

  try {
    after(persist)
  } catch {
    await persist()
  }
}
