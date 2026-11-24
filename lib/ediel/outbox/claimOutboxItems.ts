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
  batch?: { runId: string; attemptId: string }
}): Promise<void> {
  const args = {
    p_outbox_item_id: input.outboxItemId,
    p_worker_id: input.workerId,
    p_reason: input.reason,
    p_company_status: input.companyStatus ?? null,
    p_operation_decision: input.operationDecision ?? {},
  }
  const { data, error } = input.batch
    ? await supabaseService.rpc('gridex_block_ediel_outbox_batch_item_v1', {
      ...args, p_run_id: input.batch.runId, p_attempt_id: input.batch.attemptId,
    })
    : await supabaseService.rpc('canonical_block_claimed_ediel_outbox_item', args)
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
  batchRunId?: string
}): Promise<{ items: ClaimedEdielOutboxItem[]; claimed: number; blocked: number; staleTransitionCount: number }> {
  const claimRpc = supabaseService.rpc.bind(supabaseService) as unknown as (
    name: 'gridex_claim_ediel_outbox_progress_v1',
    args: { p_environment: string | null; p_company_id: string | null; p_limit: number; p_worker_id: string },
  ) => Promise<{ data: { items?: unknown; staleTransitionCount?: unknown } | null; error: unknown }>
  const workerId = assertWorkerId(params.workerId)
  const { data, error } = params.batchRunId
    ? await supabaseService.rpc('gridex_claim_ediel_outbox_batch_v1', { p_run_id: params.batchRunId, p_worker_id: workerId })
    : await claimRpc('gridex_claim_ediel_outbox_progress_v1', {
      p_environment: clean(params.environment),
      p_company_id: clean(params.companyId),
      p_limit: Math.max(1, Math.min(params.limit ?? 25, 100)),
      p_worker_id: workerId,
    })

  if (error) throw error
  if (!data || !Array.isArray(data.items) || typeof data.staleTransitionCount !== 'number' ||
      !Number.isSafeInteger(data.staleTransitionCount) || data.staleTransitionCount < 0) {
    throw new Error('ediel_outbox_claim_progress_invalid')
  }
  const claimed = data.items as ClaimedEdielOutboxItem[]
  const allowed: ClaimedEdielOutboxItem[] = []
  for (const item of claimed) {
    const attemptId = clean(item.current_send_attempt_id)
    if (params.batchRunId && !attemptId) throw new Error('ediel_outbox_batch_attempt_missing')
    const batch = params.batchRunId && attemptId ? { runId: params.batchRunId, attemptId } : undefined
    if (!item.company_id) {
      await blockClaimedOutboxItem({
        outboxItemId: item.id,
        workerId,
        batch,
        reason: 'missing_company_scope',
      })
      continue
    }
    const operation = item.environment === 'production' ? 'ediel.production.send' : 'ediel.test.process'
    const decision = await getTenantOperationDecision(item.company_id, operation)
    if (!decision.allowed) {
      await blockClaimedOutboxItem({
        outboxItemId: item.id,
        workerId,
        batch,
        reason: decision.reason_code,
        companyStatus: decision.company_status,
        operationDecision: decision as unknown as Record<string, unknown>,
      })
      continue
    }
    allowed.push(item)
  }
  return { items: allowed, claimed: claimed.length, blocked: claimed.length - allowed.length, staleTransitionCount: data.staleTransitionCount }
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
