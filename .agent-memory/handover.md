# Remediation handover

Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`

Current PR HEAD before this memory refresh chain: `e03800e36ba5e8b8d417791c2d9b44a8c37a83c0` (refetch before any write/merge decision).

Large-file blocker: customer application pipeline is split into <=2500-line production modules; ordinary CI typecheck and targeted regressions were green before the current external CI outage. The prior stale final-contract file-path assertion was corrected without weakening the token check.

Database blocker: the latest real clean replay is HEAD `4cd7539d9da6d01e0fb493edef60a41bd2a0c9e9`. It advanced through the canonical history to `20260728170000_live_schema_code_canonical_sync.sql` and failed first on missing `customer_invoice_lines.vat_rate`. Current branch restores the complete source-defined Batch 1B invoice-line runtime family (`line_type`, `unit`, `vat_rate`, `sort_order`) through a checksum-pinned derived bootstrap registered in deterministic replay order. Static provenance inputs are consistent; replay verification is pending.

Important audit rescan evidence:
- AUD-002 quote timestamp canonicalization is already fixed on current main by canonical timestamptz normalization.
- AUD-006 certificate cache derives SHA-256 before upsert; live cache has 288 rows and 0 null fingerprints.
- AUD-008 remains a real measured performance issue: heavy grid-owner actor OR-join is ~1.09 s in EXPLAIN ANALYZE; a direct-first/fallback-only benchmark is ~31 ms and avoids duplicate actor matches. No production/view rewrite has been committed yet because exact CI is unavailable.
- AUD-010 admin authorization context is request-scoped via React `cache()`, materially reducing the original likely auth amplification.
- AUD-014 current advisor finding for `subscription_platform_contract_fees` is stale; the relation does not exist.
- AUD-015 global authenticated `USING(true)` reads are reference/RBAC metadata; live tenant/user-bearing counts inspected are zero and writes stay platform-admin-gated.
- AUD-004 remains external: `main` is unprotected and the installed connector has no branch-protection/ruleset write action.

External CI blocker: GitHub Actions jobs currently never start. GitHub annotates both required jobs with: `The job was not started because recent account payments have failed or your spending limit needs to be increased.` This is an account-level billing/spending-limit failure, not a code/test failure. No self-hosted runner can be inspected through the connector and no isolated local PostgreSQL runner is available. Do not use production Supabase for destructive clean replay.

Continue all independent read-only/static remediation work. As soon as an isolated runner is available, execute exact-final-HEAD `verify` + `clean-migration-replay`, inspect the artifact, continue from the first real failure until fingerprint passes, close the audit matrix, remove draft status, merge PR #90 into main and verify main. Never mark REM-002 verified or merge on billing-failed checks.
