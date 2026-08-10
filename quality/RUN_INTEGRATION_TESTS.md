# Integration Test Protocol: Gridex OPS remediation

## Working directory and safety

Run from the repository root. Do not edit source during evidence collection. Test writes are allowed only in an explicitly identified disposable/local database or in the approved dev project with uniquely prefixed fixtures and cleanup. Never infer production from dev.

## Pre-flight

- Confirm Node 22, npm dependencies and generated environment validation.
- Identify Supabase project/environment; require explicit test tenant IDs before live writes.
- Confirm migration ledger/read-only catalog access and whether Docker/local Supabase is available.
- Run npm run typecheck, npm run db:migrations:check and the focused functional suite.
- Record source provenance; if .git is absent, label the archive fingerprint instead of inventing a SHA.

## Field reference table

These names are copied from current public mapper/contract sources and must be refreshed immediately before execution.

| DTO | Required public identity fields | Forbidden boundary |
|---|---|---|
| Customer | customer_reference, customer_number | customer_id, company_id, portal_identity_id |
| Facility | facility_reference, facility_id | site_id, customer_site_id |
| MeteringPoint | metering_point_reference, facility_reference, metering_point_id | internal id/FKs |
| Invoice | invoice_reference, invoice_number | id, company_id, customer_id |
| Contract | contract_reference, contract_number | id, company_id, contract_id |
| Event | event_reference, event_type, event_version, occurred_at | raw event/job/workflow IDs |
| Webhook envelope | event, event_version, delivery_reference, occurred_at, data | subscription/event/internal IDs |
| Error | request_id, correlation_id, contract_version, error, retryable | cross-tenant existence diagnostics |

## Test matrix

| # | Check | Method | Pass criteria |
|---:|---|---|---|
| 1 | Runtime/OpenAPI responses | Invoke representative route handlers with realistic Supabase fixtures and validate exact schemas | All successes/errors validate; no forbidden key/value |
| 2 | 1,001-row keysets | Seed invoices, events and one additional resource with timestamp ties; traverse cursors | Exact seed identity set, stable order, no duplicates/loss |
| 3 | Direct invoice detail | Place target after 1,000 newer rows and query by public reference | One tenant-bound lookup; tenant B/unknown both neutral 404 |
| 4 | Schema failure truth | Inject missing relation/column/RPC for list path | Canonical retryable 503, never empty 200 |
| 5 | Idempotent writes | Same/different body, concurrent claims and two tenants | exact replay, conflict without mutation, tenant isolation |
| 6 | Atomic auth/rate/identity | Exercise read/write/expensive, revoke/expire and ambiguous identities | weighted cost, one RPC, fail closed, no first match |
| 7 | Webhook isolation/rotation | Two tenants, same event, active/previous secrets and retry worker | cross-secret failure, bounded rotation, distinct delivery state |
| 8 | Migration reconstruction | Empty DB replay plus catalog/checksum comparison | source reconstructs connected dev signatures/indexes/constraints/RLS |
| 9 | Historical regressions | Run PlatformSchemaNotReady, SVK, quote, inbound, outbox, invoice retry, reconciliation and health suites | all named incidents remain green |
| 10 | Build/release artifacts | Run API docs/generation, type, lint, tests, security and build | deterministic artifacts and all required gates pass |

## Automated commands

Run focused tests first: npx vitest run quality/test_functional.test.ts quality/test_regression.test.ts. Then run package scripts for API docs, migration integrity, typecheck, lint, full tests and build. Execute SQL isolation/replay scripts only when their required environment variables identify a disposable environment.

## Post-run verification depth

For each check record process exit, terminal state, parsed response/data, exact content assertions, quality gate result and—where applicable—UI/manual review. Save details to quality/results/2026-08-10-integration.md with timing, environment, fixture IDs and cleanup status.

## Manual/externally blocked checks

GitHub required-check enforcement, Vercel deployed SHA, production Supabase catalog/auth settings, production latency and legal retention approval require their connected systems/owners. Record BLOCKED with the missing authority; do not skip silently.
