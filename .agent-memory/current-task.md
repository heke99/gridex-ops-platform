# Current task

Last updated: 2026-08-09
Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`

Primary release blocker: `GRIDEX-REM-002` deterministic canonical empty-database replay on the exact final HEAD.

Latest real clean-replay evidence is from HEAD `4cd7539d9da6d01e0fb493edef60a41bd2a0c9e9`. Replay advanced through the canonical history to `20260728170000_live_schema_code_canonical_sync.sql` and failed first because `customer_invoice_lines.vat_rate` was missing. Current branch restores the complete checksum-pinned Batch 1B invoice-line runtime family (`line_type`, `unit`, `vat_rate`, `sort_order`) through `supabase/bootstrap/20260525_customer_invoice_lines_runtime_foundation.sql`, registered in legacy-foundation metadata and deterministic foundation order. It is not yet final-replay verified because GitHub hosted Actions does not start.

Additional campaign work now on the branch:

- customer-document storage isolation forward fixes;
- central sensitive-log redaction and regression coverage;
- expanded `verify`, `quality-release-gates` and `clean-migration-replay` CI;
- grid-owner direct-first actor-resolution performance migration, read-only benchmarked from ~1.09 s to ~26 ms at the actor-join level;
- production `/api/internal/system/health` SQLSTATE `42702` root cause reproduced read-only and remediated by checksum-registered forward migration `20260809110000_ops_health_status_qualification.sql` plus regression;
- final remediation status recorded in `quality/audits/gridex-ops-full-integrity-performance-remediation/FINAL_STATUS.md`.

Current production evidence: Vercel is READY on main SHA `5923b5c17fe96c0453048bdc102203efb65f7d7a`. Latest 24-hour runtime scan had only the ops-health 42702 group; that defect is fixed on the remediation branch but not deployed.

External release blockers:

1. GitHub Actions hosted jobs end before step 1 (`steps=null`) because of the account billing/spending-limit condition; this is not a test result.
2. `main` is unprotected and the installed GitHub connector has no branch-protection/ruleset write action.
3. Supabase Security Advisor reports Leaked Password Protection disabled; the installed Supabase connector has no Auth/Management config write action.
4. No isolated Supabase preview branch exists; creating one is billable and must not be done without explicit cost confirmation.

Do not mutate production/default Supabase for destructive replay. Do not mark REM-002 verified or merge PR #90 until exact-final-HEAD verify + quality gates + clean replay/ledger/smoke/fingerprint genuinely pass and repository release-control requirements are satisfied. Refetch PR HEAD before any merge decision.