import { supabaseService } from '@/lib/supabase/service'
import { getTenantOperationDecision } from '@/lib/tenant/operationPolicy'

export type ClaimedEdielOutboxItem = {
  id: string
  company_id: string | null
  ediel_message_id: string | null
  status: string
  environment: string | null
  locked_by?: string | null
  current_send_attempt_id?: string | null
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function assertWorkerId(workerId: string): string {
  const value = clean(workerId)
  if (!value) throw new Error('ediel_outbox_worker_id_required')
  return value
}

export async function claimEdielOutboxItems(params: {
  workerId: string
  companyId?: string | null
  environment?: string | null
  limit?: number | null
}): Promise<ClaimedEdielOutboxItem[]> {
  const { data, error } = await supabaseService.rpc('claim_ediel_outbox_items', {
    p_environment: clean(params.environment),
    p_company_id: clean(params.companyId),
    p_limit: Math.max(1, Math.min(params.limit ?? 25, 100)),
    p_worker_id: assertWorkerId(params.workerId),
  })

  if (error) throw error
  const claimed = (data ?? []) as ClaimedEdielOutboxItem[]
  const allowed: ClaimedEdielOutboxItem[] = []
  for (const item of claimed) {
    if (!item.company_id) {
      await supabaseService.from('ediel_outbox').update({
        status: 'blocked_tenant_state', blocked_reason: 'missing_company_scope',
        blocked_at: new Date().toISOString(), locked_at: null, locked_by: null, updated_at: new Date().toISOString(),
      }).eq('id', item.id).eq('locked_by', params.workerId)
      continue
    }
    const operation = item.environment === 'production' ? 'ediel.production.send' : 'ediel.test.process'
    const decision = await getTenantOperationDecision(item.company_id, operation)
    if (!decision.allowed) {
      const { error: blockError } = await supabaseService.from('ediel_outbox').update({
        status: 'blocked_tenant_state', blocked_reason: decision.reason_code,
        blocked_at: new Date().toISOString(), company_status_snapshot: decision.company_status,
        locked_at: null, locked_by: null, updated_at: new Date().toISOString(),
      }).eq('id', item.id).eq('locked_by', params.workerId)
      if (blockError) throw blockError
      continue
    }
    allowed.push(item)
  }
  return allowed
}

export async function claimEdielOutboxItem(params: {
  outboxItemId: string
  workerId: string
  actorUserId: string
}): Promise<ClaimedEdielOutboxItem | null> {
  const outboxItemId = clean(params.outboxItemId)
  const actorUserId = clean(params.actorUserId)
  if (!outboxItemId) throw new Error('ediel_outbox_item_id_required')
  if (!actorUserId) throw new Error('ediel_outbox_actor_user_id_required')

  const { data, error } = await supabaseService.rpc('claim_ediel_outbox_item', {
    p_outbox_item_id: outboxItemId,
    p_worker_id: assertWorkerId(params.workerId),
    p_actor_user_id: actorUserId,
  })

  if (error) throw error
  const rows = Array.isArray(data) ? data : data ? [data] : []
  const claimed = (rows[0] as ClaimedEdielOutboxItem | undefined) ?? null
  if (!claimed) return null
  if (!claimed.company_id) {
    const { error: blockError } = await supabaseService.from('ediel_outbox').update({
      status: 'blocked_tenant_state', blocked_reason: 'missing_company_scope',
      blocked_at: new Date().toISOString(), locked_at: null, locked_by: null, updated_at: new Date().toISOString(),
    }).eq('id', claimed.id).eq('locked_by', params.workerId)
    if (blockError) throw blockError
    return null
  }
  const operation = claimed.environment === 'production' ? 'ediel.production.send' : 'ediel.test.process'
  const decision = await getTenantOperationDecision(claimed.company_id, operation)
  if (!decision.allowed) {
    const { error: blockError } = await supabaseService.from('ediel_outbox').update({
      status: 'blocked_tenant_state', blocked_reason: decision.reason_code,
      blocked_at: new Date().toISOString(), company_status_snapshot: decision.company_status,
      locked_at: null, locked_by: null, updated_at: new Date().toISOString(),
    }).eq('id', claimed.id).eq('locked_by', params.workerId)
    if (blockError) throw blockError
    return null
  }
  return claimed
}
