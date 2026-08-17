# Gridex E2E production certificate

The Gridex E2E suite is a release certificate for the complete OPS platform. It must validate code, database migrations, tenant isolation, public/internal API boundaries and the end-to-end electricity business chain instead of treating HTTP success alone as proof.

## Modes

- `smoke`: fast release guard on pull requests. Includes whole-project surface inventory, migrations, tenancy, intake, EDIEL, metering, billing, portal/API, RBAC and typecheck.
- `full`: nightly/main release certificate. Adds database drift/readiness, contracts, legal/POA, facility workflows, EDIEL ACK/inbound/outbound guards, automation, communications, OpenAPI compatibility/runtime parity, dependency audit and production build.
- `runtime`: mutating fresh-tenant staging journey. Requires explicit staging opt-ins and uses lifecycle tombstones instead of hard deleting operational history.
- `real`: read-only persistent real-test-customer graph check using protected GitHub staging secrets. It refuses production and refuses outbound traffic.
- `all`: local/manual orchestration of all four layers when all required secrets are available.

## Whole-project coverage gate

`scripts/gridex-whole-project-e2e-coverage.cjs` inventories the repository on every smoke run. It fails closed when:

- an API route appears under an unclassified top-level `app/api` namespace;
- database migrations disappear or duplicate filenames are introduced;
- the E2E orchestrator loses a required domain gate;
- the orchestrator references a missing package script or node test file when detected;
- a critical changed API namespace is not classified.

The gate emits `e2e-artifacts/gridex-whole-project-coverage.json` with route, migration and critical-diff inventory. New critical surfaces must therefore be classified before a release can become green.

## Persistent real test customer

`scripts/gridex-real-customer-e2e.mjs` uses a real authorized staging test customer without storing PII or fixture identifiers in Git. Required GitHub secrets:

- `GRIDEX_E2E_SUPABASE_URL`
- `GRIDEX_E2E_SUPABASE_SERVICE_ROLE_KEY`
- `GRIDEX_E2E_REAL_COMPANY_ID`
- `GRIDEX_E2E_REAL_CUSTOMER_ID`

Optional protected fixture secrets strengthen reverse-link verification:

- `GRIDEX_E2E_REAL_SITE_ID`
- `GRIDEX_E2E_REAL_CONTRACT_ID`
- `GRIDEX_E2E_REAL_CUSTOMER_NUMBER`

Repository variables:

- `GRIDEX_E2E_REAL_REQUIRE_LEGAL`: set `NO` only while the fixture is intentionally before legal completion. Default behavior requires legal acceptances and a power of attorney.
- `GRIDEX_E2E_REAL_REQUIRE_BILLING`: set `YES` once the persistent fixture is expected to have billing underlays and invoices.

The real-customer certificate is deliberately read-only. It checks customer -> site/contract/legal/billing links and their tenant/customer back-references. Artifacts store only counts and SHA-256 fingerprints of protected IDs. Raw rows are never serialized.

## Outbound safety

Real-customer E2E sets `GRIDEX_E2E_ALLOW_OUTBOUND=NO` and the script refuses to start if outbound is enabled. Real EDIEL/email dispatch must be tested only through a separately authorized controlled integration exercise; it is never implicit in routine CI.

## Failure classification

The main runner classifies failed gates as:

- `stale_regression_or_uncovered_surface`
- `database_or_migration_drift`
- `environment_or_external_dependency`
- `code_or_workflow_defect`

The classification is evidence for triage; it never converts a failed gate into a pass.

## Release rule

Gridex is not considered production-certified because one request returned `200`. A release is green only when the relevant static/full gates pass, tenant/database boundaries remain correct, and staging runtime/real-customer certificates pass whenever their protected fixtures are configured for the release.
