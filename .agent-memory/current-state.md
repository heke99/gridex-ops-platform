# Current state

Last updated: 2026-08-08T21:56:00Z

- Branch: `remediation/gridex-ops-full-integrity-performance`
- PR: `#90`
- Active finding: `GRIDEX-REM-002`
- Status: `IMPLEMENTED_NOT_VERIFIED`

Large-file split remains ordinary-CI proven and all customer-application production modules are <=2500 lines. The last real required-CI execution before the GitHub account runner block had `verify` fully green, including migration/provenance checks, API billing hardening, typecheck, idempotency/multitenant regressions, hardening/final-contract/error-boundary tests and production security audit.

Exact clean replay on `4cd7539d9da6d01e0fb493edef60a41bd2a0c9e9` proved the previously restored contract-graph and external quote/API source replays work and advanced through the canonical history to `20260728170000_live_schema_code_canonical_sync.sql`. The first real SQL failure was `customer_invoice_lines.vat_rate` missing when the migration backfilled `vat_amount`.

Canonical source tracing proves `line_type`, `unit`, `vat_rate` and `sort_order` are one source-defined customer_invoice_lines runtime family in checksum-pinned `20260525_debug_fix_batch_1b_schema_code_alignment.sql`. Current implementation adds `bootstrap/20260525_customer_invoice_lines_runtime_foundation.sql` for exactly those four fields, registers SHA-256 `5a40429f7370068f4ce588cb84e63f748920c922d4a9945d0c2266a4369341ef` in legacy-foundation additions and includes the artifact in deterministic foundation order. No invoice rows are seeded or rewritten, no live Supabase write occurs and no historical migration is edited.

Static provenance inputs for this new artifact have been checked directly: artifact SHA matches metadata, source migration is checksum-pinned in `migration-history-manifest.json`, and declared foundation/order contain the same path. Runner replay verification is currently externally blocked: GitHub Actions jobs do not start and GitHub annotates both jobs with `The job was not started because recent account payments have failed or your spending limit needs to be increased.` This is an account billing/spending-limit failure, not a code/test failure.

Next: continue static campaign rescan and dependency review without touching production. As soon as a runner is available, execute exact-HEAD `verify` + `clean-migration-replay`; continue only from a real SQL/check failure. Do not merge until the full replay/fingerprint and release gates are verified.
