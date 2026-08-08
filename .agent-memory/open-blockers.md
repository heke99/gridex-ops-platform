# Open blockers

Last updated: 2026-08-08T14:23:00Z

## Active remediation blocker

`GRIDEX-REM-002` clean empty-database replay is not green yet.

On last verified HEAD `e331041b1a724d659592cd04e7262495a1eb5bed`, first failure is missing `public.company_memberships.role_key` in `20260612123000_performance_batches_1_to_3_db_acceleration.sql:146`.

The checksum-bound single-column reconstruction is implemented but requires real PR #90 CI. The next failure, if any, remains unknown until that artifact is read.

## Resolved replay blockers

Pricing component rules, communication-log trace columns, external contract intakes, and customer-contract energy-resolution columns are each CI-confirmed to advance replay. NanoID production audit is also resolved and green.

## Merge blocker

PR #90 remains draft/unmerged until REM-002, final full rescan, all audit/remediation items and all final same-HEAD release gates are green.
