# Current task

Last updated: 2026-08-02T14:45:37+02:00
Branch: UNVERIFIED (uploaded archive excludes `.git`)
Last verified commit: null

## Active phase

PHASE-39 — Canonical security convergence, verified invitations and guarded staging synchronization.

## Verified locally

- Added the registered forward-only convergence migration with request-payload-bound idempotency, actor authentication, last-owner/admin protection, explicit Ediel profile identity, read-only readiness and least-privilege/RLS hardening.
- Routed company provisioning, lifecycle, production, first-send, profile and route writers through the canonical database boundary.
- Replaced temporary-password provisioning with verified Supabase invitation/OTP acceptance and no access before acceptance.
- Made unknown/missing roles and incomplete tenant context fail closed in the touched flows.
- PostgreSQL parser, every TypeScript target, 417 tests, 337-file/241-group migration integrity, hardening/security regressions, zero-vulnerability production audit and full Node 22 build pass.
- Added complete baseline, schema/ledger, RLS/security, preflight/backfill/quarantine, staging/rollback/cutover/verification documentation and a guarded synchronization script.

- Repaired the Ediel evidence migration against the actual `gridex-ops-dev` schema and transaction-compiled it with a confirmed rollback.
- Evidence pass/fail is server-derived from run, definition, snapshot, messages, portal identity, correlation, ACK outcome, transport and rulebook data.
- Replaced GUC-only pass protection with matching immutable attempt/evidence and approved two-person attestation checks.
- Added tenant-qualified child relations, fail-closed quarantine access, explicit actor-role mapping and service-role-resistant tenant constraints.
- Added atomic `WEBSITE_APPLICATION_COMMITTED` audit/domain/outbox projection from the durable workflow commit.
- Fixed all five TypeScript failures and upgraded vulnerable production dependencies.
- Clean Node 22 install, all TypeScript targets, 417 tests, static hardening regressions, migration integrity, production audit and full Next.js build pass.
- Lint remains 0 errors/126 warnings; all warnings are `@typescript-eslint/no-unused-vars` and none are security rules.

## Exact next action

Run only the guarded dry-run plan. Reconcile every A-C table, constraint, index, policy, trigger, function and grant before ledger repair. Resolve the 153 unscoped runs, duplicate active profile group and missing production snapshot in isolated staging without guessing; then apply D-F, `20260802160000` and `20260802170000`, and run the full DB/JWT/RLS/concurrency/worker verification protocol.

## Blockers

- Remote ledger contains only nine recorded versions while parts of A–C exist in schema; exact definition/ledger parity is not yet proven.
- 153 legacy `ediel_test_runs` have no deterministic tenant owner and must remain quarantined/manual-review candidates.
- One duplicate active actor-profile group and one prepared/live production state without a snapshot require explicit staging remediation.
- D–F, the website canonical-event migration and the convergence migration are not applied to staging.
- Authenticated two-tenant RLS, service-role cross-tenant, concurrency and full evidence-chain fixtures have not run after apply.
- External Gridex Web/portal/partner repositories and deployment targets were not supplied.
- Git provenance is absent.

## Release decision

NO-GO until exact ledger/schema reconciliation, deterministic staging cleanup, controlled apply and environment regressions are green.
