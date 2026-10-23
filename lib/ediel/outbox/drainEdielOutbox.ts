// lib/ediel/outbox/drainEdielOutbox.ts
//
// FINDINGS P8: the scheduled outbox run claimed one batch of 25 rows across every company and stopped, every
// five minutes (vercel.json), so the whole platform sent about five messages a minute and one company's backlog
// held back another company's CONTRL/APERAK for many minutes. The cron run now keeps claiming batches through the
// same claim and send path (every send gate unchanged) until the queue holds no more claimable rows or the time
// budget is spent. A batch that comes back with only rows this run already handled ends the run, so a row that is
// requeued by its own send attempt is not retried in a tight loop.
import { processEdielOutbox } from '@/lib/ediel/outbox/processEdielOutbox'

type OutboxRun = Awaited<ReturnType<typeof processEdielOutbox>>

export const EDIEL_OUTBOX_DRAIN_BUDGET_MS = 45_000
export const EDIEL_OUTBOX_DRAIN_MAX_BATCHES = 40

export async function drainEdielOutbox(params: {
  actorUserId: string
  environment?: 'test' | 'production' | string | null
  limit?: number
  budgetMs?: number
  maxBatches?: number
  now?: () => number
}): Promise<OutboxRun & { batches: number; stoppedBy: 'queue_empty' | 'budget' | 'max_batches' | 'repeated_rows' }> {
  const now = params.now ?? Date.now
  const started = now()
  const limit = params.limit ?? 25
  const budgetMs = params.budgetMs ?? EDIEL_OUTBOX_DRAIN_BUDGET_MS
  const maxBatches = params.maxBatches ?? EDIEL_OUTBOX_DRAIN_MAX_BATCHES
  const seen = new Set<string>()
  const total: OutboxRun = { processed: 0, sent: 0, failed: 0, blocked: 0, deliveryUncertain: 0, results: [] }
  let batches = 0
  for (;;) {
    const run = await processEdielOutbox({ actorUserId: params.actorUserId, companyId: null, environment: params.environment ?? null, limit })
    batches += 1
    const results = run.results ?? []
    const fresh = results.filter(result => !seen.has(String(result.id)))
    for (const result of results) seen.add(String(result.id))
    total.processed += run.processed ?? 0
    total.sent += run.sent ?? 0
    total.failed += run.failed ?? 0
    total.blocked += run.blocked ?? 0
    total.deliveryUncertain += run.deliveryUncertain ?? 0
    total.results.push(...results)
    if ((run.processed ?? 0) < limit) return { ...total, batches, stoppedBy: 'queue_empty' }
    if (results.length > 0 && fresh.length === 0) return { ...total, batches, stoppedBy: 'repeated_rows' }
    if (batches >= maxBatches) return { ...total, batches, stoppedBy: 'max_batches' }
    if (now() - started >= budgetMs) return { ...total, batches, stoppedBy: 'budget' }
  }
}
