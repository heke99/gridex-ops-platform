# Current state

Last updated: 2026-08-08T14:32:00Z

## Active remediation campaign

- Branch: `remediation/gridex-ops-full-integrity-performance`
- Draft PR: `#90`
- Baseline: `5923b5c17fe96c0453048bdc102203efb65f7d7a`
- Last verified CI HEAD: `532573df73003d272230d7222553e493c03fda5d`
- Active finding: `GRIDEX-REM-002` canonical migration lineage / empty-database replay.
- Lifecycle state: `IMPLEMENTED_NOT_VERIFIED`.

## Same-HEAD evidence

At `532573df...`, `verify`, provenance/migration checks, typecheck, targeted regressions and `security:audit-production` all PASS. `clean-migration-replay` FAILS.

The latest failure is `20260612123000_performance_batches_1_to_3_db_acceleration.sql:146`, where `company_memberships.membership_role` is missing after the prior single-column `role_key` fix.

The current work broadens the same checksum-bound 20260527 reconstruction to the complete source-defined `company_memberships` runtime family, role/status constraints and supporting indexes. Live dev confirms that canonical shape; no `user_roles.role_key` is added because live schema does not contain it.

## Next deterministic action

Push this work unit, inspect PR #90 CI on the exact new HEAD, and continue from the next exact replay failure. REM-002 remains open until clean replay, schema fingerprint and all verify/provenance/security gates pass on one final HEAD.
