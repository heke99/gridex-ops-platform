# Current task

Last updated: 2026-08-02T18:56:00+02:00
Branch: UNVERIFIED (uploaded archive excludes `.git`)
Last verified commit: null

## Active phase

PHASE-40 — V2 emergency access lockdown and evidence-backed release triage.

## Verified locally

- Added and registered forward-only migration `20260802190000_canonical_emergency_access_lockdown.sql` with checksum `9f5071e87c0689feb84f8701cbbeef72f65fb1c227862fb1ba628da47bb40d43`.
- Added a static emergency-access regression and a read-only metadata postflight.
- Migration integrity passes for 339 files/243 version groups; emergency-access and RBAC regressions pass.
- Clean install, all three TypeScript targets, 62 files/417 tests, ESLint with 0 errors/125 inherited warnings, zero-vulnerability production audit and the full Next.js build pass on available Node 24.14.0; Node 22 parity remains required by `engines`.
- Reconciled the connected Supabase migration ledger: every local canonical version through `20260802180000` is registered remotely.
- Captured advisor and SQL evidence for the four unsafe views, four broadly executable mutating functions, two unprotected internal tables, unsafe defaults, legacy platform-admin policies and current data-quality blockers.
- Located the connected private GitHub repository and current `main` head without changing the repository.

- Added the registered forward-only convergence migration with request-payload-bound idempotency, actor authentication, last-owner/admin protection, actor-role-qualified Ediel profile identity, read-only readiness and least-privilege/RLS hardening.
- Verified complete A-C table/column/constraint/index/RLS/policy/trigger/grant and seed parity read-only against `gridex-ops-dev`; guarded A-C ledger repair is now authorized for that inspected project state.
- Corrected the convergence model so supplier and ESCO profiles coexist under `(company_id, environment, actor_role)` and profile writes never deactivate another role.
- Added assertion-guarded Gridex profile reconciliation SQL: obsolete 21660/test profile is deactivated, 92825/test and 21660/production remain canonical, and snapshot capture fail-closes stale live production.
- Routed company provisioning, lifecycle, production, first-send, profile and route writers through the canonical database boundary.
- Replaced temporary-password provisioning with verified Supabase invitation/OTP acceptance and no access before acceptance.
- Made unknown/missing roles and incomplete tenant context fail closed in the touched flows.
- PostgreSQL parser, every TypeScript target, 417 tests, 337-file/241-group migration integrity, hardening/security regressions, zero-vulnerability production audit and full Node 22 build pass.
- Added complete baseline, schema/ledger, RLS/security, preflight/backfill/quarantine, staging/rollback/cutover/verification documentation and a guarded synchronization script.
- Replaced both unsupported `min(uuid)` aggregates with deterministic text-cast UUID aggregation; the repaired preflight executed successfully read-only against the connected development project.

- Repaired the Ediel evidence migration against the actual `gridex-ops-dev` schema and transaction-compiled it with a confirmed rollback.
- Evidence pass/fail is server-derived from run, definition, snapshot, messages, portal identity, correlation, ACK outcome, transport and rulebook data.
- Replaced GUC-only pass protection with matching immutable attempt/evidence and approved two-person attestation checks.
- Added tenant-qualified child relations, fail-closed quarantine access, explicit actor-role mapping and service-role-resistant tenant constraints.
- Added atomic `WEBSITE_APPLICATION_COMMITTED` audit/domain/outbox projection from the durable workflow commit.
- Fixed all five TypeScript failures and upgraded vulnerable production dependencies.
- Clean Node 22 install, all TypeScript targets, 417 tests, static hardening regressions, migration integrity, production audit and full Next.js build pass.
- Lint remains 0 errors/126 warnings; all warnings are `@typescript-eslint/no-unused-vars` and none are security rules.

## Exact next action

Obtain explicit user approval for the documented emergency-lockdown blast radius. If approved, apply only `20260802190000` to `gridex-ops-dev`, immediately run `scripts/sql/05_emergency_access_lockdown_verification.sql`, rerun Supabase security advisors and real-role/JWT smoke tests, and stop on any application regression before later canonical/data work.

## Blockers

- Remote apply of the emergency access-control migration is not authorized; the safety review requires explicit approval because privileges, view semantics, RLS, an authorization helper and a trigger change persistently.
- Post-lockdown catalog, advisor, JWT, service-role and runtime proof cannot be claimed before that controlled apply.
- The V2 prompt requires phase ordering, so later write-path/data/UI mutations are intentionally paused at Phase 0 rather than claiming a skipped lockdown.

- The prior nine-version ledger blocker is superseded: the remote ledger now records all canonical versions through `20260802180000`.
- 153 legacy `ediel_test_runs` have no deterministic tenant owner and must remain quarantined/manual-review candidates.
- The duplicate supplier/test profile and missing-snapshot live state have a deterministic, assertion-guarded repair but it has not yet been applied.
- D–F, the website canonical-event migration and the convergence migration are not applied to staging.
- Authenticated two-tenant RLS, service-role cross-tenant, concurrency and full evidence-chain fixtures have not run after apply.
- External Gridex Web/portal/partner repositories and deployment targets were not supplied.
- Git provenance is absent.

## Release decision

NO-GO until emergency lockdown is explicitly approved, applied and verified, followed by deterministic cleanup and the remaining V2 database/runtime/UI/environment gates.
