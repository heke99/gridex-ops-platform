# Gridex Tenant Execution Reference

## Modes

### `single_tenant`

Use whenever the user explicitly identifies one tenant/company.

Invariant:

`requested tenant == resolved tenant == fixture owner == API client/company scope == persisted company_id == event/outbox owner == final read-back tenant`

No other tenant may receive business-flow mutations.

The execution order is:

`global gates once -> tenant baseline -> capability map -> P0 entry-to-terminal journeys -> fix/rerun loop -> P1 -> cleanup -> tenant verdict`

The multi-company comparison scenario is `NOT_APPLICABLE` in strict single-tenant mode unless the user explicitly adds an isolation comparison request.

### `all_eligible_tenants`

Use when the user explicitly asks for all tenants or the project default applies with no narrower request.

Execution is serial by tenant for business flows:

`tenant A complete -> cleanup/verdict -> tenant B complete -> ...`

Shared release gates run once. A shared-core fix may require already-tested tenants to be rerun if their previously proven paths are affected.

## Capability classification

For each tenant and scenario:

- `PASS`: enabled/expected flow executed and terminal business result was proven.
- `FAIL`: flow is enabled/expected and executes incorrectly.
- `BLOCKED`: flow is expected but required tenant configuration, credential, external sandbox, readiness, or access is missing.
- `NOT_APPLICABLE`: capability is intentionally disabled/not part of this tenant's product configuration.
- `NOT_RUN`: no execution occurred; never infer success.

Do not classify an enabled but failing capability as NOT_APPLICABLE.

## Canonical discovery

Prefer the current database schema and implementation over names remembered from previous runs.

Gridex currently models tenant identity/readiness through canonical company and capability/readiness data. Resolve fields and views dynamically and fail closed if the schema has changed materially.

## Fix scope

A defect fix must preserve multi-tenant correctness even during single-tenant execution.

After a fix:
- rerun the failed scenario from the beginning;
- rerun neighboring regressions;
- rerun selected-tenant P0 for changes to shared auth, tenant scoping, intake orchestration, communication, routing, event/outbox, database helpers, or API serialization;
- in all-tenant mode, rerun previously passed tenants if the shared change can alter their proven behavior.

Never hardcode a tenant ID/name into production logic to make a test pass.
