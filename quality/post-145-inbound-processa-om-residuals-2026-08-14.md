# Post-#145 tip residuals — Processa om terminal sync + actionable reason

Reviewed tip: `73936c7c` (Merge PR #145: review metadata and reprocess job sync).
Branch: `cursor/codebase-health-and-stability-4764`.

## Skill routing

- Activated: using-superpowers, find-bugs, differential-review, code-review,
  fp-check, variant-analysis, test-driven-development, supabase,
  supabase-postgres-best-practices, verification-before-completion,
  scan-secrets (ggshield unavailable → blocked)
- Conditional: requesting-code-review / open_git_pr
- Skipped: full quality-playbook / threat-model (scoped tip residual);
  brainstorming (residuals evidenced by Processa om + finish path)

## Confirmed findings (fixed)

1. HIGH — `syncActiveInboundProcessingJobForMessage` only selected non-terminal
   jobs. After resolve→done (or failed), Processa om could move the message to
   `manual_review` / `processed` while the job stayed terminal, so the
   open-review form disappeared or stayed stale.
2. HIGH — Worker/Processa om invented `review_reason` from the status token
   `manual_review` and wiped `error_message`, so operators lost actionable
   reasons (UI prefers `review_reason`).
3. MEDIUM — Successful Processa om marked `done` without stamping
   `review_resolved_at` / `review_resolution` (audit gap vs resolve RPC).
4. MEDIUM — Forward repair for open rows left with opaque
   `manual_review` / `manual_review_unclassified` reasons after #145.

## False positives / deferred

- Multiple jobs per message: FALSE POSITIVE as practical residual (insert only
  on store; one job per message invariant).
- Worker `done` without resolution after Köa om: intentional; resolve RPC
  already stamped `review_resolved_at`.
- Inventing human user as `review_owner`: still operational role only.

## Fix summary

- Processor returns `reason`; worker + Processa om pass it into finish/sync.
- Sync updates newest job of any status; stamps `reprocessed` on done.
- Finish helper refuses opaque status-token reasons.
- Forward `20260814210000` repairs open opaque reasons from message fields.

## Verification

- vitest post-139/143/144/145: 8/8 PASS
- Remaining checks recorded in agent-memory verification matrix.
