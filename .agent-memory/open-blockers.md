# Open blockers

Last updated: 2026-08-09T09:05:00Z

## 1. GRIDEX-REM-002 final clean replay verification

`GRIDEX-REM-002` remains the active database release blocker until exact empty-database clean replay, Supabase CLI ledger verification, historical smoke gates and the schema fingerprint pass on the final same HEAD.

The latest real clean replay (HEAD `4cd7539d9da6d01e0fb493edef60a41bd2a0c9e9`) reached `20260728170000_live_schema_code_canonical_sync.sql` and failed first on missing `customer_invoice_lines.vat_rate`. The coherent checksum-pinned source family (`line_type`, `unit`, `vat_rate`, `sort_order`) has since been restored as `bootstrap/20260525_customer_invoice_lines_runtime_foundation.sql` and registered in both provenance metadata and deterministic foundation order. It is statically consistent but not yet replay-verified.

## 2. GitHub Actions account billing/spending limit

Current `verify`, `quality-release-gates` and `clean-migration-replay` jobs terminate before any step starts (`steps=null`). A manual rerun on the current remediation campaign behaved identically. GitHub previously annotated this condition as recent account payment failure / Actions spending-limit exhaustion. Therefore the red checks are infrastructure/account failures, not executed code/test failures.

## 3. Repository protection

GitHub reports `main` as unprotected. The installed GitHub connector exposes merge/ref operations but no branch-protection or ruleset write action. This repository release-control finding cannot be closed from the current connector surface.

## 4. Isolated database runner

The connected Supabase project has no existing development branch beyond default `main`. Creating a new branch is billable and requires explicit cost confirmation. The default/live database is not used for destructive empty-database replay.

## Implemented but awaiting final verification

- invoice-line replay prerequisite family (`line_type`, `unit`, `vat_rate`, `sort_order`);
- customer-document storage isolation forward RLS fix;
- log redaction and regression coverage;
- expanded quality release gates;
- grid-owner direct-first actor-join performance migration;
- production `ops-health` SQLSTATE 42702 remediation (`20260809110000_ops_health_status_qualification.sql`) and static regression.

Vercel 24-hour production observability currently shows only the `ops-health` 42702 error group; that exact defect is reproduced read-only in Supabase and remediated on the branch. No live Supabase schema/data write has been made during this continuation.

PR #90 remains draft/unmerged until the blockers above are genuinely closed and exact-final-HEAD release evidence is green.
