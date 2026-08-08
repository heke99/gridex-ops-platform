# Current task

Last updated: 2026-08-08T14:16:00Z
Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`

## Active finding

`GRIDEX-REM-002` — canonical migration lineage and deterministic empty-database replay.

Status: `IMPLEMENTED_NOT_VERIFIED`

## Last verified HEAD

`1ac3e0d2ec4893902ed2f1b2e228ffc6c83b1c1d`

All verify/security/provenance gates pass; clean replay fails.

## Exact current failure

- migration: `20260611170000_launch_readiness_completion_db_warnings_retention_bulk.sql`
- line: 399
- error: `column cc.price_area_used does not exist`
- relation: `public.customer_contracts`
- prerequisite: the five customer-contract energy-resolution fields from checksum-pinned source `20260611100000_energy_resolver_grid_area_operations.sql`

## Current implementation

Add `supabase/bootstrap/20260611_customer_contract_energy_resolution_foundation.sql`, register it as a checksum-bound derived artifact and include it in foundation order. The artifact adds only `requested_start_mode`, `calculated_earliest_start_date`, `price_area_used`, `grid_area_code_used`, and `resolution_status`; no rows are seeded and no live DB write occurs.

## Exact next action

Push and inspect PR #90 CI for the exact new HEAD. On clean-replay failure, use the new artifact's first SQL error as the next work unit. On clean-replay success, confirm schema fingerprint and all same-HEAD gates before marking REM-002 VERIFIED.
