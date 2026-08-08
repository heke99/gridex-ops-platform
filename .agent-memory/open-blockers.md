# Open blockers

Last updated: 2026-08-08T21:56:00Z

`GRIDEX-REM-002` remains the active database release blocker until exact empty-database clean replay, Supabase CLI ledger verification, historical smoke gates and the schema fingerprint pass on the final same HEAD.

The latest real clean replay (HEAD `4cd7539d9da6d01e0fb493edef60a41bd2a0c9e9`) reached `20260728170000_live_schema_code_canonical_sync.sql` and failed first on missing `customer_invoice_lines.vat_rate`. The coherent checksum-pinned source family (`line_type`, `unit`, `vat_rate`, `sort_order`) has now been restored as `bootstrap/20260525_customer_invoice_lines_runtime_foundation.sql` and registered in both provenance metadata and deterministic foundation order. This implementation is statically consistent but not yet replay-verified.

External infrastructure blocker: GitHub Actions currently refuses to start both `verify` and `clean-migration-replay`. The check annotation states: `The job was not started because recent account payments have failed or your spending limit needs to be increased.` Therefore the current red GitHub checks are account billing/spending-limit failures, not code/test failures. No equivalent isolated PostgreSQL runner or Supabase development branch is currently available, and production Supabase must not be used for destructive clean replay.

The customer application large-file split remains ordinary-CI proven and production modules are <=2500 lines. PR #90 remains unmerged until all final release gates are actually verified green.
