# Post-#143 tip residuals — inbound manual review reopen

Reviewed tip: `15ef6bf6` (Merge PR #143).
Branch: `cursor/codebase-health-and-stability-996c`.

## Skill routing

- Activated: using-superpowers, find-bugs, differential-review, code-review,
  fp-check, variant-analysis, test-driven-development, supabase,
  verification-before-completion, scan-secrets (ggshield unavailable → blocked)
- Conditional: requesting-code-review (PR open)
- Skipped: full quality-playbook / threat-model (scoped tip residual);
  brainstorming (requirements evidenced by tip + #143 default requeue path)

## Confirmed findings (fixed)

1. HIGH — sticky `review_resolved_at` after requeue cycles
   Evidence: resolve RPC always stamps `review_resolved_at`; form default is
   `queued`; `markInboundProcessingJobFinished` previously left the stamp when
   returning to `manual_review`; open UI + RPC both require null stamp.
2. MEDIUM — legacy `completed` terminal rows may remain from pre-#143 resolves
3. LOW — Swedish action-layer errors swallowed by generic UI mapping

## False positives / deferred

- Platform-admin-only resolve without binding: already fixed by #143 (FP as residual).
- Worker not inventing review_owner on first manual_review entry: pre-existing;
  migration backfills open rows with missing metadata only.

## Verification

- vitest 4/4, migration integrity 437, types check, production audit 0, app tsc PASS
- ggshield BLOCKED; live DB apply of `20260814193000` not observed
