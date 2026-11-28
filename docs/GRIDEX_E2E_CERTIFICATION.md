# Gridex E2E production certificate

The Gridex E2E suite is a release certificate for the complete OPS platform. It must validate code, database migrations, tenant isolation, public/internal API boundaries and the end-to-end electricity business chain instead of treating HTTP success alone as proof.

## Runner modes

- `smoke`: fast release guard on pull requests. Includes whole-project surface inventory, migrations, tenancy, intake, EDIEL, metering, billing, portal/API, RBAC and typecheck.
- `full` runs the smoke checks and adds database drift and readiness, contracts, legal and power of attorney, facility workflows, EDIEL ACK and message guards, automation, communications, OpenAPI compatibility and runtime parity, dependency audit and a production build.
- `runtime`: mutating fresh-tenant staging journey. Requires explicit staging opt-ins and uses lifecycle tombstones instead of hard deleting operational history.
- `real`: read-only persistent real-test-customer graph check using protected GitHub staging secrets. It refuses production and refuses outbound traffic.
- `all` on the local CLI combines the checks from `full`, `runtime` and `real`. The staging checks require their environment and fixture configuration.

## GitHub Actions jobs and evidence

The **Gridex full E2E** workflow chooses jobs by event and, for manual runs, by the selected mode. [Workflow definition](../.github/workflows/full-e2e.yml)

| Trigger | Selected mode | Eligible jobs |
| --- | --- | --- |
| Manual | `smoke` | `smoke` |
| Manual | `full` | `full` |
| Manual | `runtime` | `runtime-staging` |
| Manual | `real` | `real-customer-staging` |
| Manual | `all` | `full`, `runtime-staging`, `real-customer-staging`, `manual-all-evidence` |
| Pull request | — | `smoke`, `coverage`, `pr-certificate` |
| Push to `main` | — | `coverage`, `full` |
| Schedule | — | `full`, `runtime-staging`, `real-customer-staging`, `nightly-release-certificate` |

The `manual-all-evidence` job checks the three job outcomes and the current-attempt execution receipts against the producer and consumer repository and ID, event commit, checkout tree, attempt and file hashes. `MANUAL_GATES_PASSED` applies to those three jobs. The receipt lists separate jobs whose evidence must be collected on the release candidate. Its `full` runner includes the smoke checks. The standalone smoke job, V8 coverage and each release certificate have their own job results and artifacts under the conditions above.

| Job | Uploaded artifact |
| --- | --- |
| `smoke` | `gridex-e2e-smoke-<run-id>` |
| `coverage` | `gridex-coverage-<run-id>` |
| `pr-certificate` | `gridex-pr-release-certificate-<run-id>` |
| `full` | `gridex-e2e-full-<run-id>` |
| `runtime-staging` | `gridex-e2e-runtime-<run-id>` |
| `real-customer-staging` | `gridex-e2e-real-customer-<run-id>` |
| `nightly-release-certificate` | `gridex-nightly-release-certificate-<run-id>` |
| `manual-all-evidence` | `gridex-manual-all-run-evidence-<run-id>-<run-attempt>` |

For manual `all`, the three producer artifact names shown above append `-<run-attempt>`. Rerunning only the certificate or only a subset of producers leaves the new certificate incomplete when any producer has evidence from a previous attempt. To obtain three current receipts, rerun all jobs or start a new manual `all` run.

Collect the job conclusions and artifacts required for the release on the same candidate commit. For each runner artifact, match the checked-out commit and tree in `gridex-executed-evidence.json` and verify its report. Check the applicable release certificate alongside the runner evidence. Record each skipped job or missing artifact as an open evidence item.

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

- `GRIDEX_E2E_STAGING_PROJECT_REF`: the approved isolated project ref. The Supabase URL must match its hosted HTTPS origin. The production project is refused before any database request.

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
