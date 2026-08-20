import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readModuleFamily } from '@/__tests__/helpers/read-module-family'

const poller = readModuleFamily('lib/inbound-mail/edielMailboxPoller.ts')
const reopenMigration = readFileSync(
  'supabase/migrations/20260814193000_inbound_manual_review_reopen_after_requeue.sql',
  'utf8',
)
const resolveMigration = readFileSync(
  'supabase/migrations/20260814190000_inbound_manual_review_status_and_binding.sql',
  'utf8',
)
const detailPage = readFileSync('app/admin/inbound-mail/[id]/page.tsx', 'utf8')
const form = readFileSync('app/admin/inbound-mail/[id]/InboundManualReviewForm.tsx', 'utf8')

describe('post-#143 inbound manual review reopen after requeue', () => {
  it('clears sticky review_resolved_at when the worker re-enters manual_review', () => {
    // Default form action is requeue; resolve RPC always stamps review_resolved_at.
    expect(form).toContain('defaultValue="queued"')
    expect(resolveMigration).toMatch(/review_resolved_at\s*=\s*v_resolved_at/)

    // Open-review UI and the SECURITY DEFINER command both require a null stamp.
    expect(detailPage).toContain("job.status === 'manual_review' && job.review_resolved_at == null")
    expect(resolveMigration).toContain('v_job.review_resolved_at is not null')

    // Worker must reopen the review cycle when status returns to manual_review.
    expect(poller).toMatch(
      /async function markInboundProcessingJobFinished\([\s\S]*?review_resolved_at:\s*null[\s\S]*?review_resolution:\s*null/,
    )
    expect(poller).toMatch(
      /input\.status\s*===\s*["']manual_review["'][\s\S]*?review_resolved_at:\s*null|review_resolved_at:\s*null[\s\S]*?input\.status\s*===\s*["']manual_review["']/,
    )
  })

  it('forward-migrates stuck reopen rows and legacy completed terminal status', () => {
    expect(reopenMigration).toContain("status = 'done'")
    expect(reopenMigration).toContain("status = 'completed'")
    expect(reopenMigration).toContain("status = 'manual_review'")
    expect(reopenMigration).toContain('review_resolved_at = null')
    expect(reopenMigration).toContain('review_resolution = null')
    expect(reopenMigration).toMatch(/review_resolved_at\s+is\s+not\s+null/)
  })
})
