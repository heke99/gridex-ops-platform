# Gridex tenant-wide production E2E

This is the repeatable acceptance certificate for Gridex OPS. It is intentionally built on the same canonical paths and domain regressions used by the application instead of maintaining a second implementation of business logic inside tests.

## What must be proven for every tenant-capable release

The certificate covers the complete platform chain:

1. canonical tenant provisioning, onboarding defaults and tenant source-of-truth;
2. verified user invitation, role/access boundaries and tenant isolation;
3. lifecycle governance: active, paused, reactivated, closed and test-only tombstone states;
4. contract lifecycle, commercial selection, pricing, publication and legal/POA contracts;
5. website/customer intake, idempotency, review/continuation and tenant binding;
6. facility/metering-point preflight, missing-data blockers and manual recovery paths;
7. EDIEL route readiness, outbound send guards, inbound tenant resolution and ACK lifecycle;
8. metering values, multi-site mapping, billing underlays, invoices and automation idempotency;
9. customer portal/API behavior, messages/operations visibility and external API compatibility;
10. database migration/runtime readiness, RLS/RBAC, dependency security, lint/typecheck/tests and production build.

A green result is not a claim that one hard-coded tenant worked once. The runtime certificate creates brand-new tenant identities on every run and exercises canonical idempotency/lifecycle behavior. The static/full certificate separately proves that downstream domains remain tenant-aware and isolated.

## Suites

### Smoke

Run on every PR and every push to `main`:

```bash
node scripts/gridex-full-production-e2e.cjs --mode=smoke
```

The smoke suite is deliberately bounded for fast feedback while touching each major production boundary.

### Full

Run nightly and on demand:

```bash
node scripts/gridex-full-production-e2e.cjs --mode=full
```

This is the release certificate. It composes the authoritative Gridex regression suites for tenant, contracts, pricing/legal, customer intake, facility, EDIEL, metering, billing, portal/API, security and build quality.

### Fresh-tenant runtime

Run only against an isolated staging Supabase project:

```bash
GRIDEX_E2E_TARGET=staging \
GRIDEX_E2E_CONFIRM_STAGING=YES \
GRIDEX_E2E_ALLOW_MUTATION=YES \
GRIDEX_E2E_SUPABASE_URL=... \
GRIDEX_E2E_SUPABASE_SERVICE_ROLE_KEY=... \
GRIDEX_E2E_ACTOR_USER_ID=... \
node scripts/gridex-full-production-e2e.cjs --mode=runtime
```

The runtime journey performs:

- canonical tenant A provisioning and idempotent replay;
- activation through canonical lifecycle state/version handling;
- durable admin invitation creation and idempotent replay using an `example.invalid` recipient;
- canonical contract create/read/pricing/safe-delete roundtrip for that new tenant;
- pause and a negative write probe that must fail closed;
- reactivation and idempotent retry;
- terminal close and a forbidden reactivation probe;
- canonical tenant B provisioning followed by `pending_deletion -> deleted_test_only`.

It never hard-deletes operational history.

## Production safety model

Mutating E2E is staging-only. Three explicit environment opt-ins are required, and the runtime test refuses a production execution context. CI does not auto-repair code, auto-commit, or change production when a test fails. A failure is evidence: the failing domain, exact command, exit status and redacted log are recorded so the source defect can be fixed deliberately and the certificate rerun.

This matters because a test runner that edits production or commits speculative fixes would itself become a privileged production actor and could turn a test failure into an outage or data-corruption event.

## Evidence

Every orchestration run writes:

- `e2e-artifacts/gridex-e2e-report.md`
- `e2e-artifacts/gridex-e2e-report.json`
- `e2e-artifacts/gridex-e2e-junit.xml`
- `e2e-artifacts/logs/*.log`
- runtime mode also writes `e2e-artifacts/gridex-tenant-runtime-e2e.json`

Known service credentials and bearer/JWT-like values are redacted before logs are persisted. GitHub Actions uploads the evidence even when the suite fails.

## New tenant operating rule

Do not treat "tenant row exists" as production-ready. A new tenant must use the same canonical provisioning/lifecycle paths and must satisfy the platform's readiness blockers before website intake, API writes, outbound communications or EDIEL production traffic are allowed.

The runtime certificate proves that a fresh tenant can enter and leave the lifecycle correctly. The full certificate proves that the rest of the system still honors tenant boundaries. Tenant-specific route/certificate/email/API configuration remains data-driven readiness, not hard-coded E2E fixtures.

## Failure handling

When a step fails:

1. use the Markdown/JSON report to identify the domain and first broken contract;
2. inspect that step's redacted log;
3. repair the production source or migration that owns the invariant—do not weaken the assertion simply to make CI green;
4. add/extend the narrow regression that reproduces the defect;
5. rerun smoke, the affected domain regression and then full E2E;
6. if the defect affects tenant provisioning or isolation, rerun the fresh-tenant runtime certificate on staging before release.
