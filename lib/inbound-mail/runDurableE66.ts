import { runNextMixedDurableE66 } from '@/lib/inbound-mail/runMixedDurableE66'
import { draftNextDurableE66Aperak } from '@/lib/inbound-mail/draftDurableE66Aperak'
import { normalizeNextDurableE66 } from '@/lib/inbound-mail/normalizeDurableE66'
import { qualifyNextDurableE66 } from '@/lib/inbound-mail/qualifyDurableE66'
import type { DurableE66Scope } from '@/lib/inbound-mail/qualifyDurableE66'
import { readyNextDurableE66 } from '@/lib/inbound-mail/readyDurableE66'
import { supabaseService } from '@/lib/supabase/service'

type SchedulerInput = {
  environment: DurableE66Scope['environment']
  actorUserId: string
  mailboxIds: string[]
  companyId: string | null
  sourceIds: string[]
}

type ClassificationInput = DurableE66Scope & {
  jobId: string
  workerId: string
  claimedAt: string
  status: 'done' | 'manual_review'
}

type Classification =
  | { kind: 'completed'; sourceId: string; classificationStatus: ClassificationInput['status']; replayed: boolean }
  | { kind: 'no_eligible' }
  | { kind: 'held_legacy'; classification: 'protocol_duplicate' | 'identity_conflict' }

type Outcome = PromiseLike<{ data: unknown; error: { message: string } | null }>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('e66_runtime_receipt_invalid')
  return value as Record<string, unknown>
}

export async function completeE66Classification(input: ClassificationInput): Promise<Classification> {
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as (
    name: 'gridex_finish_discovered_e66_classification_v1',
    args: {
      p_job: string; p_company: string; p_environment: ClassificationInput['environment']; p_mailbox: string;
      p_actor: string; p_worker: string; p_claimed_at: string; p_outcome: ClassificationInput['status']
    },
  ) => Outcome
  const result = await rpc('gridex_finish_discovered_e66_classification_v1', {
    p_job: input.jobId, p_company: input.companyId, p_environment: input.environment, p_mailbox: input.mailboxId,
    p_actor: input.actorUserId, p_worker: input.workerId, p_claimed_at: input.claimedAt, p_outcome: input.status,
  })
  if (result.error) throw new Error(`e66_classification_handoff_failed:${result.error.message}`)
  const receipt = asRecord(result.data)
  if (receipt.kind === 'no_eligible') return { kind: 'no_eligible' }
  if (receipt.kind === 'held_legacy' &&
      (receipt.classification === 'protocol_duplicate' || receipt.classification === 'identity_conflict')) {
    return { kind: 'held_legacy', classification: receipt.classification }
  }
  if (receipt.kind !== 'completed' || typeof receipt.sourceId !== 'string' || !uuid.test(receipt.sourceId) ||
      receipt.classificationStatus !== input.status || typeof receipt.replayed !== 'boolean') {
    throw new Error('e66_classification_receipt_invalid')
  }
  return {
    kind: 'completed', sourceId: receipt.sourceId, classificationStatus: input.status, replayed: receipt.replayed,
  }
}

export async function prepareDurableE66Work(input: SchedulerInput) {
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as (
    name: 'gridex_prepare_e66_scheduler_v1',
    args: { p_environment: SchedulerInput['environment']; p_mailboxes: string[]; p_company: string | null;
      p_actor: string; p_sources: string[]; p_limit: number },
  ) => Outcome
  const result = await rpc('gridex_prepare_e66_scheduler_v1', {
    p_environment: input.environment, p_mailboxes: input.mailboxIds, p_company: input.companyId,
    p_actor: input.actorUserId, p_sources: input.sourceIds, p_limit: 4,
  })
  if (result.error) throw new Error(`e66_schedule_read_failed:${result.error.message}`)
  const receipt = asRecord(result.data)
  if (!Array.isArray(receipt.scopes) || receipt.scopes.length > 4 || !Array.isArray(receipt.ownedSources)) {
    throw new Error('e66_schedule_read_invalid')
  }
  const knownMailboxes = new Set(input.mailboxIds)
  const knownSources = new Set(input.sourceIds)
  const scopes = receipt.scopes.map((row): DurableE66Scope => {
    const { companyId, mailboxId } = asRecord(row)
    if (typeof companyId !== 'string' || !uuid.test(companyId) || (input.companyId && companyId !== input.companyId) ||
        typeof mailboxId !== 'string' || !knownMailboxes.has(mailboxId)) throw new Error('e66_schedule_scope_invalid')
    return { companyId, mailboxId, actorUserId: input.actorUserId, environment: input.environment }
  })
  const ownedSources = new Set<string>()
  for (const sourceId of receipt.ownedSources) {
    if (typeof sourceId !== 'string' || !knownSources.has(sourceId)) throw new Error('e66_schedule_source_invalid')
    ownedSources.add(sourceId)
  }
  return { scopes, ownedSources }
}

async function finishSealedE66Request(scope: DurableE66Scope) {
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as (
    name: 'gridex_drain_sealed_e66_request_v1',
    args: { p_company: string; p_mailbox: string; p_actor: string; p_environment: DurableE66Scope['environment'] },
  ) => Outcome
  const response = await rpc('gridex_drain_sealed_e66_request_v1', {
    p_company: scope.companyId, p_mailbox: scope.mailboxId, p_actor: scope.actorUserId, p_environment: scope.environment,
  })
  if (response.error) throw new Error(`e66_request_handoff_failed:${response.error.message}`)
  if (response.data === null) return { state: 'idle' as const }
  const receipt = asRecord(response.data)
  if (typeof receipt.sourceId !== 'string' || !uuid.test(receipt.sourceId)) {
    throw new Error('e66_request_handoff_receipt_invalid')
  }
  if (receipt.status === 'deferred') return { state: 'retry_required' as const }
  if (receipt.status === 'received') return { state: 'received' as const }
  if (receipt.status === 'partial') return { state: 'partial' as const }
  if (receipt.status === 'held' || receipt.status === 'replaced' || receipt.status === 'cancelled') {
    return { state: 'held' as const }
  }
  throw new Error('e66_request_handoff_receipt_invalid')
}

export async function runDurableE66Scope(scope: DurableE66Scope) {
  const stages = {
    readiness: () => readyNextDurableE66(scope, { maxValues: 16, budgetMs: 12_000 }),
    request: () => finishSealedE66Request(scope),
    ack: () => draftNextDurableE66Aperak(scope),
    normalization: () => normalizeNextDurableE66(scope, { maxChunks: 4, budgetMs: 12_000 }),
    qualification: () => qualifyNextDurableE66(scope),
    mixed: () => runNextMixedDurableE66(scope),
  }
  const errors: string[] = []
  for (const [phase, run] of Object.entries(stages)) {
    try {
      const outcome = await run()
      if (outcome.state === 'retry_required') errors.push(`${phase}: database_lock_contended`)
    } catch (error) {
      errors.push(`${phase}: ${error instanceof Error ? error.message : 'okänt fel'}`)
    }
  }
  return errors
}
