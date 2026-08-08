# Current task

Last updated: 2026-08-08T14:23:00Z
Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`

## Active finding

`GRIDEX-REM-002` — canonical migration lineage and deterministic empty-database replay.

Status: `IMPLEMENTED_NOT_VERIFIED`

## Last verified HEAD

`e331041b1a724d659592cd04e7262495a1eb5bed`

All verify/security/provenance gates pass; clean replay fails.

## Exact current failure

- migration: `20260612123000_performance_batches_1_to_3_db_acceleration.sql`
- line: 146
- error: `column cm.role_key does not exist`
- relation: `public.company_memberships`
- source: checksum-pinned pre-ledger `20260527_fix_company_user_invite_runtime_columns.sql`

## Current implementation

Add `supabase/bootstrap/20260527_company_memberships_role_key_foundation.sql` containing only `company_memberships.role_key text`, register it as derived bootstrap and include it in foundation order. Empty replay has no membership rows to backfill. Do not add `user_roles.role_key` because live canonical schema does not contain it.

## Exact next action

Push and inspect PR #90 CI for the new HEAD. Use the next clean-replay artifact's first exact SQL error if it fails. On clean-replay success, confirm schema fingerprint plus all same-HEAD gates before marking REM-002 VERIFIED.
