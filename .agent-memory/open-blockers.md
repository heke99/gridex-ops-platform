# Open blockers

Last updated: 2026-08-08T14:32:00Z

## Active remediation blocker

`GRIDEX-REM-002` clean empty-database replay is not green yet.

On last verified HEAD `532573df73003d272230d7222553e493c03fda5d`, first failure is missing `public.company_memberships.membership_role` in `20260612123000_performance_batches_1_to_3_db_acceleration.sql:146` after the narrower `role_key` fix.

The checksum-bound 20260527 membership artifact is now broadened to the complete source-defined runtime column family, role/status checks and supporting indexes. It requires real PR #90 CI before closure.

## Resolved replay blockers

Pricing component rules, communication-log trace columns, external contract intakes, customer-contract energy-resolution columns, and the first membership `role_key` blocker have each been proven to move replay forward. NanoID production audit is resolved and green.

## Merge blocker

PR #90 remains draft/unmerged until REM-002, final full rescan, all audit/remediation items and final same-HEAD release gates are green.
