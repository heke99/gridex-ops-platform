# Canonical hardening delivery

Date: 2026-08-02 (V2 continuation)
Target inspected: Supabase project `gridex-ops-dev` (`piidsfebjqjmnepdpnas`)
Release decision: **NO-GO**

## Previously delivered and now registered remotely

- Registered forward-only migration `20260802170000_canonical_security_convergence.sql`.
- Actor-authenticated canonical lifecycle, production, first-send, profile and provisioning RPC boundaries.
- Request-payload-bound idempotency and first-live-send single-use enforcement.
- Explicit Ediel profile identity, read-only canonical readiness and least-privilege/RLS hardening.
- Verified invitation flow without temporary passwords or pre-verification tenant access.
- Runtime writers routed through canonical database boundaries and ambiguous roles made fail-closed.
- Baseline, schema/ledger reconciliation, tenant/RLS/security inventories, preflight, backfill,
  quarantine, dependency, staging, rollback, cutover and verification reports.
- Guarded sync script that refuses production-labelled targets and blocks ledger repair/apply until
  explicit parity and staging approvals are supplied.

## V2 emergency delta prepared locally

- `20260802190000_canonical_emergency_access_lockdown.sql`.
- Static emergency-access regression and read-only postflight SQL.
- Actual remote inventory proving the view/RPC/default-ACL/system-table/helper
  exposures still exist after `20260802180000`.
- Current Security and Performance Advisor baseline.

Remote apply status: **BLOCKED / NOT APPLIED** pending explicit blast-radius
approval. The connected database was not mutated in this continuation.

## Local evidence

| Gate | Result |
|---|---|
| PostgreSQL parser / remote compile for `20260802190000` | NOT VERIFIED: local `psql`/Supabase CLI unavailable; remote compile would violate the blocked apply gate |
| ESLint | PASS: 0 errors; 125 inherited `no-unused-vars` warnings |
| TypeScript app/scripts/tests | PASS |
| Vitest | PASS: 62 files, 417 tests |
| Emergency access static regression | PASS |
| Migration integrity | PASS: 339 files, 243 version groups/checksums |
| Canonical/behavior/tenant/security regressions | PASS |
| Production dependency audit | PASS: 0 vulnerabilities |
| Next.js production build | PASS on available Node 24.14.0; package contract requires Node `>=22 <23`, so Node 22 CI remains required |

## Release blockers

Read-only V2 preflight confirms:

- 153 legacy `ediel_test_runs` without deterministic tenant ownership;
- 15 nonterminal null-tenant runs (`draft=4`, `running=11`);
- 11 legacy `passed` results without run or snapshot;
- 3 active owner memberships without an active system role;
- 96 `NOT VALID` constraints;
- empty canonical migration manifest;
- four unsafe views, four publicly executable mutating definer functions, two
  open system tables and unsafe default ACLs.

Versions through `20260802180000` are registered, but their presence is not
accepted as behavioral proof. Real JWT/RLS, service-role negative, concurrency,
worker and external transport tests remain required.

## Controlled next step

The obsolete A-C ledger-repair sequence must not be run: the authoritative
remote ledger is current through `20260802180000`.

After explicit user approval of the documented persistent blast radius, apply
only `20260802190000_canonical_emergency_access_lockdown.sql` to the inspected
development project. Immediately execute
`scripts/sql/05_emergency_access_lockdown_verification.sql`, rerun Security
Advisor, and exercise anonymous, authenticated, tenant-A, tenant-B and
service-role runtime smoke tests. Stop and forward-fix on any regression before
starting later V2 phases. Never use the first apply against production.
