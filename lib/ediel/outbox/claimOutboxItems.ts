import { supabaseService } from '@/lib/supabase/service'
import { tenantDb } from '@/lib/supabase/tenantDb'
import { getTenantOperationDecision } from '@/lib/tenant/operationPolicy'

export type ClaimedEdielOutboxItem = {
  id: string
  company_id: string | null
  ediel_message_id: string | null
  status: string
  environment: string | null
  locked_by?: string | null
  current_send_attempt_id?: string | null
  priority?: number | null
  created_at?: string | null
}

// The RPC's ORDER BY only chooses which items are claimed; UPDATE ... RETURNING gives them back in no order. Items are
// sent by priority, then age, so an original leaves before a correction claimed in the same run (FINDINGS I-B11).
function inSendOrder(items: ClaimedEdielOutboxItem[]): ClaimedEdielOutboxItem[] {
  const at = (item: ClaimedEdielOutboxItem) => Date.parse(item.created_at ?? '') || 0
  return [...items].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || at(a) - at(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const BLOCKED_TENANT_STATE = 'blocked_tenant_state' as const

function assertWorkerId(workerId: string): string {
  const value = clean(workerId)
  if (!value) throw new Error('ediel_outbox_worker_id_required')
  return value
}

async function blockClaimedOutboxItem(input: {
  outboxItemId: string
  workerId: string
  reason: string
  companyStatus?: string | null
  operationDecision?: Record<string, unknown> | null
}): Promise<void> {
  const { data, error } = await supabaseService.rpc(
    'canonical_block_claimed_ediel_outbox_item',
    {
      p_outbox_item_id: input.outboxItemId,
      p_worker_id: input.workerId,
      p_reason: input.reason,
      p_company_status: input.companyStatus ?? null,
      p_operation_decision: input.operationDecision ?? {},
    },
  )
  if (error) throw error
  if (data !== BLOCKED_TENANT_STATE) {
    throw new Error('ediel_outbox_claim_block_lock_lost')
  }
}

export async function claimEdielOutboxItemsWithProgress(params: {
  workerId: string
  companyId?: string | null
  environment?: string | null
  limit?: number | null
}): Promise<{ items: ClaimedEdielOutboxItem[]; claimed: number; blocked: number }> {
  const { data, error } = await supabaseService.rpc('claim_ediel_outbox_items', {
    p_environment: clean(params.environment),
    p_company_id: clean(params.companyId),
    p_limit: Math.max(1, Math.min(params.limit ?? 25, 100)),
    p_worker_id: assertWorkerId(params.workerId),
  })

  if (error) throw error
  const claimed = inSendOrder((data ?? []) as ClaimedEdielOutboxItem[])
  const allowed: ClaimedEdielOutboxItem[] = []
  for (const item of claimed) {
    if (!item.company_id) {
      await blockClaimedOutboxItem({
        outboxItemId: item.id,
        workerId: params.workerId,
        reason: 'missing_company_scope',
      })
      continue
    }
    const operation = item.environment === 'production' ? 'ediel.production.send' : 'ediel.test.process'
    const decision = await getTenantOperationDecision(item.company_id, operation)
    if (!decision.allowed) {
      await blockClaimedOutboxItem({
        outboxItemId: item.id,
        workerId: params.workerId,
        reason: decision.reason_code,
        companyStatus: decision.company_status,
        operationDecision: decision as unknown as Record<string, unknown>,
      })
      continue
    }
    allowed.push(item)
  }
  return { items: allowed, claimed: claimed.length, blocked: claimed.length - allowed.length }
}

// Keep the existing array API for callers that do not need raw queue progress.
export async function claimEdielOutboxItems(params: Parameters<typeof claimEdielOutboxItemsWithProgress>[0]): Promise<ClaimedEdielOutboxItem[]> {
  return (await claimEdielOutboxItemsWithProgress(params)).items
}

// This is only for an untouched claim: the worker has not called sendOutboxItem.
// Never use it to cancel or retry a transport operation that has begun.
export async function releaseUnsentEdielOutboxClaim(item: ClaimedEdielOutboxItem, workerId: string): Promise<void> {
  const attemptId = clean(item.current_send_attempt_id)
  // The global drain releases only allowed claims; each carries its own company scope.
  let query = (tenantDb(item.company_id).from('ediel_outbox')
    .update({ status: 'queued', locked_at: null, locked_by: null, updated_at: new Date().toISOString() }) as ReturnType<ReturnType<typeof supabaseService.from>['update']>)
    .eq('id', item.id).eq('status', 'sending').eq('locked_by', assertWorkerId(workerId))
  query = attemptId ? query.eq('current_send_attempt_id', attemptId) : query.is('current_send_attempt_id', null)
  const { data, error } = await query.select('id').maybeSingle()
  if (error) throw error
  if (!data) throw new Error('ediel_outbox_unsent_release_claim_lost')
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
    await blockClaimedOutboxItem({
      outboxItemId: claimed.id,
      workerId: params.workerId,
      reason: 'missing_company_scope',
    })
    return null
  }
  const operation = claimed.environment === 'production' ? 'ediel.production.send' : 'ediel.test.process'
  const decision = await getTenantOperationDecision(claimed.company_id, operation)
  if (!decision.allowed) {
    await blockClaimedOutboxItem({
      outboxItemId: claimed.id,
      workerId: params.workerId,
      reason: decision.reason_code,
      companyStatus: decision.company_status,
      operationDecision: decision as unknown as Record<string, unknown>,
    })
    return null
  }
  return claimed
}
