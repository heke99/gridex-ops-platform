import { supabaseService } from '@/lib/supabase/service'

export async function createInboundMailTask(input: {
  companyId?: string | null
  customerId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  title: string
  description?: string | null
  priority?: 'normal' | 'high' | 'urgent'
  metadata?: Record<string, unknown>
  actorUserId?: string | null
}): Promise<void> {
  if (!input.companyId) return

  const { error } = await supabaseService.from('customer_operation_tasks').insert({
    company_id: input.companyId,
    customer_id: input.customerId ?? null,
    site_id: input.siteId ?? null,
    metering_point_id: input.meteringPointId ?? null,
    task_type: 'inbound_ediel_mail_review',
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
