import { randomUUID } from 'node:crypto'
import { claimEdielOutboxItemsWithProgress, releaseUnsentEdielOutboxClaim } from '@/lib/ediel/outbox/claimOutboxItems'
import { openEdielOutboxBatch, type EdielOutboxBatch } from '@/lib/ediel/outbox/batchJournal'
import { EdielOutboxPreTransportProjectionError, sendOutboxItem } from '@/lib/ediel/outbox/sendOutboxItem'

export type EdielOutboxRun = {
  runId: string
  remainingReady: number | null
  claimed: number
  processed: number
  sent: number
  repaired: number
  failed: number
  blocked: number
  deliveryUncertain: number
  staleDeliveryUncertain: number
  results: Array<Record<string, unknown>>
  stoppedBy: 'queue_empty' | 'budget' | 'repeated_rows' | 'dependency_failure' | null
}

export async function processEdielOutbox(params: {
  actorUserId: string
  companyId?: string | null
  limit?: number
  environment?: 'test' | 'production' | string | null
  deadlineMs?: number
  now?: () => number
  seenIds?: ReadonlySet<string>
  journal?: EdielOutboxBatch
}): Promise<EdielOutboxRun> {
  const now = params.now ?? Date.now
  const workerId = `ediel-outbox-${params.actorUserId}-${randomUUID()}`
  const limit = Math.max(1, Math.min(params.limit ?? 25, 100))
  const expired = () => params.deadlineMs !== undefined && now() >= params.deadlineMs
  const seen = new Set(params.seenIds)
  const journal = params.journal ?? await openEdielOutboxBatch(params)
  const run: EdielOutboxRun = { runId: journal.runId, remainingReady: null, claimed: 0, processed: 0, sent: 0, repaired: 0, failed: 0, blocked: 0, deliveryUncertain: 0, staleDeliveryUncertain: 0, results: [], stoppedBy: null }
  try {
    // The company entry point resolves the current actor and scope. An open
    // global batch never supplies authority for an automatic old-lease retake.
    if (!params.journal && params.companyId && (params.environment === 'test' || params.environment === 'production') && !expired()) {
      await journal.note({ kind: 'recover_unstarted' })
      // The sealed owner must see a commit before witnessing its release.
      if (!expired()) await journal.note({ kind: 'release_prepared' })
      if (!expired()) await journal.note({ kind: 'requeue_prepared' })
    }
    while (run.claimed < limit) {
      if (expired()) { run.stoppedBy = 'budget'; break }
      // Claim just the next item. Unstarted rows stay available if a send is slow.
      const claim = await claimEdielOutboxItemsWithProgress({ workerId, companyId: params.companyId ?? null,
        environment: params.environment ?? null, limit: 1, batchRunId: journal.runId })
      run.claimed += claim.claimed
      run.blocked += claim.blocked
      run.staleDeliveryUncertain += claim.staleTransitionCount
      run.deliveryUncertain += claim.staleTransitionCount
      if (claim.claimed === 0) { run.stoppedBy = 'queue_empty'; break }
      for (const item of claim.items) {
        const claimBinding={outboxId:item.id,attemptId:item.current_send_attempt_id??null,workerId}
        const repeated = seen.has(item.id)
        if (expired() || repeated) {
          await releaseUnsentEdielOutboxClaim(item, workerId)
          await journal.note({kind:'outcome',...claimBinding,status:'released_unstarted'})
          run.stoppedBy = repeated ? 'repeated_rows' : 'budget'
          break
        }
        await journal.note({ kind: 'dispatch', ...claimBinding })
        seen.add(item.id)
        // Await the complete fenced send. An in-flight transport is never raced,
        // cancelled or requeued merely because the admission deadline passes.
        let result
        try {
          result = await sendOutboxItem({ actorUserId: params.actorUserId, outboxItemId: item.id,
            workerId, sendAttemptId: item.current_send_attempt_id ?? null, alreadyClaimed: true })
        } catch (error) {
          if (!(error instanceof EdielOutboxPreTransportProjectionError)) {
            await journal.note({kind:'outcome',...claimBinding,status:'dependency_held'}).catch(()=>{})
            run.results.push({id:item.id,status:'dependency_held',messageId:null})
            throw error
          }
          await journal.note({kind:'outcome',...claimBinding,status:'local_projection_held'})
          run.results.push({id:item.id,status:'local_projection_held',messageId:null})
          run.processed += 1
          run.blocked += 1
          continue
        }
        run.results.push({ id: item.id, ...result })
        run.processed += 1
        if (result.status === 'sent' && result.delivery === 'new_acceptance') run.sent += 1
        if (result.status === 'sent' && result.delivery === 'repaired_projection') run.repaired += 1
        if (result.status === 'failed') run.failed += 1
        if (result.status === 'blocked') run.blocked += 1
        if (result.status === 'delivery_uncertain') run.deliveryUncertain += 1
        await journal.note({kind:'outcome',...claimBinding,status:result.status,
          ...(result.status==='sent' ? {delivery:result.delivery} : {})})
        if (result.status==='delivery_uncertain' && result.persistenceFailed) {
          run.stoppedBy='dependency_failure'
          break
        }
      }
      if (run.stoppedBy) break
    }
  } catch {
    run.stoppedBy = 'dependency_failure'
  }
  if (!run.stoppedBy && expired()) run.stoppedBy = 'budget'
  if (!params.journal) {
    try {
      const receipt=await journal.note({kind:'finish',reason:run.stoppedBy??'batch_limit'})
      run.remainingReady=typeof receipt.remainingReady==='number'?receipt.remainingReady:null
    } catch { run.stoppedBy='dependency_failure' }
  }
  return run
}
