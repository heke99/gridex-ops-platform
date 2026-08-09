# Remediation handover

Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`

Refetch the PR HEAD before any verification or merge decision; this file is intentionally not a source of truth for a moving commit SHA.

## What is implemented

The customer-application pipeline was split from ~9,808 lines into <=2500-line production modules. Prior ordinary CI typecheck and targeted regressions passed before the current account-level Actions outage.

The last real deterministic clean replay (HEAD `4cd7539d9da6d01e0fb493edef60a41bd2a0c9e9`) reached `20260728170000_live_schema_code_canonical_sync.sql` and failed first on missing `customer_invoice_lines.vat_rate`. The branch now restores the full source-defined Batch 1B invoice-line runtime family (`line_type`, `unit`, `vat_rate`, `sort_order`) through a checksum-pinned derived bootstrap registered in deterministic replay order.

Other current branch remediations include customer-document storage isolation, central application-log redaction, expanded release CI, grid-owner direct-first actor-resolution performance and the ops-health SQLSTATE 42702 hotfix.

Grid-owner benchmark evidence is read-only: the previous actor OR-join was ~1.09 s and produced 186 joined rows for 183 grid owners; the direct-first/fallback-only form was ~26 ms and produced exactly 183 rows. The forward migration fails closed against canonical view-shape drift.

Vercel 24-hour runtime observability found one current production error group: `/api/internal/system/health`, SQLSTATE `42702`, last observed 2026-08-09 02:35:06 UTC. Read-only Supabase execution reproduced the PL/pgSQL `status` output-variable collision. Forward migration `20260809110000_ops_health_status_qualification.sql` patches exactly five ambiguous table references via `pg_get_functiondef()`, is checksum-registered and has a static regression. It has not been deployed or final-CI verified.

## Audit rescan disposition

- AUD-002 quote canonicalization is already on main/production through PR #85.
- AUD-005 OTP config is 3600 seconds and the old advisor warning is gone.
- AUD-006 EDIEL cache has 288 rows and zero null SHA fingerprints.
- AUD-008 performance remediation is implemented with measured read-only evidence, pending final CI/replay.
- AUD-009 application log minimization/redaction is implemented, pending final CI.
- AUD-010 central admin auth context is request-scoped via React `cache()`.
- AUD-011 Vercel production is READY on main SHA `5923b5c17fe96c0453048bdc102203efb65f7d7a`; full production DB parity is not claimed.
- AUD-014 stale advisor items are checked against actual object existence/current schema before changes.
- AUD-015 reviewed permissive reads are global EDIEL/reference/RBAC metadata; unnecessary tenant RLS rewrites were avoided.
- `quality/audits/gridex-ops-full-integrity-performance-remediation/FINAL_STATUS.md` contains the current finding-by-finding status.

## External blockers

1. GitHub hosted Actions jobs do not execute. Required jobs end before step 1 with `steps=null`; prior GitHub annotation identifies account payment/spending-limit failure. A manual rerun behaved the same. Treat these as infrastructure failures, never as passing or failing code evidence.
2. GitHub reports `main` unprotected. The installed connector has no branch-protection/ruleset write action.
3. Supabase Security Advisor reports Leaked Password Protection disabled. The installed connector has no hosted Auth/Management configuration write action.
4. There is no existing isolated Supabase preview branch. Creating one is billable and requires explicit cost confirmation; do not use the default/live database for destructive clean replay.

## Required completion sequence

When a runner is actually available:

1. Run `verify`, `quality-release-gates` and `clean-migration-replay` on the exact same final HEAD.
2. If replay fails, use only the first real SQL failure as the next remediation input; preserve historical migrations and checksum provenance.
3. Continue until the replay artifact proves deterministic completion, Supabase ledger verification, historical smoke gates and exact schema fingerprint.
4. Rescan active audit/remediation files, changed files and large-file gates; ensure no temporary workflow, historical migration edit, secret/debugger/test-skip or active release finding remains unresolved.
5. Satisfy repository release controls, including the required main protection/ruleset if the audit treats it as a release blocker.
6. Mark PR #90 ready, merge to `main`, then verify the merged/main SHA and post-merge CI/deployment.

Never merge PR #90 merely because GitHub reports it mergeable while the required jobs have not executed.