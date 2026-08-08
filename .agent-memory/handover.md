# Remediation handover — GRIDEX-REM-002

Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`
Last verified CI HEAD: `1ac3e0d2ec4893902ed2f1b2e228ffc6c83b1c1d`

## Verified state

- `verify`: PASS.
- migration integrity/provenance regression: PASS.
- `security:audit-production`: PASS.
- `clean-migration-replay`: FAIL.
- REM-002 is not VERIFIED.

## Replay progression

CI has confirmed fixes for missing `pricing_component_rules`, `communication_logs` 7D trace fields, and `external_contract_intakes` all advance the empty-database replay.

Current exact failure:

`20260611170000_launch_readiness_completion_db_warnings_retention_bulk.sql:399` -> `column cc.price_area_used does not exist`.

The skipped source `20260611100000_energy_resolver_grid_area_operations.sql` defines five `customer_contracts` energy-resolution fields. Live dev confirms them with matching types/defaults. The current implementation restores only those five fields through a checksum-bound derived bootstrap; no rows are seeded and no live DB mutation occurs.

## Next deterministic action

1. Push the current work-unit commit.
2. Read PR #90 CI for that exact HEAD.
3. If replay fails, download the artifact and remediate its first SQL failure.
4. Repeat until replay succeeds and schema fingerprint passes.
5. Confirm verify/provenance/security on the same final HEAD.
6. Then mark REM-002 VERIFIED, run the remaining campaign rescan, and merge only if all release gates remain green.
