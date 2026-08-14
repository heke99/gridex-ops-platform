# Post-#144 tip residuals — inbound manual review metadata + Processa om

Reviewed tip: `1dfc3559` (Merge PR #144: reopen manual review after requeue cycles).
Branch: `cursor/codebase-health-and-stability-e76c`.

## Skill routing

- Activated: using-superpowers, find-bugs, differential-review, code-review,
  fp-check, variant-analysis, test-driven-development, supabase,
  supabase-postgres-best-practices, verification-before-completion,
  scan-secrets (ggshield unavailable → blocked)
- Conditional: requesting-code-review / open_git_pr
- Skipped: full quality-playbook / threat-model (scoped tip residual);
  brainstorming (residuals evidenced by architecture check + Processa om path)

## Confirmed findings (fixed)

1. HIGH — worker entered `manual_review` without inventing `review_owner` /
   `review_priority` / `review_reason` / `review_sla_due_at`, and reopen left
   sticky previous `review_reason` (UI prefers it over `error_message`).
   Architecture check `manual-review-without-owner-or-sla` treats this as critical.
2. HIGH — admin **Processa om** called `processInboundEmailMessage` without
   syncing `inbound_processing_jobs`, so open-review UI/RPC could remain after
   a successful direct reprocess.
3. MEDIUM — open rows created after `#144` migrate/apply could still lack
   metadata until worker deploy; forward `20260814200000` backfills them.

## False positives / deferred

- Sticky `review_resolved_at` after Köa om: fixed on tip by #144 (FP as residual).
- Inventing human user identity as review_owner: intentionally operational role
  `tenant_operations` only (same as masterpoint defaults).

## Verification

- vitest post-139/143/144: 6/6 PASS
- `db:migrations:integrity`: PASS (438 files)
- `db:types:check`: PASS
- `security:audit-production`: PASS (0 vulnerabilities)
- `tsc -p tsconfig.app.json`: PASS
- ggshield: BLOCKED
- hosted CI / live DB apply of `20260814200000`: NOT YET
