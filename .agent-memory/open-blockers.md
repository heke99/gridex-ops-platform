# Open blockers

Last updated: 2026-08-08T14:07:00Z

## Active remediation blockers

1. `GRIDEX-REM-002` clean empty-database replay is not green yet.
2. On last verified HEAD `5212e454f7c8feca30732cd9d3122bd8eaf62728`, the first failure is missing `public.external_contract_intakes` in `20260611150000_launch_readiness_security_routes_stats.sql:451`.
3. The checksum-bound pre-ledger external-intake foundation is implemented but requires real PR #90 CI before this failure can be closed.
4. The next replay failure, if any, is intentionally unknown until that CI artifact is read.

## Resolved blockers

- `pricing_component_rules` prerequisite: CI-confirmed advanced beyond `20260609100000`.
- `communication_logs.customer_number`/7D trace prerequisite: CI-confirmed advanced through the Batch 8 migration area.
- NanoID production advisory: resolved at `nanoid 3.3.17`; same-HEAD verify/security passes.

## Remaining campaign work

After `GRIDEX-REM-002` is VERIFIED on one final HEAD, continue directly with database/code consistency, tenancy/RLS/RBAC, flows, concurrency/idempotency, database and application performance, cache/rate limits, security, API/OpenAPI, large-file remediation and the final full rescan.
