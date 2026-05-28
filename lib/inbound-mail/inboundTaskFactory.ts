import { supabaseService } from '@/lib/supabase/service'

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
  if (!input.companyId) return

  const taskType = input.taskType ?? 'inbound_ediel_mail_review'
  const sourceId = typeof input.metadata?.sourceId === 'string' ? input.metadata.sourceId : null

  if (sourceId) {
    const { count, error: existingError } = await supabaseService
      .from('customer_operation_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', input.companyId)
      .eq('task_type', taskType)
      .eq('status', 'open')
      .contains('metadata', { sourceId })

    if (!existingError && (count ?? 0) > 0) return
  }

  const { error } = await supabaseService.from('customer_operation_tasks').insert({
    company_id: input.companyId,
    customer_id: input.customerId ?? null,
    site_id: input.siteId ?? null,
    metering_point_id: input.meteringPointId ?? null,
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
