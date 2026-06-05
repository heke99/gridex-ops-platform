import { sendOutboxItem } from '@/lib/ediel/outbox/sendOutboxItem'
import { supabaseService } from '@/lib/supabase/service'

export async function processEdielOutbox(params: {
  actorUserId: string
  companyId?: string | null
  limit?: number
  environment?: 'test' | 'production' | string | null
}): Promise<{ processed: number; sent: number; failed: number; blocked: number; results: Array<Record<string, unknown>> }> {
  let query = supabaseService
    .from('ediel_outbox')
    .select('id,company_id,status,priority,environment,created_at')
    .in('status', ['prepared', 'queued'])
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(params.limit ?? 25)

  if (params.companyId) query = query.eq('company_id', params.companyId)
  if (params.environment) query = query.eq('environment', params.environment)

  const { data, error } = await query
  if (error) throw error

  const results: Array<Record<string, unknown>> = []
  for (const item of (data ?? []) as Array<{ id: string }>) {
    const result = await sendOutboxItem({ actorUserId: params.actorUserId, outboxItemId: item.id })
    results.push({ id: item.id, ...result })
  }

  return {
    processed: results.length,
    sent: results.filter((item) => item.status === 'sent').length,
    failed: results.filter((item) => item.status === 'failed').length,
    blocked: results.filter((item) => item.status === 'blocked').length,
    results,
  }
}
