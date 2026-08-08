# Remediation handover — GRIDEX-REM-002

Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`
Last verified CI HEAD: `532573df73003d272230d7222553e493c03fda5d`

## Verified state

- `verify`: PASS.
- migration integrity/provenance regression: PASS.
- `security:audit-production`: PASS.
- `clean-migration-replay`: FAIL.
- REM-002 is not VERIFIED.

CI has confirmed five earlier reconstruction steps moved replay forward. The latest error is in `20260612123000...`: after restoring `company_memberships.role_key`, the same canonical helper fails because `membership_role` is absent.

Live dev and checksum-pinned `20260527_fix_company_user_invite_runtime_columns.sql` confirm the broader membership runtime family and matching role/status checks. The current artifact now reconstructs that complete source-defined family plus supporting indexes; no membership data is backfilled on the empty replay and no live DB write occurs.

## Next deterministic action

Push, inspect exact-HEAD PR #90 CI, and continue from the next replay artifact until clean replay and schema fingerprint pass. Then confirm all same-HEAD gates, mark REM-002 VERIFIED, run final campaign rescan, resolve all remaining audit items, and merge only when the complete release gate is green.
