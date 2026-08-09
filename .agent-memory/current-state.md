# Current state

Last updated: 2026-08-09T09:05:00Z

- Branch: `remediation/gridex-ops-full-integrity-performance`
- PR: `#90`
- Active database finding: `GRIDEX-REM-002`
- Release status: `IMPLEMENTED_NOT_VERIFIED`

## Proven/implemented remediation

The customer-application orchestration split remains ordinary-CI proven and all production modules are <=2500 lines. The last real required-CI execution before the GitHub account runner block had `verify` fully green, including migration/provenance checks, API billing hardening, typecheck, idempotency/multitenant regressions, hardening/final-contract/error-boundary tests and production security audit.

Exact clean replay on `4cd7539d9da6d01e0fb493edef60a41bd2a0c9e9` advanced through the canonical history to `20260728170000_live_schema_code_canonical_sync.sql`. Its first real SQL failure was missing `customer_invoice_lines.vat_rate`. The coherent source-defined Batch 1B invoice-line family (`line_type`, `unit`, `vat_rate`, `sort_order`) is now restored by `bootstrap/20260525_customer_invoice_lines_runtime_foundation.sql`, checksum-pinned and included in deterministic replay order. It has not yet received final runner replay verification.

The current branch also contains:

- customer-document storage isolation forward migrations;
- application log redaction for credentials, personal data and raw payload/body/SQL/document content plus regression coverage;
- expanded CI release gates for lint, script/test typechecks, full tests, OpenAPI compatibility/release verification and production build;
- checksum-registered `20260808214500_grid_owner_direct_actor_join_performance.sql`, whose read-only live benchmark reduced the actor-resolution join from about 1.09 s / 186 joined rows to about 26 ms / exactly 183 rows by using direct actor links first and fallback matching only when no direct link exists;
- checksum-registered `20260809110000_ops_health_status_qualification.sql` plus `scripts/gridex-ops-health-regression.cjs`.

## Production/runtime evidence

Vercel production is `READY` on `main` SHA `5923b5c17fe96c0453048bdc102203efb65f7d7a` (PR #85). Over the latest 24-hour Vercel runtime-error window, exactly one active error group remains: `/api/internal/system/health`, SQLSTATE `42702`, last observed `2026-08-09T02:35:06Z`.

Read-only execution on connected Supabase reproduces that failure in `gridex_ops_health_checks()`: PL/pgSQL output variable `status` conflicts with unqualified `tenant_email_outbox.status`. The same function contains five remaining ambiguous unqualified status references. The new forward migration patches exactly those five references in the installed canonical function using `pg_get_functiondef()`, fails closed on shape drift, and leaves historical migrations untouched. Read-only signature validation found exactly five expected matches. No live Supabase DDL/DML was performed.

## External release gates

GitHub Actions on current remediation commits still fails before step 1: `verify`, `quality-release-gates` and `clean-migration-replay` all return `steps=null`. A manual rerun behaved identically. This remains the GitHub account billing/spending-limit block previously annotated by GitHub, not a code/test result.

`main` is still unprotected and the installed GitHub connector exposes no branch-protection/ruleset write action.

No reusable Supabase development branch exists. Creating one is a billable operation that requires explicit cost confirmation; production/default Supabase is not used for destructive replay.

Do not merge PR #90 until exact-final-HEAD required gates, deterministic replay/ledger/smoke/fingerprint and the repository-protection release requirement are genuinely satisfied.
