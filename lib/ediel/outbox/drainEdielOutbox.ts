import { openEdielOutboxBatch } from '@/lib/ediel/outbox/batchJournal'
import { processEdielOutbox, type EdielOutboxRun } from '@/lib/ediel/outbox/processEdielOutbox'

// Admission budget: an already-started send finishes under its transport's
// existing timeout and reconciliation rules. This does not cancel SMTP.
export const EDIEL_OUTBOX_DRAIN_BUDGET_MS = 45_000
export const EDIEL_OUTBOX_DRAIN_MAX_BATCHES = 40

export async function drainEdielOutbox(params: {
  actorUserId: string
  environment?: 'test' | 'production' | string | null
  limit?: number
  budgetMs?: number
  maxBatches?: number
  now?: () => number
}): Promise<Omit<EdielOutboxRun, 'stoppedBy'> & { batches: number; stoppedBy: 'queue_empty' | 'budget' | 'max_batches' | 'repeated_rows' | 'dependency_failure' }> {
  const now = params.now ?? Date.now
  const deadlineMs = now() + Math.max(0, params.budgetMs ?? EDIEL_OUTBOX_DRAIN_BUDGET_MS)
  const limit = Math.max(1, Math.min(params.limit ?? 25, 100))
  const maxBatches = Math.max(1, Math.min(params.maxBatches ?? EDIEL_OUTBOX_DRAIN_MAX_BATCHES, EDIEL_OUTBOX_DRAIN_MAX_BATCHES))
  const seen = new Set<string>()
  const journal=await openEdielOutboxBatch(params)
  const total: EdielOutboxRun = { runId:journal.runId,remainingReady:null,claimed: 0, processed: 0, sent: 0, repaired: 0, failed: 0, blocked: 0, deliveryUncertain: 0, staleDeliveryUncertain: 0, results: [], stoppedBy: null }
  let batches = 0
  async function finish(reason:'queue_empty'|'budget'|'max_batches'|'repeated_rows'|'dependency_failure') {
    try {
      const receipt=await journal.note({kind:'finish',reason})
      total.remainingReady=typeof receipt.remainingReady==='number'?receipt.remainingReady:null
    } catch { reason='dependency_failure' }
    return {...total,batches,stoppedBy:reason}
  }
  for (;;) {
    if (now() >= deadlineMs) return finish('budget')
    const run = await processEdielOutbox({ actorUserId: params.actorUserId, companyId: null,
      environment: params.environment ?? null, limit, deadlineMs, now, seenIds: seen, journal })
    batches += 1
    for (const result of run.results) seen.add(String(result.id))
    total.claimed += run.claimed
    total.processed += run.processed
    total.sent += run.sent
    total.repaired += run.repaired
    total.failed += run.failed
    total.blocked += run.blocked
    total.deliveryUncertain += run.deliveryUncertain
    total.staleDeliveryUncertain += run.staleDeliveryUncertain
    total.results.push(...run.results)
    if (run.stoppedBy) return finish(run.stoppedBy)
    if (run.claimed < limit) return finish('queue_empty')
    if (batches >= maxBatches) return finish('max_batches')
  }
}
