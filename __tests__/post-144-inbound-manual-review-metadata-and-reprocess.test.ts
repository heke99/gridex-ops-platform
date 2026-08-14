import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const poller = readFileSync('lib/inbound-mail/edielMailboxPoller.ts', 'utf8')
const actions = readFileSync('app/admin/inbound-mail/actions.ts', 'utf8')
const detailPage = readFileSync('app/admin/inbound-mail/[id]/page.tsx', 'utf8')
const architectureMigration = readFileSync(
  'supabase/migrations/20260811080000_remaining_masterpoint_convergence.sql',
  'utf8',
)
const metadataMigration = readFileSync(
  'supabase/migrations/20260814200000_inbound_manual_review_metadata_on_entry.sql',
  'utf8',
)

describe('post-#144 inbound manual review metadata and Processa om sync', () => {
  it('populates review owner/priority/reason/SLA when the worker enters manual_review', () => {
    // Architecture reconciliation treats missing owner/reason/SLA as critical.
    expect(architectureMigration).toContain('manual-review-without-owner-or-sla')
    expect(architectureMigration).toContain('nullif(job.review_owner, \'\') is null')
    expect(architectureMigration).toContain('job.review_sla_due_at is null')

    // Open UI prefers review_reason over error_message, so reopen must refresh reason.
    expect(detailPage).toContain('reviewLabel(job.review_reason, job.error_message)')

    // Worker must invent the same operational defaults as the masterpoint backfill
    // and refresh reason/SLA when returning to manual_review after a requeue cycle.
    expect(poller).toMatch(
      /async function markInboundProcessingJobFinished\([\s\S]*?review_owner:\s*["']tenant_operations["']/,
    )
    expect(poller).toMatch(
      /async function markInboundProcessingJobFinished\([\s\S]*?review_priority:\s*["']normal["']/,
    )
    expect(poller).toMatch(
      /async function markInboundProcessingJobFinished\([\s\S]*?review_reason:\s*/,
    )
    expect(poller).toMatch(
      /async function markInboundProcessingJobFinished\([\s\S]*?review_sla_due_at:\s*/,
    )
    expect(poller).toMatch(
      /async function markInboundProcessingJobFinished\([\s\S]*?review_resolved_at:\s*null[\s\S]*?review_resolution:\s*null/,
    )

    // Forward-only repair for any open rows still missing metadata after #144.
    expect(metadataMigration).toContain("status = 'manual_review'")
    expect(metadataMigration).toContain('review_owner')
    expect(metadataMigration).toContain('review_sla_due_at')
    expect(metadataMigration).toContain('manual_review_without_owner_or_sla_still_present')
  })

  it('keeps Processa om in sync with the inbound_processing_jobs row', () => {
    // Detail page exposes direct reprocess without going through the queue worker.
    expect(detailPage).toContain('reprocessInboundEmailAction')
    expect(detailPage).toContain('Processa om')

    const reprocessFn = actions.match(
      /export async function reprocessInboundEmailAction\([\s\S]*?\n\}\n\nexport async function/,
    )?.[0]
    expect(reprocessFn).toBeTruthy()

    // Direct reprocess must sync the related non-terminal job via the shared helper,
    // otherwise the open-review form can remain after a successful Processa om.
    expect(reprocessFn).toContain('processInboundEmailMessage(')
    expect(reprocessFn).toContain('syncActiveInboundProcessingJobForMessage(')
    expect(actions).toContain('syncActiveInboundProcessingJobForMessage')

    expect(poller).toMatch(
      /export async function syncActiveInboundProcessingJobForMessage\([\s\S]*?inbound_processing_jobs/,
    )
    expect(poller).toMatch(
      /export async function syncActiveInboundProcessingJobForMessage\([\s\S]*?["']done["']/,
    )
    expect(poller).toMatch(
      /export async function syncActiveInboundProcessingJobForMessage\([\s\S]*?manual_review/,
    )
    expect(poller).toMatch(
      /export async function syncActiveInboundProcessingJobForMessage\([\s\S]*?markInboundProcessingJobFinished\(/,
    )
  })
})
