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

export async function logAdminActionAndUsage(input: AdminActionLogInput): Promise<void> {
  const metadata = {
    ...(input.metadata ?? {}),
    action_label: input.label ?? null,
    source: input.source ?? 'admin_ui',
    billable: input.billable === true,
  }

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

  try {
    const { error: usageError } = await supabaseService.from('platform_usage_events').insert({
      company_id: input.companyId ?? null,
      actor_user_id: input.actorUserId,
      customer_id: input.customerId ?? (input.entityType === 'customer' ? input.entityId : null),
      entity_type: input.entityType,
      entity_id: input.entityId,
      event_key: input.action,
      action_label: input.label ?? null,
      source: input.source ?? 'admin_ui',
      billable_quantity: input.billableQuantity ?? 1,
      billing_unit: input.billingUnit ?? (input.billable ? 'action' : 'audit_only'),
      is_billable: input.billable === true,
      metadata,
    })

    if (usageError && !isMissingRelationError(usageError)) throw usageError
  } catch (error) {
    if (!isMissingRelationError(error)) throw error
  }
}

export async function logUsageEvent(input: {
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
}): Promise<void> {
  try {
    const { error } = await supabaseService.from('platform_usage_events').insert({
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
      billing_unit: input.billingUnit ?? (input.billable ? 'api_request' : 'audit_only'),
      is_billable: input.billable === true,
      metadata: input.metadata ?? {},
    })
    if (error && !isMissingRelationError(error)) throw error
  } catch (error) {
    if (!isMissingRelationError(error)) throw error
  }
}
