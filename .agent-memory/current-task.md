# Current task

Last updated: 2026-08-02T16:30:00+02:00
Branch: UNVERIFIED (uploaded archive excludes `.git`)
Last verified commit: null

## Active phase

PHASE-39 — Canonical security convergence, verified invitations and guarded staging synchronization.

## Verified locally

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

Run the supplied safe preflight, guarded A-C ledger repair and deterministic Gridex profile reconciliation in isolated staging. Then review/apply D-F, `20260802160000` and the corrected `20260802170000`, quarantine the 153 unscoped runs without assigning a tenant, and run the full DB/JWT/RLS/concurrency/worker verification protocol.

## Blockers

- Remote ledger still contains only nine recorded versions; exact A-C parity is proven but the guarded ledger repair has not yet been executed.
- 153 legacy `ediel_test_runs` have no deterministic tenant owner and must remain quarantined/manual-review candidates.
- The duplicate supplier/test profile and missing-snapshot live state have a deterministic, assertion-guarded repair but it has not yet been applied.
- D–F, the website canonical-event migration and the convergence migration are not applied to staging.
- Authenticated two-tenant RLS, service-role cross-tenant, concurrency and full evidence-chain fixtures have not run after apply.
- External Gridex Web/portal/partner repositories and deployment targets were not supplied.
- Git provenance is absent.

## Release decision

NO-GO until exact ledger/schema reconciliation, deterministic staging cleanup, controlled apply and environment regressions are green.
