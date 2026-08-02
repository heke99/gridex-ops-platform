# Canonical hardening preflight and backfill report

## Safety rules

- Historical migrations are not changed.
- Backfill is only performed when tenant ownership is exact and unambiguous.
- Ambiguous, missing or cross-tenant relations are inserted into `ediel_tenant_relation_quarantine`.
- `NOT VALID` constraints protect new writes immediately and are only validated when historical data is clean.
- No preflight query is allowed to infer a tenant from message family, code, creation order, email address or another non-unique attribute.

## New migrations, in apply order

1. `20260802010000_canonical_tenant_operation_policy_lifecycle.sql`
2. `20260802011000_canonical_ediel_production_state.sql`
3. `20260802012000_ediel_configuration_snapshots.sql`
4. `20260802013000_ediel_test_evidence_v2.sql`
5. `20260802014000_canonical_provisioning_access.sql`
6. `20260802015000_canonical_backfill_constraints.sql`

## Preflight checks

`canonical_run_hardening_preflight()` reports at least:

- test runs missing `company_id`;
- run-message relations missing `company_id`;
- cross-tenant run/message relations;
- conflicting Application Reference values;
- prepared/live production states without a configuration snapshot;
- constraints that could not yet be validated;
- companies with null, unknown or non-canonical lifecycle status.

Run:

```bash
export DATABASE_URL='postgresql://...'
npm run ops:canonical-production-preflight
```

The apply must stop before write cutover when any row is returned with `status = 'blocked'`.

## Backfill behavior

Safe backfills include:

- child test relation `company_id` from a run only when the linked message has the same non-null tenant;
- legacy production state into `ediel_production_state` as an initial compatibility projection;
- capability rows disabled by default, enabled only from explicit operational evidence;
- one-sided Application Reference values copied to the missing alias.

Not automatically backfilled:

- runs with no tenant;
- relations where run and message tenants differ;
- conflicting non-null Application Reference values;
- production readiness/dry run for a changed or unknown snapshot;
- owner/admin membership where Auth/profile state is missing or inactive.

## Required staging evidence

Before validating constraints and moving writes:

```sql
select * from public.canonical_run_hardening_preflight();
select * from public.ediel_tenant_relation_quarantine where resolved_at is null;
```

Every quarantined row requires an explicit reviewed resolution with `resolved_by`, `resolved_at` and `resolution_notes`. A zero-row result must be captured in the release evidence.

## Current local result

- Migration file integrity: **PASS** — 335 SQL files and checksums verified.
- Static migration contract: **PASS**.
- Actual staging preflight/backfill/apply: **NOT VERIFIED** — no staging database was available in this environment.
- Constraint validation against real historical rows: **NOT VERIFIED**.
