import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const poller = readFileSync('lib/inbound-mail/edielMailboxPoller.ts', 'utf8')
const actions = readFileSync('app/admin/inbound-mail/actions.ts', 'utf8')
const processor = readFileSync('lib/inbound-mail/edielInboundProcessor.ts', 'utf8')
const detailPage = readFileSync('app/admin/inbound-mail/[id]/page.tsx', 'utf8')
const reasonRepairMigration = readFileSync(
  'supabase/migrations/20260814210000_inbound_manual_review_actionable_reason_repair.sql',
  'utf8',
)

describe('post-#145 Processa om residuals after metadata sync', () => {
  it('reopens or closes the newest job even when it is already terminal', () => {
    // Detail page always exposes Processa om; open-review UI only lists
    // status=manual_review && review_resolved_at is null. Syncing only
    // non-terminal rows leaves done/failed jobs stuck while the message moves.
    expect(detailPage).toContain('reprocessInboundEmailAction')
    expect(detailPage).toContain(
      "job.status === 'manual_review' && job.review_resolved_at == null",
    )

    const syncFn = poller.match(
      /export async function syncActiveInboundProcessingJobForMessage\([\s\S]*?\n\}\n\nexport async function processQueuedInboundProcessingJobs/,
    )?.[0]
    expect(syncFn).toBeTruthy()

    // Must target the newest job for the message without excluding done/failed.
    expect(syncFn).toContain('.eq("inbound_email_message_id", input.inboundEmailMessageId)')
    expect(syncFn).toContain('.order("created_at", { ascending: false })')
    expect(syncFn).not.toMatch(/\.in\(\s*["']status["']/)

    // Successful Processa om must stamp a resolution so audit/reporting see closure.
    expect(syncFn).toMatch(/resolution:\s*nextStatus\s*===\s*["']done["']\s*\?\s*["']reprocessed["']/)
    expect(poller).toMatch(
      /async function markInboundProcessingJobFinished\([\s\S]*?resolution\?:/,
    )
  })

  it('persists an actionable review reason instead of opaque manual_review', () => {
    // UI prefers job.review_reason over job.error_message.
    expect(detailPage).toContain('reviewLabel(job.review_reason, job.error_message)')

    // Processor must return a human/ops reason so finish/sync can store it.
    expect(processor).toMatch(
      /return \{\s*status:\s*['"]manual_review['"][\s\S]*?reason:/,
    )
    expect(processor).toContain("reason: 'Mail saknar EDIFACT payload.'")

    // Worker finish path must pass the processor reason into errorMessage.
    expect(poller).toMatch(
      /markInboundProcessingJobFinished\(\{[\s\S]*?errorMessage:\s*outcome\.reason/,
    )

    // Processa om must forward the same reason into the sync helper.
    const reprocessFn = actions.match(
      /export async function reprocessInboundEmailAction\([\s\S]*?\n\}\n\nexport async function/,
    )?.[0]
    expect(reprocessFn).toBeTruthy()
    expect(reprocessFn).toContain('errorMessage: outcome.reason')

    // Do not invent review_reason from the literal status token "manual_review".
    expect(poller).toContain('manual_review_unclassified')
    expect(poller).toMatch(
      /review_reason:\s*actionableReason|const actionableReason\s*=/,
    )
    expect(poller).toMatch(
      /input\.step\s*!==\s*["']manual_review["']|step\s*!==\s*["']manual_review["']/,
    )

    // Forward repair for open rows left with opaque reason after #145 deploy.
    expect(reasonRepairMigration).toContain("status = 'manual_review'")
    expect(reasonRepairMigration).toContain('review_reason')
    expect(reasonRepairMigration).toContain('inbound_email_messages')
    expect(reasonRepairMigration).toContain("review_reason in ('manual_review', 'manual_review_unclassified')")
  })
})
