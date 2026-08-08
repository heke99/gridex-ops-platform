# Migration provenance

Date: 2026-08-08
Branch: `remediation/gridex-ops-full-integrity-performance`
Base: `5923b5c17fe96c0453048bdc102203efb65f7d7a`

## GRIDEX-REM-001

Status: IMPLEMENTED; remote verification pending.

The branch restores the two already-applied AUD-001 migration files under the exact versions present in the connected dev ledger, without mutating live migration history.

## GRIDEX-REM-002 — canonical clean replay

Severity: P1
Status: IMPLEMENTED / CI FAILED / NOT VERIFIED

Historical applied SQL remains immutable. Replay uses checksum-pinned narrow reconstruction artifacts, explicit source substitution and chronological interleaving where a skipped source historically sat between tracked migrations. No replay fix writes to live Supabase.

### Security dependency gate

Resolved. The transitive production NanoID path now resolves `nanoid 3.3.17`; `security:audit-production` remains enabled and passes on the verified remediation heads.

### Replay progression confirmed by CI

- `c627f810...` failed at `20260609100000` because `pricing_component_rules` was absent.
- `8e678aae...` confirmed that prerequisite fixed, then failed at `20260609183000` because `communication_logs.customer_number` was absent.
- `5212e454...` confirmed the Batch 8 prerequisite fixed, then failed at `20260611150000` because `external_contract_intakes` was absent.
- `1ac3e0d2...` confirmed the external-intake prerequisite fixed, then failed at `20260611170000_launch_readiness_completion_db_warnings_retention_bulk.sql:399` because `customer_contracts.price_area_used` was absent.

On `1ac3e0d2ec4893902ed2f1b2e228ffc6c83b1c1d`, `verify`, migration/provenance regression, targeted regressions and `security:audit-production` all PASS; only clean replay fails.

### Current root cause — customer contract energy-resolution fields

`20260611100000_energy_resolver_grid_area_operations.sql` is checksum-pinned and intentionally substituted by derived bootstrap content, so the source file itself is excluded from normal replay. Existing reconstruction restored its grid-owner/request relations but omitted its five additive `customer_contracts` fields:

- `requested_start_mode text not null default 'earliest_possible'` with source check constraint,
- `calculated_earliest_start_date date`,
- `price_area_used text`,
- `grid_area_code_used text`,
- `resolution_status text`.

The later billing readiness view in `20260611170000` references `cc.price_area_used`. Live `gridex-ops-dev` confirms all five source-defined columns with matching types/defaults.

### Current reconciliation

Add `supabase/bootstrap/20260611_customer_contract_energy_resolution_foundation.sql` as a second narrow derived artifact from the same immutable source. It only adds those five columns to the already-founded `customer_contracts` table and seeds no contracts or tenant/customer data.

Artifact SHA-256: `ae725b25b9abbfc8281c4ac1eda783886d214935834c436a4b59fdbbb26bd2ea`.

Status after implementation: `IMPLEMENTED_NOT_VERIFIED`; PR #90 CI must prove replay advances.

### Definition of VERIFIED

`GRIDEX-REM-002` remains open until full empty-database replay, final schema fingerprint, migration/provenance regression, production security audit and `verify` all pass on the same final HEAD. Only after that may the campaign proceed to final rescan/merge readiness.
