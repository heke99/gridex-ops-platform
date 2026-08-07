# Supabase Performance Advisor

Project checked: `gridex-ops-dev`.

## Method

Advisor signals were compared with current `pg_class`, `pg_policies`, `pg_indexes`, relation statistics and `pg_stat_statements`. No index was removed and no destructive maintenance was run.

## Advisor categories

| Category | Current classification | Evidence / action |
|---|---|---|
| `auth_rls_initplan` | Confirmed category, row-by-row priority not fully enumerated | 3,866 policies make repeated auth helper evaluation material. Prefer scalar subqueries only where semantics and tests remain identical. |
| Multiple permissive policies | Confirmed category | Overlapping policies can increase planning/evaluation cost and hide authorization intent. Consolidate only after role-matrix proof. |
| Unused indexes | Signal only | Observation window is insufficient; do not drop without workload history, write cost and query plans. |
| Duplicate/unindexed findings for `notifications`, `suppliers`, `application_staging`, `contacts` | False positive/stale | These relations do not exist in current catalog. |
| Missing/supporting FK indexes on current tables | Requires per-query validation | Add only after exact query and `EXPLAIN (ANALYZE, BUFFERS)` in non-production. |

## Direct measured hotspots

- `gridex_verified_grid_owners_v`: observed PostgREST signatures average roughly 0.5 to 2.2 seconds, including 310 calls at ~2.21 seconds and 126 calls at ~2.11 seconds.
- A `gridex_complete_grid...` RPC signature: 55 calls averaging ~7.39 seconds.
- User role lookup RPC: 19,329 calls averaging ~35 ms.
- User permission lookup RPC: 12,366 calls averaging ~43 ms.
- Geodata staging write RPC: 227,885 calls averaging ~2.95 ms.

## Storage/volume signals

| Relation | Total size | Estimated live rows | Observation |
|---|---:|---:|---|
| `energy_geodata_features_staging` | ~2,557 MB | ~227,885 | Largest table; high index use; retention/partition lifecycle must be explicit. |
| `masterdata_audit_log` | ~145 MB | ~35,984 | High bytes/row; payload and retention review needed. |
| `audit_logs` | ~66 MB | ~6,902 | Same concern. |
| `ediel_inbound_poll_runs` | ~22 MB | ~23,578 | Current stats showed no index scans; verify dominant filters. |
| `spot_price_intervals` | ~21 MB | ~38,016 | High index usage. |
| `platform_actor_readiness_checks` | ~17 MB | ~32,480 | Current stats showed no index scans; assess retention/query pattern. |

## Safe optimization protocol

1. Capture exact SQL and representative parameters.
2. Run `EXPLAIN (ANALYZE, BUFFERS)` in isolated non-production.
3. Record baseline time, rows, estimates, buffers, locks and call frequency.
4. Change the narrowest query/index/policy component without weakening tenant scope.
5. Re-run identical tests and compare outside normal variance.
6. Keep only proven improvements; use `CREATE INDEX CONCURRENTLY` where production rollout requires it.

Advisor raw count is not reported as live finding count because the response contains duplicates and stale object names. Verified performance findings are tracked by category and measured query signatures.