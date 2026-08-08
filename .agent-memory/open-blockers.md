# Open blockers

Last updated: 2026-08-08T14:16:00Z

## Active remediation blocker

`GRIDEX-REM-002` clean empty-database replay is not green yet.

On last verified HEAD `1ac3e0d2ec4893902ed2f1b2e228ffc6c83b1c1d`, the first failure is missing `public.customer_contracts.price_area_used` in `20260611170000_launch_readiness_completion_db_warnings_retention_bulk.sql:399`.

The checksum-bound five-column customer-contract energy-resolution reconstruction is implemented but requires real PR #90 CI before this failure can be closed. The next replay failure, if any, is intentionally unknown until that CI artifact is read.

## Resolved replay blockers

- `pricing_component_rules`: CI-confirmed fixed.
- `communication_logs` 7D trace columns: CI-confirmed fixed.
- `external_contract_intakes`: CI-confirmed fixed.
- NanoID production advisory: resolved at `nanoid 3.3.17`; verify/security gates pass.

## Merge blocker

PR #90 must remain draft/unmerged until REM-002, the final full rescan, all release gates and the final same-HEAD CI are green.
