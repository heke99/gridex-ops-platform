# Server and database performance

## Measured evidence

Direct `pg_stat_statements` and relation statistics from `gridex-ops-dev` identified:

| Query/flow | Calls | Mean execution | Status |
|---|---:|---:|---|
| `gridex_verified_grid_owners_v` full ordered PostgREST fetch signature | 310 | ~2,212.56 ms | Confirmed hotspot |
| Same view, second signature | 126 | ~2,114.95 ms | Confirmed hotspot |
| Same view, selected-column signature | 529 | ~510.93 ms | Confirmed hotspot |
| `gridex_complete_grid...` RPC signature | 55 | ~7,389.58 ms | Confirmed hotspot |
| `gridex_get_user_roles` RPC | 19,329 | ~35.35 ms | High-frequency permission lookup |
| User permission RPC signature | 12,366 | ~43.49 ms | High-frequency permission lookup |
| Geodata staging write RPC | 227,885 | ~2.95 ms | High volume; individually fast |
| Worker claim signature | 26,416 | ~6.73 ms | High volume; monitor contention/backlog |

These figures are development-workload observations, not production p95/p99.

## Relation profile

`energy_geodata_features_staging` is about 2.5 GB with ~228k rows and high index use. `masterdata_audit_log` (~145 MB/36k rows) and `audit_logs` (~66 MB/6.9k rows) have high storage per estimated row. `ediel_inbound_poll_runs` and `platform_actor_readiness_checks` showed no index scans in current statistics, but exact filter/query use must be captured before indexing.

## Server risks

- Repeated role and permission RPCs can amplify per-request work across layouts/routes.
- Customer application and portal sync orchestrate multiple domain writes and side effects; query count and transaction boundaries require tracing.
- External market, EDIEL, email, LDAP/IMAP and certificate calls need explicit timeout, retry, backoff and idempotency evidence.
- Cron/worker concurrency and duplicate job prevention were not load-tested.
- Large audit/geodata tables need retention, partition/archive and vacuum policy evidence.

## Safe investigation plan

1. Add request/operation spans with company-safe identifiers and query counts.
2. Capture exact grid-owner view/RPC SQL and representative parameters.
3. Run `EXPLAIN (ANALYZE, BUFFERS, WAL)` in isolated non-production.
4. Check row-estimate error, joins, sorts, functions, geometry operations and pagination.
5. Test targeted query rewrite/materialization/index changes one at a time.
6. Measure worker lock wait, queue backlog, retries and duplicate processing.
7. Define retention/partitioning for geodata and audit tables; avoid `VACUUM FULL` in live service.
8. Re-run authorization and two-tenant tests after any policy/query change.

## Finding classification

`GRIDEX-AUD-008` is confirmed Medium: the observed grid-owner operations are slow enough to affect admin/energy-resolution flows. The correct optimization is not yet proven.