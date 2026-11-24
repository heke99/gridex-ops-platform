import type { DurableE66Scope } from '@/lib/inbound-mail/qualifyDurableE66'
import { supabaseService } from '@/lib/supabase/service'
import { isTransientSupabaseError } from '@/lib/supabase/transientErrors'

type Scope = { p_company: string; p_environment: DurableE66Scope['environment']; p_mailbox: string; p_actor: string }
type Claim = Scope & { p_source: string; p_lease: string }
type Chunk = Claim & { p_next: number; p_limit: number }
type Yield = Claim & { p_next: number }
type Response = PromiseLike<{ data: unknown; error: { message: string; code?: string } | null; status: number }>
type NormalizeResult =
  | { state: 'idle' }
  | { state: 'retry_required'; sourceId: string; nextOrdinal: number; observationCount: number; reason: 'database_lock_contended' }
  | { state: 'progress' | 'ready'; sourceId: string; nextOrdinal: number; observationCount: number }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('e66_normalization_receipt_invalid')
  }
  return value as Record<string, unknown>
}

export async function normalizeNextDurableE66(
  scope: DurableE66Scope,
  limits: { maxChunks: number; budgetMs: number },
): Promise<NormalizeResult> {
  if (!Number.isInteger(limits.maxChunks) || limits.maxChunks < 1 || limits.maxChunks > 8 ||
      !Number.isInteger(limits.budgetMs) || limits.budgetMs < 1 || limits.budgetMs > 30_000) {
    throw new Error('e66_normalization_limits_invalid')
  }
  const started = performance.now()
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as {
    (name: 'gridex_claim_e66_normalization_v1', args: Scope): Response
    (name: 'gridex_read_e66_work_progress_v1', args: Claim): Response
    (name: 'gridex_normalize_e66_with_customer_outcome_v1' | 'gridex_read_e66_normalization_chunk_receipt_v1', args: Chunk): Response
    (name: 'gridex_yield_e66_normalization_v1', args: Yield): Response
  }
  const nativeScope: Scope = {
    p_company: scope.companyId, p_environment: scope.environment, p_mailbox: scope.mailboxId, p_actor: scope.actorUserId,
  }
  const claimed = await rpc('gridex_claim_e66_normalization_v1', nativeScope)
  if (claimed.error) throw new Error(`e66_normalization_claim_failed:${claimed.error.message}`)
  const claim = asRecord(claimed.data)
  if (claim.kind === 'idle') return { state: 'idle' }
  if (claim.kind !== 'claimed' || typeof claim.sourceId !== 'string' || !uuid.test(claim.sourceId) ||
      typeof claim.leaseToken !== 'string' || !uuid.test(claim.leaseToken)) {
    throw new Error('e66_normalization_claim_invalid')
  }
  const sourceId = claim.sourceId
  const lease = { ...nativeScope, p_source: sourceId, p_lease: claim.leaseToken }
  const loaded = await rpc('gridex_read_e66_work_progress_v1', lease)
  if (loaded.error) throw new Error(`e66_normalization_progress_failed:${loaded.error.message}`)
  const progress = asRecord(loaded.data)
  const { observationCount, nextOrdinal } = progress
  if (progress.sourceId !== sourceId || typeof observationCount !== 'number' || !Number.isSafeInteger(observationCount) ||
      typeof nextOrdinal !== 'number' || !Number.isSafeInteger(nextOrdinal) ||
      nextOrdinal < 0 || observationCount <= nextOrdinal) {
    throw new Error('e66_normalization_progress_invalid')
  }

  let next = nextOrdinal
  let batchLimit = 8
  for (let chunks = 0; chunks < limits.maxChunks && next < observationCount; chunks += 1) {
    if (chunks > 0 && performance.now() - started >= limits.budgetMs) break
    let limit = Math.min(batchLimit, observationCount - next)
    let chunk: Chunk = { ...lease, p_next: next, p_limit: limit }
    let result = await rpc('gridex_normalize_e66_with_customer_outcome_v1', chunk)
    while (result.error?.code === '57014' && limit > 1 && performance.now() - started < limits.budgetMs) {
      limit = Math.floor(limit / 2)
      batchLimit = limit
      chunk = { ...chunk, p_limit: limit }
      result = await rpc('gridex_normalize_e66_with_customer_outcome_v1', chunk)
    }
    let data = result.data
    if (result.error) {
      if (result.status !== 0 && !isTransientSupabaseError({ ...result.error, status: result.status })) {
        throw new Error(`e66_normalization_chunk_failed:${result.error.message}`)
      }
      const confirmation = await rpc('gridex_read_e66_normalization_chunk_receipt_v1', chunk)
      if (confirmation.error || confirmation.data === null) {
        throw new Error(`e66_normalization_chunk_unconfirmed:${result.error.message}`)
      }
      const confirmed = asRecord(confirmation.data)
      if (confirmed.state !== 'progress' || confirmed.nextOrdinal !== next + limit) {
        throw new Error('e66_normalization_checkpoint_invalid')
      }
      data = confirmed
    }
    const receipt = asRecord(data)
    if (receipt.state === 'retry_required') {
      if (receipt.sourceId !== sourceId || receipt.phase !== 'normalization' || receipt.checkpoint !== next ||
          receipt.reason !== 'database_lock_contended') throw new Error('e66_normalization_retry_receipt_invalid')
      return { state: 'retry_required', sourceId, nextOrdinal: next, observationCount, reason: receipt.reason }
    }
    if (receipt.state !== 'progress' || receipt.nextOrdinal !== next + limit) {
      throw new Error('e66_normalization_checkpoint_invalid')
    }
    next += limit
  }
  if (next === observationCount) return { state: 'ready', sourceId, nextOrdinal: next, observationCount }

  // Yield only a confirmed checkpoint. An unknown commit result keeps the
  // native lease until expiry, so another worker will re-read the saved ordinal.
  const yielded = await rpc('gridex_yield_e66_normalization_v1', { ...lease, p_next: next })
  if (yielded.error) throw new Error(`e66_normalization_yield_failed:${yielded.error.message}`)
  if (yielded.data !== true) throw new Error('e66_normalization_yield_invalid')
  return { state: 'progress', sourceId, nextOrdinal: next, observationCount }
}
