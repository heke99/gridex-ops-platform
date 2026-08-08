# Remediation handover — GRIDEX-REM-002

Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`
Last verified CI HEAD: `e331041b1a724d659592cd04e7262495a1eb5bed`

## Verified state

- `verify`: PASS.
- migration integrity/provenance regression: PASS.
- `security:audit-production`: PASS.
- `clean-migration-replay`: FAIL.
- REM-002 is not VERIFIED.

CI has confirmed four prior reconstruction fixes advance replay.

Current exact failure: `20260612123000_performance_batches_1_to_3_db_acceleration.sql:146` -> `column cm.role_key does not exist`.

Canonical evidence: pre-ledger source `20260527_fix_company_user_invite_runtime_columns.sql` adds `company_memberships.role_key`; live dev contains that column. Live `user_roles` does not contain `role_key`, so no such column is introduced there.

Current implementation: narrow checksum-bound bootstrap restoring only `company_memberships.role_key`; no data backfill is required on empty replay and no live DB mutation occurs.

## Next deterministic action

Push, inspect exact-HEAD PR #90 CI, and continue from the next replay artifact until clean replay and schema fingerprint pass. Then verify all same-HEAD gates, mark REM-002 VERIFIED, run final campaign rescan, resolve any remaining audit items, and merge only when the complete release gate is green.
