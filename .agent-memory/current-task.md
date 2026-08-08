# Current task

Last updated: 2026-08-08T14:07:00Z
Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`

## Active finding

`GRIDEX-REM-002` — canonical migration lineage and deterministic empty-database replay.

Status: `IMPLEMENTED_NOT_VERIFIED`

## Last verified HEAD

`5212e454f7c8feca30732cd9d3122bd8eaf62728`

- `verify`: PASS
- provenance/migration integrity: PASS
- `security:audit-production`: PASS
- clean replay: FAIL

## Exact current failure

- migration: `20260611150000_launch_readiness_security_routes_stats.sql`
- line: 451
- statement: creation of `gridex_company_operations_statistics_v`
- error: `relation "public.external_contract_intakes" does not exist`
- prerequisite: source-defined pre-ledger `external_contract_intakes` table from `20260521_batch_2c_end_to_end_operations.sql`

## Current implementation

Add `supabase/bootstrap/20260521_external_contract_intakes_foundation.sql` after the RBAC helper foundation. It restores only the source table, initial constraint/idempotency uniqueness, base company/status index and source RLS policies. No rows are seeded and no live DB write is performed.

## Exact next action

Push this work unit, inspect PR #90 CI on the new HEAD, download the clean-replay artifact if it fails, and continue from its first exact SQL failure. Mark REM-002 VERIFIED only after all same-HEAD gates and schema fingerprint pass.
