# Current state

Last updated: 2026-08-08T14:23:00Z

## Active remediation campaign

- Branch: `remediation/gridex-ops-full-integrity-performance`
- Draft PR: `#90`
- Baseline: `5923b5c17fe96c0453048bdc102203efb65f7d7a`
- Last verified CI HEAD: `e331041b1a724d659592cd04e7262495a1eb5bed`
- Active finding: `GRIDEX-REM-002` canonical migration lineage / empty-database replay.
- Lifecycle state: `IMPLEMENTED_NOT_VERIFIED`.

## Same-HEAD evidence

At `e331041b...`, `verify`, provenance/migration checks, typecheck, targeted regressions and `security:audit-production` all PASS. `clean-migration-replay` FAILS.

CI confirms the prior pricing-rules, communication-log, external-intake and customer-contract-energy reconstruction fixes all move replay forward.

## Current first failure

`20260612123000_performance_batches_1_to_3_db_acceleration.sql:146`

`ERROR: column cm.role_key does not exist`

Live dev confirms `company_memberships.role_key` exists; checksum-pinned source `20260527_fix_company_user_invite_runtime_columns.sql` adds it. Live `user_roles` does not have `role_key`, so no noncanonical column is added there.

Current work restores only `company_memberships.role_key` through a narrow derived bootstrap.

## Next deterministic action

Push, inspect PR #90 CI on the exact new HEAD, and continue from the next exact replay failure. REM-002 remains open until clean replay and schema fingerprint are green together with all verify/provenance/security gates on one final HEAD.
