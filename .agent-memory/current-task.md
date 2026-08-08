# Current task

Last updated: 2026-08-08T14:32:00Z
Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`

## Active finding

`GRIDEX-REM-002` — canonical migration lineage and deterministic empty-database replay.

Status: `IMPLEMENTED_NOT_VERIFIED`

## Last verified HEAD

`532573df73003d272230d7222553e493c03fda5d`

All verify/security/provenance gates pass; clean replay fails.

## Exact current failure

- migration: `20260612123000_performance_batches_1_to_3_db_acceleration.sql`
- line: 146
- error: `column cm.membership_role does not exist`
- relation: `public.company_memberships`
- source family: checksum-pinned `20260527_fix_company_user_invite_runtime_columns.sql`

## Current implementation

Broaden `supabase/bootstrap/20260527_company_memberships_role_key_foundation.sql` to reconstruct the source-defined company membership runtime columns used by canonical RBAC helpers, plus the source role/status constraints and supporting indexes. Empty replay has no membership rows to backfill. Do not add `user_roles.role_key`, which is absent live.

## Exact next action

Push and inspect PR #90 CI for the new HEAD. Use the next clean-replay artifact's first exact SQL error if it fails. On clean-replay success, confirm schema fingerprint plus all same-HEAD gates before marking REM-002 VERIFIED.
