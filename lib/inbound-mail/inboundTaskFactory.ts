import { supabaseService } from '@/lib/supabase/service'

function cleanId(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function createInboundMailTask(input: {
  companyId?: string | null
  customerId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  title: string
  description?: string | null
  priority?: 'normal' | 'high' | 'urgent'
  taskType?: string | null
  metadata?: Record<string, unknown>
  actorUserId?: string | null
}): Promise<void> {
  const companyId = cleanId(input.companyId)
  if (!companyId) return

  // customer_operation_tasks is intentionally customer-scoped and customer_id
  // is NOT NULL. Unresolved EDIEL/routing issues belong in the EDIEL event and
  // unresolved-item audit streams until a canonical customer has been matched.
  const customerId = cleanId(input.customerId)
  if (!customerId) {
    console.warn('[inbound-mail] Skipping customer-scoped task because no canonical customer is resolved.', {
      companyId,
      taskType: input.taskType ?? 'inbound_ediel_mail_review',
      sourceId: typeof input.metadata?.sourceId === 'string' ? input.metadata.sourceId : null,
    })
    return
  }

  const taskType = input.taskType ?? 'inbound_ediel_mail_review'
  const sourceId = typeof input.metadata?.sourceId === 'string' ? input.metadata.sourceId : null

  if (sourceId) {
    const { count, error: existingError } = await supabaseService
      .from('customer_operation_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('customer_id', customerId)
      .eq('task_type', taskType)
      .eq('status', 'open')
      .contains('metadata', { sourceId })

    if (!existingError && (count ?? 0) > 0) return
  }

  const { error } = await supabaseService.from('customer_operation_tasks').insert({
    company_id: companyId,
    customer_id: customerId,
    site_id: cleanId(input.siteId),
    metering_point_id: cleanId(input.meteringPointId),
    task_type: taskType,
    status: 'open',
    priority: input.priority ?? 'high',
    title: input.title,
    description: input.description ?? input.title,
    metadata: input.metadata ?? {},
    created_by: input.actorUserId ?? null,
    updated_by: input.actorUserId ?? null,
  })

  if (error) console.warn('[inbound-mail] Kunde inte skapa task', error)
}
