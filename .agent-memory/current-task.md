# Current task

Last updated: 2026-08-08T13:58:00Z
Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`

## Active finding

`GRIDEX-REM-002` — canonical migration lineage and deterministic empty-database replay.

Status: `IMPLEMENTED_NOT_VERIFIED`

## Last verified HEAD

`8e678aaee387ffb15bc68072e48dc141e8947090`

- `verify`: PASS
- provenance/migration integrity: PASS
- `security:audit-production`: PASS
- clean replay: FAIL

## Exact current failure

- migration: `20260609183000_batch_8_admin_operations_website_email_webhooks.sql`
- line: 67
- statement: create index over `public.communication_logs(company_id, customer_number, created_at desc)`
- error: `column "customer_number" does not exist`
- prerequisite: 7D communication-log trace additions from `20260609162000_batch_7_website_integration_foundation.sql`

## Current implementation

Add `supabase/bootstrap/20260609_communication_log_trace_foundation.sql` containing only the source-defined 7D columns and source customer-number index. Register it as a checksum-bound derived artifact and interleave it after `20260609143000` and before `20260609183000` so the base `communication_logs` table already exists.

No rows are seeded. No historical migration is edited. No live DB write is performed.

## Exact next action

Push this work unit and inspect PR #90 CI on the new HEAD. Continue replay failure-by-failure until the full clean replay passes; then verify all same-HEAD gates before marking `GRIDEX-REM-002` VERIFIED.
