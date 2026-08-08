# Current task

Last updated: 2026-08-08T22:05:00Z
Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`

Active release blocker: `GRIDEX-REM-002` deterministic canonical empty-database replay.

Latest real clean-replay evidence is from HEAD `4cd7539d9da6d01e0fb493edef60a41bd2a0c9e9`. Replay advanced through the canonical history to `20260728170000_live_schema_code_canonical_sync.sql` and failed first because `customer_invoice_lines.vat_rate` was missing.

Canonical source tracing shows `line_type`, `unit`, `vat_rate` and `sort_order` are one runtime family in checksum-pinned `20260525_debug_fix_batch_1b_schema_code_alignment.sql`. Current branch restores those four fields through `bootstrap/20260525_customer_invoice_lines_runtime_foundation.sql`, with artifact SHA-256 `5a40429f7370068f4ce588cb84e63f748920c922d4a9945d0c2266a4369341ef`, registered in both legacy-foundation metadata and deterministic foundation order. Static provenance inputs are consistent; no live Supabase write and no historical migration edit.

Current exact PR HEAD: `e03800e36ba5e8b8d417791c2d9b44a8c37a83c0`.

External blocker: GitHub Actions hosted jobs do not start because the account reports failed recent payments or a spending-limit problem. Both `verify` and `clean-migration-replay` return `steps=null`; this is not a code failure. `main` is also currently unprotected and the installed GitHub connector exposes no branch-protection/ruleset write action.

While the runner is unavailable, continue bounded read-only/static audit closure. Do not mutate production Supabase. Do not mark REM-002 verified or merge until an isolated exact-HEAD replay/fingerprint and final release gates actually pass.
