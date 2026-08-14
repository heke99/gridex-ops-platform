import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const residualMigration = readFileSync(
  'supabase/migrations/20260814190000_inbound_manual_review_status_and_binding.sql',
  'utf8',
)
const actions = readFileSync('app/admin/inbound-mail/actions.ts', 'utf8')
const form = readFileSync(
  'app/admin/inbound-mail/[id]/InboundManualReviewForm.tsx',
  'utf8',
)
const poller = readFileSync('lib/inbound-mail/edielMailboxPoller.ts', 'utf8')

describe('post-#139 inbound manual review residuals', () => {
  it('uses canonical inbound job terminal status done, not completed', () => {
    // Worker finishes successful inbound jobs as status=done. Writing completed
    // from the review UI creates a non-canonical terminal state that dashboards
    // and claim filters do not treat as finished success.
    expect(poller).toContain('status: outcome.status === "processed" ? "done" : "manual_review"')
    expect(form).toContain('value="done"')
    expect(form).not.toMatch(/value=["']completed["']/)
    expect(actions).toContain('["queued", "done", "failed"]')
    expect(actions).not.toMatch(/\[['\"]queued['\"],\s*['\"]completed['\"],\s*['\"]failed['\"]\]/)

    expect(residualMigration).toContain('canonical_resolve_inbound_manual_review')
    expect(residualMigration).toContain("when lower(btrim(p_next_status)) = 'completed' then 'done'")
    expect(residualMigration).toContain("v_next_status not in ('queued', 'done', 'failed')")
  })

  it('binds review resolution to the inbound email message on the page', () => {
    // The detail form posts both job_id and inbound_email_message_id. Without a
    // membership check, a platform admin can resolve an unrelated open review
    // while revalidating the wrong message page.
    expect(actions).toContain('inbound_processing_job_message_mismatch')
    expect(actions).toMatch(
      /from\(["']inbound_processing_jobs["']\)[\s\S]*?inbound_email_message_id[\s\S]*?eq\(["']id["'],\s*jobId\)/,
    )
    expect(residualMigration).toContain('p_inbound_email_message_id')
    expect(residualMigration).toContain('inbound_processing_job_message_mismatch')
  })
})
