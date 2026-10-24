import { randomUUID } from 'node:crypto'
import { claimEdielOutboxItemsWithProgress, releaseUnsentEdielOutboxClaim } from '@/lib/ediel/outbox/claimOutboxItems'
import { sendOutboxItem } from '@/lib/ediel/outbox/sendOutboxItem'

export type EdielOutboxRun = {
  claimed: number
  processed: number
  sent: number
  failed: number
  blocked: number
  deliveryUncertain: number
  results: Array<Record<string, unknown>>
  stoppedBy: 'queue_empty' | 'budget' | 'repeated_rows' | null
}

export async function processEdielOutbox(params: {
  actorUserId: string
  companyId?: string | null
  limit?: number
  environment?: 'test' | 'production' | string | null
  deadlineMs?: number
  now?: () => number
  seenIds?: ReadonlySet<string>
}): Promise<EdielOutboxRun> {
  const now = params.now ?? Date.now
  const workerId = `ediel-outbox-${params.actorUserId}-${randomUUID()}`
  const limit = Math.max(1, Math.min(params.limit ?? 25, 100))
  const expired = () => params.deadlineMs !== undefined && now() >= params.deadlineMs
  const seen = new Set(params.seenIds)
  const run: EdielOutboxRun = { claimed: 0, processed: 0, sent: 0, failed: 0, blocked: 0, deliveryUncertain: 0, results: [], stoppedBy: null }
  while (run.claimed < limit) {
    if (expired()) { run.stoppedBy = 'budget'; break }
    // Claim just the next item. Unstarted rows stay available if a send is slow.
    const claim = await claimEdielOutboxItemsWithProgress({ workerId, companyId: params.companyId ?? null,
      environment: params.environment ?? null, limit: 1 })
    run.claimed += claim.claimed
    run.blocked += claim.blocked
    if (claim.claimed === 0) { run.stoppedBy = 'queue_empty'; break }
    for (const item of claim.items) {
      const repeated = seen.has(item.id)
      if (expired() || repeated) {
        await releaseUnsentEdielOutboxClaim(item, workerId)
        run.stoppedBy = repeated ? 'repeated_rows' : 'budget'
        return run
      }
      seen.add(item.id)
      // Await the complete fenced send. An in-flight transport is never raced,
      // cancelled or requeued merely because the admission deadline passes.
      const result = await sendOutboxItem({ actorUserId: params.actorUserId, outboxItemId: item.id,
        workerId, sendAttemptId: item.current_send_attempt_id ?? null, alreadyClaimed: true })
      run.results.push({ id: item.id, ...result })
      run.processed += 1
      if (result.status === 'sent') run.sent += 1
      if (result.status === 'failed') run.failed += 1
      if (result.status === 'blocked') run.blocked += 1
      if (result.status === 'delivery_uncertain') run.deliveryUncertain += 1
    }
  }
  if (expired()) run.stoppedBy = 'budget'
  return run
}
